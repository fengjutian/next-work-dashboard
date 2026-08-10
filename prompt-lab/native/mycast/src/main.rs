//! nwd-mycast entry point.
//!
//! MyCast: a LAN-only screen casting + file transfer daemon for prompt-lab.
//! Runs as a long-lived child process, communicating with the parent (nwd)
//! over stdio via JSONL for control/state, and exposing:
//!   - HTTP server:    file upload/download + mobile web UI
//!   - WebSocket:      WebRTC signaling
//!   - mDNS:           LAN device discovery

mod config;
mod daemon;
mod http;
mod mdns;
mod protocol;
mod security;
mod signaling;
mod state;
mod transfer;

use std::net::IpAddr;
use std::path::PathBuf;
use std::process::ExitCode;

use crate::config::ConfigOverrides;

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(|s| s.as_str()) {
        Some("daemon") => {
            // Initialize tracing to stderr (stdout is reserved for JSONL RPC).
            let _ = tracing_subscriber::fmt()
                .with_writer(std::io::stderr)
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,nwd_mycast=debug")),
                )
                .try_init();
            let overrides = parse_daemon_flags(&args[1..]);
            match daemon::run(overrides).await {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("nwd-mycast: daemon error: {e:#}");
                    ExitCode::from(1)
                }
            }
        }
        Some("version") | Some("--version") | Some("-V") => {
            println!("nwd-mycast {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("usage: nwd-mycast <daemon|version> [--http-port N] [--ws-port N] [--bind 0.0.0.0] [--no-mdns] [--storage-dir PATH] [--device-name NAME]");
            ExitCode::from(2)
        }
    }
}

/// Parse CLI flags that come after the `daemon` subcommand. Unknown flags are
/// silently ignored so future versions can add new ones without breaking
/// older callers. Values are returned as a `ConfigOverrides` the daemon can
/// layer over the defaults.
fn parse_daemon_flags(args: &[String]) -> ConfigOverrides {
    let mut ovr = ConfigOverrides::default();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        match a.as_str() {
            "--http-port" => {
                if let Some(v) = args.get(i + 1) { if let Ok(n) = v.parse() { ovr.http_port = Some(n); } i += 1; }
            }
            "--ws-port" => {
                if let Some(v) = args.get(i + 1) { if let Ok(n) = v.parse() { ovr.ws_port = Some(n); } i += 1; }
            }
            "--bind" | "--bind-addr" => {
                if let Some(v) = args.get(i + 1) { if let Ok(addr) = v.parse::<IpAddr>() { ovr.bind_addr = Some(addr); } i += 1; }
            }
            "--no-mdns" => { ovr.mdns_enabled = Some(false); }
            "--mdns" => { ovr.mdns_enabled = Some(true); }
            "--storage-dir" => {
                if let Some(v) = args.get(i + 1) { ovr.storage_dir = Some(PathBuf::from(v)); i += 1; }
            }
            "--device-name" => {
                if let Some(v) = args.get(i + 1) { ovr.device_name = Some(v.clone()); i += 1; }
            }
            _ => { /* ignore unknown flag */ }
        }
        i += 1;
    }
    ovr
}
