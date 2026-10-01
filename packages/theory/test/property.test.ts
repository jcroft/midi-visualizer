import { describe, expect, it } from 'vitest';
import { play, transpose, V } from './helpers';

// Each voicing is played alone (no context) in all 12 transpositions; the
// quality and the root (relative to the transposition) must not change.
const VOICINGS: [string, string, number][] = [
  ['C2 E3 G3 B3 D4', 'maj7', 0],
  ['C2 Bb2 E3 A3 D4', '7', 0],
  ['C2 Eb3 G3 Bb3 D4', 'm7', 0],
  ['C2 Bb2 Eb3 Gb3', 'm7b5', 0],
  ['C2 E3 Bb3 Eb4 Ab4', '7', 0],
  ['C2 F3 Bb3 D4', '7sus4', 0],
  ['C2 E3 G3 A3 D4', '6', 0],
  ['C2 Eb3 G3 A3', 'm6', 0],
  ['C2 E3 B3', 'maj7', 0],
  ['C2 Bb2 E3', '7', 0],
];

describe('transposition invariance', () => {
  for (const [v, q, rootOffset] of VOICINGS) {
    it(`${v} → ${q}`, () => {
      for (let k = 0; k < 12; k++) {
        const { steps } = play([transpose(V(v), k)]);
        const c = steps[0].last!.chord!;
        expect(c.quality, `k=${k} ${c.name}`).toBe(q);
        expect(c.root).toBe((rootOffset + k) % 12);
      }
    });
  }

  it('rootless A-form m9 and B-form 13 (mid register) keep quality', () => {
    for (const [v, q] of [
      ['G3 Bb3 D4 F4', 'm7'],
      ['A3 D4 E4 G4', '7sus4'],
    ] as const) {
      const ref = play([V(v)]).steps[0].last!.chord!;
      expect(ref.quality).toBe(q);
      for (let k = 0; k < 12; k++) {
        const c = play([transpose(V(v), k)]).steps[0].last!.chord!;
        expect(c.quality).toBe(ref.quality);
        expect(c.rootInferred).toBe(ref.rootInferred);
        expect(c.root).toBe((ref.root + k) % 12);
      }
    }
  });
});
