//! JSONL protocol for the nwd-net-probe daemon.
//!
//! Wire format: one JSON object per line, both directions.
//! V1 supports: ready / error / probe_result (icmp only).
//! V2 will add tcp / dns / http / traceroute events.

use serde::{Deserialize, Serialize};

/// Outbound message (daemon → Node).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Outbound {
    /// Sent once after startup. Node treats missing `ready` as a fatal error.
    Ready { version: String, pid: u32 },
    /// Probe sample for a target. Emitted on every completed probe.
    ProbeResult {
        id: String,
        probe: String,
        timestamp_ms: u64,
        success: bool,
        latency_ms: Option<f64>,
        error: Option<String>,
    },
    /// Non-fatal daemon-level error (e.g. failed to add a target).
    Error { message: String },
}

/// Inbound message (Node → daemon). Unknown variants are ignored (forward-compat).
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Inbound {
    /// Add or update a target. Existing id replaces the previous config.
    AddTarget {
        id: String,
        target: String,
        #[serde(default = "default_probe")]
        probe: String,
        #[serde(default = "default_interval")]
        interval_ms: u64,
        #[serde(default)]
        timeout_ms: Option<u64>,
    },
    /// Remove a target. Missing id is a no-op.
    RemoveTarget { id: String },
    /// Graceful shutdown.
    Shutdown,
}

fn default_probe() -> String {
    "icmp".to_string()
}

fn default_interval() -> u64 {
    5000
}

impl Outbound {
    pub fn to_jsonl(&self) -> String {
        // serde_json never fails for our types; unwrap is safe.
        let mut line = serde_json::to_string(self).expect("serialize outbound");
        line.push('\n');
        line
    }
}
