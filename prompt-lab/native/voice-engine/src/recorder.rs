//! WAV recorder for the W1 smoke test.
//!
//! In W1 the goal is only to verify the audio pipeline end-to-end, so the
//! recorder just drains the ring buffer, writes a 16-bit PCM mono WAV file,
//! and emits an `audio_level` event every ~50 ms with the RMS level of the
//! last window.
//!
//! Future phases will replace this with VAD + ASR workers, but the
//! ring-buffer + level-meter scaffolding stays the same.

use anyhow::{Context, Result};
use hound::{SampleFormat as HoundFormat, WavSpec, WavWriter};
use ringbuf::HeapCons;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tracing::info;

use crate::protocol::Event;

/// ~50 ms at 16 kHz. Small enough for responsive UI meters, big enough that
/// we don't spam stdout with JSONL events.
const LEVEL_WINDOW_FRAMES: usize = 800;
/// Emit a level event at most this often even if the window fills.
const LEVEL_MIN_INTERVAL: Duration = Duration::from_millis(50);

pub struct Recorder {
    pub output_path: PathBuf,
    pub duration_secs: u32,
    pub sample_rate: u32,
    /// How to broadcast events back to the daemon. The daemon owns stdout
    /// and serializes the writes, so we send through an mpsc channel.
    pub tx: tokio::sync::mpsc::UnboundedSender<Event>,
    pub consumer: HeapCons<f32>,
    pub started_at: Instant,
}

impl Recorder {
    /// Run the recording loop. Returns when the configured duration has
    /// elapsed or the consumer is disconnected.
    pub async fn run(mut self) -> Result<()> {
        let spec = WavSpec {
            channels: 1,
            sample_rate: self.sample_rate,
            bits_per_sample: 16,
            sample_format: HoundFormat::Int,
        };
        let mut writer = WavWriter::create(&self.output_path, spec)
            .with_context(|| format!("create wav writer at {}", self.output_path.display()))?;

        let total_frames = self.sample_rate as u64 * self.duration_secs as u64;
        let mut written: u64 = 0;
        let mut window: Vec<f32> = Vec::with_capacity(LEVEL_WINDOW_FRAMES);
        let mut last_level_emit = Instant::now();
        let mut last_progress_emit = Instant::now();

        info!(
            path = %self.output_path.display(),
            duration_secs = self.duration_secs,
            "recording started"
        );
        self.tx
            .send(Event::new(
                "recording.started",
                serde_json::json!({
                    "path": self.output_path.to_string_lossy(),
                    "duration_secs": self.duration_secs,
                    "sample_rate": self.sample_rate,
                }),
            ))
            .ok();

        while written < total_frames {
            // Pull up to 100 ms of audio at a time. We use a tight loop with
            // tokio::task::yield_now to keep the worker responsive without
            // sleeping so long that we miss the target duration.
            let mut chunk = [0.0f32; 1600];
            let pushed = self.consumer.pop_slice(&mut chunk);
            if pushed == 0 {
                tokio::time::sleep(Duration::from_millis(5)).await;
                continue;
            }

            for s in &chunk[..pushed] {
                let sample = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                writer
                    .write_sample(sample)
                    .context("write wav sample")?;
                written += 1;
                if written >= total_frames {
                    break;
                }
            }

            // RMS for the level meter.
            window.extend_from_slice(&chunk[..pushed]);
            if window.len() >= LEVEL_WINDOW_FRAMES
                || last_level_emit.elapsed() >= LEVEL_MIN_INTERVAL
            {
                let rms = rms_level(&window);
                self.tx
                    .send(Event::new(
                        "audio.level",
                        serde_json::json!({
                            "rms": rms,
                            "frames": window.len(),
                            "written_frames": written,
                            "total_frames": total_frames,
                        }),
                    ))
                    .ok();
                window.clear();
                last_level_emit = Instant::now();
            }

            if last_progress_emit.elapsed() >= Duration::from_millis(500) {
                self.tx
                    .send(Event::new(
                        "recording.progress",
                        serde_json::json!({
                            "written_frames": written,
                            "total_frames": total_frames,
                        }),
                    ))
                    .ok();
                last_progress_emit = Instant::now();
            }
        }

        writer.finalize().context("finalize wav writer")?;
        let elapsed = self.started_at.elapsed().as_secs_f32();
        info!(path = %self.output_path.display(), elapsed_secs = elapsed, "recording finished");
        self.tx
            .send(Event::new(
                "recording.finished",
                serde_json::json!({
                    "path": self.output_path.to_string_lossy(),
                    "duration_secs": self.duration_secs,
                    "elapsed_secs": elapsed,
                    "sample_rate": self.sample_rate,
                }),
            ))
            .ok();
        Ok(())
    }
}

pub fn default_output_path(storage_dir: &Path) -> PathBuf {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    storage_dir.join(format!("voice-smoke-{stamp}.wav"))
}

fn rms_level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}
