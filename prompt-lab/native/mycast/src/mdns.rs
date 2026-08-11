//! mDNS service registration. Advertises the device as `_nwd-mycast._tcp.local`
//! so phones on the same LAN can discover it by name.
//!
//! The `mdns-sd` crate implements the protocol directly; it does NOT require
//! Bonjour on Windows.

use mdns_sd::{ServiceDaemon, ServiceInfo};

use crate::config::Config;

pub struct MdnsAdvertiser {
    daemon: ServiceDaemon,
}

impl MdnsAdvertiser {
    pub fn start(cfg: &Config, http_port: u16, txt: &[(&str, &str)]) -> anyhow::Result<Self> {
        let daemon = ServiceDaemon::new()?;
        let instance = sanitize_instance(&cfg.device_name);
        let service_type = "_nwd-mycast._tcp.local.";
        let properties = txt
            .iter()
            .map(|(k, v)| (*k, *v))
            .collect::<Vec<_>>();
        let host_ipv4: std::net::Ipv4Addr = primary_ipv4().unwrap_or([0, 0, 0, 0].into());
        let service = ServiceInfo::new(
            service_type,
            &instance,
            &format!("{instance}.local."),
            std::net::IpAddr::V4(host_ipv4),
            http_port,
            properties.as_slice(),
        )?;
        daemon.register(service)?;
        let full_name = format!("{instance}.{service_type}");
        tracing::info!(target: "mycast.mdns", name = %full_name, port = http_port, "mDNS service registered");
        Ok(Self { daemon })
    }
}

impl Drop for MdnsAdvertiser {
    fn drop(&mut self) {
        let _ = self.daemon.shutdown();
    }
}

fn sanitize_instance(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    if cleaned.is_empty() {
        "nwd-desktop".to_string()
    } else {
        cleaned.chars().take(63).collect()
    }
}

/// Pick the first non-loopback IPv4 address by opening a transient UDP socket.
fn primary_ipv4() -> Option<std::net::Ipv4Addr> {
    use std::net::{Ipv4Addr, SocketAddr, UdpSocket};
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect(SocketAddr::new("1.1.1.1".parse().ok()?, 80)).ok()?;
    match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() => Some(v4),
        _ => None,
    }
}
