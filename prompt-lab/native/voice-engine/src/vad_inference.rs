//! Silero VAD inference via ONNX Runtime.
//!
//! The Silero VAD model is a small LSTM that takes 512 mono 16 kHz float
//! samples (32 ms) and produces a single speech probability in [0, 1],
//! plus updated hidden + cell state. We keep the state across calls so
//! the model can run as a streaming classifier.
//!
//! ONNX schema (the `silero_vad.onnx` shipped with sherpa-onnx, v4-style):
//!   inputs : x [1, 512] (f32, 32 ms @ 16 kHz), h [2, 1, 64] (LSTM hidden),
//!            c [2, 1, 64] (LSTM cell)
//!   outputs: prob [1, 1] (f32), new_h [2, 1, 64], new_c [2, 1, 64]
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
        for input in &session.inputs {
            tracing::info!(
                name = %input.name,
                ty = ?input.input_type,
                "VAD input"
            );
        }
        for output in &session.outputs {
            tracing::info!(
                name = %output.name,
                ty = ?output.output_type,
                "VAD output"
            );
        }
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
        // Input window: 1xN f32 tensor.
        let x_tensor = Tensor::from_array(([1_i64, WINDOW_SAMPLES as i64], window.to_vec().into_boxed_slice()))
            .context("create VAD x tensor")?;
        // Hidden / cell state: 2x1x64 f32 tensors. We carry the previous
        // state inside `self.h` / `self.c` and feed it in; the model
        // returns the updated `new_h` / `new_c` for the next call.
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
                "x" => x_tensor,
                "h" => h_tensor,
                "c" => c_tensor,
            ]?)
            .context("VAD inference failed")?;

        // prob: [1, 1] f32. The shape is (1,1) — we read the only element.
        let (prob_shape, prob_data) = outputs["prob"]
            .try_extract_raw_tensor::<f32>()
            .context("VAD prob not a raw f32 tensor")?;
        let prob = *prob_data
            .first()
            .ok_or_else(|| anyhow::anyhow!("VAD prob tensor empty: shape={:?}", prob_shape))?;
        // The model returns prob in [0, 1]; clamp defensively against
        // any tiny numerical drift.
        let prob = prob.clamp(0.0, 1.0);

        // new_h / new_c: 2x1x64 f32.
        let (nh_shape, nh_data) = outputs["new_h"]
            .try_extract_raw_tensor::<f32>()
            .context("VAD new_h not a raw f32 tensor")?;
        if shape_matches(nh_shape, &HC_SHAPE) {
            self.h = Array3::from_shape_vec([2, 1, 64], nh_data.to_vec())
                .context("VAD new_h shape mismatch on copy")?;
        } else {
            warn_shape_mismatch("new_h", nh_shape, &HC_SHAPE);
            self.h = Array3::zeros([2, 1, 64]);
        }

        let (nc_shape, nc_data) = outputs["new_c"]
            .try_extract_raw_tensor::<f32>()
            .context("VAD new_c not a raw f32 tensor")?;
        if shape_matches(nc_shape, &HC_SHAPE) {
            self.c = Array3::from_shape_vec([2, 1, 64], nc_data.to_vec())
                .context("VAD new_c shape mismatch on copy")?;
        } else {
            warn_shape_mismatch("new_c", nc_shape, &HC_SHAPE);
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
