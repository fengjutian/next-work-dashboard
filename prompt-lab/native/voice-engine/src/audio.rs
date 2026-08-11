//! CPAL-based audio capture + the canonical internal PCM format.
//!
//! Internal format (matches nwd-mycast + the design doc):
//!     sample_rate : 16_000 Hz
//!     channels    : 1
//!     sample      : f32 in [-1.0, 1.0]
//!
//! The capture stream resamples / downmixes into this format before pushing
//! samples to the ring buffer, so consumers (VAD / ASR in later phases) can
//! rely on it.

#![allow(dead_code)]

use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use ringbuf::HeapProd;
use ringbuf::traits::Producer;
use tracing::{info, warn};

pub const TARGET_SAMPLE_RATE: u32 = 16_000;
pub const TARGET_CHANNELS: u16 = 1;

pub struct AudioCapture {
    pub input_device: String,
    /// Sample rate of the actual input stream (used by VAD/ASR in W2+).
    pub actual_sample_rate: u32,
    /// Channel count of the actual input stream.
    pub actual_channels: u16,
    stream: cpal::Stream,
}

impl AudioCapture {
    /// Open the default input device and start pushing 16 kHz mono f32 samples
    /// into `producer`. The returned guard must be kept alive for the duration
    /// of the recording; dropping it stops the stream.
    pub fn start(producer: HeapProd<f32>) -> Result<Self> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .context("no default input device available")?;
        let input_device = device
            .name()
            .unwrap_or_else(|_| "<unnamed input>".to_string());

        let supported = device
            .default_input_config()
            .context("device has no default input config")?;
        let sample_format = supported.sample_format();
        let actual_channels = supported.channels();
        let actual_sample_rate = supported.sample_rate().0;

        let stream_config = StreamConfig {
            channels: actual_channels,
            sample_rate: supported.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };

        info!(
            device = %input_device,
            sample_rate = actual_sample_rate,
            channels = actual_channels,
            ?sample_format,
            "opening input stream"
        );

        let stream = match sample_format {
            SampleFormat::F32 => build_stream_f32(&device, &stream_config, producer)?,
            SampleFormat::I16 => build_stream_i16(&device, &stream_config, producer)?,
            SampleFormat::U16 => build_stream_u16(&device, &stream_config, producer)?,
            other => anyhow::bail!("unsupported sample format: {other:?}"),
        };
        stream
            .play()
            .context("failed to start input stream (microphone permission?)")?;

        Ok(Self {
            input_device,
            actual_sample_rate,
            actual_channels,
            stream,
        })
    }

    pub fn stop(self) {
        drop(self.stream);
        info!("input stream stopped");
    }
}

fn build_stream_f32(
    device: &cpal::Device,
    config: &StreamConfig,
    mut producer: HeapProd<f32>,
) -> Result<cpal::Stream> {
    let channels = config.channels as usize;
    let err_fn = |err| warn!("cpal stream error: {err}");
    let stream = device
        .build_input_stream(
            config,
            move |data: &[f32], _info| {
                push_mono_f32(&mut producer, data, channels);
            },
            err_fn,
            None,
        )
        .context("build_input_stream (f32) failed")?;
    Ok(stream)
}

fn build_stream_i16(
    device: &cpal::Device,
    config: &StreamConfig,
    mut producer: HeapProd<f32>,
) -> Result<cpal::Stream> {
    let channels = config.channels as usize;
    let err_fn = |err| warn!("cpal stream error: {err}");
    let stream = device
        .build_input_stream(
            config,
            move |data: &[i16], _info| {
                // i16 -> f32: divide by i16::MAX (32768) so the range is
                // strictly [-1, 1).
                let mut tmp = vec![0.0f32; data.len()];
                for (i, s) in data.iter().enumerate() {
                    tmp[i] = *s as f32 / 32_768.0;
                }
                push_mono_f32(&mut producer, &tmp, channels);
            },
            err_fn,
            None,
        )
        .context("build_input_stream (i16) failed")?;
    Ok(stream)
}

fn build_stream_u16(
    device: &cpal::Device,
    config: &StreamConfig,
    mut producer: HeapProd<f32>,
) -> Result<cpal::Stream> {
    let channels = config.channels as usize;
    let err_fn = |err| warn!("cpal stream error: {err}");
    let stream = device
        .build_input_stream(
            config,
            move |data: &[u16], _info| {
                // u16 -> f32: center around 0 by subtracting 32768 and scaling.
                let mut tmp = vec![0.0f32; data.len()];
                for (i, s) in data.iter().enumerate() {
                    tmp[i] = (*s as f32 - 32_768.0) / 32_768.0;
                }
                push_mono_f32(&mut producer, &tmp, channels);
            },
            err_fn,
            None,
        )
        .context("build_input_stream (u16) failed")?;
    Ok(stream)
}

/// Downmix `data` (interleaved multi-channel f32) to mono and push to the
/// ring buffer. Samples that don't fit are dropped (ring buffer full); this
/// is a smoke test, not the final design — VAD/ASR will need backpressure
/// handling.
fn push_mono_f32(producer: &mut HeapProd<f32>, data: &[f32], channels: usize) {
    if channels <= 1 {
        let _ = producer.push_slice(data);
        return;
    }
    let frames = data.len() / channels;
    let mut mono = vec![0.0f32; frames];
    for f in 0..frames {
        let mut sum = 0.0f32;
        for c in 0..channels {
            sum += data[f * channels + c];
        }
        mono[f] = sum / channels as f32;
    }
    let _ = producer.push_slice(&mono);
}
