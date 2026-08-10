//! Cross-platform ICMP probe.
//!
//! V1 supports only the `icmp` probe type. V2 will add tcp / dns / http.

use std::time::Duration;

use crate::platform;

/// One probe attempt. Either `latency_ms` is set on success or `error` on failure.
#[derive(Debug, Clone)]
pub struct ProbeSample {
    pub success: bool,
    pub latency_ms: Option<f64>,
    pub error: Option<String>,
}

/// Trait for a single probe attempt. Implementations must respect `timeout` and
/// never block longer than `timeout + small grace` (currently +500ms for OS quirks).
pub trait Probe: Send + Sync {
    fn name(&self) -> &'static str;
    fn run(&self, target: &str, timeout: Duration) -> ProbeSample;
}

/// Factory: return the probe implementation for a given probe type string.
/// Unknown types return None.
pub fn probe_for(kind: &str) -> Option<Box<dyn Probe>> {
    match kind {
        "icmp" => Some(Box::new(IcmpProbe::new())),
        _ => None,
    }
}

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

    fn run(&self, target: &str, timeout: Duration) -> ProbeSample {
        // Resolve hostname to socket address. We do this per-probe; DNS cache
        // is a V2 concern (it's cheap and hostnames rarely change).
        let addrs = match resolve(target) {
            Ok(v) => v,
            Err(e) => {
                return ProbeSample {
                    success: false,
                    latency_ms: None,
                    error: Some(format!("dns: {e}")),
                };
            }
        };

        // Try each resolved address until one succeeds. Most hostnames resolve
        // to a single address, so this is a no-op in the common case.
        let mut last_err: Option<String> = None;
        for addr in &addrs {
            match platform::icmp_echo(*addr, timeout) {
                Ok(latency) => {
                    return ProbeSample {
                        success: true,
                        latency_ms: Some(latency),
                        error: None,
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
        }
    }
}

fn resolve(target: &str) -> std::io::Result<Vec<std::net::SocketAddr>> {
    use std::net::ToSocketAddrs;
    // V1: IPv4 only. IPv6 is V2; we intentionally avoid the bigger code path
    // and the ToSocketAddrs dual-stack surprises for now.
    target.to_socket_addrs().map(|iter| iter.collect())
}
