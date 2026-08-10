//! Daemon event loop. Owns the set of active targets, dispatches probes, and
//! emits JSONL events on stdout.
//!
//! Design (V1):
//! - One thread per target. Probes run sequentially within a thread.
//! - Probe results are pushed to a single emit channel; the main thread reads
//!   and writes them to stdout (so stdout writes are serialised and atomic per line).
//! - stdin is read on a dedicated thread; inbound messages mutate a shared target table.

use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::probe::{probe_for, Probe, ProbeSample};
use crate::protocol::{Inbound, Outbound};

/// Per-target configuration + runtime.
struct Target {
    id: String,
    target: String,
    interval: Duration,
    timeout: Duration,
    probe_kind: String,
}

/// Snapshot used by probe threads. Recreated when the config changes.
type TargetMap = Arc<Mutex<HashMap<String, Target>>>;

pub fn run() -> io::Result<()> {
    let targets: TargetMap = Arc::new(Mutex::new(HashMap::new()));
    let (emit_tx, emit_rx) = channel::<Outbound>();
    let next_seq = Arc::new(AtomicU64::new(0));

    // Spawn emit loop (stdout writer).
    spawn_emit_thread(emit_rx);

    // Emit `ready` immediately so Node can confirm the daemon is up.
    let _ = emit_tx.send(Outbound::Ready {
        version: env!("CARGO_PKG_VERSION").to_string(),
        pid: std::process::id(),
    });

    // Spawn stdin reader.
    spawn_stdin_thread(targets.clone(), emit_tx.clone(), next_seq.clone());

    // Idle on main thread. When a target is added, spawn a worker thread for it.
    // When the daemon receives `shutdown`, exit.
    let mut workers: HashMap<String, thread::JoinHandle<()>> = HashMap::new();

    // Watchdog: poll for new/changed/removed targets every 200ms.
    let mut last_seen: HashMap<String, Target> = HashMap::new();
    loop {
        thread::sleep(Duration::from_millis(200));

        let snapshot: Vec<Target> = {
            let map = targets.lock().expect("targets poisoned");
            map.values().cloned().collect()
        };

        // Spawn workers for new targets.
        for t in &snapshot {
            if !last_seen.contains_key(&t.id) {
                let handle = spawn_worker(
                    t.clone(),
                    emit_tx.clone(),
                    next_seq.clone(),
                );
                workers.insert(t.id.clone(), handle);
            }
        }

        // Restart workers whose config changed (interval/timeout/probe/target).
        for t in &snapshot {
            if let Some(prev) = last_seen.get(&t.id) {
                let changed = prev.target != t.target
                    || prev.interval != t.interval
                    || prev.timeout != t.timeout
                    || prev.probe_kind != t.probe_kind;
                if changed {
                    if let Some(handle) = workers.remove(&t.id) {
                        // Best-effort: detach the old thread. We can't reliably
                        // interrupt a blocking ICMP syscall, but the new thread
                        // will take over with the updated config.
                        drop(handle);
                    }
                    let handle = spawn_worker(
                        t.clone(),
                        emit_tx.clone(),
                        next_seq.clone(),
                    );
                    workers.insert(t.id.clone(), handle);
                }
            }
        }

        // Drop workers for removed targets.
        let live_ids: std::collections::HashSet<String> =
            snapshot.iter().map(|t| t.id.clone()).collect();
        let dead: Vec<String> = last_seen
            .keys()
            .filter(|id| !live_ids.contains(*id))
            .cloned()
            .collect();
        for id in dead {
            if let Some(handle) = workers.remove(&id) {
                drop(handle);
            }
        }

        // Update last_seen from the current snapshot.
        last_seen = snapshot.into_iter().map(|t| (t.id.clone(), t)).collect();

        // Check for shutdown signal: if the target map has been cleared and
        // the stdin thread exited, we're done. For V1 we just rely on the
        // process being killed; explicit `shutdown` is handled by stdin
        // thread sending a sentinel.
    }
}

fn spawn_emit_thread(rx: Receiver<Outbound>) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let stdout = io::stdout();
        let mut out = stdout.lock();
        while let Ok(msg) = rx.recv() {
            let line = msg.to_jsonl();
            if out.write_all(line.as_bytes()).is_err() {
                // stdout closed (Node disconnected) — exit cleanly.
                break;
            }
            let _ = out.flush();
        }
    })
}

fn spawn_stdin_thread(
    targets: TargetMap,
    emit: Sender<Outbound>,
    next_seq: Arc<AtomicU64>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let stdin = io::stdin();
        let mut locked = stdin.lock();
        let mut buf = String::new();
        loop {
            buf.clear();
            let n = match locked.read_line(&mut buf) {
                Ok(n) => n,
                Err(_) => return, // stdin closed
            };
            if n == 0 {
                return; // EOF
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
                    };
                    targets.lock().expect("targets poisoned").insert(id.clone(), t);
                    next_seq.fetch_add(1, Ordering::Relaxed);
                }
                Inbound::RemoveTarget { id } => {
                    targets.lock().expect("targets poisoned").remove(&id);
                }
                Inbound::Shutdown => {
                    // Cleanest shutdown: drop target map and exit. Main thread
                    // will see the empty map on its next tick, but we exit
                    // the whole process to keep V1 simple.
                    std::process::exit(0);
                }
            }
        }
    })
}

fn spawn_worker(
    target: Target,
    emit: Sender<Outbound>,
    _next_seq: Arc<AtomicU64>,
) -> thread::JoinHandle<()> {
    let probe_kind = target.probe_kind.clone();
    let id = target.id.clone();
    let target_str = target.target.clone();
    let interval = target.interval;
    let timeout = target.timeout;

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

        // Schedule probes at fixed intervals using a wall-clock deadline.
        let mut next = Instant::now();
        loop {
            let sample: ProbeSample = probe.run(&target_str, timeout);
            let timestamp_ms = now_ms();
            let _ = emit.send(Outbound::ProbeResult {
                id: id.clone(),
                probe: probe_kind.clone(),
                timestamp_ms,
                success: sample.success,
                latency_ms: sample.latency_ms,
                error: sample.error,
            });
            next += interval;
            let now = Instant::now();
            if next > now {
                thread::sleep(next - now);
            } else {
                // Fell behind — reset deadline to avoid burst.
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

// We use `Clone` on Target to pass snapshots around. Implement manually.
impl Clone for Target {
    fn clone(&self) -> Self {
        Self {
            id: self.id.clone(),
            target: self.target.clone(),
            interval: self.interval,
            timeout: self.timeout,
            probe_kind: self.probe_kind.clone(),
        }
    }
}
