//! ICMP probe. Cross-platform: IcmpSendEcho (v4) / Icmp6SendEcho2 (v6) on
//! Windows, raw socket (v4 / v6) on Unix. The probe kind stays "icmp"; the
//! IP family is auto-detected from the resolved address (or pinned by the
//! `ip_version` option in V1.1.1+).

use std::time::Duration;

use serde_json::Value;

use super::{resolve, Probe, ProbeSample};
use crate::platform;

pub struct IcmpProbe;

impl IcmpProbe {
    pub fn new() -> Self {
        Self
    }
}

impl Probe for IcmpProbe {
    fn name(&self) -> &'static str {
        "icmp"
    }

    fn run(&self, target: &str, options: &Value, timeout: Duration) -> ProbeSample {
        let ip_version = match options.get("ip_version").and_then(|v| v.as_str()) {
            Some(s) => s,
            None => "auto",
        };

        let addrs = match resolve(target) {
            Ok(v) => v,
            Err(e) => {
                return ProbeSample {
                    success: false,
                    latency_ms: None,
                    error: Some(format!("dns: {e}")),
                    payload: None,
                };
            }
        };

        // Filter addresses by ip_version preference.
        let filtered: Vec<_> = addrs
            .into_iter()
            .filter(|a| match ip_version {
                "v4" => a.is_ipv4(),
                "v6" => a.is_ipv6(),
                _ => true, // auto: try in resolver order
            })
            .collect();

        if filtered.is_empty() {
            return ProbeSample {
                success: false,
                latency_ms: None,
                error: Some(format!("no {ip_version} address for {target}")),
                payload: None,
            };
        }

        let mut last_err: Option<String> = None;
        for addr in &filtered {
            let result = if addr.is_ipv4() {
                platform::icmp_echo(*addr, timeout)
            } else {
                platform::icmp6_echo(*addr, timeout)
            };
            match result {
                Ok(latency) => {
                    let ip_version_str = if addr.is_ipv4() { "v4" } else { "v6" };
                    return ProbeSample {
                        success: true,
                        latency_ms: Some(latency),
                        error: None,
                        payload: Some(serde_json::json!({
                            "ip_version": ip_version_str,
                            "remote": addr.to_string(),
                        })),
                    };
                }
                Err(e) => {
                    last_err = Some(e);
                }
            }
        }
        ProbeSample {
            success: false,
            latency_ms: None,
            error: last_err.or_else(|| Some("no address".to_string())),
            payload: None,
        }
    }
}
