//! Traceroute probe. V2.1 implementation: invokes the system `tracert` /
//! `traceroute` binary, parses its textual output into structured hops, and
//! reports the full path in the payload.
//!
//! Options:
//! - `max_hops` (number, default 15): maximum number of hops
//! - `timeout_sec` (number, default 30): per-binary timeout
//! - `queries` (number, default 3): probes per hop (passed to system binary)
//! - `resolve_dns` (bool, default false): pass `-d` to skip reverse DNS
//!
//! Top-level `latency_ms` = total trace duration. Payload carries:
//!   { "target": "...", "max_hops": N, "complete": bool,
//!     "hops": [{ "hop": 1, "rtt_ms": [2.0, 1.5, 4.0], "host": "192.168.2.1" }, ...] }
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use regex::Regex;
use serde_json::{json, Value};

use super::{Probe, ProbeSample};

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
        let max_hops: u32 = options
            .get("max_hops")
            .and_then(|v| v.as_u64())
            .and_then(|n| u32::try_from(n).ok())
            .unwrap_or(15)
            .clamp(1, 64);
        let timeout_sec: u32 = options
            .get("timeout_sec")
            .and_then(|v| v.as_u64())
            .and_then(|n| u32::try_from(n).ok())
            .unwrap_or(30)
            .clamp(1, 120);
        let queries: u32 = options
            .get("queries")
            .and_then(|v| v.as_u64())
            .and_then(|n| u32::try_from(n).ok())
            .unwrap_or(3)
            .clamp(1, 5);
        let resolve_dns: bool = options
            .get("resolve_dns")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // Build command based on OS. We always pass a per-binary timeout via
        // the platform flag (-w on Windows in seconds; on Unix traceroute uses
        // its own first-probe timeout in seconds).
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("tracert.exe");
            c.arg("-d").arg("-h").arg(max_hops.to_string());
            if !resolve_dns {
                c.arg("-d");
            }
            c.arg("-w").arg(timeout_sec.to_string());
            c.arg(target);
            c
        } else {
            let mut c = Command::new("traceroute");
            c.arg("-n").arg("-m").arg(max_hops.to_string());
            c.arg("-q").arg(queries.to_string());
            c.arg("-w").arg(timeout_sec.to_string());
            c.arg(target);
            c
        };
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        // Spawn the binary and read stdout in a dedicated thread so we can
        // enforce our own overall timeout.
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                return ProbeSample {
                    success: false,
                    latency_ms: None,
                    error: Some(format!("spawn: {e}")),
                    payload: Some(json!({
                        "target": target,
                        "binary_missing": true,
                    })),
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

        // Wait with our overall timeout. tracert may take 30-90s for distant
        // targets; respect `timeout` but never below 5s.
        let effective_timeout = timeout.max(Duration::from_secs(5));
        let started = Instant::now();
        let output = match rx.recv_timeout(effective_timeout) {
            Ok(s) => s,
            Err(_) => {
                let _ = child.kill();
                return ProbeSample {
                    success: false,
                    latency_ms: None,
                    error: Some(format!("traceroute timeout after {effective_timeout:?}")),
                    payload: Some(json!({
                        "target": target, "max_hops": max_hops, "complete": false,
                    })),
                };
            }
        };
        let total_ms = started.elapsed().as_secs_f64() * 1000.0;
        let _ = child.wait();

        // Parse output into hops.
        let (hops, complete) = parse_hops(&output, max_hops);
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
            })),
        }
    }
}

fn parse_hops(output: &str, _max_hops: u32) -> (Vec<Value>, bool) {
    // tracert hop lines have a fixed shape:
    //   "  1     2 ms     1 ms     4 ms  192.168.2.1"
    //   "  4     5 ms     4 ms     *     218.2.125.249"
    //   "  5     *        *        *     Request timed out."
    // We tokenize by whitespace: hop, [3 RTT cells], host.
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
            || lower.starts_with("traceroute to") {
            continue;
        }
        let trimmed = line.trim_start();
        // Hop number is the first whitespace-separated token.
        let mut parts = trimmed.split_whitespace();
        let hop_tok = match parts.next() {
            Some(t) => t,
            None => continue,
        };
        let hop_num: u32 = match hop_tok.parse() {
            Ok(n) => n,
            Err(_) => continue,
        };
        // Collect the rest. We need 3 RTT cells + host. RTT cells can be
        // "<N> ms" (2 tokens) or "*" (1 token). Host is whatever is left.
        let rest: Vec<&str> = parts.collect();
        if rest.len() < 3 {
            continue;
        }
        let rtt_cells: Vec<f64> = rest
            .iter()
            .take(3)
            .map(|s| parse_rtt_cell_token(s))
            .collect();
        // Host: the rest of the line. For "*" cells we still have 3 tokens
        // ("*", "*", "*") before the host, so skip the first 3 RTT tokens.
        // Walk the rest: skip the first 3 "rtt tokens" (which may be "<n>" + "ms"
        // for numeric, or "*" for timeout).
        let mut idx = 0;
        let mut skip = 0;
        while skip < 3 && idx < rest.len() {
            let t = rest[idx];
            if t == "*" {
                idx += 1;
            } else if t.parse::<f64>().is_ok() {
                idx += 1;
                // Next token should be "ms".
                if idx < rest.len() && rest[idx] == "ms" {
                    idx += 1;
                }
            } else {
                // Not a known RTT token; stop.
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

fn parse_rtt_cell_token(tok: &str) -> f64 {
    if tok == "*" {
        return -1.0;
    }
    tok.parse::<f64>().unwrap_or(-1.0)
}

fn parse_rtt_cell(s: &str) -> f64 {
    // "<N> ms" → N; "*" → -1 sentinel. Kept for backwards compat with
    // (now-removed) regex path.
    let _ = s;
    -1.0
}
