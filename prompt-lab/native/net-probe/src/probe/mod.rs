//! Cross-platform probe implementations.
//!
//! V1.1 supports: icmp / tcp / dns / http.
//! V2 will add: traceroute.

pub mod icmp;
pub mod tcp;
pub mod dns;
pub mod http;

use std::time::Duration;

use serde_json::Value;

use crate::platform;

/// One probe attempt. Either `latency_ms` is set on success or `error` on failure.
#[derive(Debug, Clone)]
pub struct ProbeSample {
    pub success: bool,
    /// Overall latency for this probe in milliseconds. Probe-specific semantics:
    /// - icmp: round-trip time of the echo
    /// - tcp: time from connect() call to completion
    /// - dns: time to resolve via primary resolver
    /// - http: total time to first byte (TTFB)
    pub latency_ms: Option<f64>,
    pub error: Option<String>,
    /// Type-specific structured details (e.g. http waterfall, dns per-resolver).
    pub payload: Option<Value>,
}

/// Trait for a single probe attempt. Implementations must respect `timeout` and
/// never block longer than `timeout + small grace` (currently +500ms for OS quirks).
///
/// `options` is the probe-specific configuration (e.g. port for tcp, resolvers
/// for dns, url for http). Implementations should ignore unknown keys and use
/// their own defaults.
pub trait Probe: Send + Sync {
    #[allow(dead_code)]
    fn name(&self) -> &'static str;
    fn run(&self, target: &str, options: &Value, timeout: Duration) -> ProbeSample;
}

/// Factory: return the probe implementation for a given probe type string.
/// Unknown types return None.
pub fn probe_for(kind: &str) -> Option<Box<dyn Probe>> {
    match kind {
        "icmp" => Some(Box::new(icmp::IcmpProbe::new())),
        "tcp" => Some(Box::new(tcp::TcpProbe::new())),
        "dns" => Some(Box::new(dns::DnsProbe::new())),
        "http" => Some(Box::new(http::HttpProbe::new())),
        _ => None,
    }
}

// ── Shared helpers ──────────────────────────────────────────────────────

/// Resolve hostname / IP literal to socket addresses. Accepts:
/// - bare hostnames ("example.com")
/// - bare IPv4 literals ("1.1.1.1")
/// - bare IPv6 literals ("2001::1")
/// - host:port or [ipv6]:port (already-formed)
///
/// Strategy: try `target.to_socket_addrs()` first (handles already-formed
/// strings). If empty, append `:0` to the bare form, wrapping IPv6 literals
/// in `[...]`.
pub(crate) fn resolve(target: &str) -> std::io::Result<Vec<std::net::SocketAddr>> {
    use std::net::ToSocketAddrs;
    if let Ok(it) = target.to_socket_addrs() {
        let v: Vec<_> = it.collect();
        if !v.is_empty() {
            return Ok(v);
        }
    }
    // Fall back: append port. IPv6 literals need `[...]` wrapping.
    let with_port: String = if target.starts_with('[') {
        // [ipv6] without port.
        format!("{target}:0")
    } else if target.contains(':') {
        // Bare IPv6 literal like "2001::1".
        format!("[{target}]:0")
    } else {
        // Hostname or bare IPv4 literal.
        format!("{target}:0")
    };
    with_port.to_socket_addrs().map(|iter| iter.collect())
}

/// Re-export the platform ICMP helper (only used by icmp probe).
#[allow(dead_code)]
pub(crate) fn platform_icmp(addr: std::net::SocketAddr, timeout: Duration) -> Result<f64, String> {
    platform::icmp_echo(addr, timeout)
}
