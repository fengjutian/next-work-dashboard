//! Daemon event loop. Owns the set of active targets, dispatches probes, and
//! emits JSONL events on stdout.
//!
//! V1.1.2: per-worker cancel flag + cooperative shutdown. When a target is
//! reconfigured or removed (or on Shutdown), the old worker is signalled and
//! joined (bounded wait) before the new state is installed. A worker whose
//! probe panics is caught and reported as an Error event instead of silently
//! dying.

use std::collections::{HashMap, HashSet};
use std::io::{self, BufRead, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
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

/// Bounds how long `stop_worker` will wait for an in-flight probe to drain.
/// Anything longer is leaked; the worker thread is bounded by the probe's own
/// `timeout` and will exit on its own.
const STOP_GRACE: Duration = Duration::from_secs(5);

struct WorkerHandle {
    handle: thread::JoinHandle<()>,
    cancel: Arc<AtomicBool>,
}

pub fn run() -> io::Result<()> {
    let targets: TargetMap = Arc::new(Mutex::new(HashMap::new()));
    let (emit_tx, emit_rx) = channel::<Outbound>();
    let (shutdown_tx, shutdown_rx) = channel::<()>();

    spawn_emit_thread(emit_rx);

    let _ = emit_tx.send(Outbound::Ready {
        version: env!("CARGO_PKG_VERSION").to_string(),
        pid: std::process::id(),
    });

    spawn_stdin_thread(targets.clone(), emit_tx.clone(), shutdown_tx);

    let mut workers: HashMap<String, WorkerHandle> = HashMap::new();
    let mut last_seen: HashMap<String, Target> = HashMap::new();

    loop {
        match shutdown_rx.recv_timeout(Duration::from_millis(200)) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }

        let snapshot: Vec<Target> = {
            let map = targets.lock().expect("targets poisoned");
            map.values().cloned().collect()
        };

        for t in &snapshot {
            if !last_seen.contains_key(&t.id) {
                let h = spawn_worker(t.clone(), emit_tx.clone());
                workers.insert(t.id.clone(), h);
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
                    if let Some(old) = workers.remove(&t.id) {
                        stop_worker(old);
                    }
                    let h = spawn_worker(t.clone(), emit_tx.clone());
                    workers.insert(t.id.clone(), h);
                }
            }
        }

        let live_ids: HashSet<String> = snapshot.iter().map(|t| t.id.clone()).collect();
        let dead: Vec<String> = last_seen
            .keys()
            .filter(|id| !live_ids.contains(*id))
            .cloned()
            .collect();
        for id in dead {
            if let Some(old) = workers.remove(&id) {
                stop_worker(old);
            }
        }

        last_seen = snapshot.into_iter().map(|t| (t.id.clone(), t)).collect();
    }

    // Shutdown: stop all workers, then drop emit_tx so the emit thread exits.
    for (_, w) in workers.drain() {
        stop_worker(w);
    }
    drop(emit_tx);
    Ok(())
}

fn stop_worker(w: WorkerHandle) {
    w.cancel.store(true, Ordering::Relaxed);
    // Bounded join: spawn a thread to call join() and notify us; we move on
    // after STOP_GRACE even if the probe is still running. The probe itself
    // is bounded by its `timeout`, so the thread will exit on its own.
    let (done_tx, done_rx) = channel::<()>();
    thread::spawn(move || {
        let _ = w.handle.join();
        let _ = done_tx.send(());
    });
    let _ = done_rx.recv_timeout(STOP_GRACE);
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

fn spawn_stdin_thread(
    targets: TargetMap,
    emit: Sender<Outbound>,
    shutdown: Sender<()>,
) -> thread::JoinHandle<()> {
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
                    let _ = shutdown.send(());
                    return;
                }
            }
        }
        // On EOF / read error, the `shutdown` Sender drops; the main loop's
        // recv_timeout returns Disconnected and we shut down cleanly.
    })
}

fn spawn_worker(target: Target, emit: Sender<Outbound>) -> WorkerHandle {
    let probe_kind = target.probe_kind.clone();
    let id = target.id.clone();
    let target_str = target.target.clone();
    let interval = target.interval;
    let timeout = target.timeout;
    let options = target.options.clone();

    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_for_thread = cancel.clone();

    let handle = thread::spawn(move || {
        let probe: Box<dyn Probe> = match probe_for(&probe_kind) {
            Some(p) => p,
            None => {
                let _ = emit.send(Outbound::Error {
                    message: format!("unknown probe type: {probe_kind}"),
                });
                return;
            }
        };

        // Keep clones of (emit, id, probe_kind) for the panic-recovery path —
        // the closure below moves them, and the borrow checker would otherwise
        // refuse to let us touch them after catch_unwind returns.
        let emit_for_err = emit.clone();
        let id_for_err = id.clone();
        let probe_kind_for_err = probe_kind.clone();

        // catch_unwind so a panicking probe doesn't silently kill the target's
        // monitoring. The probe trait doesn't bound on UnwindSafe, so wrap the
        // closure in AssertUnwindSafe.
        let result = catch_unwind(AssertUnwindSafe(move || {
            let mut next = Instant::now();
            loop {
                if cancel_for_thread.load(Ordering::Relaxed) {
                    return;
                }
                let sample: ProbeSample = probe.run(&target_str, &options, timeout);
                if cancel_for_thread.load(Ordering::Relaxed) {
                    return;
                }
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
        }));

        if let Err(panic) = result {
            let msg = panic_message(&panic);
            let _ = emit_for_err.send(Outbound::Error {
                message: format!("worker {id_for_err} ({probe_kind_for_err}) panicked: {msg}"),
            });
        }
    });

    WorkerHandle { handle, cancel }
}

fn panic_message(panic: &Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = panic.downcast_ref::<&'static str>() {
        s.to_string()
    } else if let Some(s) = panic.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic".to_string()
    }
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
