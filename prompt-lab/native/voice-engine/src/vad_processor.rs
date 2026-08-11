//! Streaming VAD processor.
//!
//! Pulls 16 kHz mono f32 samples from a ring buffer, slices them into
//! 32 ms (512-sample) windows, runs Silero VAD, and applies a hysteresis
//! state machine to detect speech segments. Each segment gets:
//!   - a `speech.start` event
//!   - one or more `audio.level` events for the partial waveform
//!   - a `speech.end` event with the captured PCM and a per-segment WAV
//!
//! Why the W1 `recorder` is gone: in W2 we want to record *only the
//! speech* the user said, not 5 seconds of mic noise. The recorder
//! module stayed in the tree for reference, but `vad_processor` replaces
//! it on the live path.

#![allow(dead_code)]

use anyhow::{Context, Result};
use hound::{SampleFormat as HoundFormat, WavSpec, WavWriter};
use ringbuf::HeapCons;
use ringbuf::traits::Consumer;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tracing::info;

use crate::protocol::Event;
use crate::vad_inference::{SileroVad, WINDOW_SAMPLES};

const POP_CHUNK: usize = 1_600; // 100 ms at 16 kHz
const IDLE_POLL: Duration = Duration::from_millis(5);
const LEVEL_MIN_INTERVAL: Duration = Duration::from_millis(50);

/// Hysteresis thresholds. Silero emits a probability in [0, 1] and we
/// use two thresholds to avoid chopping a sentence in half on short
/// silences. These are the values sherpa-onnx uses by default.
const THRESHOLD_START: f32 = 0.5;
const THRESHOLD_END: f32 = 0.35;
const MIN_SPEECH_MS: u64 = 250;
const MIN_SILENCE_MS: u64 = 500;
const PREROLL_MS: u64 = 200;

pub struct VadProcessor {
    pub consumer: HeapCons<f32>,
    pub sample_rate: u32,
    pub storage_dir: PathBuf,
    pub tx: mpsc::UnboundedSender<Event>,
    pub model_path: PathBuf,
}

impl VadProcessor {
    pub async fn run(mut self) -> Result<()> {
        let mut vad = SileroVad::load(&self.model_path)
            .with_context(|| format!("load VAD model {}", self.model_path.display()))?;
        info!(model = %self.model_path.display(), "VAD ready");

        let sample_rate = self.sample_rate.max(1);
        let preroll_frames = (sample_rate as usize) * PREROLL_MS as usize / 1000;
        let mut preroll: Vec<f32> = Vec::with_capacity(preroll_frames);

        // Session-relative sample counter, used to compute segment
        // start timestamps.
        let mut total_sample: u64 = 0;

        // Per-segment state.
        let mut in_speech = false;
        let mut segment_start_sample: u64 = 0;
        let mut segment_samples: Vec<f32> = Vec::new();
        let mut silence_run_frames: u64 = 0;

        let mut last_level_emit = Instant::now();
        let mut window_buf: [f32; WINDOW_SAMPLES] = [0.0; WINDOW_SAMPLES];
        let mut window_fill: usize = 0;
        let mut chunk = [0.0f32; POP_CHUNK];

        loop {
            let pushed = self.consumer.pop_slice(&mut chunk);
            if pushed == 0 {
                tokio::time::sleep(IDLE_POLL).await;
                continue;
            }
            for i in 0..pushed {
                let sample = chunk[i];
                window_buf[window_fill] = sample;
                window_fill += 1;
                if window_fill < WINDOW_SAMPLES {
                    continue;
                }
                window_fill = 0;
                // `total_sample` is updated to point past the last
                // sample of the just-processed window.
                total_sample += WINDOW_SAMPLES as u64;
                let prob = vad
                    .predict_window(&window_buf)
                    .context("VAD predict failed")?;

                let is_speech_likely = prob >= THRESHOLD_END;
                let is_speech_strong = prob >= THRESHOLD_START;

                if !in_speech {
                    if is_speech_strong {
                        in_speech = true;
                        segment_start_sample = total_sample.saturating_sub(preroll_frames as u64);
                        segment_samples.clear();
                        segment_samples.extend_from_slice(&preroll);
                        segment_samples.extend_from_slice(&window_buf);
                        silence_run_frames = 0;
                        let _ = self.tx.send(Event::new(
                            "speech.start",
                            serde_json::json!({
                                "sample": segment_start_sample,
                                "probability": prob,
                            }),
                        ));
                    } else {
                        // Maintain preroll ring so we can prepend ~200 ms
                        // when speech eventually starts.
                        if preroll.len() == preroll_frames {
                            preroll.remove(0);
                        }
                        preroll.push(sample);
                    }
                } else {
                    segment_samples.extend_from_slice(&window_buf);
                    if !is_speech_likely {
                        silence_run_frames += WINDOW_SAMPLES as u64;
                        let silence_ms =
                            silence_run_frames * 1000 / sample_rate as u64;
                        if silence_ms >= MIN_SILENCE_MS {
                            let speech_ms =
                                segment_samples.len() as u64 * 1000 / sample_rate as u64;
                            if speech_ms >= MIN_SPEECH_MS {
                                finalize_segment(
                                    &self.storage_dir,
                                    &self.tx,
                                    segment_start_sample,
                                    &segment_samples,
                                    sample_rate,
                                )?;
                            }
                            // Whether we kept or dropped, reset state.
                            in_speech = false;
                            segment_samples.clear();
                            silence_run_frames = 0;
                            preroll.clear();
                            vad.reset();
                        }
                    } else {
                        silence_run_frames = 0;
                    }
                }

                if last_level_emit.elapsed() >= LEVEL_MIN_INTERVAL {
                    let _ = self.tx.send(Event::new(
                        "audio.level",
                        serde_json::json!({
                            "rms": 0.0,
                            "speech_prob": prob,
                            "in_speech": in_speech,
                            "written_frames": total_sample,
                        }),
                    ));
                    last_level_emit = Instant::now();
                }
            }
        }
    }
}

fn finalize_segment(
    storage_dir: &Path,
    tx: &mpsc::UnboundedSender<Event>,
    start_sample: u64,
    samples: &[f32],
    sample_rate: u32,
) -> Result<()> {
    std::fs::create_dir_all(storage_dir).ok();
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S-%3f");
    let path = storage_dir.join(format!("speech-{stamp}.wav"));
    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: HoundFormat::Int,
    };
    let mut writer =
        WavWriter::create(&path, spec).with_context(|| format!("create {}", path.display()))?;
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        writer.write_sample(v).context("write sample")?;
    }
    writer.finalize().context("finalize wav")?;

    let duration_ms = (samples.len() as u64) * 1000 / sample_rate.max(1) as u64;
    let start_ms = start_sample * 1000 / sample_rate.max(1) as u64;
    let _ = tx.send(Event::new(
        "speech.end",
        serde_json::json!({
            "path": path.to_string_lossy(),
            "start_ms": start_ms,
            "duration_ms": duration_ms,
            "sample_rate": sample_rate,
        }),
    ));
    info!(
        path = %path.display(),
        start_ms,
        duration_ms,
        "speech segment finalized"
    );
    Ok(())
}
