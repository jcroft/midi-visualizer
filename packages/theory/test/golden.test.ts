import { describe, expect, it } from 'vitest';
import { createAnalyzer } from '../src/index';
import { play, snap, transpose, V } from './helpers';

const names = (chords: string[]) => play(chords.map(V)).steps.map((s) => s.name);

describe('golden progressions', () => {
  it('ii–V–I in C with rootless A/B voicings', () => {
    const { steps } = play(['D2 F3 A3 C4 E4', 'F3 A3 B3 E4', 'E3 G3 B3 D4'].map(V));
    expect(steps.map((s) => s.name)).toEqual(['D–9', 'G13', 'CΔ9']);
    expect(steps.map((s) => s.changed)).toEqual([true, true, true]);
    const [, v, i] = steps.map((s) => s.last!);
    expect(v.chord!.rootInferred).toBe(true);
    expect(v.roman).toBe('V⁷');
    expect(v.key).toMatchObject({ tonic: 0, mode: 'major', implied: true });
    expect(i.chord!.rootInferred).toBe(true);
    expect(i.roman).toBe('IΔ⁷');
    expect(i.key).toMatchObject({ tonic: 0, label: 'C', implied: false });
  });

  it('rootless ii–V–I keeps its qualities in many keys, spelled by key', () => {
    const base = ['D2 F3 A3 C4 E4', 'F3 A3 B3 E4', 'E3 G3 B3 D4'].map(V);
    const expected: Record<number, string[]> = {
      [-4]: ['B♭–9', 'E♭13', 'A♭Δ9'],
      [-2]: ['C–9', 'F13', 'B♭Δ9'],
      [1]: ['E♭–9', 'A♭13', 'D♭Δ9'],
      [3]: ['F–9', 'B♭13', 'E♭Δ9'],
      [4]: ['F♯–9', 'B13', 'EΔ9'],
    };
    for (let k = -4; k <= 5; k++) {
      const { steps } = play(base.map((c) => transpose(c, k)));
      expect(steps.map((s) => s.last!.chord!.quality)).toEqual(['m7', '7', 'maj7']);
      if (expected[k]) expect(steps.map((s) => s.name)).toEqual(expected[k]);
    }
  });

  it('shells (1-7-3 / 1-3-7) are unambiguous', () => {
    expect(names(['D2 C3 F3', 'G2 F3 B3', 'C3 B3 E4'])).toEqual(['D–7', 'G7', 'CΔ7']);
    expect(names(['Bb2 Ab3 Db4', 'Eb3 Db4 G4', 'Ab2 G3 C4'])).toEqual(['B♭–7', 'E♭7', 'A♭Δ7']);
  });

  it('tritone sub: D–7 D♭7 CΔ7', () => {
    const { steps } = play(['D2 C3 F3', 'Db2 B2 F3', 'C3 B3 E4'].map(V));
    expect(steps.map((s) => s.name)).toEqual(['D–7', 'D♭7', 'CΔ7']);
    expect(steps[1].last!.key).toMatchObject({ tonic: 0, implied: true });
    expect(steps[2].last!.key).toMatchObject({ tonic: 0, implied: false });
  });

  it('7alt, ø7 and a minor ii–V–i', () => {
    expect(names(['C2 E3 Bb3 Eb4 Ab4'])).toEqual(['C7alt']);
    expect(names(['B1 A2 D3 F3'])).toEqual(['Bø7']);
    const { steps } = play(['D2 C3 F3 Ab3', 'G2 F3 B3 Eb4 Ab4', 'C3 Eb3 G3 A3'].map(V));
    expect(steps.map((s) => s.name)).toEqual(['Dø7', 'G7alt', 'C–6']);
    expect(steps[2].last!.key).toMatchObject({ tonic: 0, mode: 'minor', label: 'C minor' });
  });

  it('upper-structure triads read as the altered dominant', () => {
    expect(names(['C2 E3 Bb3 D4 F#4 A4'])).toEqual(['C13(♯11)']);
    expect(names(['C2 E3 Bb3 Eb4 G4 Bb4'])).toEqual(['C7(♯9)']);
  });

  it('slash chord when the bass is not the root', () => {
    expect(names(['C2 Ab3 C4 Eb4'])).toEqual(['A♭/C']);
  });

  it('bass decides C6 vs A–7', () => {
    expect(names(['C3 E3 G3 A3'])).toEqual(['C6']);
    expect(names(['A2 C3 E3 G3'])).toEqual(['A–7']);
  });

  it('context tie-break: after D–7 in C, {B D F A} is G9 (rootless), alone it is Bø7', () => {
    const { steps } = play(['D2 F3 A3 C4', 'B3 D4 F4 A4'].map(V));
    expect(steps[1].name).toBe('G9');
    expect(steps[1].last!.chord!.rootInferred).toBe(true);
    expect(steps[1].last!.runnerUp!.name).toBe('Bø7');
    expect(names(['B3 D4 F4 A4'])).toEqual(['Bø7']);
  });

  it('lone F A C E reads literally (FΔ7) with D–9 as the ghost', () => {
    const { steps } = play([V('F3 A3 C4 E4')]);
    expect(steps[0].name).toBe('FΔ7');
    expect(steps[0].last!.runnerUp!.name).toBe('D–9');
  });

  it('quartal (So What) is named modally with low confidence; clusters are not forced', () => {
    const sw = play([V('E3 A3 D4 G4 B4')]).steps[0].last!;
    expect(sw.chord!.name).toBe('E–11');
    expect(sw.chord!.conf).toBeLessThanOrEqual(0.35);
    const cl = play([V('C4 Db4 D4 Eb4')]).steps[0].last!;
    expect(cl.chord!.quality).toBe('cluster');
    expect(cl.chord!.conf).toBeLessThan(0.3);
  });

  it('enharmonics follow the key: G♯–7 in E, D♭7 in A♭', () => {
    expect(names(['F#2 E3 A3', 'B2 A3 D#4', 'E3 D#4 G#4', 'G#2 F#3 B3 D#4'])[3]).toBe('G♯–7');
    expect(names(['Bb2 Ab3 Db4', 'Eb3 Db4 G4', 'Ab2 G3 C4', 'Db3 Cb4 F4'])[3]).toBe('D♭7');
  });

  it('predictions: at most 3, with reasons, only recomputed on chord change', () => {
    const { steps } = play(['D2 C3 F3', 'G2 F3 B3'].map(V));
    const ii = steps[0].last!;
    expect(ii.predictions.length).toBeLessThanOrEqual(3);
    expect(ii.predictions[0]).toMatchObject({ name: 'G7', why: 'ii–V pull' });
    const v = steps[1].last!;
    expect(v.predictions[0]).toMatchObject({ name: 'CΔ7', why: 'V–I' });
    expect(v.predictions.some((p) => p.why === 'tritone sub')).toBe(true);
    for (const p of v.predictions) expect(p.why.length).toBeGreaterThan(0);
  });

  it('silence clears the chord; reset clears everything', () => {
    const a = createAnalyzer();
    play([V('C3 E3 G3 B3')], { a });
    const r = a.update(snap(5000, []));
    expect(r?.chord ?? null).toBeNull();
    a.reset();
    const r2 = a.update(snap(6000, V('C3 E3 G3 B3'), V('C3 E3 G3 B3')));
    expect(r2!.chord!.name).toBe('CΔ7');
    expect(r2!.key).toBeNull();
  });
});
