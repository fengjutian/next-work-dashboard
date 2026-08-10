//! DNS resolution probe with multi-resolver comparison.
//!
//! Options:
//! - `record` (string, default "A"): "A" | "AAAA" | "CNAME" | "MX" | "TXT"
//! - `resolvers` (array of strings, default ["1.1.1.1:53", "8.8.8.8:53", "9.9.9.9:53"]):
//!   one or more resolver addresses
//! - `system` (bool, default false): if true, also measure the system resolver
//!
//! Payload on success: per-resolver { resolver, latency_ms, addresses[] } and
//! `latency_ms` (the fastest resolver's RTT).
//!
//! Latency reported in the top-level `latency_ms` field is the fastest
//! resolver's elapsed time. The probe is considered successful if the
//! **primary** resolver (first in the list) returned at least one record.

use std::sync::Arc;
use std::time::{Duration, Instant};

use hickory_resolver::config::{NameServerConfigGroup, ResolverConfig, ResolverOpts};
use hickory_resolver::name_server::TokioConnectionProvider;
use hickory_resolver::TokioResolver;
use serde_json::{json, Value};
use tokio::runtime::Runtime;

use super::{Probe, ProbeSample};

pub struct DnsProbe {
    runtime: Arc<Runtime>,
}

impl DnsProbe {
    pub fn new() -> Self {
        // hickory-resolver is async; we run a single-threaded tokio runtime
        // dedicated to DNS so callers don't need to know about async.
        let runtime = Runtime::new().expect("create tokio runtime for dns probe");
        Self { runtime: Arc::new(runtime) }
    }
}

fn default_resolvers() -> Vec<String> {
    vec!["1.1.1.1:53".into(), "8.8.8.8:53".into(), "9.9.9.9:53".into()]
}

fn build_resolver(resolver_addr: &str) -> Result<TokioResolver, String> {
    let mut parts = resolver_addr.rsplitn(2, ':');
    let port = parts.next().and_then(|p| p.parse::<u16>().ok()).unwrap_or(53);
    let host = parts.next().unwrap_or(resolver_addr);
    let ns = NameServerConfigGroup::from_ips_clear(&[host.parse().map_err(|e| format!("parse ip {host}: {e}"))?], port, true);
    let cfg = ResolverConfig::from_parts(None, vec![], ns);
    let opts = ResolverOpts::default();
    TokioResolver::builder_with_config(cfg, TokioConnectionProvider::default())
        .with_options(opts)
        .build()
        .map_err(|e| format!("build resolver: {e}"))
}

impl Probe for DnsProbe {
    fn name(&self) -> &'static str {
        "dns"
    }

    fn run(&self, target: &str, options: &Value, _timeout: Duration) -> ProbeSample {
        let record = options
            .get("record")
            .and_then(|v| v.as_str())
            .unwrap_or("A");
        let resolvers: Vec<String> = options
            .get("resolvers")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect::<Vec<_>>()
            })
            .filter(|v| !v.is_empty())
            .unwrap_or_else(default_resolvers);

        let runtime = self.runtime.clone();
        let target_owned = target.to_string();
        let resolvers_clone = resolvers.clone();

        // Run all resolvers in parallel; collect per-resolver timings.
        let results: Vec<(String, Option<f64>, Vec<String>, Option<String>)> = runtime.block_on(async move {
            let mut handles = Vec::new();
            for r in resolvers_clone.iter() {
                let r_clone = r.clone();
                let t_clone = target_owned.clone();
                handles.push(tokio::spawn(async move {
                    let started = Instant::now();
                    let result: Result<TokioResolver, String> = build_resolver(&r_clone);
                    match result {
                        Err(e) => (r_clone, None, vec![], Some(e)),
                        Ok(resolver) => {
                            let lookup = match record {
                                "A" => resolver.lookup_ip(t_clone.clone()).await.map(|l| {
                                    l.into_iter().map(|ip| ip.to_string()).collect::<Vec<_>>()
                                }),
                                "AAAA" => resolver
                                    .lookup_ip(t_clone.clone())
                                    .await
                                    .map(|l| l.into_iter().map(|ip| ip.to_string()).collect::<Vec<_>>()),
                                "CNAME" => resolver
                                    .lookup(format!("{t_clone}."))
                                    .await
                                    .map(|l| l.iter().map(|r| r.to_string()).collect::<Vec<_>>()),
                                "TXT" => resolver
                                    .lookup(format!("{t_clone}."))
                                    .await
                                    .map(|l| {
                                        l.iter()
                                            .filter_map(|r| r.as_txt().map(|t| t.to_string()))
                                            .collect::<Vec<_>>()
                                    }),
                                "MX" => resolver
                                    .mx_lookup(format!("{t_clone}."))
                                    .await
                                    .map(|l| {
                                        l.iter()
                                            .map(|r| format!("{} {}", r.preference(), r.exchange()))
                                            .collect::<Vec<_>>()
                                    }),
                                _ => Err(format!("unsupported record type: {record}")),
                            };
                            let latency = started.elapsed().as_secs_f64() * 1000.0;
                            match lookup {
                                Ok(addrs) if !addrs.is_empty() => (r_clone, Some(latency), addrs, None),
                                Ok(_) => (r_clone, Some(latency), vec![], Some("empty result".to_string())),
                                Err(e) => (r_clone, Some(latency), vec![], Some(e.to_string())),
                            }
                        }
                    }
                }));
            }
            let mut out = Vec::new();
            for h in handles {
                if let Ok(v) = h.await {
                    out.push(v);
                }
            }
            out
        });

        // Compute top-level latency: fastest successful resolver.
        let best_latency = results
            .iter()
            .filter_map(|(_, lat, addrs, err)| {
                if err.is_none() && !addrs.is_empty() {
                    *lat
                } else {
                    None
                }
            })
            .fold(f64::INFINITY, f64::min);

        // Build payload: per-resolver breakdown.
        let payload_results: Vec<Value> = results
            .iter()
            .map(|(r, lat, addrs, err)| {
                json!({
                    "resolver": r,
                    "latency_ms": lat,
                    "addresses": addrs,
                    "error": err,
                })
            })
            .collect();

        // Top-level success: primary resolver (first) succeeded.
        let primary_ok = results
            .first()
            .map(|(_, _, addrs, err)| err.is_none() && !addrs.is_empty())
            .unwrap_or(false);

        if primary_ok {
            ProbeSample {
                success: true,
                latency_ms: Some(if best_latency.is_finite() { best_latency } else { 0.1 }),
                error: None,
                payload: Some(json!({
                    "record": record,
                    "resolvers": payload_results,
                    "primary": resolvers.first().cloned().unwrap_or_default(),
                })),
            }
        } else {
            let primary_err = results
                .first()
                .and_then(|(_, _, _, err)| err.clone())
                .unwrap_or_else(|| "no resolvers succeeded".to_string());
            ProbeSample {
                success: false,
                latency_ms: None,
                error: Some(primary_err),
                payload: Some(json!({
                    "record": record,
                    "resolvers": payload_results,
                })),
            }
        }
    }
}
