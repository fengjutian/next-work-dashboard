//! LAN scan probe (V2.5).
//!
//! Cross-platform LAN discovery using TCP connect to a fixed set of common
//! ports on every host in the local /24. Doesn't require admin / raw sockets
//! (works as a standard user) and works on Windows / Linux / macOS.
//!
//! Algorithm
//! ---------
//! 1. Discover the local IP via the UDP-socket trick (bind 0.0.0.0:0, connect
//!    to a public IP, read local_addr — no packets are actually sent).
//! 2. Compute the /24 subnet (e.g. 192.168.1.0/24 → hosts 1..=254).
//! 3. For each host, attempt TCP connect on a fixed set of common ports
//!    (22/80/443/445/3389/5353) with a short per-port timeout.
//! 4. Hosts with at least one successful connect are "up". Reverse-DNS the
//!    IP (best effort, 500ms timeout) to get a hostname.
//! 5. Return the up hosts as the payload; the TS-side storage layer merges
//!    them into the `net_probe_lan_hosts` table.
//!
//! Concurrency
//! -----------
//! Scans run in parallel — one worker thread per host — so a /24 scan with
//! 6 ports × 254 hosts finishes in roughly `per_port_timeout` × 6 wall time,
//! not `6 × per_port_timeout × 254`.
//!
//! Options:
//! - `subnet` (string, optional): explicit /24 base, e.g. "192.168.1.0". If
//!   omitted, the probe infers the local /24 from the OS.
//! - `ports` (array of u16, default [22, 80, 443, 445, 3389, 5353])
//! - `per_port_timeout_ms` (u32, default 300): per-attempt connect timeout
//! - `max_hosts` (u32, default 254): cap the number of hosts to scan
//!
//! Payload on success:
//!   { "subnet": "192.168.1.0/24", "scanned": 254, "found": 12,
//!     "hosts": [ { "ip": "192.168.1.1", "hostname": "router.lan", "open_ports": [80, 443] }, ... ] }
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, UdpSocket};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use hickory_resolver::name_server::TokioConnectionProvider;
use hickory_resolver::AsyncResolver;
use serde_json::{json, Value};
use tokio::runtime::Runtime;

use super::{Probe, ProbeSample};

const DEFAULT_PORTS: &[u16] = &[22, 80, 443, 445, 3389, 5353];
const DEFAULT_PER_PORT_TIMEOUT_MS: u64 = 300;

type TokioResolver = AsyncResolver<TokioConnectionProvider>;

pub struct LanScanProbe {
    runtime: Arc<Runtime>,
}

impl LanScanProbe {
    pub fn new() -> Self {
        let runtime = Runtime::new().expect("create tokio runtime for lan_scan probe");
        Self { runtime: Arc::new(runtime) }
    }
}

impl Probe for LanScanProbe {
    fn name(&self) -> &'static str {
        "lan_scan"
    }

    fn run(&self, _target: &str, options: &Value, timeout: Duration) -> ProbeSample {
        let started = Instant::now();
        // Outer timeout — clamp between 1s and 60s.
        let outer_timeout = timeout.clamp(Duration::from_secs(1), Duration::from_secs(60));

        // Resolve ports.
        let ports: Vec<u16> = options
            .get("ports")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|n| n.as_u64().and_then(|x| u16::try_from(x).ok()))
                    .collect()
            })
            .filter(|v: &Vec<u16>| !v.is_empty())
            .unwrap_or_else(|| DEFAULT_PORTS.to_vec());

        let per_port_timeout_ms: u64 = options
            .get("per_port_timeout_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_PER_PORT_TIMEOUT_MS)
            .clamp(50, 5_000);

        // Resolve subnet.
        let subnet = match options
            .get("subnet")
            .and_then(|v| v.as_str())
            .and_then(|s| parse_subnet(s))
        {
            Some(s) => s,
            None => match detect_local_subnet_v4() {
                Ok(s) => s,
                Err(e) => {
                    return ProbeSample {
                        success: false,
                        latency_ms: None,
                        error: Some(format!("subnet detect: {e}")),
                        payload: None,
                    };
                }
            },
        };

        let max_hosts: u32 = options
            .get("max_hosts")
            .and_then(|v| v.as_u64())
            .and_then(|n| u32::try_from(n).ok())
            .unwrap_or(254)
            .clamp(1, 1024);

        // Materialize the host list so we can move owned values into threads.
        let hosts: Vec<Ipv4Addr> = subnet.hosts().take(max_hosts as usize).collect();
        let (tx, rx) = mpsc::channel::<ScanResult>();
        let ports_arc = Arc::new(ports);
        let per_port = Duration::from_millis(per_port_timeout_ms);

        for host_ip in hosts.iter().copied() {
            // Each worker has its own reverse-DNS attempt (best-effort, with
            // its own timeout) to avoid blocking the rest of the scan.
            let tx = tx.clone();
            let ports = Arc::clone(&ports_arc);
            let runtime = self.runtime.clone();
            thread::spawn(move || {
                let mut open_ports: Vec<u16> = Vec::new();
                for &p in ports.iter() {
                    let addr = SocketAddr::new(IpAddr::V4(host_ip), p);
                    if TcpStream::connect_timeout(&addr, per_port).is_ok() {
                        open_ports.push(p);
                    }
                }
                let hostname = if !open_ports.is_empty() {
                    reverse_dns(runtime.clone(), host_ip, Duration::from_millis(500))
                } else {
                    None
                };
                let _ = tx.send(ScanResult {
                    ip: host_ip,
                    hostname,
                    open_ports,
                });
            });
        }
        // Drop the original sender so the channel closes when all workers finish.
        drop(tx);

        // Collect results, respecting the outer timeout.
        let collected = Mutex::new(Vec::<ScanResult>::new());
        loop {
            let remaining = outer_timeout.saturating_sub(started.elapsed());
            if remaining.is_zero() {
                break;
            }
            match rx.recv_timeout(remaining) {
                Ok(r) => {
                    if !r.open_ports.is_empty() {
                        collected.lock().unwrap().push(r);
                    }
                }
                Err(_) => break, // Disconnected or timeout
            }
        }
        // Drain any remaining quick results (workers may have finished just
        // after the outer timeout).
        while let Ok(r) = rx.try_recv() {
            if !r.open_ports.is_empty() {
                collected.lock().unwrap().push(r);
            }
        }
        let mut found = collected.into_inner().unwrap();
        found.sort_by_key(|r| r.ip);

        let total_ms = started.elapsed().as_secs_f64() * 1000.0;
        let subnet_str = format!(
            "{}.{}.{}.0/24",
            subnet.octets[0], subnet.octets[1], subnet.octets[2]
        );
        let hosts_json: Vec<Value> = found
            .iter()
            .map(|r| {
                json!({
                    "ip": r.ip.to_string(),
                    "hostname": r.hostname,
                    "open_ports": r.open_ports,
                })
            })
            .collect();

        ProbeSample {
            success: true,
            latency_ms: Some(total_ms),
            error: None,
            payload: Some(json!({
                "subnet": subnet_str,
                "scanned": hosts.len(),
                "found": found.len(),
                "hosts": hosts_json,
            })),
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct SubnetV4 {
    octets: [u8; 4],
}

impl SubnetV4 {
    fn hosts(&self) -> impl Iterator<Item = Ipv4Addr> + '_ {
        let base = self.octets[0] as u32 * 0x0100_0000
            + self.octets[1] as u32 * 0x0001_0000
            + self.octets[2] as u32 * 0x0000_0100;
        (1u32..=254).map(move |i| Ipv4Addr::from(base | i))
    }
}

fn parse_subnet(s: &str) -> Option<SubnetV4> {
    let parts: Vec<&str> = s.split('/').collect();
    let ip_str = parts[0];
    let octets: Vec<u8> = ip_str
        .split('.')
        .filter_map(|p| p.parse::<u8>().ok())
        .collect();
    if octets.len() != 4 {
        return None;
    }
    if parts.len() == 2 && parts[1] != "24" {
        return None;
    }
    Some(SubnetV4 {
        octets: [octets[0], octets[1], octets[2], octets[3]],
    })
}

fn detect_local_subnet_v4() -> Result<SubnetV4, String> {
    let sock = UdpSocket::bind("0.0.0.0:0").map_err(|e| format!("bind: {e}"))?;
    sock.connect("8.8.8.8:80").map_err(|e| format!("connect: {e}"))?;
    let local = sock.local_addr().map_err(|e| format!("local_addr: {e}"))?;
    match local.ip() {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            Ok(SubnetV4 {
                octets: [o[0], o[1], o[2], 0],
            })
        }
        IpAddr::V6(_) => Err("IPv6 local address; only IPv4 LAN scan is supported in V2.5".to_string()),
    }
}

struct ScanResult {
    ip: Ipv4Addr,
    hostname: Option<String>,
    open_ports: Vec<u16>,
}

fn reverse_dns(runtime: Arc<Runtime>, ip: Ipv4Addr, timeout: Duration) -> Option<String> {
    // Best-effort reverse DNS via hickory-resolver on the probe's tokio
    // runtime. We use the system resolver config (cached; ~10ms per lookup
    // on a warm resolver). If the lookup exceeds `timeout`, we abandon by
    // dropping the receiver.
    let (tx, rx) = mpsc::channel::<Option<String>>();
    let ip_addr = IpAddr::V4(ip);
    let handle = thread::spawn(move || {
        let result: Option<String> = runtime.block_on(async move {
            let resolver: Result<TokioResolver, _> = AsyncResolver::tokio_from_system_conf();
            match resolver {
                Ok(r) => {
                    let response = r.reverse_lookup(ip_addr).await.ok()?;
                    response.iter().next().map(|name| name.to_string())
                }
                Err(_) => None,
            }
        });
        let _ = tx.send(result);
    });
    let result = rx.recv_timeout(timeout).ok().flatten();
    let _ = handle.join();
    result
}
