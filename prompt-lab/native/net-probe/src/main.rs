//! nwd-net-probe entry point.
//!
//! V1 only supports the `daemon` subcommand. The daemon runs as a long-lived
//! child process, communicating with the parent (nwd) over stdio via JSONL.

mod daemon;
mod platform;
mod probe;
mod protocol;

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(|s| s.as_str()) {
        Some("daemon") => match daemon::run() {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("nwd-net-probe: daemon error: {e}");
                ExitCode::from(1)
            }
        },
        Some("version") | Some("--version") | Some("-V") => {
            println!("nwd-net-probe {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("usage: nwd-net-probe <daemon|version>");
            ExitCode::from(2)
        }
    }
}
