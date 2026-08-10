//! Daemon configuration. All values can be overridden at startup via the
//! `start` RPC command from the parent Electron process or CLI args.

use std::net::IpAddr;
use std::path::PathBuf;

#[derive(Debug, Clone, Default)]
pub struct ConfigOverrides {
    pub http_port: Option<u16>,
    pub ws_port: Option<u16>,
    pub bind_addr: Option<IpAddr>,
    pub mdns_enabled: Option<bool>,
    pub storage_dir: Option<PathBuf>,
    pub device_name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub bind_addr: IpAddr,
    pub http_port: u16,
    pub ws_port: u16,
    pub storage_dir: PathBuf,
    pub mdns_enabled: bool,
    /// Path to the mobile web UI assets directory. If None, embedded defaults are used.
    pub web_root: Option<PathBuf>,
}

impl Config {
    pub fn defaults() -> Self {
        Self::with_overrides(&ConfigOverrides::default())
    }

    pub fn with_overrides(ovr: &ConfigOverrides) -> Self {
        let device_id = format!("nwd-{}", &uuid::Uuid::new_v4().to_string()[..8]);
        let device_name = ovr
            .device_name
            .clone()
            .unwrap_or_else(hostname);
        let platform = format!("{} {}", std::env::consts::OS, std::env::consts::ARCH);
        Self {
            device_id,
            device_name,
            platform,
            bind_addr: ovr.bind_addr.unwrap_or_else(|| "0.0.0.0".parse().expect("valid bind addr")),
            http_port: ovr.http_port.unwrap_or(17890),
            ws_port: ovr.ws_port.unwrap_or(17891),
            storage_dir: ovr.storage_dir.clone().unwrap_or_else(default_storage_dir),
            mdns_enabled: ovr.mdns_enabled.unwrap_or(true),
            web_root: None,
        }
    }
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "nwd-desktop".to_string())
}

#[cfg(target_os = "windows")]
fn default_storage_dir() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("nwd-mycast")
}

#[cfg(not(target_os = "windows"))]
fn default_storage_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(".local/share/nwd-mycast")
}
