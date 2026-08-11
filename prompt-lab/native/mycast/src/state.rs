//! Shared in-memory daemon state. Held in an Arc<RwLock<>> for cheap reads.

use crate::security::TokenManager;
use crate::signaling::SignalingHub;
use crate::transfer::TransferManager;

#[derive(Default)]
pub struct SharedState {
    pub tokens: TokenManager,
    pub signaling: SignalingHub,
    pub transfers: TransferManager,
}

impl SharedState {
    pub fn new() -> Self {
        Self::default()
    }
}
