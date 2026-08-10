//! Daemon event loop. Owns the set of active targets, dispatches probes, and
//! emits JSONL events on stdout.
//!
//! V1.1: per-target probe type, per-target options (port for tcp, resolvers
//! for dns, url for http). Each target runs on its own thread; probes are
//! sequential within a thread.

use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::probe::{probe_for, Probe, ProbeSample};
use crate::protocol::{Inbound, Outbound};

/// Per-target configuration + runtime.
#[derive(Clone)]
struct Target {
    id: String,
    target: String,
    interval: Duration,
    timeout: Duration,
    probe_kind: String,
    options: Value,
}

type TargetMap = Arc<Mutex<HashMap<String, Target>>>;

pub fn run() -> io::Result<()> {
    let targets: TargetMap = Arc::new(Mutex::new(HashMap::new()));
    let (emit_tx, emit_rx) = channel::<Outbound>();

    spawn_emit_thread(emit_rx);

    let _ = emit_tx.send(Outbound::Ready {
        version: env!("CARGO_PKG_VERSION").to_string(),
        pid: std::process::id(),
    });

    spawn_stdin_thread(targets.clone(), emit_tx.clone());

    let mut workers: HashMap<String, thread::JoinHandle<()>> = HashMap::new();
    let mut last_seen: HashMap<String, Target> = HashMap::new();

    loop {
        thread::sleep(Duration::from_millis(200));

        let snapshot: Vec<Target> = {
            let map = targets.lock().expect("targets poisoned");
            map.values().cloned().collect()
        };

        for t in &snapshot {
            if !last_seen.contains_key(&t.id) {
                workers.insert(t.id.clone(), spawn_worker(t.clone(), emit_tx.clone()));
            }
        }

        for t in &snapshot {
            if let Some(prev) = last_seen.get(&t.id) {
                let changed = prev.target != t.target
                    || prev.interval != t.interval
                    || prev.timeout != t.timeout
                    || prev.probe_kind != t.probe_kind
                    || prev.options != t.options;
                if changed {
                    if let Some(h) = workers.remove(&t.id) {
                        drop(h);
                    }
                    workers.insert(t.id.clone(), spawn_worker(t.clone(), emit_tx.clone()));
                }
            }
        }

        let live_ids: std::collections::HashSet<String> =
            snapshot.iter().map(|t| t.id.clone()).collect();
        let dead: Vec<String> = last_seen
            .keys()
            .filter(|id| !live_ids.contains(*id))
            .cloned()
            .collect();
        for id in dead {
            if let Some(h) = workers.remove(&id) {
                drop(h);
            }
        }

        last_seen = snapshot.into_iter().map(|t| (t.id.clone(), t)).collect();
    }
}

fn spawn_emit_thread(rx: Receiver<Outbound>) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let stdout = io::stdout();
        let mut out = stdout.lock();
        while let Ok(msg) = rx.recv() {
            let line = msg.to_jsonl();
            if out.write_all(line.as_bytes()).is_err() {
                break;
            }
            let _ = out.flush();
        }
    })
}

fn spawn_stdin_thread(targets: TargetMap, emit: Sender<Outbound>) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let stdin = io::stdin();
        let mut locked = stdin.lock();
        let mut buf = String::new();
        loop {
            buf.clear();
            let n = match locked.read_line(&mut buf) {
                Ok(n) => n,
                Err(_) => return,
            };
            if n == 0 {
                return;
            }
            let trimmed = buf.trim();
            if trimmed.is_empty() {
                continue;
            }
            let msg: Inbound = match serde_json::from_str(trimmed) {
                Ok(m) => m,
                Err(e) => {
                    let _ = emit.send(Outbound::Error {
                        message: format!("parse: {e}"),
                    });
                    continue;
                }
            };
            match msg {
                Inbound::AddTarget {
                    id,
                    target,
                    probe,
                    interval_ms,
                    timeout_ms,
                    options,
                } => {
                    let interval = Duration::from_millis(interval_ms.max(100));
                    let timeout = Duration::from_millis(
                        timeout_ms.unwrap_or_else(|| interval.as_millis().min(3000) as u64),
                    );
                    let t = Target {
                        id: id.clone(),
                        target,
                        interval,
                        timeout,
                        probe_kind: probe,
                        options: options.unwrap_or(Value::Null),
                    };
                    targets.lock().expect("targets poisoned").insert(id, t);
                }
                Inbound::RemoveTarget { id } => {
                    targets.lock().expect("targets poisoned").remove(&id);
                }
                Inbound::Shutdown => {
                    std::process::exit(0);
                }
            }
        }
    })
}

fn spawn_worker(target: Target, emit: Sender<Outbound>) -> thread::JoinHandle<()> {
    let probe_kind = target.probe_kind.clone();
    let id = target.id.clone();
    let target_str = target.target.clone();
    let interval = target.interval;
    let timeout = target.timeout;
    let options = target.options.clone();

    thread::spawn(move || {
        let probe: Box<dyn Probe> = match probe_for(&probe_kind) {
            Some(p) => p,
            None => {
                let _ = emit.send(Outbound::Error {
                    message: format!("unknown probe type: {probe_kind}"),
                });
                return;
            }
        };

        let mut next = Instant::now();
        loop {
            let sample: ProbeSample = probe.run(&target_str, &options, timeout);
            let _ = emit.send(Outbound::ProbeResult {
                id: id.clone(),
                probe: probe_kind.clone(),
                timestamp_ms: now_ms(),
                success: sample.success,
                latency_ms: sample.latency_ms,
                error: sample.error,
                payload: sample.payload,
            });
            next += interval;
            let now = Instant::now();
            if next > now {
                thread::sleep(next - now);
            } else {
                next = now + interval;
            }
        }
    })
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
