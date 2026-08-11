//! Model manager — ensures the on-disk model files exist.
//!
//! For W2 we only need the Silero VAD model. The download URL points at
//! the official sherpa-onnx GitHub release; if GitHub is unreachable,
//! the user can drop `silero_vad.onnx` into the model directory manually
//! and we'll pick it up next start.

#![allow(dead_code)]

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use tracing::{info, warn};

/// sherpa-onnx release URL for the v5 Silero VAD ONNX.
const SILERO_VAD_URL: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx";

const SILERO_VAD_FILENAME: &str = "silero_vad.onnx";

#[derive(Clone, Debug)]
pub struct ModelPaths {
    pub vad: PathBuf,
    pub model_dir: PathBuf,
}

pub fn model_paths(model_dir: &Path) -> ModelPaths {
    ModelPaths {
        vad: model_dir.join(SILERO_VAD_FILENAME),
        model_dir: model_dir.to_path_buf(),
    }
}

/// Ensure all required models are present, downloading what is missing.
/// Emits progress as tracing events. Failures are non-fatal — we return
/// the paths either way so the caller can report a clean "missing model"
/// error to the renderer.
pub async fn ensure_models(model_dir: &Path) -> Result<ModelPaths> {
    std::fs::create_dir_all(model_dir)
        .with_context(|| format!("create model dir {}", model_dir.display()))?;
    let paths = model_paths(model_dir);

    if !paths.vad.exists() {
        info!(
            vad_path = %paths.vad.display(),
            "Silero VAD model missing, attempting download"
        );
        if let Err(e) = download(SILERO_VAD_URL, &paths.vad).await {
            warn!(error = %e, "failed to download silero_vad.onnx; place it manually to enable VAD");
        } else {
            info!(path = %paths.vad.display(), "Silero VAD model downloaded");
        }
    } else {
        info!(path = %paths.vad.display(), "Silero VAD model already on disk");
    }

    Ok(paths)
}

async fn download(url: &str, dest: &Path) -> Result<()> {
    let client = reqwest::Client::builder()
        .user_agent("nwd-voice-engine/0.1")
        .build()
        .context("build reqwest client")?;
    let resp = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?;
    if !resp.status().is_success() {
        anyhow::bail!("download failed: HTTP {}", resp.status());
    }
    let bytes = resp.bytes().await.context("read response body")?;
    if bytes.len() < 1024 {
        anyhow::bail!("download too small ({} bytes); refusing to write", bytes.len());
    }
    // Write to a temp file alongside, then rename, to avoid leaving a
    // half-written model on disk if we crash mid-download.
    let tmp = dest.with_extension("onnx.tmp");
    std::fs::write(&tmp, &bytes).with_context(|| format!("write {}", tmp.display()))?;
    std::fs::rename(&tmp, dest)
        .with_context(|| format!("rename {} -> {}", tmp.display(), dest.display()))?;
    Ok(())
}
