// CONTRACT (owned by the theory worker). Receives PianoSnapshots, posts Analysis.
/// <reference lib="webworker" />
import type { PianoSnapshot, ToWorker } from '@shared/analysis';
import { createAnalyzer } from '@theory/index';

const analyzer = createAnalyzer();
const ctx = self as unknown as DedicatedWorkerGlobalScope;

// Hysteresis needs time to pass even when the keyboard is still (no new
// snapshots). While a label change is pending, re-run the last snapshot with
// an advanced clock. Worker and main thread have different performance.now()
// origins, so we advance by local elapsed time from the last receipt.
let lastSnap: PianoSnapshot | null = null;
let lastRecv = 0;
let tick: ReturnType<typeof setTimeout> | null = null;
const TICK_MS = 50;

function run(snap: PianoSnapshot): void {
  const a = analyzer.update(snap);
  if (a) ctx.postMessage(a);
  if (tick === null && analyzer.wantsTick()) tick = setTimeout(onTick, TICK_MS);
}

function onTick(): void {
  tick = null;
  if (!lastSnap) return;
  run({ ...lastSnap, t: lastSnap.t + (performance.now() - lastRecv), pedalRecatch: false });
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'reset') {
    analyzer.reset();
    lastSnap = null;
    if (tick !== null) clearTimeout(tick);
    tick = null;
    return;
  }
  if (m.type === 'lean') {
    analyzer.lean(m.style);
    if (lastSnap) run({ ...lastSnap, t: lastSnap.t + (performance.now() - lastRecv), pedalRecatch: false });
    return;
  }
  if (m.type !== 'snapshot') return;
  lastSnap = m;
  lastRecv = performance.now();
  run(m);
};
