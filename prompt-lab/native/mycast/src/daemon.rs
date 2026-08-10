//! Daemon entry: wires config, HTTP server, mDNS, and the parent JSONL RPC loop.

use std::net::SocketAddr;
use std::sync::Arc;

use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::sync::mpsc;

use crate::config::Config;
use crate::http::{self, HttpState};
use crate::mdns::MdnsAdvertiser;
use crate::protocol::{DaemonInfo, Event, Request, Response};
use crate::signaling::SignalingFrame;
use crate::state::SharedState;

pub async fn run() -> anyhow::Result<()> {
    let cfg = Arc::new(Config::defaults());
    let shared = Arc::new(SharedState::new());

    // Channel: HTTP / signaling -> parent.
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<Event>();
    shared.signaling.attach_event_sink(event_tx.clone());

    // Output writer for JSONL responses / events.
    let stdout = tokio::io::stdout();
    let mut stdout = BufWriter::new(stdout);

    // Stream transfer lifecycle events too.
    // (Transfers emit progress inline within http.rs; we forward high-level
    //  completion events via the signaling path.)

    // Channel: parent -> internal: control commands.
    let (control_tx, mut control_rx) = mpsc::unbounded_channel::<serde_json::Value>();

    // Spawn RPC reader task: reads lines from stdin, parses requests, routes them.
    let cfg_for_rpc = cfg.clone();
    let shared_for_rpc = shared.clone();
    let stdout_arc = Arc::new(tokio::sync::Mutex::new(tokio::io::stdout()));
    let rpc_task = tokio::spawn(async move {
        run_rpc_reader(cfg_for_rpc, shared_for_rpc, control_tx, stdout_arc).await;
    });

    // Spawn event writer task: receives events, writes them to stdout.
    let writer_stdout = Arc::new(tokio::sync::Mutex::new(tokio::io::stdout()));
    let event_task = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            if let Ok(line) = serde_json::to_string(&event) {
                let mut w = writer_stdout.lock().await;
                let _ = w.write_all(line.as_bytes()).await;
                let _ = w.write_all(b"\n").await;
                let _ = w.flush().await;
            }
        }
    });

    // Wait for the parent to send a `start` command with optional overrides,
    // then boot HTTP + mDNS. If the parent never sends one (e.g. dev mode),
    // we boot with defaults after a 1s grace period.
    let mut started = false;
    tokio::select! {
        cmd = control_rx.recv() => {
            if let Some(cmd) = cmd {
                apply_control(&cfg, &shared, cmd).await;
                started = boot_services(cfg.clone(), shared.clone(), &mut stdout).await.is_ok();
            }
        }
        _ = tokio::time::sleep(std::time::Duration::from_millis(1500)) => {
            started = boot_services(cfg.clone(), shared.clone(), &mut stdout).await.is_ok();
        }
    }

    if started {
        let info = DaemonInfo {
            device_id: cfg.device_id.clone(),
            device_name: cfg.device_name.clone(),
            platform: cfg.platform.clone(),
            bind_addr: cfg.bind_addr.to_string(),
            http_port: cfg.http_port,
            ws_port: cfg.ws_port,
            mdns_enabled: cfg.mdns_enabled,
            version: env!("CARGO_PKG_VERSION").to_string(),
        };
        // The parent expects a `ready` event; we send it through the event channel
        // so it goes out via the same writer.
        let _ = event_tx.send(Event::new("ready", serde_json::to_value(&info).unwrap_or_default()));
    } else {
        let _ = event_tx.send(Event::new("error", serde_json::json!({ "message": "boot failed" })));
    }

    // Main loop: dispatch control commands to handlers.
    while let Some(cmd) = control_rx.recv().await {
        dispatch_control(&cfg, &shared, cmd, &mut stdout).await;
    }

    rpc_task.abort();
    event_task.abort();
    Ok(())
}

async fn boot_services(cfg: Arc<Config>, shared: Arc<SharedState>, _stdout: &mut BufWriter<tokio::io::Stdout>) -> anyhow::Result<()> {
    let http_addr = SocketAddr::new(cfg.bind_addr, cfg.http_port);
    let state = HttpState { cfg: cfg.clone(), shared: shared.clone() };
    tokio::spawn(async move {
        if let Err(e) = http::serve(http_addr, state).await {
            tracing::error!(target: "mycast.boot", "http server crashed: {e:#}");
        }
    });

    if cfg.mdns_enabled {
        let cfg_clone = cfg.clone();
        tokio::spawn(async move {
            match MdnsAdvertiser::start(&cfg_clone, cfg_clone.http_port, &[
                ("device_id", &cfg_clone.device_id),
                ("platform", &cfg_clone.platform),
                ("ver", env!("CARGO_PKG_VERSION")),
            ]) {
                Ok(_adv) => {
                    // Keep the advertiser alive for the daemon's lifetime.
                    // Drop runs on daemon exit, which calls shutdown().
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
                    }
                }
                Err(e) => tracing::warn!(target: "mycast.boot", "mDNS 启动失败: {e:#}"),
            }
        });
    }
    Ok(())
}

async fn apply_control(_cfg: &Arc<Config>, _shared: &Arc<SharedState>, _cmd: serde_json::Value) {
    // Reserved for future pre-boot configuration.
}

async fn dispatch_control(cfg: &Arc<Config>, shared: &Arc<SharedState>, cmd: serde_json::Value, stdout: &mut BufWriter<tokio::io::Stdout>) {
    let req: Request = match serde_json::from_value(cmd) {
        Ok(r) => r,
        Err(e) => {
            let resp = Response::err(None, "error", format!("bad request: {e}"));
            write_response(stdout, &resp).await;
            return;
        }
    };
    let id = req.id;
    match req.kind.as_str() {
        "state" => {
            let info = DaemonInfo {
                device_id: cfg.device_id.clone(),
                device_name: cfg.device_name.clone(),
                platform: cfg.platform.clone(),
                bind_addr: cfg.bind_addr.to_string(),
                http_port: cfg.http_port,
                ws_port: cfg.ws_port,
                mdns_enabled: cfg.mdns_enabled,
                version: env!("CARGO_PKG_VERSION").to_string(),
            };
            let resp = Response::ok(id, "state", serde_json::to_value(&info).unwrap_or_default());
            write_response(stdout, &resp).await;
        }
        "list_sessions" => {
            let resp = Response::ok(id, "sessions", serde_json::json!({ "sessions": shared.signaling.list_sessions() }));
            write_response(stdout, &resp).await;
        }
        "list_transfers" => {
            let resp = Response::ok(id, "transfers", serde_json::json!({ "transfers": shared.transfers.list() }));
            write_response(stdout, &resp).await;
        }
        "issue_pairing" => {
            let (token, code, ttl) = shared.tokens.issue_pairing(None);
            let resp = Response::ok(id, "pairing", serde_json::json!({
                "token_prefix": &token[..token.len().min(8)],
                "pair_code": code,
                "expires_in_ms": ttl.as_millis() as u64,
            }));
            write_response(stdout, &resp).await;
        }
        "send_to_phone" => {
            #[derive(Deserialize)]
            struct SendArgs { device_id: String, frame: SignalingFrame }
            match serde_json::from_value::<SendArgs>(req.payload.clone()) {
                Ok(args) => {
                    let ok = shared.signaling.send_to_phone(&args.device_id, args.frame);
                    let resp = Response::ok(id, "sent", serde_json::json!({ "delivered": ok }));
                    write_response(stdout, &resp).await;
                }
                Err(e) => {
                    let resp = Response::err(id, "error", format!("bad args: {e}"));
                    write_response(stdout, &resp).await;
                }
            }
        }
        "end_session" => {
            #[derive(Deserialize)]
            struct EndArgs { session_id: String }
            match serde_json::from_value::<EndArgs>(req.payload.clone()) {
                Ok(args) => {
                    let removed = shared.signaling.end_session(&args.session_id);
                    let resp = Response::ok(id, "ended", serde_json::json!({ "removed": removed }));
                    write_response(stdout, &resp).await;
                }
                Err(e) => {
                    let resp = Response::err(id, "error", format!("bad args: {e}"));
                    write_response(stdout, &resp).await;
                }
            }
        }
        "cancel_transfer" => {
            #[derive(Deserialize)]
            struct CancelArgs { upload_id: String }
            match serde_json::from_value::<CancelArgs>(req.payload.clone()) {
                Ok(args) => {
                    let cancelled = shared.transfers.cancel(&args.upload_id);
                    let resp = Response::ok(id, "cancelled", serde_json::json!({ "cancelled": cancelled }));
                    write_response(stdout, &resp).await;
                }
                Err(e) => {
                    let resp = Response::err(id, "error", format!("bad args: {e}"));
                    write_response(stdout, &resp).await;
                }
            }
        }
        "ping" => {
            let resp = Response::ok(id, "pong", serde_json::json!({ "ts": chrono::Utc::now().timestamp_millis() }));
            write_response(stdout, &resp).await;
        }
        "shutdown" => {
            let resp = Response::ok(id, "shutting_down", serde_json::json!({}));
            write_response(stdout, &resp).await;
            let _ = stdout.flush().await;
            std::process::exit(0);
        }
        other => {
            let resp = Response::err(id, "error", format!("unknown command: {other}"));
            write_response(stdout, &resp).await;
        }
    }
}

async fn write_response<W: AsyncWriteExt + Unpin>(stdout: &mut BufWriter<W>, resp: &Response) {
    if let Ok(line) = serde_json::to_string(resp) {
        let _ = stdout.write_all(line.as_bytes()).await;
        let _ = stdout.write_all(b"\n").await;
        let _ = stdout.flush().await;
    }
}

async fn run_rpc_reader(
    _cfg: Arc<Config>,
    _shared: Arc<SharedState>,
    control_tx: mpsc::UnboundedSender<serde_json::Value>,
    _stdout_arc: Arc<tokio::sync::Mutex<tokio::io::Stdout>>,
) {
    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut buf = String::new();
    loop {
        buf.clear();
        match reader.read_line(&mut buf).await {
            Ok(0) => break, // EOF
            Ok(_) => {
                let trimmed = buf.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<serde_json::Value>(trimmed) {
                    Ok(value) => {
                        if control_tx.send(value).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        tracing::warn!(target: "mycast.rpc", "bad json from parent: {e}: {trimmed}");
                    }
                }
            }
            Err(e) => {
                tracing::error!(target: "mycast.rpc", "stdin read error: {e}");
                break;
            }
        }
    }
}
