//! HTTP probe. Issues a GET and reports waterfall timings.
//!
//! V1.1.1 supports both http and https. HTTPS uses rustls (pure Rust,
//! cross-platform, no OpenSSL dependency on Windows).
//!
//! Options:
//! - `url` (string): full URL (overrides target)
//! - `path` (string, default "/"): URL path
//! - `max_bytes` (number, default 65536): download size cap
//! - `verify_tls` (bool, default true): set false to skip cert validation
//!
//! Top-level `latency_ms` = TTFB. Payload carries dns_ms / tcp_ms / tls_ms /
//! ttfb_ms / download_ms / total_ms / status / bytes.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, RootCertStore, Stream};
use serde_json::{json, Value};

use super::{Probe, ProbeSample};

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
        let verify_tls = options
            .get("verify_tls")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let (scheme_str, default_port) = if url.starts_with("https://") {
            ("https", 443u16)
        } else {
            ("http", 80u16)
        };

        let host = match extract_host(&url) {
            Some(h) => h,
            None => return err_sample("invalid url"),
        };
        let port = extract_port(&url).unwrap_or(default_port);

        // 1. DNS
        let dns_start = Instant::now();
        let addrs = match (host.clone(), port).to_socket_addrs() {
            Ok(it) => it.collect::<Vec<_>>(),
            Err(e) => {
                return ProbeSample {
                    success: false,
                    latency_ms: None,
                    error: Some(format!("dns: {e}")),
                    payload: Some(json!({
                        "url": url, "scheme": scheme_str, "host": host, "port": port,
                    })),
                };
            }
        };
        let dns_ms = dns_start.elapsed().as_secs_f64() * 1000.0;
        let addr = match addrs.first() {
            Some(a) => *a,
            None => {
                return ProbeSample {
                    success: false,
                    latency_ms: None,
                    error: Some("no address".to_string()),
                    payload: Some(json!({
                        "url": url, "scheme": scheme_str, "dns_ms": dns_ms,
                    })),
                };
            }
        };

        // 2. TCP
        let target_addr = std::net::SocketAddr::new(addr.ip(), port);
        let tcp_start = Instant::now();
        let stream = match TcpStream::connect_timeout(&target_addr, timeout) {
            Ok(s) => s,
            Err(e) => {
                return ProbeSample {
                    success: false,
                    latency_ms: None,
                    error: Some(format!("tcp: {e}")),
                    payload: Some(json!({
                        "url": url, "remote": target_addr.to_string(),
                        "scheme": scheme_str, "dns_ms": dns_ms, "tcp_ms": 0.0,
                    })),
                };
            }
        };
        let _ = stream.set_read_timeout(Some(timeout));
        let _ = stream.set_write_timeout(Some(timeout));
        let tcp_ms = tcp_start.elapsed().as_secs_f64() * 1000.0;

        // 3. Send request, measure TTFB + parse status + download body.
        let request = format!(
            "GET {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: nwd-net-probe/0.1.1\r\nAccept: */*\r\nConnection: close\r\n\r\n"
        );

        // Build the body handler. Returns (status_code, bytes_read, ttfb_ms, download_ms, error).
        let outcome: Result<(u64, usize, f64, f64), String>;

        if scheme_str == "https" {
            // HTTPS path: drive TLS handshake, then wrap in a Stream for I/O.
            let server_name = match ServerName::try_from(host.clone()) {
                Ok(sn) => sn,
                Err(e) => {
                    return ProbeSample {
                        success: false,
                        latency_ms: None,
                        error: Some(format!("tls server name: {e}")),
                        payload: Some(json!({
                            "url": url, "remote": target_addr.to_string(),
                            "scheme": scheme_str, "dns_ms": dns_ms, "tcp_ms": tcp_ms,
                        })),
                    };
                }
            };
            let config = build_tls_config(verify_tls);
            let mut conn = match ClientConnection::new(Arc::new(config), server_name) {
                Ok(c) => c,
                Err(e) => {
                    return ProbeSample {
                        success: false,
                        latency_ms: None,
                        error: Some(format!("tls init: {e}")),
                        payload: Some(json!({
                            "url": url, "remote": target_addr.to_string(),
                            "scheme": scheme_str, "dns_ms": dns_ms, "tcp_ms": tcp_ms,
                        })),
                    };
                }
            };
            let mut sock = stream;

            // Drive the TLS handshake, measure it.
            let tls_start = Instant::now();
            let hs: Result<(), String> = (|| {
                while conn.is_handshaking() {
                    conn.complete_io(&mut sock).map_err(|e| e.to_string())?;
                }
                Ok(())
            })();
            if let Err(e) = hs {
                return ProbeSample {
                    success: false,
                    latency_ms: None,
                    error: Some(format!("tls handshake: {e}")),
                    payload: Some(json!({
                        "url": url, "remote": target_addr.to_string(),
                        "scheme": scheme_str, "dns_ms": dns_ms, "tcp_ms": tcp_ms,
                    })),
                };
            }
            let tls_ms = tls_start.elapsed().as_secs_f64() * 1000.0;

            // Now wrap in a Stream for the application-level I/O.
            let mut tls_stream = Stream::new(&mut conn, &mut sock);
            outcome = http_exchange(&mut tls_stream, request.as_bytes(), max_bytes).map_err(|e| e.to_string());

            let (status_code, bytes_read, ttfb_ms, download_ms) = match outcome {
                Ok(v) => v,
                Err(e) => {
                    return ProbeSample {
                        success: false,
                        latency_ms: None,
                        error: Some(format!("http: {e}")),
                        payload: Some(json!({
                            "url": url, "remote": target_addr.to_string(),
                            "scheme": scheme_str, "dns_ms": dns_ms,
                            "tcp_ms": tcp_ms, "tls_ms": tls_ms,
                        })),
                    };
                }
            };

            let total_ms = dns_ms + tcp_ms + tls_ms + ttfb_ms + download_ms;
            let payload = json!({
                "url": url, "status": status_code, "remote": target_addr.to_string(),
                "scheme": scheme_str, "dns_ms": dns_ms, "tcp_ms": tcp_ms,
                "tls_ms": tls_ms, "ttfb_ms": ttfb_ms, "download_ms": download_ms,
                "total_ms": total_ms, "bytes": bytes_read,
            });
            let success = (200..400).contains(&status_code) && ttfb_ms > 0.0;
            ProbeSample {
                success,
                latency_ms: Some(if ttfb_ms > 0.0 { ttfb_ms } else { 0.1 }),
                error: if success { None } else { Some(format!("http {status_code}")) },
                payload: Some(payload),
            }
        } else {
            // Plain HTTP path.
            let mut sock = stream;
            outcome = http_exchange(&mut sock, request.as_bytes(), max_bytes).map_err(|e| e.to_string());

            let (status_code, bytes_read, ttfb_ms, download_ms) = match outcome {
                Ok(v) => v,
                Err(e) => {
                    return ProbeSample {
                        success: false,
                        latency_ms: None,
                        error: Some(format!("http: {e}")),
                        payload: Some(json!({
                            "url": url, "remote": target_addr.to_string(),
                            "scheme": scheme_str, "dns_ms": dns_ms,
                            "tcp_ms": tcp_ms, "tls_ms": 0.0,
                        })),
                    };
                }
            };

            let total_ms = dns_ms + tcp_ms + ttfb_ms + download_ms;
            let payload = json!({
                "url": url, "status": status_code, "remote": target_addr.to_string(),
                "scheme": scheme_str, "dns_ms": dns_ms, "tcp_ms": tcp_ms,
                "tls_ms": 0.0, "ttfb_ms": ttfb_ms, "download_ms": download_ms,
                "total_ms": total_ms, "bytes": bytes_read,
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
}

fn build_tls_config(verify_tls: bool) -> ClientConfig {
    if verify_tls {
        let mut root_store = RootCertStore::empty();
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth()
    } else {
        ClientConfig::builder()
            .with_root_certificates(RootCertStore::empty())
            .with_no_client_auth()
    }
}

/// Generic HTTP exchange: write request, read status line, download body.
/// Works for any Read+Write stream (raw TcpStream or rustls Stream).
fn http_exchange<S: Read + Write>(
    io: &mut S,
    request: &[u8],
    max_bytes: usize,
) -> std::io::Result<(u64, usize, f64, f64)> {
    let ttfb_start = Instant::now();
    io.write_all(request)?;
    io.flush()?;

    // Read status line byte-by-byte.
    let mut byte = [0u8; 1];
    let mut header_buf: Vec<u8> = Vec::with_capacity(512);
    let mut status_line = String::new();
    loop {
        match io.read(&mut byte) {
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
            Err(e) => return Err(e),
        }
    }
    let ttfb_ms = ttfb_start.elapsed().as_secs_f64() * 1000.0;
    let status_code = parse_status_code(&status_line).unwrap_or(0);

    // Read body up to max_bytes.
    let dl_start = Instant::now();
    let mut body = vec![0u8; max_bytes];
    let mut bytes_read = 0;
    while bytes_read < max_bytes {
        match io.read(&mut body[bytes_read..]) {
            Ok(0) => break,
            Ok(n) => bytes_read += n,
            Err(_) => break,
        }
    }
    let download_ms = dl_start.elapsed().as_secs_f64() * 1000.0;

    Ok((status_code, bytes_read, ttfb_ms, download_ms))
}

fn err_sample(msg: &str) -> ProbeSample {
    ProbeSample {
        success: false,
        latency_ms: None,
        error: Some(msg.to_string()),
        payload: None,
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
