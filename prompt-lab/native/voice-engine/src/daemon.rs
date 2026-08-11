//! Daemon entry: read JSONL requests from stdin, write events to stdout,
//! coordinate cpal + recorder. This is the W1 smoke-test loop. W2+ will
//! swap the recorder for VAD + ASR workers but keep the same shape.

use anyhow::{Context, Result};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, Mutex};
use tracing::{error, info, warn};

use crate::audio::{AudioCapture, TARGET_CHANNELS, TARGET_SAMPLE_RATE};
use crate::protocol::{DaemonInfo, Event, Request, Response};
use crate::recorder::{default_output_path, Recorder};

const RING_BUFFER_FRAMES: usize = 16_000 * 6; // 6 seconds at 16 kHz.

pub struct State {
    pub started_at: Instant,
    pub storage_dir: PathBuf,
    pub input_device: Option<String>,
    pub recording: bool,
    pub last_result: Option<serde_json::Value>,
}

impl State {
    fn snapshot(&self, version: String) -> DaemonInfo {
        DaemonInfo {
            version,
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
        last_result: None,
    }));

    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<Event>();
    // Spawn the stdout writer so request handling and event emission never
    // interleave on stdout (each line is one JSON object).
    let writer = tokio::spawn(async move {
        use tokio::io::{AsyncWriteExt, BufWriter};
        let stdout = tokio::io::stdout();
        let mut out = BufWriter::new(stdout);
        while let Some(event) = event_rx.recv().await {
            if let Ok(line) = serde_json::to_string(&event) {
                if let Err(e) = out.write_all(line.as_bytes()).await {
                    error!("write event to stdout: {e:#}");
                    break;
                }
                if let Err(e) = out.write_all(b"\n").await {
                    error!("write newline: {e:#}");
                    break;
                }
                let _ = out.flush().await;
            }
        }
    });

    // Emit a synthetic `ready` so the parent can drive startup.
    event_tx
        .send(Event::new(
            "ready",
            serde_json::json!({
                "version": env!("CARGO_PKG_VERSION"),
                "platform": std::env::consts::OS,
                "sample_rate": TARGET_SAMPLE_RATE,
                "channels": TARGET_CHANNELS,
            }),
        ))
        .ok();

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
        let tx = event_tx.clone();
        let state = state.clone();
        // We process the request inline (still on the same task) so the
        // recorder lives as long as the audio capture guard. Spawning a new
        // task per request would also work, but for W1 we keep the flow
        // simple and easy to follow.
        if let Err(e) = handle_request(req, &tx, &state).await {
            error!("request handler failed: {e:#}");
        }
    }

    drop(event_tx);
    let _ = writer.await;
    Ok(())
}

async fn handle_request(
    req: Request,
    tx: &mpsc::UnboundedSender<Event>,
    state: &Arc<Mutex<State>>,
) -> Result<()> {
    match req.kind.as_str() {
        "ping" => {
            let _ = tx.send(Event::new(
                "pong",
                serde_json::json!({ "id": req.id.unwrap_or(0) }),
            ));
        }
        "state" => {
            let snap = state.lock().await.snapshot(env!("CARGO_PKG_VERSION"));
            let payload = serde_json::to_value(&snap).unwrap_or(serde_json::Value::Null);
            // Use a synthetic response-shaped event so the parent can
            // match on `type = state` without an `id` correlation.
            let _ = tx.send(Event::new("state", payload));
        }
        "recording.start" => {
            // Optional duration override (seconds), default 5.
            let duration_secs = req
                .payload
                .get("duration_secs")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32)
                .unwrap_or(5);
            start_recording(duration_secs, tx, state.clone()).await?;
        }
        _ => {
            warn!("unknown request type: {}", req.kind);
            let _ = tx.send(Event::new(
                "error",
                serde_json::json!({
                    "request_id": req.id,
                    "kind": req.kind,
                    "message": "unknown request type",
                }),
            ));
        }
    }
    // Reference `Response` to keep the symbol exported for future phases.
    let _ = Response::ok::<&str>;
    Ok(())
}

async fn start_recording(
    duration_secs: u32,
    tx: &mpsc::UnboundedSender<Event>,
    state: Arc<Mutex<State>>,
) -> Result<()> {
    {
        let mut g = state.lock().await;
        if g.recording {
            anyhow::bail!("recording already in progress");
        }
        g.recording = true;
    }

    let (producer, consumer) = ringbuf::HeapRb::<f32>::new(RING_BUFFER_FRAMES).split();

    let capture = match AudioCapture::start(producer) {
        Ok(c) => c,
        Err(e) => {
            let mut g = state.lock().await;
            g.recording = false;
            return Err(e);
        }
    };

    {
        let mut g = state.lock().await;
        g.input_device = Some(capture.input_device.clone());
    }

    let output_path = {
        let g = state.lock().await;
        default_output_path(&g.storage_dir)
    };

    let recorder = Recorder {
        output_path,
        duration_secs,
        sample_rate: TARGET_SAMPLE_RATE,
        tx: tx.clone(),
        consumer,
        started_at: Instant::now(),
    };

    // Run the recorder on a dedicated OS thread because the ring buffer
    // pop path is CPU-bound and we want to keep the tokio runtime free
    // for stdin handling.
    let state_for_finish = state.clone();
    let capture_for_stop = Arc::new(parking_lot_mutex(capture));
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build recorder runtime");
        let result = rt.block_on(recorder.run());
        if let Err(e) = result {
            error!("recorder failed: {e:#}");
            let _ = tx.send(Event::new(
                "error",
                serde_json::json!({
                    "kind": "recorder",
                    "message": format!("{e:#}"),
                }),
            ));
        }
        // Stop capture: take the guard out of the mutex and drop it.
        if let Some(cap) = capture_for_stop.lock().take() {
            cap.stop();
        }
        let mut g = state_for_finish.blocking_lock();
        g.recording = false;
    });

    Ok(())
}

/// Wrap `AudioCapture` in a parking_lot mutex so we can hand the guard
/// across threads. parking_lot is not in our deps, so just use std Mutex.
fn parking_lot_mutex<T>(inner: T) -> std::sync::Mutex<Option<T>> {
    std::sync::Mutex::new(Some(inner))
}
