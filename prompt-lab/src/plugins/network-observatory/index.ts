/**
 * Network Observatory plugin — entry point.
 *
 * V1: single-panel UI with one ICMP probe and a live result feed. Backend
 * daemon (nwd-net-probe.exe) is spawned by `setupNetProbeIPC` in main.ts.
 */
export { NetworkObservatoryPanel } from './NetworkObservatoryPanel';
