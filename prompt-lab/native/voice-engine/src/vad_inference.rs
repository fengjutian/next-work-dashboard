//! Silero VAD inference via ONNX Runtime.
//!
//! The Silero VAD model is a small LSTM that takes 512 mono 16 kHz float
//! samples (32 ms) and produces a single speech probability in [0, 1],
//! plus updated hidden + cell state. We keep the state across calls so
//! the model can run as a streaming classifier.
//!
//! ONNX schema (silero_vad.onnx v5):
//!   inputs : input [1, N] (N=512 for 16 kHz), sr (int64, scalar),
//!            h [2, 1, 64] (LSTM hidden state), c [2, 1, 64]
//!   outputs: output (scalar prob), hn, cn
//!
//! Thresholding and start/end decisions are the caller's job. This module
//! only does the per-window inference and state bookkeeping.

#![allow(dead_code)]

use anyhow::{Context, Result};
use ndarray::Array3;
use ort::session::Session;
use ort::value::Tensor;
use std::path::Path;
use std::sync::Mutex;

/// Number of samples per inference window at 16 kHz (32 ms).
pub const WINDOW_SAMPLES: usize = 512;
/// Hidden/cell state shape (LSTM has 2 layers, 1 direction, 64 cells).
const HC_SHAPE: [i64; 3] = [2, 1, 64];

pub struct SileroVad {
    session: Mutex<Session>,
    h: Array3<f32>,
    c: Array3<f32>,
}

impl SileroVad {
    pub fn load(model_path: &Path) -> Result<Self> {
        let session = Session::builder()
            .context("failed to build ort session")?
            .commit_from_file(model_path)
            .with_context(|| format!("failed to load ONNX model from {}", model_path.display()))?;
        Ok(Self {
            session: Mutex::new(session),
            h: Array3::zeros([2, 1, 64]),
            c: Array3::zeros([2, 1, 64]),
        })
    }

    /// Reset the LSTM state. Call this when the audio stream restarts
    /// (e.g. after a long silence gap) so the model doesn't keep stale
    /// context from the previous session.
    pub fn reset(&mut self) {
        self.h.fill(0.0);
        self.c.fill(0.0);
    }

    /// Run inference on a 512-sample window. Returns the speech
    /// probability in [0, 1].
    pub fn predict_window(&mut self, window: &[f32; WINDOW_SAMPLES]) -> Result<f32> {
        // Input window: 1xN f32 tensor. Use the raw (shape, data) form
        // to avoid copying the array twice. Ndarray is also fine, but
        // this is the simplest portable shape across ort feature flags.
        let input_tensor = Tensor::from_array(([1_i64, WINDOW_SAMPLES as i64], window.to_vec().into_boxed_slice()))
            .context("create VAD input tensor")?;
        // Sample-rate scalar (ort wants a 0-D i64 tensor).
        let sr_tensor = Tensor::from_array(((), vec![16_000_i64]))
            .context("create VAD sr tensor")?;
        // Hidden / cell state: 2x1x64 f32 tensors. We carry the previous
        // state inside `self.h` / `self.c` and feed it in; the model
        // returns the updated `hn` / `cn` for the next call.
        let h_data: Box<[f32]> = self
            .h
            .as_slice()
            .context("VAD h not contiguous")?
            .to_vec()
            .into_boxed_slice();
        let h_tensor = Tensor::from_array((HC_SHAPE, h_data))
            .context("create VAD h tensor")?;
        let c_data: Box<[f32]> = self
            .c
            .as_slice()
            .context("VAD c not contiguous")?
            .to_vec()
            .into_boxed_slice();
        let c_tensor = Tensor::from_array((HC_SHAPE, c_data))
            .context("create VAD c tensor")?;

        let session = self.session.lock().expect("VAD session poisoned");
        let outputs = session
            .run(ort::inputs![
                "input" => input_tensor,
                "sr" => sr_tensor,
                "h" => h_tensor,
                "c" => c_tensor,
            ]?)
            .context("VAD inference failed")?;

        // output: scalar f32 probability. The model declares it as a
        // 0-D tensor; `try_extract_scalar` handles that explicitly.
        let prob: f32 = outputs["output"]
            .try_extract_scalar::<f32>()
            .context("VAD output is not a scalar f32")?;

        // hn / cn: 2x1x64 f32. `try_extract_raw_tensor` gives us
        // `(&[i64], &[f32])` so we can both sanity-check the shape and
        // copy the data back into the ndarray state.
        let (hn_shape, hn_data) = outputs["hn"]
            .try_extract_raw_tensor::<f32>()
            .context("VAD hn not a raw f32 tensor")?;
        if shape_matches(hn_shape, &HC_SHAPE) {
            self.h = Array3::from_shape_vec([2, 1, 64], hn_data.to_vec())
                .context("VAD hn shape mismatch on copy")?;
        } else {
            warn_shape_mismatch("hn", hn_shape, &HC_SHAPE);
            self.h = Array3::zeros([2, 1, 64]);
        }

        let (cn_shape, cn_data) = outputs["cn"]
            .try_extract_raw_tensor::<f32>()
            .context("VAD cn not a raw f32 tensor")?;
        if shape_matches(cn_shape, &HC_SHAPE) {
            self.c = Array3::from_shape_vec([2, 1, 64], cn_data.to_vec())
                .context("VAD cn shape mismatch on copy")?;
        } else {
            warn_shape_mismatch("cn", cn_shape, &HC_SHAPE);
            self.c = Array3::zeros([2, 1, 64]);
        }

        Ok(prob)
    }
}

fn shape_matches(got: &[i64], expected: &[i64]) -> bool {
    if got.len() != expected.len() {
        return false;
    }
    for (a, b) in got.iter().zip(expected.iter()) {
        if *a != *b {
            return false;
        }
    }
    true
}

fn warn_shape_mismatch(name: &str, got: &[i64], expected: &[i64]) {
    tracing::warn!(
        vad_tensor = name,
        got = ?got,
        expected = ?expected,
        "VAD state tensor shape mismatch; resetting"
    );
}
