//! Windows ICMP via IcmpSendEcho (Icmp.dll) for IPv4 and Icmp6SendEcho2 for IPv6.
//! No raw socket on Windows userspace.
//!
//! Reference: <https://learn.microsoft.com/en-us/windows/win32/api/icmpapi/nf-icmpapi-icmpsendecho>
//!            <https://learn.microsoft.com/en-us/windows/win32/api/icmpapi/nf-icmpapi-icmp6sendecho2>
//!
//! V1.1.1 supports both ICMP (v4) and ICMPv6 (v6).

use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, SocketAddrV4, SocketAddrV6};
use std::sync::Once;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::HANDLE;
use windows::Win32::NetworkManagement::IpHelper::{
    Icmp6SendEcho2, IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY,
    IP_OPTION_INFORMATION,
};
use windows::Win32::Networking::WinSock::{WSAStartup, WSADATA, SOCKADDR_IN6};

static WSA_INIT: Once = Once::new();

/// Winsock 2.2 must be initialised before any Winsock call. `IcmpSendEcho`
/// runs over Winsock under the hood; without WSAStartup, IcmpCreateFile
/// returns an invalid handle and the first IcmpSendEcho fails with
/// WSAEPROVIDERFAILEDINIT (10093) / 11050 in some builds.
fn ensure_winsock() {
    WSA_INIT.call_once(|| unsafe {
        let mut data: WSADATA = std::mem::zeroed();
        // MAKEWORD(2, 2)
        let _ = WSAStartup(0x0202, &mut data);
    });
}

/// Open Icmp handle once per call. Cheap (just a CreateFile), and avoids
/// process-wide state for now. V2 may cache this.
pub fn icmp_echo(addr: SocketAddr, timeout: Duration) -> Result<f64, String> {
    ensure_winsock();
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
        let send_data: [u8; 32] = [0u8; 32];

        // Reply buffer must be large enough: ICMP_ECHO_REPLY + RequestSize.
        // Per MSDN, ReplySize = sizeof(ICMP_ECHO_REPLY) + RequestSize.
        // The buffer itself needs ICMP_ECHO_REPLY (28 on x64) + payload + headroom.
        let mut reply_buffer: Vec<u8> =
            vec![0u8; std::mem::size_of::<ICMP_ECHO_REPLY>() + send_data.len() + 32];
        let reply_size: u32 = (std::mem::size_of::<ICMP_ECHO_REPLY>() + send_data.len()) as u32;

        // Timeout in ms; cast saturating since duration is bounded.
        let timeout_ms: u32 = u32::try_from(timeout.as_millis().min(u128::from(u32::MAX)))
            .unwrap_or(u32::MAX);

        let options: IP_OPTION_INFORMATION = IP_OPTION_INFORMATION {
            Ttl: 64,
            Tos: 0,
            Flags: 0,
            OptionsSize: 0,
            OptionsData: std::ptr::null_mut(),
        };

        let started = Instant::now();
        let result: u32 = IcmpSendEcho(
            handle,
            u32::from(ipv4),
            send_data.as_ptr() as *const std::ffi::c_void,
            u16::try_from(send_data.len()).unwrap_or(u16::MAX),
            Some(&options as *const IP_OPTION_INFORMATION),
            reply_buffer.as_mut_ptr() as *mut std::ffi::c_void,
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

/// ICMPv6 echo via Icmp6SendEcho2. Same caveats as v4 (Windows user-mode, no
/// raw socket). Icmp6SendEcho2 requires SOCKADDR_IN6 for both source and
/// destination; we pass zero for source (Windows picks a sensible one) and the
/// target for destination.
pub fn icmp6_echo(addr: SocketAddr, timeout: Duration) -> Result<f64, String> {
    ensure_winsock();

    let ipv6: Ipv6Addr = match addr {
        SocketAddr::V6(v6) => *v6.ip(),
        SocketAddr::V4(_) => return Err("icmp6_echo expects v6 address".to_string()),
    };
    let dest_port: u16 = match addr {
        SocketAddr::V6(v6) => v6.port(),
        SocketAddr::V4(v4) => v4.port(),
    };

    unsafe {
        let handle: HANDLE = match IcmpCreateFile() {
            Ok(h) => h,
            Err(e) => return Err(format!("Icmp6CreateFile failed: {e}")),
        };
        if handle.is_invalid() {
            return Err(format!(
                "Icmp6CreateFile returned invalid handle (err={})",
                std::io::Error::last_os_error()
            ));
        }

        let send_data: [u8; 32] = [0u8; 32];

        // Reply buffer: ICMPV6_ECHO_REPLY is the v6 counterpart of ICMP_ECHO_REPLY.
        // Windows doesn't expose a public sizeof for it, so we use a generous
        // 200-byte buffer (well over the actual struct size on x64).
        let mut reply_buffer: Vec<u8> = vec![0u8; 200 + send_data.len()];
        let reply_size: u32 = (200 + send_data.len()) as u32;

        let timeout_ms: u32 = u32::try_from(timeout.as_millis().min(u128::from(u32::MAX)))
            .unwrap_or(u32::MAX);

        // Build destination SOCKADDR_IN6. family = AF_INET6 (23 on Windows,
        // 10 on Linux; windows crate uses 23 directly via SOCKADDR_IN6::default).
        let mut dest_addr: SOCKADDR_IN6 = std::mem::zeroed();
        dest_addr.sin6_family = windows::Win32::Networking::WinSock::ADDRESS_FAMILY(23); // AF_INET6
        dest_addr.sin6_port = dest_port;
        dest_addr.sin6_addr = ipv6.into();
        // sin6_scope_id stays 0 (link-local handled by resolver returning global IPv6)

        let options: IP_OPTION_INFORMATION = IP_OPTION_INFORMATION {
            Ttl: 64,
            Tos: 0,
            Flags: 0,
            OptionsSize: 0,
            OptionsData: std::ptr::null_mut(),
        };

        let started = Instant::now();
        // Icmp6SendEcho2 expects SOCKADDR_IN6 for both source and destination.
        // Pass null for source (Windows picks one). The reply buffer holds an
        // ICMPV6_ECHO_REPLY struct.
        let result: u32 = Icmp6SendEcho2(
            handle,
            HANDLE(std::ptr::null_mut()), // event
            None,                         // apcroutine
            None,                         // apccontext
            std::ptr::null(),             // sourceaddress (Windows picks)
            &dest_addr as *const SOCKADDR_IN6,
            send_data.as_ptr() as *const std::ffi::c_void,
            u16::try_from(send_data.len()).unwrap_or(u16::MAX),
            Some(&options as *const IP_OPTION_INFORMATION),
            reply_buffer.as_mut_ptr() as *mut std::ffi::c_void,
            reply_size,
            timeout_ms,
        );
        let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;

        let _ = IcmpCloseHandle(handle);

        if result == 0 {
            return Err(format!(
                "Icmp6SendEcho2 failed (err={})",
                std::io::Error::last_os_error()
            ));
        }

        // Read the reply. RTT in the ICMPV6_ECHO_REPLY is a ULONG at the
        // usual offset after Address (ULONG), Status (ULONG), and any padding.
        // On x64 Windows ICMPV6_ECHO_REPLY layout: { ULONG Address; ULONG
        // Status; ULONG RoundTripTime; ... }. Reading through a manual
        // accessor to avoid relying on the crate's struct layout.
        let reply_u32_ptr = reply_buffer.as_ptr() as *const u32;
        let status = u32::from_le(reply_u32_ptr.add(1).read_unaligned());
        let rtt_u32 = u32::from_le(reply_u32_ptr.add(2).read_unaligned());
        if status != 0 {
            return Err(format!("icmpv6 status {}", status));
        }

        let rtt = if rtt_u32 > 0 {
            f64::from(rtt_u32)
        } else if elapsed_ms > 0.0 {
            elapsed_ms
        } else {
            0.1
        };
        Ok(rtt)
    }
}
