import { describe, expect, it } from 'vitest';
import type { Analysis } from '../../../src/shared/analysis';
import { createAnalyzer } from '../src/index';
import { V, snap } from './helpers';

/** Hold one chord for `ms`, returning the last analysis emitted. */
function hold(a: ReturnType<typeof createAnalyzer>, notes: number[], t0: number, ms: number): { last: Analysis | null; t: number; changed: Analysis | null } {
  let last: Analysis | null = null;
  let changed: Analysis | null = null;
  let t = t0;
  for (; t < t0 + ms; t += 16) {
    const r = a.update(snap(t, notes, t - t0 < 60 ? notes : []));
    if (r) {
      last = r;
      if (r.changed) changed = r;
    }
  }
  return { last, t, changed };
}

describe('modal frame', () => {
  it('a held D–7 reads as D dorian, and the edge numerals count from D like the center', () => {
    const a = createAnalyzer();
    const { last } = hold(a, V('D3 F3 A3 C4 E4'), 1000, 5000);
    expect(last!.key).toMatchObject({ label: 'D dorian', parent: 'ii of C' });
    expect(last!.roman).toBe('i⁷');
    expect(last!.predictions[0]).toMatchObject({ name: 'G7', roman: 'IV⁷' });
    expect(last!.predictions.some((p) => /side-slip/.test(p.why))).toBe(true);
  });

  it('the vamp keeps its frame through IV7, and predicts the way back to i', () => {
    const a = createAnalyzer();
    let r = hold(a, V('D3 F3 A3 C4 E4'), 1000, 5000);
    r = hold(a, V('F3 B3 D4 E4'), r.t, 2000); // G13 rootless
    expect(r.last!.key?.label).toBe('D dorian');
    expect(r.last!.roman).toMatch(/^IV/);
    expect(r.last!.predictions[0]).toMatchObject({ root: 2, roman: 'i⁷' });
  });

  it('a long G7 resolving to CΔ7 is still V–I, but a C triad keeps the mixolydian vamp', () => {
    const a = createAnalyzer();
    let r = hold(a, V('G2 F3 B3 E4'), 1000, 5000);
    expect(r.last!.key?.label).toBe('G mixolydian');
    const b = createAnalyzer();
    let rb = hold(b, V('G2 F3 B3 E4'), 1000, 5000);
    r = hold(a, V('C3 E3 G3 B3'), r.t, 1500);
    expect(r.last!.key?.mode).not.toBe('mixolydian');
    rb = hold(b, V('C3 E3 G3 C4'), rb.t, 1500);
    expect(rb.last!.key?.label).toBe('G mixolydian');
    expect(rb.last!.roman).toMatch(/^IV/);
  });

  it('wants a tick while a held m7 may still become modal, so a still keyboard gets there', () => {
    const a = createAnalyzer();
    hold(a, V('D3 F3 A3 C4 E4'), 1000, 600);
    expect(a.wantsTick()).toBe(true);
    hold(a, V('D3 F3 A3 C4 E4'), 1600, 4000);
    expect(a.wantsTick()).toBe(false);
  });

  it('a ii–V out of the vamp breaks the modal frame', () => {
    const a = createAnalyzer();
    let r = hold(a, V('D3 F3 A3 C4 E4'), 1000, 5000);
    r = hold(a, V('Db3 F3 Ab3 C4'), r.t, 700); // B♭–9 rootless
    r = hold(a, V('Db3 G3 C4 F4'), r.t, 700); // E♭13 rootless
    expect(r.last!.key?.mode).not.toBe('dorian');
  });
});

/** Play chords back to back; returns each chord's event analysis (null if it was only a refinement). */
function events(chords: string[], dur = 700): (Analysis | null)[] {
  const a = createAnalyzer();
  let t = 1000;
  const out: (Analysis | null)[] = [];
  for (const c of chords) {
    const r = hold(a, V(c), t, dur);
    t = r.t;
    out.push(r.changed);
  }
  return out;
}

describe('hindsight relabel', () => {
  it('a diminished seventh that resolves up a half step is reread as a rootless 7♭9 (C♯°7 → D–7)', () => {
    const ev = events(['C#3 E3 G3 Bb3', 'D3 F3 A3 C4']);
    expect(ev[0]!.chord!.quality).toBe('dim7');
    expect(ev[1]!.reread).toMatchObject({ name: 'A7(♭9)', why: 'rootless 7♭9' });
  });

  it('a diminished seventh that does not resolve like a dominant is left alone', () => {
    const ev = events(['C3 Eb3 Gb3 A3', 'C3 E3 G3 B3']); // common-tone C°7 → CΔ7
    expect(ev[1]!.reread?.name ?? null).toBeNull();
  });

  it('FΔ7 voiced high going to G7 is reread as D–9, so the ii–V points at C', () => {
    const ev = events(['F3 A3 C4 E4', 'G2 F3 B3 E4']);
    expect(ev[0]!.chord!.name).toBe('FΔ7');
    expect(ev[1]!.reread).toMatchObject({ name: 'D–9', was: 'FΔ7', why: 'rootless ii', roman: 'ii⁷' });
    expect(ev[1]!.key).toMatchObject({ tonic: 0, implied: true });
    expect(ev[1]!.predictions[0].name).toBe('CΔ7');
  });

  it('FΔ7 over a low F going to G7 stays IV → V', () => {
    const ev = events(['F2 A3 C4 E4', 'G2 F3 B3 E4']);
    expect(ev[1]!.reread?.name ?? null).toBeNull();
  });

  it('at a key change, the chord before it shows its numeral in both keys (iii in C → ii in D)', () => {
    const ev = events(['C3 E3 G3 B3', 'A2 C3 E3 G3', 'D3 F3 A3 C4', 'G2 F3 B3 E4', 'C3 E3 G3 B3', 'E2 G3 B3 D4', 'A2 G3 C#4 F#4'], 900);
    expect(ev[6]!.key).toMatchObject({ tonic: 2, implied: true });
    expect(ev[6]!.reread).toMatchObject({ name: null, why: 'pivot', pivot: 'iii⁷', roman: 'ii⁷' });
  });
});

describe('tendencies', () => {
  it('G13 leaning into CΔ7: the 7 falls to the 3, while the 3 (B) and 13 (E) are already in CΔ7 and stay', async () => {
    const { analyzeVoicing, tendencies } = await import('../src/voicing');
    const r = analyzeVoicing(V('F3 B3 E4 A4'), 7, '7')!;
    const t = tendencies(r.voices, 0, 'maj7');
    expect(t).toContainEqual(expect.objectContaining({ from: 5, to: 4, d: -1, cls: 'guide' }));
    expect(t.some((x) => x.from === 11 || x.from === 4)).toBe(false);
    // against C7 instead, the B has somewhere to go
    expect(tendencies(r.voices, 0, '7').some((x) => x.from === 11)).toBe(true);
  });

  it('the tritone sub D♭7 leans the same way as G7', async () => {
    const { analyzeVoicing, tendencies } = await import('../src/voicing');
    const g = tendencies(analyzeVoicing(V('F3 B3'), 7, '7')!.voices, 0, 'maj7');
    const db = tendencies(analyzeVoicing(V('F3 B3'), 1, '7')!.voices, 0, 'maj7');
    expect(db.map((x) => [x.from, x.to])).toEqual(g.map((x) => [x.from, x.to]));
  });
});
