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

use std::process::ExitCode;

fn main() -> ExitCode {
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
            match daemon::run() {
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
            eprintln!("usage: nwd-mycast <daemon|version>");
            ExitCode::from(2)
        }
    }
}
