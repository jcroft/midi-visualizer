import { describe, expect, it } from 'vitest';
import type { Analysis } from '../../../src/shared/analysis';
import { type Analyzer, createAnalyzer } from '../src/index';
import { snap, V } from './helpers';

const S = (s: string) => s.split('|').map((x) => V(x.trim()));
const rep = <T>(xs: T[], n: number): T[] => Array.from({ length: n }, () => xs).flat();

// I vi ii V in C, 1 s per chord
const HOME = S('C3 E3 G3 B3 | A2 C3 E3 G3 | D3 F3 A3 C4 | G2 F3 B3 D4');

/** Play block chords (1 s each by default); return the chord and key in force at the end of each. */
function keys(a: Analyzer, chords: number[][], t0: number, dur = 1000) {
  let t = t0;
  const out: { chord: string | undefined; key: string | undefined; t: number }[] = [];
  let last: Analysis | null = null;
  for (const n of chords) {
    for (const start = t; t < start + dur; t += 16) {
      const r = a.update(snap(t, n, t - start < 60 ? n : []));
      if (r) last = r;
    }
    out.push({ chord: last?.chord?.name, key: last?.key?.label, t });
  }
  return { out, t };
}

function settledInC() {
  const a = createAnalyzer();
  const { out, t } = keys(a, rep(HOME, 5), 1000);
  expect(out.at(-2)!.key).toBe('C');
  return { a, t };
}

describe('key tracking follows modulations', () => {
  it('a direct modulation by diatonic chords (no ii–V) lands within two passes', () => {
    const { a, t } = settledInC();
    // I iii IV vi in E
    const E = S('E3 G#3 B3 D#4 | G#2 B2 D#3 F#3 | A2 C#4 E4 G#4 | C#3 E3 G#3 B3');
    const { out } = keys(a, rep(E, 4), t);
    const first = out.findIndex((s) => s.key === 'E');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(8); // was ~17 s before the recent window
    // no detour through a third key on the way, and it stays
    for (const s of out.slice(0, first)) expect(['C', 'E', undefined]).toContain(s.key);
    for (const s of out.slice(first)) expect(s.key).toBe('E');
  });

  it('after a ii–V–I modulation the global key catches up, so the new key outlives the local window', () => {
    const { a, t } = settledInC();
    // ii–V–I into E♭ once, then 24 s of diatonic E♭ with no further cadence
    const cadence = S('F2 Ab3 C4 Eb4 | Bb2 Ab3 D4 F4 | Eb3 G3 Bb3 D4 | Eb3 G3 Bb3 D4');
    const diatonicEb = S('Eb3 G3 Bb3 D4 | Ab2 C4 Eb4 G4 | C3 Eb3 G3 Bb3 | Ab2 C4 Eb4 G4');
    let r = keys(a, cadence, t);
    expect(r.out.at(-1)!.key).toBe('E♭');
    r = keys(a, rep(diatonicEb, 6), r.t);
    for (const s of r.out.slice(-8)) expect(s.key).toBe('E♭');
  });

  it('an unresolved ii–V stops claiming its key after two unrelated chords', () => {
    const { a, t } = settledInC();
    // ii–V of E♭ that never arrives; back to C chords, with no cadence to re-set the key
    const r = keys(a, S('F2 Ab3 C4 Eb4 | Bb2 Ab3 D4 F4 | F2 A3 C4 E4 | D3 F3 A3 C4 | E3 G3 B3 D4 | F2 A3 C4 E4'), t);
    expect(r.out[1].key).toBe('E♭');
    expect(r.out.at(-3)!.key).toBe('C');
    expect(r.out.at(-1)!.key).toBe('C');
  });
});

describe('key tracking stays put when it should', () => {
  it('secondary dominants do not move the home key', () => {
    const a = createAnalyzer();
    const tune = S('C3 E3 G3 B3 | A2 G3 C#4 E4 | D3 F3 A3 C4 | G2 F3 B3 D4 | E2 D3 G#3 B3 | A2 C3 E3 G3 | D3 F#3 A3 C4 | G2 F3 B3 D4');
    const { out } = keys(a, rep(tune, 5), 1000);
    out.forEach((s, i) => {
      if (i >= 8 && i % 8 === 0) expect(s.key, `bar ${i}`).toBe('C');
    });
  });

  it('a rhythm-changes bridge (III7 VI7 II7 V7, two bars each) comes home to B♭', () => {
    const a = createAnalyzer();
    const A = S('Bb2 D3 F3 A3 | G2 Bb2 D3 F3 | C3 Eb3 G3 Bb3 | F2 Eb3 A3 C4');
    const bridge = S('D3 F#3 A3 C4 | D3 F#3 A3 C4 | G2 F3 B3 D4 | G2 F3 B3 D4 | C3 E3 G3 Bb3 | C3 E3 G3 Bb3 | F2 Eb3 A3 C4 | F2 Eb3 A3 C4');
    const { out } = keys(a, rep([...A, ...A, ...bridge, ...A], 3), 1000);
    out.forEach((s, i) => {
      if (i >= 4 && s.chord === 'B♭Δ7') expect(s.key, `chord ${i}`).toBe('B♭');
    });
  });

  it('a four-bar excursion to E♭ returns to C', () => {
    const { a, t } = settledInC();
    let r = keys(a, S('F2 Ab3 C4 Eb4 | Bb2 Ab3 D4 F4 | Eb3 G3 Bb3 D4 | Eb3 G3 Bb3 D4'), t);
    r = keys(a, rep(HOME, 2), r.t);
    expect(r.out.at(-4)!.key).toBe('C');
    expect(r.out.at(-1)!.key).toMatch(/^C/);
  });
});
