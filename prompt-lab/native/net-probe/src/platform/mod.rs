//! Platform-conditional ICMP implementation.

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{icmp_echo, icmp6_echo};

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::{icmp_echo, icmp6_echo};
