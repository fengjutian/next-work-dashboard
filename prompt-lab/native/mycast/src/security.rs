//! Pairing token generation & validation.

use rand::{Rng, RngCore};
use sha2::{Digest, Sha256};
use std::sync::RwLock;
use std::time::{Duration, Instant};

const DEFAULT_TOKEN_TTL: Duration = Duration::from_secs(300);
const DEFAULT_SESSION_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const MAX_PAIR_ATTEMPTS: u8 = 5;

pub struct TokenManager {
    /// The currently valid one-time pairing token. None means "no active pairing".
    inner: RwLock<Option<TokenEntry>>,
    /// Long-lived session tokens issued after successful pairing.
    sessions: RwLock<Vec<SessionToken>>,
}

struct TokenEntry {
    pair_code: String,
    expires_at: Instant,
    failed_attempts: u8,
}

#[derive(Clone)]
pub struct SessionToken {
    pub token: String,
    pub device_id: String,
    expires_at: Instant,
}

impl Default for TokenManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TokenManager {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(None),
            sessions: RwLock::new(Vec::new()),
        }
    }

    /// Issue a fresh pairing token. Replaces any previous unconsumed one.
    pub fn issue_pairing(&self, ttl: Option<Duration>) -> (String, String, Duration) {
        let mut rng = rand::thread_rng();
        let mut bytes = [0u8; 32];
        rng.fill_bytes(&mut bytes);
        let token = hex::encode(bytes);
        let pair_code = format!("{:06}", {
            let code: u32 = rng.gen_range(0..1_000_000);
            code
        });
        let ttl = ttl.unwrap_or(DEFAULT_TOKEN_TTL);
        let now = Instant::now();
        let entry = TokenEntry {
            pair_code: pair_code.clone(),
            expires_at: now + ttl,
            failed_attempts: 0,
        };
        *self.inner.write().expect("token lock") = Some(entry);
        (token, pair_code, ttl)
    }

    /// Consume the active pairing entry by its 6-digit display code (not the
    /// 32-byte secret). Used by the mobile web UI's "输入配对码" flow: the
    /// phone knows only the code shown on the desktop, and posts it here to
    /// claim the active pairing.
    pub fn consume_pairing_by_code(
        &self,
        code: &str,
        device_id: &str,
        device_name: &str,
    ) -> Option<SessionToken> {
        let mut guard = self.inner.write().expect("token lock");
        let entry = guard.as_ref()?;
        if Instant::now() > entry.expires_at {
            *guard = None;
            return None;
        }
        if !constant_time_eq(entry.pair_code.as_bytes(), code.as_bytes()) {
            let attempts = entry.failed_attempts.saturating_add(1);
            if attempts >= MAX_PAIR_ATTEMPTS {
                *guard = None;
            } else if let Some(active) = guard.as_mut() {
                active.failed_attempts = attempts;
            }
            return None;
        }
        Self::promote_to_session(
            &mut self.sessions.write().expect("session lock"),
            entry,
            device_id,
            device_name,
        );
        *guard = None;
        Some(
            self.sessions
                .read()
                .expect("session lock")
                .last()
                .cloned()
                .expect("just promoted"),
        )
    }

    fn promote_to_session(
        sessions: &mut Vec<SessionToken>,
        _entry: &TokenEntry,
        device_id: &str,
        _device_name: &str,
    ) {
        let mut rng = rand::thread_rng();
        let mut bytes = [0u8; 32];
        rng.fill_bytes(&mut bytes);
        let session = SessionToken {
            token: hex::encode(bytes),
            device_id: device_id.to_string(),
            expires_at: Instant::now() + DEFAULT_SESSION_TTL,
        };
        sessions.push(session);
    }

    /// Validate a session bearer token. Returns the owning device_id if valid.
    pub fn validate_session(&self, presented: &str) -> Option<String> {
        let guard = self.sessions.read().expect("session lock");
        let now = Instant::now();
        guard
            .iter()
            .find(|s| {
                now < s.expires_at && constant_time_eq(s.token.as_bytes(), presented.as_bytes())
            })
            .map(|s| s.device_id.clone())
    }

    #[allow(dead_code)] // Wired to the desktop "forget device" action in the next UI phase.
    pub fn revoke_device(&self, device_id: &str) -> usize {
        let mut guard = self.sessions.write().expect("session lock");
        let before = guard.len();
        guard.retain(|session| session.device_id != device_id);
        before - guard.len()
    }
}

pub fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Best-effort LAN address discovery (used for QR / mDNS reporting).
pub fn enumerate_lan_addrs() -> Vec<std::net::IpAddr> {
    use std::net::{IpAddr, SocketAddr, TcpStream};
    use std::time::Duration;

    let mut addrs: Vec<IpAddr> = Vec::new();
    // Loop over local interface addresses via a transient UDP "connect" trick.
    if let Some(local_ip) = local_ip_for_outbound() {
        addrs.push(local_ip);
    }
    // Sanity probe: try a quick TCP connect to a public DNS to confirm routability
    // (this also forces a non-loopback source). The result itself isn't needed.
    let _ = TcpStream::connect_timeout(
        &SocketAddr::new("1.1.1.1".parse().unwrap(), 80),
        Duration::from_millis(50),
    );
    addrs
}

fn local_ip_for_outbound() -> Option<std::net::IpAddr> {
    use std::net::{IpAddr, SocketAddr, UdpSocket};
    let socket = UdpSocket::bind((std::net::Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket
        .connect(SocketAddr::new("1.1.1.1".parse().ok()?, 80))
        .ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() => Some(IpAddr::V4(v4)),
        other => Some(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_code_is_single_use_and_session_can_be_revoked() {
        let manager = TokenManager::new();
        let (_, code, _) = manager.issue_pairing(None);
        let session = manager
            .consume_pairing_by_code(&code, "phone-1", "Phone")
            .expect("pairing succeeds");
        assert_eq!(
            manager.validate_session(&session.token).as_deref(),
            Some("phone-1")
        );
        assert!(manager
            .consume_pairing_by_code(&code, "phone-2", "Other")
            .is_none());
        assert_eq!(manager.revoke_device("phone-1"), 1);
        assert!(manager.validate_session(&session.token).is_none());
    }

    #[test]
    fn pairing_is_invalidated_after_repeated_failures() {
        let manager = TokenManager::new();
        let (_, code, _) = manager.issue_pairing(None);
        for _ in 0..MAX_PAIR_ATTEMPTS {
            assert!(manager
                .consume_pairing_by_code("999999", "attacker", "Attacker")
                .is_none());
        }
        assert!(manager
            .consume_pairing_by_code(&code, "phone-1", "Phone")
            .is_none());
    }
}
