//! JSONL RPC protocol shared by the parent (Electron main) and this sidecar.
//!
//! Wire format: one JSON object per line. Parent -> child on stdin; child -> parent
//! on stdout. All requests carry an `id` for correlation; unsolicited events use
//! `id = null`.

use serde::{Deserialize, Serialize};

/// RPC request: parent -> sidecar.
#[derive(Debug, Clone, Deserialize)]
pub struct Request {
    #[serde(default)]
    pub id: Option<u64>,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(flatten)]
    pub payload: serde_json::Value,
}

/// RPC response: sidecar -> parent (in reply to a request).
#[derive(Debug, Clone, Serialize)]
pub struct Response {
    pub id: Option<u64>,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(flatten)]
    pub payload: serde_json::Value,
}

impl Response {
    pub fn ok(id: Option<u64>, kind: impl Into<String>, payload: serde_json::Value) -> Self {
        Self { id, kind: kind.into(), payload }
    }
    pub fn err(id: Option<u64>, kind: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            id,
            kind: kind.into(),
            payload: serde_json::json!({ "ok": false, "error": message.into() }),
        }
    }
}

/// Out-of-band event: sidecar -> parent, no reply expected.
#[derive(Debug, Clone, Serialize)]
pub struct Event {
    pub id: Option<u64>,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(flatten)]
    pub payload: serde_json::Value,
}

impl Event {
    pub fn new(kind: impl Into<String>, payload: serde_json::Value) -> Self {
        Self { id: None, kind: kind.into(), payload }
    }
}

/// State snapshot returned to the parent on `start` and `state` requests.
#[derive(Debug, Clone, Serialize)]
pub struct DaemonInfo {
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub bind_addr: String,
    pub http_port: u16,
    pub ws_port: u16,
    pub mdns_enabled: bool,
    pub version: String,
}
