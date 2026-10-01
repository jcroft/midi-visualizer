// Global key (long-window Temperley/Kostka–Payne profile correlation) and
// Roman numerals. Pure, no deps.
import { isMinorish } from './chords';
import { mod12, type KeyLike } from './pitch';

// Temperley (Kostka–Payne) key profiles.
const MAJOR = [0.748, 0.06, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057, 0.4];
const MINOR = [0.712, 0.084, 0.474, 0.618, 0.049, 0.46, 0.105, 0.747, 0.404, 0.067, 0.133, 0.33];

function centered(p: number[]): { v: Float64Array; norm: number } {
  const mean = p.reduce((a, b) => a + b, 0) / 12;
  const v = new Float64Array(12);
  let n = 0;
  for (let i = 0; i < 12; i++) {
    v[i] = p[i] - mean;
    n += v[i] * v[i];
  }
  return { v, norm: Math.sqrt(n) };
}
const PMAJ = centered(MAJOR);
const PMIN = centered(MINOR);

export interface KeyEstimate extends KeyLike {
  conf: number;
}

export class GlobalKey {
  readonly hist = new Float64Array(12);
  private mass = 0;
  private cached: KeyEstimate | null = null;
  private dirty = true;
  /** Decay time constant (ms). */
  constructor(
    private readonly tau = 45000,
    private readonly poolGain = 0.15,
  ) {}

  reset(): void {
    this.hist.fill(0);
    this.mass = 0;
    this.cached = null;
    this.dirty = true;
  }

  /** Integrate the sounding pool for `dtMs` (surface evidence, low weight). */
  addPool(pool: ArrayLike<number>, dtMs: number): void {
    if (dtMs <= 0) return;
    const d = Math.exp(-dtMs / this.tau);
    const g = (dtMs / 1000) * this.poolGain;
    let m = 0;
    for (let i = 0; i < 12; i++) {
      this.hist[i] = this.hist[i] * d + pool[i] * g;
      m += this.hist[i];
    }
    this.mass = m;
    this.dirty = true;
  }

  /** Chord events weight roots and guide tones over surface notes. */
  addChord(root: number, guides: number[]): void {
    this.hist[root] += 1.0;
    for (const g of guides) this.hist[mod12(root + g)] += 0.5;
    this.mass += 1 + 0.5 * guides.length;
    this.dirty = true;
  }

  /** Weighted pitch-class mass (for the minimum-evidence gate). */
  get evidence(): number {
    return this.mass;
  }

  /**
   * Correlation of the histogram with every key profile: index tonic for
   * major, 12 + tonic for minor. Null until there is enough evidence.
   */
  correlations(out = new Float64Array(24)): Float64Array | null {
    if (this.mass < 3.5) return null;
    let mean = 0;
    for (let i = 0; i < 12; i++) mean += this.hist[i];
    mean /= 12;
    let hn = 0;
    for (let i = 0; i < 12; i++) hn += (this.hist[i] - mean) ** 2;
    hn = Math.sqrt(hn);
    if (hn < 1e-9) return null;
    for (let tonic = 0; tonic < 12; tonic++) {
      for (let m = 0; m < 2; m++) {
        const p = m === 0 ? PMAJ : PMIN;
        let r = 0;
        for (let i = 0; i < 12; i++) r += (this.hist[(tonic + i) % 12] - mean) * p.v[i];
        out[m * 12 + tonic] = r / (hn * p.norm);
      }
    }
    return out;
  }

  estimate(): KeyEstimate | null {
    if (!this.dirty) return this.cached;
    this.dirty = false;
    const c = this.correlations(this.corr);
    if (!c) return (this.cached = null);
    const { best, second, at } = top2(c);
    const sep = Math.min(1, Math.max(0.15, (best - second) * 5));
    const conf = Math.max(0, Math.min(1, best)) * sep * Math.min(1, this.mass / 6);
    return (this.cached = { tonic: at % 12, mode: at < 12 ? 'major' : 'minor', conf });
  }

  /** Replace most of this histogram with `other`'s shape (scaled to keep this mass). */
  rebase(other: GlobalKey, keep = 0.25): void {
    if (other.mass <= 0) return;
    const k = (this.mass * (1 - keep)) / other.mass;
    let m = 0;
    for (let i = 0; i < 12; i++) {
      this.hist[i] = this.hist[i] * keep + other.hist[i] * k;
      m += this.hist[i];
    }
    this.mass = m;
    this.dirty = true;
  }

  private readonly corr = new Float64Array(24);
}

function top2(c: Float64Array): { best: number; second: number; at: number } {
  let best = -2,
    second = -2,
    at = 0;
  for (let i = 0; i < 24; i++) {
    if (c[i] > best) {
      second = best;
      best = c[i];
      at = i;
    } else if (c[i] > second) second = c[i];
  }
  return { best, second, at };
}

const keyIndex = (k: KeyLike) => (k.mode === 'minor' ? 12 : 0) + k.tonic;

const SWITCH_MARGIN = 0.08; // recent window must prefer the new key over the committed one by this much
const SWITCH_HOLD_MS = 2000; // ...for this long
const SWITCH_EVENTS = 2; // ...across at least this many chord events
const SWITCH_CONF = 0.25;
const RECENT_TAU = 6000;
const RECENT_POOL_GAIN = 0.5; // surface notes count for more over a few bars

/**
 * Global key with modulation tracking. A long window (stable, slow) and a
 * recent window (a few bars) both listen. The first key comes from the long
 * window; after that the key moves only when the recent window has preferred a
 * different key by a clear margin for a couple of seconds and chord changes.
 * Then the long window is rebased so it doesn't drag the old key back in.
 */
export class KeyTracker {
  readonly long = new GlobalKey(45000);
  readonly recent = new GlobalKey(RECENT_TAU, RECENT_POOL_GAIN);
  private key: KeyEstimate | null = null;
  private pend = -1;
  private pendSince = 0;
  private pendEvents = 0;
  private lastT = 0;
  private readonly cr = new Float64Array(24);
  /** Bumped whenever the committed key moves to a different key. */
  changes = 0;

  reset(): void {
    this.long.reset();
    this.recent.reset();
    this.key = null;
    this.pend = -1;
    this.pendEvents = 0;
    this.changes = 0;
  }

  addPool(pool: ArrayLike<number>, dtMs: number, t: number): void {
    this.long.addPool(pool, dtMs);
    this.recent.addPool(pool, dtMs);
    this.lastT = t;
    this.step(false);
  }

  addChord(root: number, guides: number[], t: number): void {
    this.long.addChord(root, guides);
    this.recent.addChord(root, guides);
    this.lastT = t;
    this.step(true);
  }

  estimate(): KeyEstimate | null {
    return this.key;
  }

  private step(chordEvent: boolean): void {
    const L = this.long.estimate();
    const t = this.lastT;
    if (!this.key) {
      if (L) this.commit(L);
      return;
    }
    const cr = this.recent.correlations(this.cr);
    const R = this.recent.estimate();
    const ci = keyIndex(this.key);
    if (cr && R && keyIndex(R) !== ci && R.conf >= SWITCH_CONF && cr[keyIndex(R)] - cr[ci] >= SWITCH_MARGIN) {
      const ri = keyIndex(R);
      if (this.pend !== ri) {
        this.pend = ri;
        this.pendSince = t;
        this.pendEvents = 0;
      }
      if (chordEvent) this.pendEvents++;
      if (t - this.pendSince >= SWITCH_HOLD_MS && this.pendEvents >= SWITCH_EVENTS) {
        this.long.rebase(this.recent);
        this.commit(R);
      }
      return;
    }
    this.pend = -1;
    // the long window only refreshes confidence; moving the key always goes through the hold above
    if (L && keyIndex(L) === ci) this.key = L;
  }

  private commit(k: KeyEstimate): void {
    if (!this.key || keyIndex(k) !== keyIndex(this.key)) this.changes++;
    this.key = k;
    this.pend = -1;
  }
}

const DEGREE = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
const SUFFIX: Record<string, string> = {
  maj7: 'Δ⁷',
  '6': '⁶',
  m7: '⁷',
  m6: '⁶',
  mMaj7: 'Δ⁷',
  '7': '⁷',
  m7b5: 'ø⁷',
  dim7: '°⁷',
  '7sus4': '⁷sus',
  maj: '',
  min: '',
  aug: '+',
  dim: '°',
  sus4: 'sus',
};

/** Roman numeral of a chord relative to a key tonic (major-scale degrees, ♭ for borrowed). */
export function roman(root: number, q: string, key: KeyLike): string | null {
  if (!(q in SUFFIX)) return null;
  let r = DEGREE[mod12(root - key.tonic)];
  if (isMinorish(q)) r = r.toLowerCase();
  return r + SUFFIX[q];
}

/** Is (degree, quality) diatonic in the key? */
export function diatonic(root: number, q: string, key: KeyLike): boolean {
  const deg = mod12(root - key.tonic);
  if (key.mode === 'minor') {
    switch (deg) {
      case 0:
        return q === 'm6' || q === 'mMaj7' || q === 'min' || q === 'm7';
      case 2:
        return q === 'm7b5';
      case 3:
      case 8:
        return q === 'maj7' || q === 'maj' || q === '6';
      case 5:
        return q === 'm7' || q === 'min' || q === '7';
      case 7:
        return q === '7' || q === 'maj' || q === '7sus4';
      case 10:
        return q === '7' || q === 'maj';
      case 11:
        return q === 'dim7';
    }
    return false;
  }
  // major (dorian/mixolydian are judged against their parent major in the caller)
  switch (deg) {
    case 0:
    case 5:
      return q === 'maj7' || q === '6' || q === 'maj';
    case 2:
      return q === 'm7' || q === 'min' || q === '7sus4';
    case 4:
    case 9:
      return q === 'm7' || q === 'min';
    case 7:
      return q === '7' || q === 'maj' || q === '7sus4';
    case 11:
      return q === 'm7b5';
  }
  return false;
}
