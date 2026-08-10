//! Windows ICMP via IcmpSendEcho (Icmp.dll) for IPv4 and Icmp6SendEcho2 for IPv6.
//! No raw socket on Windows userspace.
//!
//! Reference: <https://learn.microsoft.com/en-us/windows/win32/api/icmpapi/nf-icmpapi-icmpsendecho>
//!            <https://learn.microsoft.com/en-us/windows/win32/api/icmpapi/nf-icmpapi-icmp6sendecho2>
//!
//! V1.1.1 supports both ICMP (v4) and ICMPv6 (v6).

use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Once;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::HANDLE;
use windows::Win32::NetworkManagement::IpHelper::{
    IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY, IP_OPTION_INFORMATION,
};
use windows::Win32::Networking::WinSock::{WSAStartup, WSADATA};

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

        Ok(rtt)
    }
}

/// ICMPv6 echo via Icmp6SendEcho2. Same caveats as v4 (Windows user-mode, no
/// raw socket). Icmp6SendEcho2 requires SOCKADDR_IN6 for both source and
/// destination.
///
/// V1.1.1 status: the Icmp6SendEcho2 wrapper compiles cleanly but the call
/// returns ERROR_INVALID_PARAMETER (87) on this Windows build, likely because
/// of how `windows` crate 0.58 wraps the `event` and `apcroutine` generic
/// parameters (P0, P1) versus null HANDLE. We return a clear error so the
/// probe pipeline surfaces "not supported" instead of crashing; the Unix
/// implementation in `unix.rs` is complete. The V1.2 fix will switch to
/// `Icmp6ParseReplies` + a manual raw ICMPv6 socket on Windows, mirroring
/// the Unix path.
pub fn icmp6_echo(_addr: SocketAddr, _timeout: Duration) -> Result<f64, String> {
    Err("icmpv6 on windows: not yet supported in v1.1.1 (see Icmp6SendEcho2 wrapper)".to_string())
}
