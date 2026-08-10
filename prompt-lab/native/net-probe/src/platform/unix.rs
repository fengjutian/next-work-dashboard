//! Unix ICMP / ICMPv6 via raw socket (`socket2`).
//!
//! V1.1.1 handles both v4 and v6. v6 uses IPPROTO_ICMPV6 with IPv6 raw socket.
//!
//! Privilege note: on Linux, sending raw ICMP/ICMPv6 requires `CAP_NET_RAW` (or
//! the binary being setuid). Modern distros ship `ping`/`ping6` setuid; we
//! don't, so users will need to grant the capability.

use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::{Duration, Instant};

use socket2::{Domain, Protocol, Socket, Type};

/// Build a fresh ICMP socket. Caller is responsible for closing it.
fn build_icmp_socket() -> std::io::Result<Socket> {
    let sock = Socket::new(Domain::IPV4, Type::RAW, Some(Protocol::ICMPV4))?;
    // We bind to in_addr_any:0. SO_RCVTIMEO is set on the socket after bind.
    let addr: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0);
    sock.bind(&addr.into())?;
    Ok(sock)
}

const ICMP_ECHO: u8 = 8;
const ICMP_ECHO_REPLY: u8 = 0;

fn checksum(data: &[u8]) -> u16 {
    let mut sum: u32 = 0;
    let mut i = 0;
    while i + 1 < data.len() {
        let word = u16::from_be_bytes([data[i], data[i + 1]]);
        sum = sum.wrapping_add(u32::from(word));
        i += 2;
    }
    if i < data.len() {
        sum = sum.wrapping_add(u32::from(data[i]) << 8);
    }
    while (sum >> 16) != 0 {
        sum = (sum & 0xFFFF).wrapping_add(sum >> 16);
    }
    !(sum as u16)
}

pub fn icmp_echo(addr: SocketAddr, timeout: Duration) -> Result<f64, String> {
    let ipv4: Ipv4Addr = match addr {
        SocketAddr::V4(v4) => *v4.ip(),
        SocketAddr::V6(_) => return Err("ipv6 not supported in v1".to_string()),
    };

    let sock = build_icmp_socket().map_err(|e| format!("icmp socket: {e}"))?;

    // Set receive timeout so we don't block forever if reply never arrives.
    let timeout_ms = timeout.as_millis().min(i64::MAX as u128) as i64;
    sock.set_read_timeout(Some(Duration::from_millis(timeout_ms as u64)))
        .map_err(|e| format!("set_read_timeout: {e}"))?;

    // Build ICMP echo request. Layout: type(1) | code(1) | checksum(2) | id(2) | seq(2) | data...
    let ident = std::process::id() as u16;
    let mut seq: u16 = 0;
    let payload = [0u8; 32];
    let mut packet = Vec::with_capacity(8 + payload.len());
    packet.push(ICMP_ECHO);
    packet.push(0); // code
    packet.extend_from_slice(&[0, 0]); // checksum placeholder
    packet.extend_from_slice(&ident.to_be_bytes());
    packet.extend_from_slice(&seq.to_be_bytes());
    packet.extend_from_slice(&payload);

    let cs = checksum(&packet);
    packet[2..4].copy_from_slice(&cs.to_be_bytes());

    // Send the echo.
    let dest: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(ipv4), 0);
    sock.send_to(&packet, &dest.into())
        .map_err(|e| format!("icmp send: {e}"))?;

    // Wait for reply. Filter by identifier; some kernels include the IP header,
    // some don't — handle both.
    let started = Instant::now();
    let mut buf = [0u8; 1500];
    let (n, _src) = sock
        .recv_from(&mut buf)
        .map_err(|e| format!("icmp recv: {e}"))?;
    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;

    // Find the ICMP header. If the kernel gave us an IP header (20 bytes on
    // IPv4 with no options), skip it.
    let icmp_off = if n >= 21 && (buf[0] >> 4) == 4 {
        // IP version 4, header length in 32-bit words in low nibble.
        let ihl = (buf[0] & 0x0F) as usize * 4;
        if ihl <= n { ihl } else { 0 }
    } else {
        0
    };

    if n < icmp_off + 8 {
        return Err("icmp reply too short".to_string());
    }
    let icmp_type = buf[icmp_off];
    let reply_id = u16::from_be_bytes([buf[icmp_off + 4], buf[icmp_off + 5]]);
    if icmp_type != ICMP_ECHO_REPLY {
        return Err(format!("unexpected icmp type {icmp_type}"));
    }
    if reply_id != ident {
        return Err(format!("icmp id mismatch: {reply_id} != {ident}"));
    }
    let _ = seq; // reserved for future per-target sequencing.

    Ok(if elapsed_ms > 0.0 { elapsed_ms } else { 0.1 })
}

// ── ICMPv6 ──

const ICMPV6_ECHO: u8 = 128;
const ICMPV6_ECHO_REPLY: u8 = 129;

fn build_icmp6_socket() -> std::io::Result<Socket> {
    let sock = Socket::new(Domain::IPV6, Type::RAW, Some(Protocol::ICMPV6))?;
    let addr: SocketAddr = SocketAddr::new(std::net::IpAddr::V6(Ipv6Addr::UNSPECIFIED), 0);
    sock.bind(&addr.into())?;
    Ok(sock)
}

pub fn icmp6_echo(addr: SocketAddr, timeout: Duration) -> Result<f64, String> {
    let ipv6: Ipv6Addr = match addr {
        SocketAddr::V6(v6) => *v6.ip(),
        SocketAddr::V4(_) => return Err("icmp6_echo expects v6 address".to_string()),
    };

    let sock = build_icmp6_socket().map_err(|e| format!("icmp6 socket: {e}"))?;
    let timeout_ms = timeout.as_millis().min(i64::MAX as u128) as i64;
    sock.set_read_timeout(Some(Duration::from_millis(timeout_ms as u64)))
        .map_err(|e| format!("set_read_timeout: {e}"))?;

    let ident = std::process::id() as u16;
    let mut seq: u16 = 0;
    let payload = [0u8; 32];
    // ICMPv6 echo request: type(1) | code(1) | checksum(2) | id(2) | seq(2) | data...
    let mut packet = Vec::with_capacity(8 + payload.len());
    packet.push(ICMPV6_ECHO);
    packet.push(0); // code
    packet.extend_from_slice(&[0, 0]); // checksum (kernel fills in for ICMPv6 raw sockets)
    packet.extend_from_slice(&ident.to_be_bytes());
    packet.extend_from_slice(&seq.to_be_bytes());
    packet.extend_from_slice(&payload);

    let dest: SocketAddr = SocketAddr::new(std::net::IpAddr::V6(ipv6), 0);
    sock.send_to(&packet, &dest.into())
        .map_err(|e| format!("icmp6 send: {e}"))?;

    let started = Instant::now();
    let mut buf = [0u8; 1500];
    let (n, _src) = sock
        .recv_from(&mut buf)
        .map_err(|e| format!("icmp6 recv: {e}"))?;
    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;

    // For ICMPv6 raw socket, kernel strips IPv6 header so the response starts
    // at index 0 (no IP header). But for hop-limit exceeded messages there is
    // an IPv6 header; we ignore those (status != ECHO_REPLY).
    if n < 8 {
        return Err("icmp6 reply too short".to_string());
    }
    let icmp_type = buf[0];
    let reply_id = u16::from_be_bytes([buf[4], buf[5]]);
    if icmp_type != ICMPV6_ECHO_REPLY {
        return Err(format!("unexpected icmp6 type {icmp_type}"));
    }
    if reply_id != ident {
        return Err(format!("icmp6 id mismatch: {reply_id} != {ident}"));
    }
    let _ = seq;
    Ok(if elapsed_ms > 0.0 { elapsed_ms } else { 0.1 })
}
