import { describe, expect, it } from 'vitest';
import type { Reread } from '../../../src/shared/analysis';
import { createAnalyzer } from '../src/index';
import { V, play } from './helpers';

/** Play the chords; return the names and every hindsight reread. */
function run(chords: string[]) {
  const a = createAnalyzer();
  const rereads: Reread[] = [];
  const update = a.update.bind(a);
  a.update = (s) => {
    const r = update(s);
    if (r?.changed && r.reread) rereads.push(r.reread);
    return r;
  };
  const { steps } = play(chords.map(V), { dur: 900, a });
  return { names: steps.map((s) => s.name), rereads };
}

describe('lydian over the bass, not a slash chord', () => {
  it('a D triad over a low C is C lydian, not D7/C', () => {
    expect(run(['C2 D3 F#3 A3']).names).toEqual(['C6/9(♯11)']);
  });

  it('with the 3rd it is still C6/9(♯11), not D9/C', () => {
    expect(run(['C2 E3 F#3 A3 D4']).names).toEqual(['C6/9(♯11)']);
  });

  it('at a ii–V–I cadence in C it lands on C, not D7/C or D13/C', () => {
    expect(run(['D3 F3 A3 C4 E4', 'G2 F3 B3 E4', 'C2 D4 F#4 A4']).names).toEqual(['D–9', 'G13', 'C6/9(♯11)']);
    expect(run(['D3 F3 A3 C4 E4', 'G2 F3 B3 E4', 'C2 B3 D4 F#4 A4']).names[2]).toBe('CΔ13(♯11)');
  });

  it('keeps full lydian voicings as they were', () => {
    expect(run(['C2 B2 E3 F#3 A3 D4']).names).toEqual(['CΔ13(♯11)']);
    expect(run(['F2 E3 A3 B3 G4']).names).toEqual(['FΔ9(♯11)']);
  });

  it('rereads it as a dominant over its 7th when it moves up a fifth (D7/C → G/B)', () => {
    const { names, rereads } = run(['C2 D3 F#3 A3', 'B1 D3 G3 B3']);
    expect(names).toEqual(['C6/9(♯11)', 'G/B']);
    expect(rereads[0]).toMatchObject({ name: 'D7/C', was: 'C6/9(♯11)' });
    expect(run(['F2 G3 B3 D4', 'E2 C3 G3 C4']).rereads[0]).toMatchObject({ name: 'G7/F' });
  });

  it('does not reread the lydian tonic after a cadence', () => {
    expect(run(['G2 F3 B3 E4', 'C2 D3 F#3 A3', 'D3 F3 A3 C4 E4']).rereads).toEqual([]);
  });
});
