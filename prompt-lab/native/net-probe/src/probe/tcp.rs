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
        // Determine port: from target ("host:port") or from options.port.
        let (host, port_from_target) = match target.rsplit_once(':') {
            Some((h, p)) => (h, p.parse::<u16>().ok()),
            None => (target, None),
        };
        let port: u16 = options
            .get("port")
            .and_then(|v| v.as_u64())
            .and_then(|n| u16::try_from(n).ok())
            .or(port_from_target)
            .unwrap_or(80);

        let ip_version = options
            .get("ip_version")
            .and_then(|v| v.as_str())
            .unwrap_or("v4");

        let addrs = match resolve(&format!("{host}:0")) {
            Ok(mut addrs) => {
                // Filter by IP version if requested.
                addrs.retain(|a| match ip_version {
                    "v6" => a.is_ipv6(),
                    _ => a.is_ipv4(),
                });
                if addrs.is_empty() {
                    return ProbeSample {
                        success: false,
                        latency_ms: None,
                        error: Some(format!("no {ip_version} address for {host}")),
                        payload: None,
                    };
                }
                addrs
            }
            Err(e) => {
                return ProbeSample {
                    success: false,
                    latency_ms: None,
                    error: Some(format!("dns: {e}")),
                    payload: None,
                };
            }
        };

        let mut last_err: Option<String> = None;
        for addr in &addrs {
            let target: SocketAddr = SocketAddr::new(addr.ip(), port);
            let started = Instant::now();
            match TcpStream::connect_timeout(&target, timeout) {
                Ok(stream) => {
                    let latency = started.elapsed().as_secs_f64() * 1000.0;
                    let _ = stream.shutdown(std::net::Shutdown::Both);
                    let ip_version_str = if addr.is_ipv4() { "v4" } else { "v6" };
                    return ProbeSample {
                        success: true,
                        latency_ms: Some(if latency > 0.0 { latency } else { 0.1 }),
                        error: None,
                        payload: Some(json!({
                            "remote": target.to_string(),
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
