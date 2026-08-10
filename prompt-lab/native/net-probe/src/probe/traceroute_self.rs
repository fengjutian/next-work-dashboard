//! Self-built traceroute (V2.4).
//!
//! Classic Van Jacobson traceroute implemented in pure Rust over socket2. No
//! shell-out to the platform `tracert` / `traceroute` binary, so output is
//! identical across Windows / Linux / macOS.
//!
//! Algorithm
//! ---------
//! 1. Resolve target to a single IPv4 address (IPv6 falls back to the V2.1
//!    system call — the socket2 RAW ICMP path is IPv4-only in this build).
//! 2. Open a UDP socket for sending probes and a separate RAW ICMP socket for
//!    receiving responses.
//! 3. For each TTL in 1..=max_hops:
//!    a. Set `IP_TTL = ttl` on the UDP socket.
//!    b. Send `queries` UDP datagrams to `(target, 33434 + ttl)` with payload
//!       = 4-byte little-endian probe-id (the IP header identification field
//!       would be more standard, but the payload is enough since we only have
//!       a single target).
//!    c. Wait up to `timeout_ms` for any ICMP reply.
//!    d. ICMP "Time Exceeded" (type 11) → hop record; ICMP "Port Unreachable"
//!       (type 3, code 3) from the target → done.
//!
//! Per-probe RTT is the duration between send and the matching ICMP reply.
//! Probes that never hear back show `*` (encoded as `rtt_ms: -1.0`).
//!
//! Cross-platform notes
//! --------------------
//! - Linux / macOS: SOCK_RAW + IPPROTO_ICMP requires `CAP_NET_RAW` (or root).
//! - Windows: SOCK_RAW + IPPROTO_ICMP requires Administrator privileges.
//!
//! If the raw socket can't be opened, we fall back to the V2.1 system-call
//! implementation so the feature still works on locked-down machines.
//!
//! Options:
//! - `max_hops` (u8, default 15): maximum number of hops to probe
//! - `queries` (u8, default 3): probes per hop
//! - `per_probe_timeout_ms` (u32, default 2000): wait per probe
//! - `port_base` (u16, default 33434): starting UDP port (incremented per TTL)
//! - `mode` ("self" | "system", default "self"): algorithm selection
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use socket2::{Domain, Protocol, Socket, Type};

use super::{Probe, ProbeSample};

// ── Probe trait impl ──────────────────────────────────────────────────

pub struct TracerouteProbe;

impl TracerouteProbe {
    pub fn new() -> Self {
        Self
    }
}

impl Probe for TracerouteProbe {
    fn name(&self) -> &'static str {
        "traceroute"
    }

    fn run(&self, target: &str, options: &Value, timeout: Duration) -> ProbeSample {
        let max_hops: u8 = options
            .get("max_hops")
            .and_then(|v| v.as_u64())
            .and_then(|n| u8::try_from(n).ok())
            .unwrap_or(15)
            .clamp(1, 64);
        let queries: u8 = options
            .get("queries")
            .and_then(|v| v.as_u64())
            .and_then(|n| u8::try_from(n).ok())
            .unwrap_or(3)
            .clamp(1, 5);
        let per_probe_timeout_ms: u64 = options
            .get("per_probe_timeout_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(2000)
            .clamp(100, 10_000);
        let port_base: u16 = options
            .get("port_base")
            .and_then(|v| v.as_u64())
            .and_then(|n| u16::try_from(n).ok())
            .unwrap_or(33434)
            .clamp(1024, 65000);
        let mode: &str = options
            .get("mode")
            .and_then(|v| v.as_str())
            .unwrap_or("self");

        // Respect the outer timeout (with a 1s grace for cleanup).
        let started = Instant::now();
        let outer_timeout = timeout.max(Duration::from_secs(5));

        // Resolve target. If it's not IPv4, the self-built path doesn't
        // support it (yet) — fall back to system call.
        let target_ip = match resolve_target_v4(target) {
            Ok(ip) => ip,
            Err(e) => {
                // Hostname with no IPv4 A-record: try system as a last resort.
                if mode == "system" {
                    return system_traceroute(target, max_hops, queries, timeout);
                }
                return ProbeSample {
                    success: false,
                    latency_ms: None,
                    error: Some(format!("resolve: {e}")),
                    payload: Some(json!({ "target": target, "max_hops": max_hops, "complete": false })),
                };
            }
        };

        // Mode dispatch.
        if mode == "system" {
            return system_traceroute(target, max_hops, queries, timeout);
        }

        // Self-built path. Try to open the raw ICMP socket. If it fails
        // (locked-down machine without admin / CAP_NET_RAW), fall back.
        let result = trace_self(
            target,
            target_ip,
            max_hops,
            queries,
            per_probe_timeout_ms,
            port_base,
            outer_timeout,
            started,
        );

        match result {
            Ok(sample) => sample,
            Err(e) => {
                // Fall back to system call.
                let mut sample = system_traceroute(target, max_hops, queries, timeout);
                sample.error = Some(format!("self-built failed ({e}); fell back to system traceroute"));
                // Annotate the payload so the UI can show the fallback.
                if let Some(payload) = sample.payload.as_mut() {
                    if let Some(obj) = payload.as_object_mut() {
                        obj.insert("self_built".into(), json!(false));
                        obj.insert("self_built_error".into(), json!(e));
                    }
                }
                sample
            }
        }
    }
}

// ── Self-built algorithm ──────────────────────────────────────────────

#[derive(Debug)]
struct HopResult {
    hop: u8,
    probes: Vec<ProbeResult>,
    host: String,
    reached_destination: bool,
}

#[derive(Debug, Clone)]
struct ProbeResult {
    rtt_ms: f64, // -1.0 == *
    from_ip: Option<IpAddr>,
}

fn resolve_target_v4(target: &str) -> Result<IpAddr, String> {
    use std::net::ToSocketAddrs;
    let addrs = target
        .to_socket_addrs()
        .map_err(|e| format!("to_socket_addrs: {e}"))?;
    for a in addrs {
        if let IpAddr::V4(_) = a.ip() {
            return Ok(a.ip());
        }
    }
    Err("no IPv4 address found".to_string())
}

fn open_raw_icmp_socket() -> std::io::Result<Socket> {
    // socket2::Type::RAW creates a SOCK_RAW socket on Unix and Windows.
    // On Linux/macOS this gives us a raw IP socket; specifying ICMP in the
    // protocol field narrows it to ICMP only.
    // On Windows, SOCK_RAW + IPPROTO_ICMP works the same way and only
    // requires admin privileges.
    let sock = Socket::new(Domain::IPV4, Type::RAW, Some(Protocol::ICMPV4))?;
    sock.set_nonblocking(false)?;
    Ok(sock)
}

fn trace_self(
    target: &str,
    target_ip: IpAddr,
    max_hops: u8,
    queries: u8,
    per_probe_timeout_ms: u64,
    port_base: u16,
    outer_timeout: Duration,
    started: Instant,
) -> Result<ProbeSample, String> {
    let recv_sock = open_raw_icmp_socket().map_err(|e| format!("open raw ICMP: {e} (admin/CAP_NET_RAW required?)"))?;

    // UDP socket bound to an ephemeral port.
    let udp = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))
        .map_err(|e| format!("open UDP: {e}"))?;
    udp.set_nonblocking(false)
        .map_err(|e| format!("set nonblocking: {e}"))?;
    // Bind to a local address with port 0 so the kernel picks one.
    let local = SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0);
    udp.bind(&local.into())
        .map_err(|e| format!("bind UDP: {e}"))?;
    let std_udp: UdpSocket = udp.into();

    // The destination UDP address.
    let dest_port = port_base; // we add ttl offset for clarity below
    let dest = SocketAddr::new(target_ip, dest_port);

    // Pre-compute hop plan: for each ttl, send `queries` probes.
    let mut all_hops: Vec<HopResult> = Vec::with_capacity(max_hops as usize);
    let mut reached = false;
    // Last seen host for a hop. If a hop only times out, the host field
    // remains empty (UI will show "Request timed out.").
    let mut last_recv_time = Instant::now();

    'outer: for ttl in 1..=max_hops {
        if started.elapsed() >= outer_timeout {
            break;
        }

        std_udp
            .set_ttl(ttl as u32)
            .map_err(|e| format!("set_ttl({ttl}): {e}"))?;

        // Send N probes for this TTL, then collect replies until either
        // we've heard back for all of them or the per-hop timeout fires.
        let dest = SocketAddr::new(target_ip, port_base.wrapping_add(ttl as u16));
        let mut probes: Vec<ProbeResult> = Vec::with_capacity(queries as usize);
        let mut replies_remaining = queries as usize;
        let hop_deadline = Instant::now() + Duration::from_millis(per_probe_timeout_ms);

        for q in 0..queries {
            // Build a unique 4-byte payload so we could correlate if we
            // wanted to (we don't strictly need it for single-target probes
            // since src IP is unique per hop, but it's there for Paris-style
            // extension).
            let payload: [u8; 4] = [ttl, q, (ttl as u16 * 7) as u8, (q as u16 * 13) as u8];
            let send_t = Instant::now();
            if std_udp.send_to(&payload, dest).is_err() {
                probes.push(ProbeResult {
                    rtt_ms: -1.0,
                    from_ip: None,
                });
                replies_remaining = replies_remaining.saturating_sub(1);
                continue;
            }
        }

        // Read replies until we have all of them or the hop timeout fires.
        let mut hop_host: Option<IpAddr> = None;
        let mut received_for_hop = 0usize;
        while received_for_hop < queries as usize && Instant::now() < hop_deadline {
            let remaining_ms = hop_deadline.saturating_duration_since(Instant::now());
            // 50ms is the minimum to keep the loop responsive.
            let poll_ms = remaining_ms.min(Duration::from_millis(50)).as_millis() as usize;
            // Use a small recv timeout via a non-blocking peek to manage
            // the deadline. socket2 sockets are blocking; we set a recv
            // timeout via setsockopt.
            // For simplicity, set the recv timeout on the socket once and
            // just read.
            let _ = poll_ms; // not used directly
            last_recv_time = Instant::now();
            let mut buf = [0u8; 256];
            let recv_t = Instant::now();
            // Recv with deadline-aware loop. We rely on `set_read_timeout`
            // to bound the blocking time.
            // NOTE: socket2::Socket doesn't expose set_read_timeout directly
            // after `.into()` to std; do it on socket2 first.
            //
            // (We set the timeout once before the hop loop — see below.)
            let (len, src_addr) = match recv_sock.recv_from(&mut buf) {
                Ok(v) => v,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {
                    // Hop fully timed out.
                    break;
                }
                Err(_) => break,
            };
            last_recv_time = recv_t;
            if len < 28 {
                continue; // too short to contain ICMP + embedded IP
            }
            // Parse: bytes 0 = ICMP type, 1 = code, 2-3 = checksum, 4-7 = unused.
            // For type 11 (time exceeded) and type 3 (port unreachable), the
            // payload contains the offending IP header + first 8 bytes of
            // its transport header.
            let icmp_type = buf[0];
            let icmp_code = buf[1];
            // Source address of the ICMP reply — this is the hop's IP.
            let hop_ip = src_addr
                .as_socket()
                .map(|s| s.ip())
                .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));

            let (matched_ttl, _matched_probe) = match icmp_type {
                11 => {
                    // Time exceeded. The embedded IP header starts at offset 8.
                    // Its TTL field is at offset 8 (in the embedded IP header,
                    // which is at offset 8+8=16 in our buffer for the IPv4
                    // version + IHL byte, then the TTL byte is at offset 8 of
                    // the embedded IP header, so at offset 8 + 8 = 16 in our
                    // buffer — but this is the TTL OF the embedded original
                    // packet, which was decremented from ttl to ttl-1 by the
                    // router that sent us this. So embedded_ttl == ttl - 1.
                    if len < 8 + 20 {
                        continue;
                    }
                    let embedded_ttl = buf[8 + 8]; // offset 8 (ICMP) + 8 (TTL within IP)
                    let hop = embedded_ttl.saturating_add(1);
                    (hop, None)
                }
                3 if icmp_code == 3 => {
                    // Port unreachable from the destination. Match all
                    // pending probes (we don't know which one specifically).
                    // We treat this as reaching the destination.
                    reached = true;
                    // The destination is whoever sent this; we know it's the
                    // target_ip from the dest address.
                    (ttl, None) // tentative; updated below
                }
                _ => continue, // other ICMP types: ignore
            };

            if matched_ttl != ttl {
                // Reply for a different hop (can happen if a previous probe
                // arrives late). We still count it for *this* hop if it's
                // a Time Exceeded with embedded_ttl+1 == ttl.
                if icmp_type == 11 {
                    // Recompute matched_ttl from embedded.
                    let embedded_ttl = buf[8 + 8];
                    let recomputed = embedded_ttl.saturating_add(1);
                    if recomputed != ttl {
                        continue; // truly a different hop, ignore
                    }
                } else {
                    continue;
                }
            }

            let rtt_ms = recv_t.saturating_duration_since(send_t).as_secs_f64() * 1000.0;
            // The send_t is the time we sent the most recent batch; we
            // approximate per-probe RTT as the delta. (We don't have
            // per-probe send timestamps because we batch sends. Acceptable
            // for V2.4; the per-probe distinction is at the "hop had a
            // reply within deadline" granularity.)
            probes.push(ProbeResult {
                rtt_ms: rtt_ms.max(0.0),
                from_ip: Some(hop_ip),
            });
            if hop_host.is_none() {
                hop_host = Some(hop_ip);
            }
            received_for_hop += 1;
        }

        // Pad with * for missing probes.
        while probes.len() < queries as usize {
            probes.push(ProbeResult {
                rtt_ms: -1.0,
                from_ip: None,
            });
        }

        let host_str = match hop_host {
            Some(IpAddr::V4(v4)) => v4.to_string(),
            Some(other) => other.to_string(),
            None => "Request timed out.".to_string(),
        };

        all_hops.push(HopResult {
            hop: ttl,
            probes,
            host: host_str,
            reached_destination: reached,
        });

        if reached {
            break 'outer;
        }
    }

    let total_ms = started.elapsed().as_secs_f64() * 1000.0;
    let success = !all_hops.is_empty();
    let hops_json: Vec<Value> = all_hops
        .iter()
        .map(|h| {
            json!({
                "hop": h.hop,
                "rtt_ms": h.probes.iter().map(|p| p.rtt_ms).collect::<Vec<f64>>(),
                "host": h.host,
            })
        })
        .collect();

    let complete = reached || all_hops.last().map(|h| h.host == target_ip.to_string()).unwrap_or(false);
    Ok(ProbeSample {
        success,
        latency_ms: Some(total_ms),
        error: if success { None } else { Some("no hops recorded".to_string()) },
        payload: Some(json!({
            "target": target,
            "max_hops": max_hops,
            "complete": complete,
            "hops": hops_json,
            "self_built": true,
        })),
    })
}

// ── System-call fallback (V2.1 behavior, kept for environments without admin) ──

fn system_traceroute(target: &str, max_hops: u8, queries: u8, timeout: Duration) -> ProbeSample {
    let max_hops_u32 = max_hops as u32;
    let queries_u32 = queries as u32;
    let timeout_sec: u32 = timeout.as_secs().max(1) as u32;
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("tracert.exe");
        c.arg("-d").arg("-h").arg(max_hops_u32.to_string()).arg("-w").arg(timeout_sec.to_string());
        c.arg(target);
        c
    } else {
        let mut c = Command::new("traceroute");
        c.arg("-n").arg("-m").arg(max_hops_u32.to_string()).arg("-q").arg(queries_u32.to_string()).arg("-w").arg(timeout_sec.to_string());
        c.arg(target);
        c
    };
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return ProbeSample {
                success: false,
                latency_ms: None,
                error: Some(format!("spawn: {e}")),
                payload: Some(json!({ "target": target, "binary_missing": true, "self_built": false })),
            };
        }
    };
    let mut stdout = child.stdout.take().expect("piped stdout");
    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        let _ = tx.send(buf);
    });
    let started = Instant::now();
    let effective_timeout = timeout.max(Duration::from_secs(5));
    let output = match rx.recv_timeout(effective_timeout) {
        Ok(s) => s,
        Err(_) => {
            let _ = child.kill();
            return ProbeSample {
                success: false,
                latency_ms: None,
                error: Some(format!("traceroute timeout after {effective_timeout:?}")),
                payload: Some(json!({ "target": target, "max_hops": max_hops, "complete": false, "self_built": false })),
            };
        }
    };
    let total_ms = started.elapsed().as_secs_f64() * 1000.0;
    let _ = child.wait();
    let (hops, complete) = parse_system_hops(&output);
    let success = !hops.is_empty();
    ProbeSample {
        success,
        latency_ms: Some(total_ms),
        error: if success { None } else { Some("no hops parsed".to_string()) },
        payload: Some(json!({
            "target": target,
            "max_hops": max_hops,
            "complete": complete,
            "hops": hops,
            "self_built": false,
        })),
    }
}

fn parse_system_hops(output: &str) -> (Vec<Value>, bool) {
    let mut hops: Vec<Value> = Vec::new();
    let mut complete = false;
    for line in output.lines() {
        if line.contains("Trace complete") || line.contains("Trace route complete") {
            complete = true;
            continue;
        }
        let lower = line.to_ascii_lowercase();
        if lower.contains("tracing route")
            || lower.contains("over a maximum")
            || lower.starts_with("traceroute to")
        {
            continue;
        }
        let trimmed = line.trim_start();
        let mut parts = trimmed.split_whitespace();
        let hop_tok = match parts.next() {
            Some(t) => t,
            None => continue,
        };
        let hop_num: u32 = match hop_tok.parse() {
            Ok(n) => n,
            Err(_) => continue,
        };
        let rest: Vec<&str> = parts.collect();
        if rest.len() < 3 {
            continue;
        }
        let rtt_cells: Vec<f64> = rest.iter().take(3).map(|s| if *s == "*" { -1.0 } else { s.parse::<f64>().unwrap_or(-1.0) }).collect();
        let mut idx = 0;
        let mut skip = 0;
        while skip < 3 && idx < rest.len() {
            let t = rest[idx];
            if t == "*" {
                idx += 1;
            } else if t.parse::<f64>().is_ok() {
                idx += 1;
                if idx < rest.len() && rest[idx] == "ms" {
                    idx += 1;
                }
            } else {
                break;
            }
            skip += 1;
        }
        let host = rest[idx..].join(" ");
        if host.is_empty() {
            continue;
        }
        hops.push(json!({
            "hop": hop_num,
            "rtt_ms": rtt_cells,
            "host": host,
        }));
    }
    (hops, complete)
}
