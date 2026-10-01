// Frame pacing + software-leg latency for the spike's go/no-go:
//   p95 key→photon < 25 ms  AND  p99 frame time < 10 ms at 120 Hz.
//
// Everything here is preallocated. The per-frame hooks (frameStart/frameEnd,
// noteSeen/frameSubmitted) only write numbers into typed arrays; sorting and
// percentiles happen in summary(), which the HUD calls a few times per second.
import type { PianoEvent } from '@shared/events';

// ---------------------------------------------------------------------------
// Constants and the photon model
// ---------------------------------------------------------------------------

/** ~10.7 s of frames at 120 Hz. */
export const FRAME_CAP = 1280;
/** Per-note latency samples kept (ring). */
export const NOTE_CAP = 4096;

/** Go/no-go bars. */
export const BAR_FRAME_P99_MS = 10;
export const BAR_KEY_TO_PHOTON_P95_MS = 25;
/** Minimum samples before the HUD shows a PASS/FAIL verdict. */
export const MIN_NOTES_FOR_VERDICT = 50;
export const MIN_FRAMES_FOR_VERDICT = 240;

/**
 * Estimated photon model (a model, not a measurement; the slo-mo video is the truth):
 *
 *   photon ≈ nextVsync(submitT)       the frame's GPU work makes the next vsync boundary
 *          + 1 × refresh interval     Chromium's display compositor (Viz) composes
 *                                     the page frame into the window one vsync later
 *          + PANEL_MS                 panel scanout / pixel response, ~3 ms on a
 *                                     ProMotion mini-LED panel
 *
 *   nextVsync(submitT) = frameT + max(1, ceil((submitT - frameT) / interval)) × interval
 *   where frameT (the rAF timestamp) is taken as being on the vsync grid.
 *
 *   key→photon (est) = photon - ev.t + KEYBED_USB_MS
 *
 * ev.t is the CoreMIDI driver timestamp (Web MIDI event.timeStamp), so the
 * keybed scan + USB transfer before the driver sees the message is invisible
 * to software; KEYBED_USB_MS is a conservative allowance for it.
 */
export const PANEL_MS = 3;
export const COMPOSITOR_FRAMES = 1;
export const KEYBED_USB_MS = 2;

/** Sources that are synthetic (scheduled, not played) are kept in the raw data but excluded from the gate. */
export function isSyntheticSrc(src: string): boolean {
  return src.startsWith('replay') || src.startsWith('demo') || src.startsWith('file');
}

// ---------------------------------------------------------------------------
// Percentile helpers (allocation-free; caller supplies scratch)
// ---------------------------------------------------------------------------

/** Nearest-rank-with-interpolation percentile of the first n values of an ascending-sorted array. */
export function percentileSorted(sorted: Float64Array, n: number, p: number): number {
  if (n <= 0) return NaN;
  if (n === 1) return sorted[0];
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(n - 1, lo + 1);
  const f = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * f;
}

export interface Pcts {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

function pcts(scratch: Float64Array, n: number): Pcts {
  if (n === 0) return { n: 0, p50: NaN, p95: NaN, p99: NaN, max: NaN };
  const view = scratch.subarray(0, n);
  view.sort();
  return {
    n,
    p50: percentileSorted(view, n, 50),
    p95: percentileSorted(view, n, 95),
    p99: percentileSorted(view, n, 99),
    max: view[n - 1],
  };
}

// ---------------------------------------------------------------------------
// FrameStats
// ---------------------------------------------------------------------------

export interface FrameSummary {
  /** Frames in the window (≤ FRAME_CAP). */
  frames: number;
  totalFrames: number;
  /** Estimated refresh interval (median rAF delta) and rate. */
  intervalMs: number;
  refreshHz: number;
  /** rAF-to-rAF delta: this is "frame time" for the go/no-go. */
  delta: Pcts;
  /** CPU cost of the frame callback (frameEnd - callback start). */
  cpu: Pcts;
  /** Deltas > 1.5 × interval in the window. */
  dropped: number;
  /** Sum of vsyncs missed in the window (a 3-interval gap counts 2). */
  missedVsyncs: number;
  /** Frames whose CPU cost exceeded the refresh interval. */
  longFrames: number;
  /** Gaps > GAP_MS (window hidden, debugger) skipped since reset. */
  gaps: number;
}

/** Deltas longer than this are treated as a pause (hidden window), not a dropped frame. */
const GAP_MS = 250;

export class FrameStats {
  private readonly deltas = new Float64Array(FRAME_CAP);
  private readonly costs = new Float64Array(FRAME_CAP);
  private readonly scratch = new Float64Array(FRAME_CAP);
  private head = 0; // next write index
  private count = 0;
  private total = 0;
  private gaps = 0;
  private lastRaf = 0;
  private cbStart = 0;
  private pendingDelta = -1;

  /** Called first thing in the rAF callback. `now` defaults to performance.now() (injectable for tests). */
  frameStart(rafT: number, now: number = performance.now()): void {
    this.cbStart = now;
    if (this.lastRaf > 0) {
      const d = rafT - this.lastRaf;
      if (d > GAP_MS) {
        this.gaps++;
        this.pendingDelta = -1;
      } else if (d > 0) {
        this.pendingDelta = d;
      } else {
        this.pendingDelta = -1;
      }
    }
    this.lastRaf = rafT;
  }

  /** Called last in the rAF callback. Records the delta and CPU cost as one sample. */
  frameEnd(now: number): void {
    if (this.pendingDelta < 0) return;
    const i = this.head;
    this.deltas[i] = this.pendingDelta;
    this.costs[i] = now - this.cbStart;
    this.head = (i + 1) % FRAME_CAP;
    if (this.count < FRAME_CAP) this.count++;
    this.total++;
    this.pendingDelta = -1;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.total = 0;
    this.gaps = 0;
    this.lastRaf = 0;
    this.pendingDelta = -1;
  }

  /** Median rAF delta of the window (NaN when empty). */
  intervalMs(): number {
    const n = this.count;
    if (n === 0) return NaN;
    this.scratch.set(n === FRAME_CAP ? this.deltas : this.deltas.subarray(0, n));
    const v = this.scratch.subarray(0, n);
    v.sort();
    return percentileSorted(v, n, 50);
  }

  summary(): FrameSummary {
    const n = this.count;
    const interval = this.intervalMs();
    let dropped = 0;
    let missed = 0;
    let long = 0;
    for (let i = 0; i < n; i++) {
      const d = this.deltas[i];
      if (d > 1.5 * interval) {
        dropped++;
        missed += Math.max(1, Math.round(d / interval) - 1);
      }
      if (this.costs[i] > interval) long++;
    }
    this.scratch.set(this.deltas.subarray(0, n));
    const delta = pcts(this.scratch, n);
    this.scratch.set(this.costs.subarray(0, n));
    const cpu = pcts(this.scratch, n);
    return {
      frames: n,
      totalFrames: this.total,
      intervalMs: interval,
      refreshHz: n ? 1000 / interval : NaN,
      delta,
      cpu,
      dropped,
      missedVsyncs: missed,
      longFrames: long,
      gaps: this.gaps,
    };
  }

  /** Window samples in chronological order (allocates; for save only). */
  samples(): { deltaMs: number[]; cpuMs: number[] } {
    const deltaMs: number[] = [];
    const cpuMs: number[] = [];
    const n = this.count;
    const start = n === FRAME_CAP ? this.head : 0;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % FRAME_CAP;
      deltaMs.push(round3(this.deltas[i]));
      cpuMs.push(round3(this.costs[i]));
    }
    return { deltaMs, cpuMs };
  }
}

// ---------------------------------------------------------------------------
// LatencyProbe
// ---------------------------------------------------------------------------

export interface LatencySummary {
  /** Notes counted (live sources only, current tag filter). */
  n: number;
  totalSeen: number;
  /** A: rAF timestamp of the draining frame - driver timestamp. Can be slightly negative (see notes). */
  toFrame: Pcts;
  /** B: GPU submit (end of render()) - driver timestamp. */
  toSubmit: Pcts;
  /** Driver timestamp → JS callback (ev.recvT - ev.t). */
  transport: Pcts;
  /** Model estimate, see the photon model comment at the top of this file. */
  keyToPhoton: Pcts;
}

export class LatencyProbe {
  // Per-note ring.
  private readonly t = new Float64Array(NOTE_CAP);
  private readonly recvT = new Float64Array(NOTE_CAP);
  private readonly frameT = new Float64Array(NOTE_CAP);
  private readonly submitT = new Float64Array(NOTE_CAP);
  private readonly interval = new Float64Array(NOTE_CAP);
  private readonly note = new Uint8Array(NOTE_CAP);
  private readonly vel = new Uint8Array(NOTE_CAP);
  private readonly srcId = new Uint8Array(NOTE_CAP);
  private readonly tagId = new Uint8Array(NOTE_CAP);
  private readonly scratch = new Float64Array(NOTE_CAP);
  private head = 0;
  private count = 0;
  private totalSeen = 0;
  /** Index (absolute, = totalSeen) of the first note still waiting for its frameSubmitted. */
  private pendingFrom = 0;

  // Interned strings (≤255 each).
  private readonly srcNames: string[] = [];
  private readonly srcSynthetic: boolean[] = [];
  private readonly tagNames: string[] = ['normal'];
  private curTag = 0;

  // Refresh interval estimate from consecutive frameSubmitted calls: median of last 15 deltas.
  private readonly recent = new Float64Array(15);
  private readonly recentSorted = new Float64Array(15);
  private recentN = 0;
  private recentHead = 0;
  private lastFrameT = 0;

  private readonly meta: Record<string, unknown> = {};

  /** A note-on was drained in the frame whose rAF timestamp is frameT. */
  noteSeen(ev: PianoEvent & { type: 'on' }, frameT: number): void {
    const i = this.head;
    // Fall back to arrival time when a driver stamp is missing.
    const t = ev.t > 0 ? ev.t : ev.recvT;
    this.t[i] = t;
    this.recvT[i] = ev.recvT;
    this.frameT[i] = frameT;
    this.submitT[i] = NaN;
    this.interval[i] = NaN;
    this.note[i] = ev.note & 127;
    this.vel[i] = ev.vel <= 1 ? Math.round(ev.vel * 127) : ev.vel & 127;
    this.srcId[i] = this.intern(ev.src);
    this.tagId[i] = this.curTag;
    this.head = (i + 1) % NOTE_CAP;
    if (this.count < NOTE_CAP) this.count++;
    this.totalSeen++;
  }

  /** The frame's GPU work was submitted at `submitT`. Called once per frame. */
  frameSubmitted(frameT: number, submitT: number): void {
    if (this.lastFrameT > 0) {
      const d = frameT - this.lastFrameT;
      if (d > 0 && d < GAP_MS) {
        this.recent[this.recentHead] = d;
        this.recentHead = (this.recentHead + 1) % this.recent.length;
        if (this.recentN < this.recent.length) this.recentN++;
      }
    }
    this.lastFrameT = frameT;
    if (this.pendingFrom === this.totalSeen) return;
    const iv = this.recentInterval();
    // Fill every note drained this frame (the oldest pending may have been overwritten if >NOTE_CAP).
    const first = Math.max(this.pendingFrom, this.totalSeen - this.count);
    for (let k = first; k < this.totalSeen; k++) {
      const i = k % NOTE_CAP;
      if (this.frameT[i] === frameT) {
        this.submitT[i] = submitT;
        this.interval[i] = iv;
      }
    }
    this.pendingFrom = this.totalSeen;
  }

  /** Label subsequent notes (the chrome sets this to the visual mode). */
  setTag(tag: string): void {
    let id = this.tagNames.indexOf(tag);
    if (id < 0 && this.tagNames.length < 255) {
      this.tagNames.push(tag);
      id = this.tagNames.length - 1;
    }
    this.curTag = Math.max(0, id);
  }

  currentTag(): string {
    return this.tagNames[this.curTag];
  }

  /** Extra metadata included in saved reports (e.g. backend, set by the HUD). */
  setMeta(key: string, value: unknown): void {
    this.meta[key] = value;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.totalSeen = 0;
    this.pendingFrom = 0;
  }

  /** Percentiles over live (non-synthetic) notes; pass a tag to restrict to one mode. */
  summary(tag?: string): LatencySummary {
    const tagFilter = tag === undefined ? -1 : this.tagNames.indexOf(tag);
    const sc = this.scratch;
    const n = this.count;
    const out: LatencySummary = {
      n: 0,
      totalSeen: this.totalSeen,
      toFrame: pcts(sc, 0),
      toSubmit: pcts(sc, 0),
      transport: pcts(sc, 0),
      keyToPhoton: pcts(sc, 0),
    };
    if (tag !== undefined && tagFilter < 0) return out;
    for (let pass = 0; pass < 4; pass++) {
      let m = 0;
      for (let i = 0; i < n; i++) {
        if (!this.included(i, tagFilter)) continue;
        let v: number;
        if (pass === 0) v = this.frameT[i] - this.t[i];
        else if (pass === 1) v = this.submitT[i] - this.t[i];
        else if (pass === 2) v = this.recvT[i] - this.t[i];
        else v = this.photonEst(i);
        if (Number.isFinite(v)) sc[m++] = v;
      }
      const p = pcts(sc, m);
      if (pass === 0) {
        out.toFrame = p;
        out.n = m;
      } else if (pass === 1) out.toSubmit = p;
      else if (pass === 2) out.transport = p;
      else out.keyToPhoton = p;
    }
    return out;
  }

  /** Estimated key→photon for sample i (ms), NaN if the frame never submitted. */
  private photonEst(i: number): number {
    const sub = this.submitT[i];
    const iv = this.interval[i];
    if (!Number.isFinite(sub) || !Number.isFinite(iv) || iv <= 0) return NaN;
    const ft = this.frameT[i];
    const k = Math.max(1, Math.ceil((sub - ft) / iv));
    const photon = ft + k * iv + COMPOSITOR_FRAMES * iv + PANEL_MS;
    return photon - this.t[i] + KEYBED_USB_MS;
  }

  private included(i: number, tagFilter: number): boolean {
    if (this.srcSynthetic[this.srcId[i]]) return false;
    return tagFilter < 0 || this.tagId[i] === tagFilter;
  }

  private recentInterval(): number {
    const n = this.recentN;
    if (n === 0) return NaN;
    const s = this.recentSorted;
    for (let i = 0; i < n; i++) s[i] = this.recent[i];
    // insertion sort, n ≤ 15
    for (let i = 1; i < n; i++) {
      const v = s[i];
      let j = i - 1;
      while (j >= 0 && s[j] > v) {
        s[j + 1] = s[j];
        j--;
      }
      s[j + 1] = v;
    }
    return s[n >> 1];
  }

  private intern(src: string): number {
    const names = this.srcNames;
    for (let i = 0; i < names.length; i++) if (names[i] === src) return i;
    if (names.length >= 255) return 254;
    names.push(src);
    this.srcSynthetic.push(isSyntheticSrc(src));
    return names.length - 1;
  }

  /** Per-note rows in chronological order (allocates; for save/tests only). */
  rows(): NoteRow[] {
    const rows: NoteRow[] = [];
    const n = this.count;
    const start = n === NOTE_CAP ? this.head : 0;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % NOTE_CAP;
      rows.push({
        note: this.note[i],
        vel: this.vel[i],
        src: this.srcNames[this.srcId[i]] ?? '?',
        mode: this.tagNames[this.tagId[i]],
        live: !this.srcSynthetic[this.srcId[i]],
        t: round3(this.t[i]),
        recvT: round3(this.recvT[i]),
        frameT: round3(this.frameT[i]),
        submitT: round3(this.submitT[i]),
        intervalMs: round3(this.interval[i]),
        transportMs: round3(this.recvT[i] - this.t[i]),
        toFrameMs: round3(this.frameT[i] - this.t[i]),
        toSubmitMs: round3(this.submitT[i] - this.t[i]),
        keyToPhotonEstMs: round3(this.photonEst(i)),
      });
    }
    return rows;
  }

  /** Builds the report object (exported for tests). */
  report(stats: FrameStats, meta: Record<string, unknown>): BenchReport {
    const frame = stats.summary();
    const latency = this.summary();
    const env: Record<string, unknown> = {};
    if (typeof navigator !== 'undefined') env.userAgent = navigator.userAgent;
    if (typeof window !== 'undefined') {
      env.devicePixelRatio = window.devicePixelRatio;
      env.screen = { width: window.screen?.width, height: window.screen?.height };
      env.window = { width: window.innerWidth, height: window.innerHeight };
    }
    const frameVerdict = frame.frames >= MIN_FRAMES_FOR_VERDICT ? frame.delta.p99 < BAR_FRAME_P99_MS : null;
    const latencyVerdict =
      latency.keyToPhoton.n >= MIN_NOTES_FOR_VERDICT ? latency.keyToPhoton.p95 < BAR_KEY_TO_PHOTON_P95_MS : null;
    return {
      kind: 'midi-visualizer-bench',
      version: 1,
      savedAt: new Date().toISOString(),
      meta: {
        ...env,
        refreshHzEstimate: frame.refreshHz,
        mode: this.currentTag(),
        ...this.meta,
        ...meta,
      },
      model: {
        keyToPhotonEst:
          'nextVsync(submitT) + COMPOSITOR_FRAMES*interval + PANEL_MS - ev.t + KEYBED_USB_MS; ' +
          'nextVsync = frameT + max(1, ceil((submitT-frameT)/interval))*interval',
        PANEL_MS,
        COMPOSITOR_FRAMES,
        KEYBED_USB_MS,
        note: 'Estimate only. The 240 fps video test is the real end-to-end number. Synthetic sources (replay/demo/file) are excluded from summaries.',
      },
      bars: {
        frameP99Ms: BAR_FRAME_P99_MS,
        keyToPhotonP95Ms: BAR_KEY_TO_PHOTON_P95_MS,
        framePass: frameVerdict,
        latencyPass: latencyVerdict,
      },
      summary: { frame, latency, latencyByMode: this.byMode() },
      samples: { frames: stats.samples(), notes: this.rows() },
    };
  }

  private byMode(): Record<string, LatencySummary> {
    const out: Record<string, LatencySummary> = {};
    for (const name of this.tagNames) {
      const s = this.summary(name);
      if (s.n > 0) out[name] = s;
    }
    return out;
  }

  /** Saves a JSON+CSV report via window.app.saveFile('bench', ...). Resolves to the JSON path. */
  async save(stats: FrameStats, meta: Record<string, unknown>): Promise<string | null> {
    const report = this.report(stats, meta);
    const stamp = fileStamp(new Date());
    const json = JSON.stringify(report, jsonReplacer, 1);
    const csv = toCsv(report.samples.notes);
    const app = typeof window !== 'undefined' ? window.app : undefined;
    if (app?.saveFile) {
      const path = await app.saveFile('bench', `bench-${stamp}.json`, json);
      await app.saveFile('bench', `bench-${stamp}-notes.csv`, csv);
      return path;
    }
    // Plain browser (vite dev without Electron): download instead.
    if (typeof document !== 'undefined') {
      download(`bench-${stamp}.json`, json, 'application/json');
      download(`bench-${stamp}-notes.csv`, csv, 'text/csv');
      return `bench-${stamp}.json (downloaded)`;
    }
    return null;
  }
}

export interface NoteRow {
  note: number;
  vel: number;
  src: string;
  mode: string;
  live: boolean;
  t: number;
  recvT: number;
  frameT: number;
  submitT: number;
  intervalMs: number;
  transportMs: number;
  toFrameMs: number;
  toSubmitMs: number;
  keyToPhotonEstMs: number;
}

export interface BenchReport {
  kind: 'midi-visualizer-bench';
  version: 1;
  savedAt: string;
  meta: Record<string, unknown>;
  model: Record<string, unknown>;
  bars: { frameP99Ms: number; keyToPhotonP95Ms: number; framePass: boolean | null; latencyPass: boolean | null };
  summary: { frame: FrameSummary; latency: LatencySummary; latencyByMode: Record<string, LatencySummary> };
  samples: { frames: { deltaMs: number[]; cpuMs: number[] }; notes: NoteRow[] };
}

const CSV_COLS: (keyof NoteRow)[] = [
  'note', 'vel', 'src', 'mode', 'live', 't', 'recvT', 'frameT', 'submitT', 'intervalMs',
  'transportMs', 'toFrameMs', 'toSubmitMs', 'keyToPhotonEstMs',
];

export function toCsv(rows: NoteRow[]): string {
  const lines = [CSV_COLS.join(',')];
  for (const r of rows) {
    lines.push(
      CSV_COLS.map((c) => {
        const v = r[c];
        if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
        if (typeof v === 'string') return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        return String(v);
      }).join(','),
    );
  }
  return lines.join('\n') + '\n';
}

function round3(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : NaN;
}

/** NaN/Infinity → null so the JSON stays valid and readable. */
function jsonReplacer(_k: string, v: unknown): unknown {
  return typeof v === 'number' && !Number.isFinite(v) ? null : v;
}

function fileStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function download(name: string, data: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
