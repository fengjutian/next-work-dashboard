//! Shared in-memory daemon state. Held in an Arc<RwLock<>> for cheap reads.

use std::collections::HashMap;
use std::sync::RwLock;

use crate::security::TokenManager;
use crate::signaling::SignalingHub;
use crate::transfer::TransferManager;

#[derive(Default)]
pub struct SharedState {
    pub tokens: TokenManager,
    pub signaling: SignalingHub,
    pub transfers: TransferManager,
    /// device_id -> last-seen timestamp (ms since epoch)
    pub connected_devices: RwLock<HashMap<String, i64>>,
}

impl SharedState {
    pub fn new() -> Self {
        Self::default()
    }
}
