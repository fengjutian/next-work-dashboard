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
use ndarray::{Array2, Array3};
use ort::session::Session;
use ort::value::Value;
use std::path::Path;
use std::sync::Mutex;

/// Number of samples per inference window at 16 kHz (32 ms).
pub const WINDOW_SAMPLES: usize = 512;
/// Hidden/cell state shape (LSTM has 2 layers, 1 direction, 64 cells).
const HC_SHAPE: [usize; 3] = [2, 1, 64];

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
            h: Array3::zeros(HC_SHAPE),
            c: Array3::zeros(HC_SHAPE),
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
        let input = Array2::from_shape_vec((1, WINDOW_SAMPLES), window.to_vec())
            .context("VAD window size mismatch")?;
        let sr: i64 = 16_000;
        let sr_array = ndarray::arr0(sr);

        let input_val = Value::from_array(input)?;
        let sr_val = Value::from_array(sr_array)?;
        let h_val = Value::from_array(self.h.clone())?;
        let c_val = Value::from_array(self.c.clone())?;

        let mut session = self.session.lock().expect("VAD session poisoned");
        let outputs = session
            .run(ort::inputs!["input" => input_val, "sr" => sr_val, "h" => h_val, "c" => c_val])
            .context("VAD inference failed")?;

        // output: scalar (1,) f32
        let (out_shape, out_data) = outputs["output"]
            .try_extract_tensor::<f32>()
            .context("VAD output not a tensor")?;
        let prob = if out_shape.is_empty() {
            // Some ort versions wrap scalars as [].
            out_data.first().copied().unwrap_or(0.0)
        } else {
            out_data.first().copied().unwrap_or(0.0)
        };

        // hn, cn: [2, 1, 64]
        let (hn_shape, hn_data) = outputs["hn"].try_extract_tensor::<f32>()?;
        let (cn_shape, cn_data) = outputs["cn"].try_extract_tensor::<f32>()?;
        if hn_shape == HC_SHAPE.as_slice() {
            self.h = Array3::from_shape_vec(HC_SHAPE, hn_data.to_vec())
                .context("VAD hn shape mismatch")?;
        } else {
            // Defensive: if ort returns a different layout, fall back to zeros
            // rather than panic. The next call's state will be off, but we
            // won't crash the daemon.
            warn_shape_mismatch("hn", hn_shape, HC_SHAPE.as_slice());
            self.h = Array3::zeros(HC_SHAPE);
        }
        if cn_shape == HC_SHAPE.as_slice() {
            self.c = Array3::from_shape_vec(HC_SHAPE, cn_data.to_vec())
                .context("VAD cn shape mismatch")?;
        } else {
            warn_shape_mismatch("cn", cn_shape, HC_SHAPE.as_slice());
            self.c = Array3::zeros(HC_SHAPE);
        }
        let _ = (out_shape, cn_shape);

        Ok(prob)
    }
}

fn warn_shape_mismatch(name: &str, got: &[i64], expected: &[usize]) {
    tracing::warn!(
        vad_tensor = name,
        got = ?got,
        expected = ?expected,
        "VAD state tensor shape mismatch; resetting"
    );
}
