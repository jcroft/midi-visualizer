// Global key (long-window Temperley/Kostka–Payne profile correlation) and
// Roman numerals. Pure, no deps.
import { isMinorish } from './chords';
import { mod12, type KeyLike, type Mode } from './pitch';

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
  constructor(private readonly tau = 45000) {}

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
    const g = (dtMs / 1000) * 0.15;
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

  estimate(): KeyEstimate | null {
    if (!this.dirty) return this.cached;
    this.dirty = false;
    if (this.mass < 3.5) return (this.cached = null);
    let mean = 0;
    for (let i = 0; i < 12; i++) mean += this.hist[i];
    mean /= 12;
    let hn = 0;
    for (let i = 0; i < 12; i++) hn += (this.hist[i] - mean) ** 2;
    hn = Math.sqrt(hn);
    if (hn < 1e-9) return (this.cached = null);
    let best = -2,
      second = -2,
      bt = 0,
      bm: Mode = 'major';
    for (let tonic = 0; tonic < 12; tonic++) {
      for (let m = 0; m < 2; m++) {
        const p = m === 0 ? PMAJ : PMIN;
        let r = 0;
        for (let i = 0; i < 12; i++) r += (this.hist[(tonic + i) % 12] - mean) * p.v[i];
        r /= hn * p.norm;
        if (r > best) {
          second = best;
          best = r;
          bt = tonic;
          bm = m === 0 ? 'major' : 'minor';
        } else if (r > second) second = r;
      }
    }
    const sep = Math.min(1, Math.max(0.15, (best - second) * 5));
    const conf = Math.max(0, Math.min(1, best)) * sep * Math.min(1, this.mass / 6);
    return (this.cached = { tonic: bt, mode: bm, conf });
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
