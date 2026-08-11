//! nwd-voice-engine entry point.
//!
//! A long-lived child process that the Electron main process spawns. The
//! parent sends control requests on stdin (one JSON object per line) and
//! receives responses + unsolicited events on stdout. stderr is reserved
//! for `tracing` logs.
//!
//! Subcommands:
//!   daemon  — run the voice engine
//!   version — print version and exit
//!
//! Wire format: see `protocol.rs`.

mod audio;
mod daemon;
mod protocol;
mod recorder;

use std::process::ExitCode;

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(|s| s.as_str()) {
        Some("daemon") => {
            // Initialize tracing to stderr (stdout is reserved for JSONL RPC).
            let _ = tracing_subscriber::fmt()
                .with_writer(std::io::stderr)
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                        tracing_subscriber::EnvFilter::new("info,nwd_voice_engine=debug")
                    }),
                )
                .try_init();
            match daemon::run().await {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("nwd-voice-engine: daemon error: {e:#}");
                    ExitCode::from(1)
                }
            }
        }
        Some("version") | Some("--version") | Some("-V") => {
            println!("nwd-voice-engine {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("usage: nwd-voice-engine <daemon|version> [--storage-dir PATH]");
            ExitCode::from(2)
        }
    }
}
