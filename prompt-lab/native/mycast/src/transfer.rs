//! File transfer: incoming (upload from phone) and outgoing (download to phone).
//!
//! All state is held in memory; the file payload itself is streamed to disk
//! directly so we don't have to buffer large transfers.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::Instant;

use sha2::{Digest, Sha256};

#[derive(Debug, Clone, serde::Serialize)]
pub struct UploadRecord {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub received_bytes: u64,
    pub sha256: String,
    pub status: TransferStatus,
    pub path: PathBuf,
    pub started_at_ms: i64,
    pub finished_at_ms: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferStatus {
    Active,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Default)]
pub struct TransferManager {
    uploads: RwLock<HashMap<String, UploadRecord>>,
}

impl TransferManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn begin_upload(&self, id: &str, name: &str, declared_size: u64, target_path: PathBuf) {
        let rec = UploadRecord {
            id: id.to_string(),
            name: name.to_string(),
            size: declared_size,
            received_bytes: 0,
            sha256: String::new(),
            status: TransferStatus::Active,
            path: target_path,
            started_at_ms: chrono::Utc::now().timestamp_millis(),
            finished_at_ms: None,
            error: None,
        };
        self.uploads.write().expect("uploads lock").insert(id.to_string(), rec);
    }

    pub fn update_progress(&self, id: &str, received: u64) {
        if let Some(rec) = self.uploads.write().expect("uploads lock").get_mut(id) {
            rec.received_bytes = received;
        }
    }

    pub fn finish_upload(&self, id: &str, sha256: String, ok: bool, error: Option<String>) -> Option<UploadRecord> {
        let mut guard = self.uploads.write().expect("uploads lock");
        let rec = guard.get_mut(id)?;
        rec.sha256 = sha256;
        rec.finished_at_ms = Some(chrono::Utc::now().timestamp_millis());
        rec.status = if ok { TransferStatus::Completed } else { TransferStatus::Failed };
        rec.error = error;
        Some(rec.clone())
    }

    pub fn get(&self, id: &str) -> Option<UploadRecord> {
        self.uploads.read().expect("uploads lock").get(id).cloned()
    }

    pub fn list(&self) -> Vec<UploadRecord> {
        let mut v: Vec<UploadRecord> = self.uploads.read().expect("uploads lock").values().cloned().collect();
        v.sort_by(|a, b| b.started_at_ms.cmp(&a.started_at_ms));
        v
    }

    pub fn cancel(&self, id: &str) -> bool {
        if let Some(rec) = self.uploads.write().expect("uploads lock").get_mut(id) {
            rec.status = TransferStatus::Cancelled;
            rec.finished_at_ms = Some(chrono::Utc::now().timestamp_millis());
            true
        } else {
            false
        }
    }
}

/// Helper for incremental SHA-256 during upload.
pub struct Hasher {
    inner: Sha256,
    started: Instant,
}

impl Hasher {
    pub fn new() -> Self {
        Self { inner: Sha256::new(), started: Instant::now() }
    }
    pub fn update(&mut self, data: &[u8]) {
        self.inner.update(data);
    }
    pub fn finalize_hex(self) -> String {
        hex::encode(self.inner.finalize())
    }
    #[allow(dead_code)]
    pub fn elapsed(&self) -> std::time::Duration {
        self.started.elapsed()
    }
}
