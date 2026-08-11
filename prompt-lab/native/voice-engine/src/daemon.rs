//! Daemon entry: read JSONL requests from stdin, write events to stdout,
//! coordinate cpal + recorder. This is the W1 smoke-test loop. W2+ will
//! swap the recorder for VAD + ASR workers but keep the same shape.
//!
//! cpal::Stream is `!Send` on every platform we target, so the recorder
//! runs synchronously on the same task that opened the stream. While a
//! recording is in progress, additional JSONL requests are buffered by
//! tokio and processed after `recording.finished` fires. That's fine for
//! W1 (a 5-second smoke test) and easy to upgrade in W2 by moving the
//! audio worker into a dedicated tokio task and bridging back via channel.

#![allow(dead_code)]

use anyhow::{Context, Result};
use ringbuf::traits::Split;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use crate::audio::{AudioCapture, TARGET_CHANNELS, TARGET_SAMPLE_RATE};
use crate::protocol::{DaemonInfo, Event, Request};
use crate::recorder::{default_output_path, Recorder};

const RING_BUFFER_FRAMES: usize = 16_000 * 6; // 6 seconds at 16 kHz.

pub struct State {
    pub started_at: Instant,
    pub storage_dir: PathBuf,
    pub input_device: Option<String>,
    pub recording: bool,
}

impl State {
    fn snapshot(&self, version: &'static str) -> DaemonInfo {
        DaemonInfo {
            version: version.to_string(),
            platform: std::env::consts::OS.to_string(),
            sample_rate: TARGET_SAMPLE_RATE,
            channels: TARGET_CHANNELS,
            storage_dir: self.storage_dir.to_string_lossy().to_string(),
            input_device: self.input_device.clone(),
            recording: self.recording,
        }
    }
}

pub async fn run() -> Result<()> {
    let storage_dir = resolve_storage_dir();
    std::fs::create_dir_all(&storage_dir)
        .with_context(|| format!("create storage dir {}", storage_dir.display()))?;
    info!(storage_dir = %storage_dir.display(), "voice daemon starting");

    let state = Arc::new(Mutex::new(State {
        started_at: Instant::now(),
        storage_dir,
        input_device: None,
        recording: false,
    }));

    // Event bus: requests handled in-line, plus an mpsc that any task can
    // post events to. The stdout writer task owns the write half so we
    // never interleave JSON lines.
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<Event>();
    tokio::spawn(async move {
        let stdout = tokio::io::stdout();
        let mut out = BufWriter::new(stdout);
        while let Some(event) = event_rx.recv().await {
            if let Ok(line) = serde_json::to_string(&event) {
                if let Err(e) = out.write_all(line.as_bytes()).await {
                    error!("write event to stdout: {e}");
                    break;
                }
                if let Err(e) = out.write_all(b"\n").await {
                    error!("write newline: {e}");
                    break;
                }
                let _ = out.flush().await;
            }
        }
    });

    // Emit `ready` so the parent knows we're alive.
    let _ = event_tx.send(Event::new(
        "ready",
        serde_json::json!({
            "version": env!("CARGO_PKG_VERSION"),
            "platform": std::env::consts::OS,
            "sample_rate": TARGET_SAMPLE_RATE,
            "channels": TARGET_CHANNELS,
        }),
    ));

    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    while let Some(line) = lines.next_line().await.context("read stdin")? {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let req: Request = match serde_json::from_str(trimmed) {
            Ok(r) => r,
            Err(e) => {
                warn!("malformed request: {e} ({trimmed})");
                continue;
            }
        };
        // Recording runs synchronously, so each request is fully processed
        // before we read the next stdin line.
        if let Err(e) = handle_request(req, &event_tx, &state) {
            error!("request handler failed: {e:#}");
            let _ = event_tx.send(Event::new(
                "error",
                serde_json::json!({
                    "kind": "request",
                    "message": format!("{e:#}"),
                }),
            ));
        }
    }

    Ok(())
}

fn handle_request(
    req: Request,
    event_tx: &mpsc::UnboundedSender<Event>,
    state: &Arc<Mutex<State>>,
) -> Result<()> {
    match req.kind.as_str() {
        "ping" => {
            let _ = event_tx.send(Event::new(
                "pong",
                serde_json::json!({ "id": req.id.unwrap_or(0) }),
            ));
        }
        "state" => {
            let snap = state.lock().unwrap().snapshot(env!("CARGO_PKG_VERSION"));
            let payload = serde_json::to_value(&snap).unwrap_or(serde_json::Value::Null);
            let _ = event_tx.send(Event::new("state", payload));
        }
        "recording.start" => {
            let duration_secs = req
                .payload
                .get("duration_secs")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32)
                .unwrap_or(5);
            run_recording(duration_secs, event_tx, state.clone())?;
        }
        _ => {
            warn!("unknown request type: {}", req.kind);
            let _ = event_tx.send(Event::new(
                "error",
                serde_json::json!({
                    "request_id": req.id,
                    "kind": req.kind,
                    "message": "unknown request type",
                }),
            ));
        }
    }
    Ok(())
}

fn run_recording(
    duration_secs: u32,
    event_tx: &mpsc::UnboundedSender<Event>,
    state: Arc<Mutex<State>>,
) -> Result<()> {
    {
        let g = state.lock().unwrap();
        if g.recording {
            anyhow::bail!("recording already in progress");
        }
    }

    let (producer, consumer) = ringbuf::HeapRb::<f32>::new(RING_BUFFER_FRAMES).split();

    let capture = AudioCapture::start(producer).context("open microphone")?;
    {
        let mut g = state.lock().unwrap();
        g.recording = true;
        g.input_device = Some(capture.input_device.clone());
    }

    let output_path = {
        let g = state.lock().unwrap();
        default_output_path(&g.storage_dir)
    };

    let recorder = Recorder {
        output_path,
        duration_secs,
        sample_rate: TARGET_SAMPLE_RATE,
        tx: event_tx.clone(),
        consumer,
        started_at: Instant::now(),
    };

    // Runs synchronously on the calling task. cpal::Stream is `!Send`, so
    // the AudioCapture guard must stay on this task — that's why we can't
    // ship it to a worker thread.
    let result = recorder.run();
    capture.stop();
    state.lock().unwrap().recording = false;

    if let Err(e) = result {
        return Err(e);
    }
    Ok(())
}

fn resolve_storage_dir() -> PathBuf {
    if let Ok(p) = std::env::var("NWD_VOICE_STORAGE_DIR") {
        return PathBuf::from(p);
    }
    if let Some(base) = dirs_fallback() {
        return base.join("voice-engine");
    }
    PathBuf::from(".")
}

/// Tiny `dirs` stand-in so we don't pull another dependency. We only need
/// a writable per-user directory; fall back to the current directory if we
/// can't find one.
fn dirs_fallback() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(PathBuf::from)
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
    }
}
