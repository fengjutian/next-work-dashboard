//! TCP connect probe. Reports the time to complete the three-way handshake.
//!
//! Options:
//! - `port` (number, required if target has no port): port to connect to
//! - `ip_version` (string "v4"|"v6", optional, default "v4"): restrict to v4 or v6
//!
//! Payload on success: `{ "remote": "1.2.3.4:443", "ip_version": "v4" }`

use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::{resolve, Probe, ProbeSample};

pub struct TcpProbe;

impl TcpProbe {
    pub fn new() -> Self {
        Self
    }
}

impl Probe for TcpProbe {
    fn name(&self) -> &'static str {
        "tcp"
    }

    fn run(&self, target: &str, options: &Value, timeout: Duration) -> ProbeSample {
        let ip_version = options
            .get("ip_version")
            .and_then(|v| v.as_str())
            .unwrap_or("v4");

        // Delegate to the shared resolve helper. It already handles
        // "host", "host:port", bare IPv4, and bare/bracketed IPv6 literals
        // correctly (which the old hand-rolled rsplit_once logic did not —
        // it mangled bare IPv6 like "2001:db8::1" into "2001:db8:::0").
        let resolved = match resolve(target) {
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

        // If the target string carried a port (resolve baked it into the
        // SocketAddr), use it; otherwise fall back to options.port or 80.
        let port_from_target = resolved.first().map(|a| a.port()).filter(|p| *p != 0);
        let port: u16 = options
            .get("port")
            .and_then(|v| v.as_u64())
            .and_then(|n| u16::try_from(n).ok())
            .or(port_from_target)
            .unwrap_or(80);

        let addrs: Vec<SocketAddr> = resolved
            .into_iter()
            .map(|a| SocketAddr::new(a.ip(), port))
            .filter(|a| match ip_version {
                "v6" => a.is_ipv6(),
                _ => a.is_ipv4(),
            })
            .collect();

        if addrs.is_empty() {
            return ProbeSample {
                success: false,
                latency_ms: None,
                error: Some(format!("no {ip_version} address for {target}")),
                payload: None,
            };
        }

        let mut last_err: Option<String> = None;
        for addr in &addrs {
            let started = Instant::now();
            match TcpStream::connect_timeout(addr, timeout) {
                Ok(stream) => {
                    let latency = started.elapsed().as_secs_f64() * 1000.0;
                    let _ = stream.shutdown(std::net::Shutdown::Both);
                    let ip_version_str = if addr.is_ipv4() { "v4" } else { "v6" };
                    return ProbeSample {
                        success: true,
                        latency_ms: Some(if latency > 0.0 { latency } else { 0.1 }),
                        error: None,
                        payload: Some(json!({
                            "remote": addr.to_string(),
                            "ip_version": ip_version_str,
                            "port": port,
                        })),
                    };
                }
                Err(e) => {
                    last_err = Some(format!("connect: {e}"));
                }
            }
        }
        ProbeSample {
            success: false,
            latency_ms: None,
            error: last_err,
            payload: None,
        }
    }
}
