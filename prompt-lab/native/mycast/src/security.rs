//! Pairing token generation & validation.

use rand::{Rng, RngCore};
use sha2::{Digest, Sha256};
use std::sync::RwLock;
use std::time::{Duration, Instant};

const DEFAULT_TOKEN_TTL: Duration = Duration::from_secs(300);
const PAIRING_CODE_LEN: usize = 6;

pub struct TokenManager {
    /// The currently valid one-time pairing token. None means "no active pairing".
    inner: RwLock<Option<TokenEntry>>,
    /// Long-lived session tokens issued after successful pairing.
    sessions: RwLock<Vec<SessionToken>>,
}

struct TokenEntry {
    token: String,
    pair_code: String,
    issued_at: Instant,
    expires_at: Instant,
}

#[derive(Clone)]
pub struct SessionToken {
    pub token: String,
    pub device_id: String,
    pub device_name: String,
    pub issued_at: Instant,
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
            token: token.clone(),
            pair_code: pair_code.clone(),
            issued_at: now,
            expires_at: now + ttl,
        };
        *self.inner.write().expect("token lock") = Some(entry);
        (token, pair_code, ttl)
    }

    /// Try to consume the current pairing token. Returns true on success.
    /// `device_id`/`device_name` describe the phone that just paired.
    pub fn consume_pairing(&self, presented: &str, device_id: &str, device_name: &str) -> Option<SessionToken> {
        let mut guard = self.inner.write().expect("token lock");
        let entry = guard.as_ref()?;
        if Instant::now() > entry.expires_at {
            *guard = None;
            return None;
        }
        if !constant_time_eq(entry.token.as_bytes(), presented.as_bytes()) {
            return None;
        }
        // Promote to a long-lived session token.
        let mut rng = rand::thread_rng();
        let mut bytes = [0u8; 32];
        rng.fill_bytes(&mut bytes);
        let session = SessionToken {
            token: hex::encode(bytes),
            device_id: device_id.to_string(),
            device_name: device_name.to_string(),
            issued_at: Instant::now(),
        };
        self.sessions.write().expect("session lock").push(session.clone());
        *guard = None;
        Some(session)
    }

    /// Validate a session bearer token. Returns the owning device_id if valid.
    pub fn validate_session(&self, presented: &str) -> Option<String> {
        let guard = self.sessions.read().expect("session lock");
        guard.iter().find(|s| constant_time_eq(s.token.as_bytes(), presented.as_bytes())).map(|s| s.device_id.clone())
    }

    pub fn active_pair_code(&self) -> Option<String> {
        let guard = self.inner.read().expect("token lock");
        guard.as_ref().and_then(|e| if Instant::now() < e.expires_at { Some(e.pair_code.clone()) } else { None })
    }

    pub fn list_sessions(&self) -> Vec<serde_json::Value> {
        let guard = self.sessions.read().expect("session lock");
        guard.iter().map(|s| serde_json::json!({
            "token": sha256_hex(&s.token),
            "device_id": s.device_id,
            "device_name": s.device_name,
            "issued_at_ms": s.issued_at.elapsed().as_millis() as i64,
        })).collect()
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
    let _ = TcpStream::connect_timeout(&SocketAddr::new("1.1.1.1".parse().unwrap(), 80), Duration::from_millis(50));
    addrs
}

fn local_ip_for_outbound() -> Option<std::net::IpAddr> {
    use std::net::{IpAddr, SocketAddr, UdpSocket};
    let socket = UdpSocket::bind((std::net::Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect(SocketAddr::new("1.1.1.1".parse().ok()?, 80)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() => Some(IpAddr::V4(v4)),
        other => Some(other),
    }
}
