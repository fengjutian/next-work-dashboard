//! WebRTC signaling hub. Routes signaling messages between the phone (WebSocket
//! client) and the desktop renderer. The desktop does NOT connect over WebSocket;
//! it receives signaling frames via the parent IPC (`signaling` events).
//!
//! The WebRTC peer connection itself is created in the desktop's renderer
//! process (Chromium) using its native WebRTC API. This service only forwards
//! SDP / ICE candidates.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::sync::mpsc;

use crate::protocol::Event;

#[derive(Clone)]
pub struct SignalingHub {
    inner: Arc<RwLock<HubInner>>,
}

struct HubInner {
    /// Active phone-side WebSocket senders, keyed by phone device_id.
    phone_senders: HashMap<String, mpsc::UnboundedSender<SignalingFrame>>,
    /// Active sessions, keyed by session_id.
    sessions: HashMap<String, SessionEntry>,
    /// Outbound event channel (events to forward to the parent / Electron main).
    events: Option<mpsc::UnboundedSender<Event>>,
}

pub struct SessionEntry {
    pub session_id: String,
    pub phone_device_id: String,
    pub phone_device_name: String,
    pub kind: SessionKind,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionKind {
    Screen,
    File,
    Discovery,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SignalingFrame {
    /// Phone announces itself, requests pairing, or lists its capabilities.
    Hello { device_id: String, device_name: String, platform: String },
    /// Phone presents a pairing token for upgrade to a session.
    Pair { token: String, device_id: String, device_name: String, platform: String },
    /// Phone requests a new session (after pairing succeeded).
    CreateSession { session_id: String, kind: SessionKind },
    /// WebRTC SDP / ICE relay frames.
    Offer { session_id: String, sdp: String },
    Answer { session_id: String, sdp: String },
    Ice { session_id: String, candidate: serde_json::Value },
    /// Phone signals stream start/stop, file list, etc.
    StreamStart { session_id: String },
    StreamStop { session_id: String },
    /// Keep-alive ping from phone.
    Ping,
}

impl SignalingHub {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HubInner {
                phone_senders: HashMap::new(),
                sessions: HashMap::new(),
                events: None,
            })),
        }
    }

    pub fn attach_event_sink(&self, tx: mpsc::UnboundedSender<Event>) {
        self.inner.write().expect("signaling lock").events = Some(tx);
    }

    pub fn register_phone(&self, device_id: &str, sender: mpsc::UnboundedSender<SignalingFrame>) {
        self.inner.write().expect("signaling lock").phone_senders.insert(device_id.to_string(), sender);
    }

    pub fn unregister_phone(&self, device_id: &str) {
        self.inner.write().expect("signaling lock").phone_senders.remove(device_id);
        let mut guard = self.inner.write().expect("signaling lock");
        guard.sessions.retain(|_, s| s.phone_device_id != device_id);
    }

    /// Handle a frame arriving from a phone.
    pub fn handle_phone_frame(&self, from_device: &str, frame: SignalingFrame) {
        match &frame {
            SignalingFrame::Hello { device_id, device_name, platform } => {
                tracing::info!(target: "mycast.signaling", phone = %device_id, name = %device_name, "phone hello");
                self.emit(Event::new("phone.hello", serde_json::json!({
                    "device_id": device_id,
                    "device_name": device_name,
                    "platform": platform,
                })));
            }
            SignalingFrame::Pair { token, device_id, device_name, platform } => {
                tracing::info!(target: "mycast.signaling", phone = %device_id, "phone pair request");
                self.emit(Event::new("phone.pair", serde_json::json!({
                    "device_id": device_id,
                    "device_name": device_name,
                    "platform": platform,
                    "token_prefix": &token[..token.len().min(8)],
                })));
            }
            SignalingFrame::CreateSession { session_id, kind } => {
                let mut guard = self.inner.write().expect("signaling lock");
                let phone_device_name = self.phone_display_name(&guard, from_device);
                guard.sessions.insert(session_id.clone(), SessionEntry {
                    session_id: session_id.clone(),
                    phone_device_id: from_device.to_string(),
                    phone_device_name,
                    kind: *kind,
                    created_at_ms: chrono::Utc::now().timestamp_millis(),
                });
                drop(guard);
                self.emit(Event::new("session.created", serde_json::json!({
                    "session_id": session_id,
                    "phone_device_id": from_device,
                    "kind": kind,
                })));
            }
            SignalingFrame::Offer { session_id, sdp } => {
                self.emit(Event::new("webrtc.offer", serde_json::json!({
                    "session_id": session_id,
                    "phone_device_id": from_device,
                    "sdp": sdp,
                })));
            }
            SignalingFrame::Answer { session_id, sdp } => {
                self.emit(Event::new("webrtc.answer", serde_json::json!({
                    "session_id": session_id,
                    "phone_device_id": from_device,
                    "sdp": sdp,
                })));
            }
            SignalingFrame::Ice { session_id, candidate } => {
                self.emit(Event::new("webrtc.ice", serde_json::json!({
                    "session_id": session_id,
                    "phone_device_id": from_device,
                    "candidate": candidate,
                })));
            }
            SignalingFrame::StreamStart { session_id } => {
                self.emit(Event::new("stream.start", serde_json::json!({
                    "session_id": session_id,
                    "phone_device_id": from_device,
                })));
            }
            SignalingFrame::StreamStop { session_id } => {
                self.emit(Event::new("stream.stop", serde_json::json!({
                    "session_id": session_id,
                    "phone_device_id": from_device,
                })));
            }
            SignalingFrame::Ping => { /* heartbeat */ }
        }
    }

    /// Send a frame to a specific phone (used to push desktop-originated SDP / ICE).
    pub fn send_to_phone(&self, device_id: &str, frame: SignalingFrame) -> bool {
        let guard = self.inner.read().expect("signaling lock");
        if let Some(tx) = guard.phone_senders.get(device_id) {
            tx.send(frame).is_ok()
        } else {
            false
        }
    }

    pub fn list_sessions(&self) -> Vec<serde_json::Value> {
        let guard = self.inner.read().expect("signaling lock");
        guard.sessions.values().map(|s| serde_json::json!({
            "session_id": s.session_id,
            "phone_device_id": s.phone_device_id,
            "phone_device_name": s.phone_device_name,
            "kind": s.kind,
            "created_at_ms": s.created_at_ms,
        })).collect()
    }

    pub fn end_session(&self, session_id: &str) -> bool {
        let mut guard = self.inner.write().expect("signaling lock");
        if let Some(entry) = guard.sessions.remove(session_id) {
            if let Some(tx) = guard.phone_senders.get(&entry.phone_device_id) {
                let _ = tx.send(SignalingFrame::StreamStop { session_id: session_id.to_string() });
            }
            true
        } else {
            false
        }
    }

    fn phone_display_name(&self, guard: &HubInner, device_id: &str) -> String {
        // We don't store display_name on the sender; phones always include it in their
        // hello frame. Best-effort fallback: use device_id.
        guard.phone_senders.get(device_id).map(|_| device_id.to_string()).unwrap_or_else(|| device_id.to_string())
    }

    fn emit(&self, event: Event) {
        if let Some(tx) = self.inner.read().expect("signaling lock").events.as_ref() {
            let _ = tx.send(event);
        }
    }
}

impl Default for SignalingHub {
    fn default() -> Self {
        Self::new()
    }
}
