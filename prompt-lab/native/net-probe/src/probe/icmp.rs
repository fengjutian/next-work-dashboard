//! ICMP probe. Cross-platform: IcmpSendEcho on Windows, raw socket on Unix.

use std::time::Duration;

use serde_json::Value;

use super::{platform_icmp, resolve, Probe, ProbeSample};

pub struct IcmpProbe;

impl IcmpProbe {
    pub fn new() -> Self {
        Self
    }
}

impl Probe for IcmpProbe {
    fn name(&self) -> &'static str {
        "icmp"
    }

    fn run(&self, target: &str, _options: &Value, timeout: Duration) -> ProbeSample {
        let addrs = match resolve(target) {
            Ok(v) => v,
            Err(e) => {
                return ProbeSample {
                    success: false,
                    latency_ms: None,
                    error: Some(format!("dns: {e}")),
                    payload: None,
                };
            }
        };

        let mut last_err: Option<String> = None;
        for addr in &addrs {
            match platform_icmp(*addr, timeout) {
                Ok(latency) => {
                    return ProbeSample {
                        success: true,
                        latency_ms: Some(latency),
                        error: None,
                        payload: None,
                    };
                }
                Err(e) => {
                    last_err = Some(e);
                }
            }
        }
        ProbeSample {
            success: false,
            latency_ms: None,
            error: last_err.or_else(|| Some("no address".to_string())),
            payload: None,
        }
    }
}
