//! HTTP probe. Issues a GET and reports waterfall timings.
//!
//! V1.1 supports plain http only; HTTPS is V1.1.1 (requires native-tls).
//!
//! Options:
//! - `url` (string, required if target is not a full URL)
//! - `path` (string, default "/"): URL path
//! - `max_bytes` (number, default 65536): how many bytes to download
//!
//! Top-level `latency_ms` = TTFB. Payload carries dns_ms / tcp_ms / ttfb_ms /
//! download_ms / total_ms / status / bytes.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::{resolve, Probe, ProbeSample};

pub struct HttpProbe;

impl HttpProbe {
    pub fn new() -> Self {
        Self
    }
}

impl Probe for HttpProbe {
    fn name(&self) -> &'static str {
        "http"
    }

    fn run(&self, target: &str, options: &Value, timeout: Duration) -> ProbeSample {
        let url = options
            .get("url")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                if target.starts_with("http://") || target.starts_with("https://") {
                    target.to_string()
                } else {
                    format!("http://{target}")
                }
            });

        if url.starts_with("https://") {
            return ProbeSample {
                success: false,
                latency_ms: None,
                error: Some("https not yet supported (V1.1.1); use http://".to_string()),
                payload: None,
            };
        }

        let path = options
            .get("path")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| extract_path(&url).unwrap_or_else(|| "/".to_string()));
        let max_bytes: usize = options
            .get("max_bytes")
            .and_then(|v| v.as_u64())
            .and_then(|n| usize::try_from(n).ok())
            .unwrap_or(65_536);

        let host = match extract_host(&url) {
            Some(h) => h,
            None => {
                return ProbeSample {
                    success: false,
                    latency_ms: None,
                    error: Some("invalid url".to_string()),
                    payload: None,
                };
            }
        };
        let port = extract_port(&url).unwrap_or(80);

        // 1. DNS
        let dns_start = Instant::now();
        let addrs = match resolve(&format!("{host}:0")) {
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
        let dns_ms = dns_start.elapsed().as_secs_f64() * 1000.0;
        let addr = match addrs.first() {
            Some(a) => a.ip(),
            None => {
                return ProbeSample {
                    success: false,
                    latency_ms: None,
                    error: Some("no address".to_string()),
                    payload: None,
                };
            }
        };

        // 2. TCP
        let target_addr = std::net::SocketAddr::new(addr, port);
        let tcp_start = Instant::now();
        let mut stream = match TcpStream::connect_timeout(&target_addr, timeout) {
            Ok(s) => s,
            Err(e) => {
                return ProbeSample {
                    success: false,
                    latency_ms: None,
                    error: Some(format!("tcp: {e}")),
                    payload: Some(json!({
                        "url": url, "remote": target_addr.to_string(),
                        "dns_ms": dns_ms, "tcp_ms": 0.0,
                    })),
                };
            }
        };
        let _ = stream.set_read_timeout(Some(timeout));
        let _ = stream.set_write_timeout(Some(timeout));
        let tcp_ms = tcp_start.elapsed().as_secs_f64() * 1000.0;

        // 3. Send request, measure TTFB
        let request = format!(
            "GET {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: nwd-net-probe/0.1\r\nAccept: */*\r\nConnection: close\r\n\r\n"
        );
        let ttfb_start = Instant::now();
        if let Err(e) = stream.write_all(request.as_bytes()) {
            return ProbeSample {
                success: false,
                latency_ms: None,
                error: Some(format!("write: {e}")),
                payload: None,
            };
        }
        if let Err(e) = stream.flush() {
            return ProbeSample {
                success: false,
                latency_ms: None,
                error: Some(format!("flush: {e}")),
                payload: None,
            };
        }

        // 4. Read status line
        let mut header_buf = Vec::with_capacity(1024);
        let mut byte = [0u8; 1];
        let mut status_line = String::new();
        loop {
            match stream.read(&mut byte) {
                Ok(0) => break,
                Ok(_) => {
                    header_buf.push(byte[0]);
                    if byte[0] == b'\n' {
                        let line = String::from_utf8_lossy(&header_buf).to_string();
                        if status_line.is_empty() {
                            status_line = line.trim_end().to_string();
                        }
                        if line == "\r\n" || line == "\n" {
                            break;
                        }
                        header_buf.clear();
                    }
                }
                Err(e) => {
                    return ProbeSample {
                        success: false,
                        latency_ms: None,
                        error: Some(format!("read: {e}")),
                        payload: None,
                    };
                }
            }
        }
        let ttfb_ms = ttfb_start.elapsed().as_secs_f64() * 1000.0;
        let status_code = parse_status_code(&status_line).unwrap_or(0);

        // 5. Read body up to max_bytes
        let dl_start = Instant::now();
        let mut body = vec![0u8; max_bytes];
        let mut bytes_read = 0;
        while bytes_read < max_bytes {
            match stream.read(&mut body[bytes_read..]) {
                Ok(0) => break,
                Ok(n) => bytes_read += n,
                Err(_) => break,
            }
        }
        let download_ms = dl_start.elapsed().as_secs_f64() * 1000.0;
        let total_ms = dns_ms + tcp_ms + ttfb_ms + download_ms;

        let payload = json!({
            "url": url,
            "status": status_code,
            "remote": target_addr.to_string(),
            "scheme": "http",
            "dns_ms": dns_ms,
            "tcp_ms": tcp_ms,
            "tls_ms": 0.0,
            "ttfb_ms": ttfb_ms,
            "download_ms": download_ms,
            "total_ms": total_ms,
            "bytes": bytes_read,
        });

        let success = (200..400).contains(&status_code) && ttfb_ms > 0.0;
        ProbeSample {
            success,
            latency_ms: Some(if ttfb_ms > 0.0 { ttfb_ms } else { 0.1 }),
            error: if success { None } else { Some(format!("http {status_code}")) },
            payload: Some(payload),
        }
    }
}

fn extract_host(url: &str) -> Option<String> {
    let after = url.split("://").nth(1)?;
    let host_port = after.split('/').next()?;
    Some(host_port.split(':').next()?.to_string())
}

fn extract_port(url: &str) -> Option<u16> {
    let after = url.split("://").nth(1)?;
    let host_port = after.split('/').next()?;
    host_port.split(':').nth(1)?.parse().ok()
}

fn extract_path(url: &str) -> Option<String> {
    let after = url.split("://").nth(1)?;
    let idx = after.find('/')?;
    Some(after[idx..].to_string())
}

fn parse_status_code(status_line: &str) -> Option<u64> {
    let mut parts = status_line.split_whitespace();
    parts.next()?;
    parts.next()?.parse().ok()
}
