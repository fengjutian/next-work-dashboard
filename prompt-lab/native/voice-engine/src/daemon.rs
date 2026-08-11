//! Daemon entry: read JSONL requests from stdin, write events to stdout,
//! coordinate cpal + VAD. This is the W2 loop. W1's "record N seconds of
//! PCM" mode is still available via the `recording.raw` request (mostly
//! for debugging), but the default `recording.start` path runs the
//! VAD-aware processor that emits `speech.start` / `speech.end` events
//! per detected segment.
//!
//! cpal::Stream is `!Send` on every platform we target, so the VAD
//! worker runs synchronously on the same task that opened the stream.

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
use crate::model_manager::{ensure_models, model_paths, ModelPaths};
use crate::protocol::{DaemonInfo, Event, Request};
use crate::recorder::{default_output_path, Recorder};
use crate::vad_processor::VadProcessor;

const RING_BUFFER_FRAMES: usize = 16_000 * 30; // 30 seconds at 16 kHz.

pub struct State {
    pub started_at: Instant,
    pub storage_dir: PathBuf,
    pub model_dir: PathBuf,
    pub input_device: Option<String>,
    pub recording: bool,
    pub models: Option<ModelPaths>,
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
    let model_dir = storage_dir.join("models");
    std::fs::create_dir_all(&storage_dir)
        .with_context(|| format!("create storage dir {}", storage_dir.display()))?;
    info!(storage_dir = %storage_dir.display(), "voice daemon starting");

    // Make sure the on-disk models are present. Network failure is
    // non-fatal — we just won't be able to do VAD until the user
    // manually drops `silero_vad.onnx` into the model dir.
    if let Err(e) = ensure_models(&model_dir).await {
        warn!(error = %e, "model download failed; voice daemon will run in degraded mode");
    }
    let models = model_paths(&model_dir);

    let state = Arc::new(Mutex::new(State {
        started_at: Instant::now(),
        storage_dir,
        model_dir,
        input_device: None,
        recording: false,
        models: Some(models),
    }));

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
            "vad_model_path": state.lock().unwrap().models.as_ref().map(|m| m.vad.to_string_lossy().to_string()),
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
            let _ = writer_send(event_tx, "state", payload);
        }
        "models" => {
            let paths = state
                .lock()
                .unwrap()
                .models
                .clone()
                .ok_or_else(|| anyhow::anyhow!("model paths not initialized"))?;
            let vad_exists = paths.vad.exists();
            let _ = writer_send(
                event_tx,
                "models",
                serde_json::json!({
                    "vad": {
                        "path": paths.vad.to_string_lossy(),
                        "exists": vad_exists,
                        "ready": vad_exists,
                    }
                }),
            );
        }
        "recording.start" => {
            let duration_secs = req
                .payload
                .get("duration_secs")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32)
                .unwrap_or(5);
            run_recording_vad(duration_secs, event_tx, state.clone())?;
        }
        "recording.raw" => {
            // W1-style raw recorder. Kept for debug + smoke tests.
            let duration_secs = req
                .payload
                .get("duration_secs")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32)
                .unwrap_or(5);
            run_recording_raw(duration_secs, event_tx, state.clone())?;
        }
        _ => {
            warn!("unknown request type: {}", req.kind);
            let _ = writer_send(
                event_tx,
                "error",
                serde_json::json!({
                    "request_id": req.id,
                    "kind": req.kind,
                    "message": "unknown request type",
                }),
            );
        }
    }
    Ok(())
}

fn writer_send(
    tx: &mpsc::UnboundedSender<Event>,
    kind: &str,
    payload: serde_json::Value,
) -> Option<Event> {
    tx.send(Event::new(kind, payload)).ok()
}

fn run_recording_vad(
    _duration_secs: u32,
    event_tx: &mpsc::UnboundedSender<Event>,
    state: Arc<Mutex<State>>,
) -> Result<()> {
    {
        let g = state.lock().unwrap();
        if g.recording {
            anyhow::bail!("recording already in progress");
        }
        if g.models.as_ref().map(|m| !m.vad.exists()).unwrap_or(true) {
            anyhow::bail!("VAD model not available; place silero_vad.onnx under the model dir");
        }
    }

    let (producer, consumer) = ringbuf::HeapRb::<f32>::new(RING_BUFFER_FRAMES).split();
    let capture = AudioCapture::start(producer).context("open microphone")?;
    {
        let mut g = state.lock().unwrap();
        g.recording = true;
        g.input_device = Some(capture.input_device.clone());
    }

    let model_path = state
        .lock()
        .unwrap()
        .models
        .as_ref()
        .map(|m| m.vad.clone())
        .ok_or_else(|| anyhow::anyhow!("model paths not initialized"))?;
    let storage_dir = state.lock().unwrap().storage_dir.clone();
    let _ = event_tx.send(Event::new(
        "recording.started",
        serde_json::json!({
            "mode": "vad",
            "sample_rate": TARGET_SAMPLE_RATE,
        }),
    ));

    let processor = VadProcessor {
        consumer,
        sample_rate: TARGET_SAMPLE_RATE,
        storage_dir,
        tx: event_tx.clone(),
        model_path,
    };

    // Runs synchronously on this task — cpal::Stream is `!Send`.
    let result = processor.run();
    capture.stop();
    state.lock().unwrap().recording = false;
    if let Err(e) = result {
        return Err(e);
    }
    Ok(())
}

fn run_recording_raw(
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
    let capture = match AudioCapture::start(producer) {
        Ok(c) => c,
        Err(e) => return Err(e),
    };
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

#[cfg(windows)]
fn dirs_fallback() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from)
}

#[cfg(target_os = "macos")]
fn dirs_fallback() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn dirs_fallback() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
}
