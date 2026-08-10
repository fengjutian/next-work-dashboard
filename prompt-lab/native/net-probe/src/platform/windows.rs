//! Windows ICMP via IcmpSendEcho (Icmp.dll). No raw socket on Windows userspace.
//!
//! Reference: <https://learn.microsoft.com/en-us/windows/win32/api/icmpapi/nf-icmpapi-icmpsendecho>
//!
//! V1 only handles IPv4 (ICMP). IPv6 (ICMPv6) is V2.

use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::time::{Duration, Instant};

use windows::core::PCWSTR;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::NetworkManagement::IpHelper::{
    IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY, IP_OPTION_INFORMATION,
};

/// Open Icmp handle once per call. Cheap (just a CreateFile), and avoids
/// process-wide state for now. V2 may cache this.
pub fn icmp_echo(addr: SocketAddr, timeout: Duration) -> Result<f64, String> {
    // Reject IPv6 early. V1 only supports IPv4.
    let ipv4: Ipv4Addr = match addr {
        SocketAddr::V4(v4) => *v4.ip(),
        SocketAddr::V6(_) => return Err("ipv6 not supported in v1".to_string()),
    };
    let dest = SocketAddrV4::new(ipv4, 0);

    unsafe {
        let handle: HANDLE = match IcmpCreateFile() {
            Ok(h) => h,
            Err(e) => return Err(format!("IcmpCreateFile failed: {e}")),
        };
        if handle.is_invalid() {
            return Err(format!(
                "IcmpCreateFile returned invalid handle (err={})",
                std::io::Error::last_os_error()
            ));
        }

        // 32-byte payload. Anything works; matches typical `ping -l 32` default.
        let send_data = [0u8; 32];

        // Reply buffer must be large enough: ICMP_ECHO_REPLY + 8-byte ICMP header
        // + reply data. sizeof(ICMP_ECHO_REPLY) = 28 on x64; we add 32 for payload
        // + headroom for the ICMP header.
        let mut reply_buffer = vec![0u8; 64 + send_data.len()];
        let reply_size = std::mem::size_of::<ICMP_ECHO_REPLY>() as u32;

        // Timeout in ms; cast saturating since duration is bounded.
        let timeout_ms = u32::try_from(timeout.as_millis().min(u128::from(u32::MAX)))
            .unwrap_or(u32::MAX);

        let started = Instant::now();
        let result = IcmpSendEcho(
            handle,
            u32::from(ipv4),
            PCWSTR::from_raw(send_data.as_ptr() as *const u16),
            u16::try_from(send_data.len()).unwrap_or(u16::MAX),
            Some(&IP_OPTION_INFORMATION {
                Ttl: 64,
                Tos: 0,
                Flags: 0,
                OptionsSize: 0,
                OptionsData: std::ptr::null_mut(),
            }),
            Some(reply_buffer.as_mut_ptr() as *mut ICMP_ECHO_REPLY),
            reply_size,
            timeout_ms,
        );
        let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;

        // Always close handle, even on error.
        let _ = IcmpCloseHandle(handle);

        if result == 0 {
            return Err(format!(
                "IcmpSendEcho failed (err={})",
                std::io::Error::last_os_error()
            ));
        }

        // result is the number of replies. Round-trip time in ms is in reply.RoundTripTime.
        let reply: &ICMP_ECHO_REPLY = &*(reply_buffer.as_ptr() as *const ICMP_ECHO_REPLY);
        // status == 0 means SUCCESS. Non-zero is an IP status code.
        if reply.Status != 0 {
            return Err(format!("icmp status {}", reply.Status));
        }

        // Prefer OS-reported RTT (sub-ms resolution); fall back to wall clock.
        let rtt = if reply.RoundTripTime > 0 {
            f64::from(reply.RoundTripTime)
        } else if elapsed_ms > 0.0 {
            elapsed_ms
        } else {
            // Both say 0 — give a tiny epsilon so the UI doesn't render "0 ms".
            0.1
        };

        // Sanity: result==1 means one reply; anything else is unexpected on V1.
        let _ = dest; // currently unused; keep for future per-hop tracking.
        Ok(rtt)
    }
}
