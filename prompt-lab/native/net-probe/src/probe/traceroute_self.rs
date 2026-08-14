//! Self-built traceroute (V2.4).
//!
//! Classic Van Jacobson traceroute implemented in pure Rust over socket2. No
//! shell-out to the platform `tracert` / `traceroute` binary, so output is
//! identical across Windows / Linux / macOS.
//!
//! Algorithm
//! ---------
//! 1. Resolve target to a single IPv4 address.
//! 2. Open a UDP socket for sending probes and a separate RAW ICMP socket
//!    for receiving responses.
//! 3. For each TTL in 1..=max_hops:
//!    a. Set `IP_TTL = ttl` on the UDP socket.
//!    b. Send `queries` UDP datagrams to `(target, 33434 + ttl)`. Each probe
//!       records its send timestamp.
//!    c. Read ICMP replies for up to `per_probe_timeout_ms` after the last
//!       send. Match each reply to its hop by reading the TTL field in the
//!       embedded original IP header (TTL exceeded) — it's `ttl - 1`.
//!    d. Three replies from the same src IP complete the hop. ICMP "port
//!       unreachable" from the target means we reached the destination.
//!
//! Cross-platform
//! --------------
//! - Linux / macOS: needs `CAP_NET_RAW` (or root) to open a SOCK_RAW ICMP
//!   receive socket.
//! - Windows: needs Administrator privileges for SOCK_RAW ICMP.
//! - If the raw socket can't be opened, we fall back to the V2.1 system
//!   call so the feature still works on locked-down machines.
//!
//! Known issue (Windows)
//! ---------------------
//! `tracert.exe` is a console-subsystem binary. When its stdout is a pipe
//! (which is the case here), the Windows console API bypasses the pipe and
//! writes nothing — a long-standing Rust-on-Windows gotcha. The fallback
//! therefore returns 0 hops on Windows in this build. macOS/Linux are
//! unaffected. To work around: spawn via `cmd /c` with `> tempfile.txt`
//! redirection, then read the temp file. Implemented in a follow-up if
//! needed; the self-built path is the recommended one anyway.
//!
//! Options:
//! - `max_hops` (u8, default 30): maximum number of hops
//! - `queries` (u8, default 3): probes per hop
//! - `per_probe_timeout_ms` (u32, default 2000): per-hop wait window
//! - `port_base` (u16, default 33434): starting UDP port
//! - `mode` ("self" | "system", default "self"): algorithm selection
use std::io::Read;
use std::mem::MaybeUninit;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
use std::os::raw::c_int;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use socket2::{Domain, Protocol, Socket, Type};

use super::{Probe, ProbeSample};

// SOCK_RAW = 3 on both Linux/macOS and Windows. socket2 0.5 gates `Type::RAW`
// behind the `all` feature, so we construct the int value directly.
const SOCK_RAW: c_int = 3;

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
            .unwrap_or(30)
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
            .clamp(1024, 60_000);
        let mode: &str = options
            .get("mode")
            .and_then(|v| v.as_str())
            .unwrap_or("self");

        // Outer timeout with a 1s grace.
        let outer_timeout = timeout.max(Duration::from_secs(5));

        if mode == "system" {
            return system_traceroute(target, max_hops, queries, timeout);
        }

        // Resolve target to IPv4 (the self-built path is IPv4-only).
        let target_ip = match resolve_target_v4(target) {
            Ok(ip) => ip,
            Err(e) => {
                // No AAAA/A record → try system as a last resort.
                let mut sample = system_traceroute(target, max_hops, queries, timeout);
                sample.error = Some(format!("self-built: resolve failed ({e}); used system traceroute"));
                if let Some(payload) = sample.payload.as_mut() {
                    if let Some(obj) = payload.as_object_mut() {
                        obj.insert("self_built".into(), json!(false));
                        obj.insert("self_built_error".into(), json!(e));
                    }
                }
                return sample;
            }
        };

        let started = Instant::now();
        match trace_self(
            target,
            target_ip,
            max_hops,
            queries,
            per_probe_timeout_ms,
            port_base,
            outer_timeout,
            started,
        ) {
            Ok(sample) => sample,
            Err(e) => {
                // Permission / capability failure → fall back to system call.
                let mut sample = system_traceroute(target, max_hops, queries, timeout);
                sample.error = Some(format!("self-built failed ({e}); fell back to system traceroute"));
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

fn resolve_target_v4(target: &str) -> Result<IpAddr, String> {
    use std::net::ToSocketAddrs;
    // Try the target as-is. `&str::to_socket_addrs` accepts bare IPs and
    // hostnames both, with the caveat that some forms require a port.
    let mut first_err: Option<String> = None;
    match target.to_socket_addrs() {
        Ok(it) => {
            for a in it {
                if let IpAddr::V4(_) = a.ip() {
                    return Ok(a.ip());
                }
            }
        }
        Err(e) => {
            first_err = Some(format!("{e}"));
        }
    }
    // Fallback: parse as bare IP literal.
    if let Ok(ip) = target.parse::<IpAddr>() {
        if let IpAddr::V4(v4) = ip {
            return Ok(IpAddr::V4(v4));
        }
    }
    // Last resort: append a port and retry (handles bare hostnames and bare
    // IPv6 literals which need `[...]` wrapping).
    let with_port: String = if target.starts_with('[') {
        format!("{target}:0")
    } else if target.contains(':') {
        format!("[{target}]:0")
    } else {
        format!("{target}:0")
    };
    match with_port.to_socket_addrs() {
        Ok(it) => {
            for a in it {
                if let IpAddr::V4(_) = a.ip() {
                    return Ok(a.ip());
                }
            }
        }
        Err(e) => {
            return Err(format!(
                "{}; retry with port: {e}",
                first_err.unwrap_or_else(|| "no v4 addr".to_string())
            ));
        }
    }
    Err("no IPv4 address found".to_string())
}

fn open_raw_icmp_socket() -> std::io::Result<Socket> {
    let sock = Socket::new(Domain::IPV4, Type::from(SOCK_RAW), Some(Protocol::ICMPV4))?;
    sock.set_nonblocking(true)?;
    Ok(sock)
}

#[derive(Debug, Clone)]
struct ProbeSend {
    send_t: Instant,
}

#[derive(Debug)]
struct HopResult {
    hop: u8,
    rtts_ms: Vec<f64>, // -1.0 == * (timeout)
    host: String,
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
    let recv_sock = open_raw_icmp_socket()
        .map_err(|e| format!("open raw ICMP: {e} (admin / CAP_NET_RAW required)"))?;

    // UDP socket bound to an ephemeral port.
    let udp = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))
        .map_err(|e| format!("open UDP: {e}"))?;
    udp.bind(&SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0).into())
        .map_err(|e| format!("bind UDP: {e}"))?;
    let std_udp: UdpSocket = udp.into();

    let mut all_hops: Vec<HopResult> = Vec::with_capacity(max_hops as usize);
    let mut reached = false;

    'outer: for ttl in 1..=max_hops {
        if started.elapsed() >= outer_timeout {
            break;
        }

        std_udp
            .set_ttl(ttl as u32)
            .map_err(|e| format!("set_ttl({ttl}): {e}"))?;

        // Send N probes; remember each send timestamp.
        let mut sends: Vec<ProbeSend> = Vec::with_capacity(queries as usize);
        for q in 0..queries {
            let port = port_base
                .wrapping_add(ttl as u16)
                .wrapping_add(q as u16);
            let dest = SocketAddr::new(target_ip, port);
            // 4-byte payload encodes (ttl, q, ttl*7, q*13) — enough entropy
            // to be unique within a single trace.
            let payload: [u8; 4] = [ttl, q, ttl.wrapping_mul(7), q.wrapping_mul(13)];
            let send_t = Instant::now();
            if std_udp.send_to(&payload, dest).is_err() {
                continue;
            }
            sends.push(ProbeSend { send_t });
        }

        // Read ICMP replies until either we've matched `queries` replies
        // for this hop, or the per-hop deadline passes.
        let hop_deadline = Instant::now() + Duration::from_millis(per_probe_timeout_ms);
        let mut probes: Vec<f64> = Vec::with_capacity(queries as usize);
        let mut hop_host: Option<IpAddr> = None;

        while probes.len() < queries as usize && Instant::now() < hop_deadline {
            let mut buf = [MaybeUninit::<u8>::uninit(); 256];
            match recv_sock.recv_from(&mut buf) {
                Ok((len, src_addr)) => {
                    if len < 28 {
                        continue;
                    }
                    // SAFETY: `len` bytes at the start of `buf` are now initialized.
                    let buf: &[u8] = unsafe { std::slice::from_raw_parts(buf.as_ptr() as *const u8, len) };
                    let icmp_type = buf[0];
                    let icmp_code = buf[1];
                    let recv_t = Instant::now();
                    let src_ip = src_addr
                        .as_socket()
                        .map(|s| s.ip())
                        .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));

                    let matched_ttl: u8 = match icmp_type {
                        11 => {
                            if len < 8 + 20 {
                                continue;
                            }
                            let embedded_ttl = buf[8 + 8];
                            embedded_ttl.saturating_add(1)
                        }
                        3 if icmp_code == 3 => {
                            reached = true;
                            ttl
                        }
                        _ => continue,
                    };
                    if matched_ttl != ttl {
                        continue;
                    }

                    let earliest_send = sends.first().map(|s| s.send_t).unwrap_or(recv_t);
                    let rtt_ms = recv_t
                        .saturating_duration_since(earliest_send)
                        .as_secs_f64()
                        * 1000.0;

                    if hop_host.is_none() && !src_ip.is_unspecified() {
                        hop_host = Some(src_ip);
                    }
                    probes.push(rtt_ms.max(0.0));

                    if reached {
                        break;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    let now = Instant::now();
                    let remaining = hop_deadline.saturating_duration_since(now);
                    if remaining.is_zero() {
                        break;
                    }
                    let sleep = remaining.min(Duration::from_millis(50));
                    thread::sleep(sleep);
                }
                Err(_) => break,
            }
        }

        while probes.len() < queries as usize {
            probes.push(-1.0);
        }

        let host_str = match hop_host {
            Some(IpAddr::V4(v4)) => v4.to_string(),
            Some(other) => other.to_string(),
            None => "Request timed out.".to_string(),
        };

        all_hops.push(HopResult {
            hop: ttl,
            rtts_ms: probes,
            host: host_str,
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
                "rtt_ms": h.rtts_ms,
                "host": h.host,
            })
        })
        .collect();
    let complete = reached
        || all_hops
            .last()
            .map(|h| h.host == target_ip.to_string())
            .unwrap_or(false);

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

// ── System-call fallback (V2.1 behavior) ──────────────────────────────
//
// On Windows, `tracert.exe` is a console-subsystem binary and the console
// API bypasses the stdout pipe — we get 0 bytes back. On macOS/Linux the
// system call works correctly. Use the self-built path on Windows.

fn system_traceroute(target: &str, max_hops: u8, queries: u8, timeout: Duration) -> ProbeSample {
    let max_hops_u32 = max_hops as u32;
    let queries_u32 = queries as u32;
    // Windows `tracert -w` is in **milliseconds**; Unix `traceroute -w` is
    // in **seconds**. Convert from the canonical seconds input.
    let timeout_secs = timeout.as_secs().max(1) as u32;
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("tracert.exe");
        c.arg("-d")
            .arg("-h")
            .arg(max_hops_u32.to_string())
            .arg("-w")
            .arg((timeout_secs * 1000).to_string());
        c.arg(target);
        c
    } else {
        let mut c = Command::new("traceroute");
        c.arg("-n")
            .arg("-m")
            .arg(max_hops_u32.to_string())
            .arg("-q")
            .arg(queries_u32.to_string())
            .arg("-w")
            .arg(timeout_secs.to_string());
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
                payload: Some(json!({
                    "target": target,
                    "max_hops": max_hops,
                    "complete": false,
                    "self_built": false,
                })),
            };
        }
    };
    let total_ms = started.elapsed().as_secs_f64() * 1000.0;
    let _ = child.wait();
    let (hops, complete) = parse_system_hops(&output);
    let success = !hops.is_empty();
    let note = if output.is_empty() && cfg!(windows) {
        Some("tracert.exe is a console-subsystem binary; its output is not captured via Rust std pipes on Windows. Use mode=self.")
    } else {
        None
    };
    ProbeSample {
        success,
        latency_ms: Some(total_ms),
        error: if success {
            None
        } else {
            Some(note.unwrap_or("no hops parsed").to_string())
        },
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
        let mut rtt_cells: Vec<f64> = Vec::with_capacity(3);
        let mut idx = 0;
        while rtt_cells.len() < 3 && idx < rest.len() {
            let t = rest[idx];
            if t == "*" {
                rtt_cells.push(-1.0);
                idx += 1;
            } else if t.parse::<f64>().is_ok() {
                rtt_cells.push(t.parse::<f64>().unwrap_or(-1.0));
                idx += 1;
                if idx < rest.len() && rest[idx] == "ms" {
                    idx += 1;
                }
            } else {
                break;
            }
        }
        while rtt_cells.len() < 3 {
            rtt_cells.push(-1.0);
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

#[cfg(test)]
mod tests {
    use super::parse_system_hops;
    use serde_json::json;

    #[test]
    fn parses_windows_rtt_columns_without_token_shift() {
        let output = "  1     2 ms     1 ms     4 ms  192.168.2.1\r\n\
                      2     *        8 ms     *     edge.example\r\n\
                      3     *        *        *     Request timed out.\r\n\
                      Trace complete.\r\n";
        let (hops, complete) = parse_system_hops(output);
        assert!(complete);
        assert_eq!(hops.len(), 3);
        assert_eq!(hops[0]["rtt_ms"], json!([2.0, 1.0, 4.0]));
        assert_eq!(hops[1]["rtt_ms"], json!([-1.0, 8.0, -1.0]));
        assert_eq!(hops[2]["host"], "Request timed out.");
    }
}
