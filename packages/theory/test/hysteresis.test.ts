import { describe, expect, it } from 'vitest';
import type { Analysis } from '../../../src/shared/analysis';
import { createAnalyzer } from '../src/index';
import { N, play, snap, V } from './helpers';

describe('segmentation and hysteresis', () => {
  it('a passing tone does not flip the label', () => {
    const a = createAnalyzer();
    const chord = V('C3 E3 G3 B3');
    let { t } = play([chord], { a });
    const out: Analysis[] = [];
    // RH melody: A♭5 for 90 ms, then F5 for 90 ms, over the held chord
    for (const [note, len] of [
      [N('Ab5'), 90],
      [N('F5'), 90],
      [N('Db5'), 90],
    ] as const) {
      const start = t;
      for (; t < start + len; t += 16) {
        const r = a.update(snap(t, [...chord, note], t - start < 60 ? [note] : []));
        if (r) out.push(r);
      }
    }
    for (; t < 3000; t += 16) {
      const r = a.update(snap(t, chord));
      if (r) out.push(r);
    }
    for (const r of out) {
      expect(r.chord!.name).toBe('CΔ7');
      expect(r.changed).toBe(false);
    }
  });

  it('adding an extension is a refinement (changed=false)', () => {
    const a = createAnalyzer();
    const { t } = play([V('C3 E3 G3 B3')], { a });
    const { steps } = play([V('C3 E3 G3 B3 D4')], { a, t0: t });
    expect(steps[0].name).toBe('CΔ9');
    expect(steps[0].changed).toBe(false);
  });

  it('a new chord attack (3+ onsets) commits quickly', () => {
    const a = createAnalyzer();
    const { t } = play([V('D2 C3 F3')], { a });
    const g = V('G2 F3 B3');
    let first = -1;
    for (let tt = t; tt < t + 300; tt += 16) {
      const r = a.update(snap(tt, g, tt - t < 60 ? g : []));
      if (r?.changed && first < 0) first = tt - t;
    }
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(110);
  });

  it('without a trigger, a sustained new harmony still lands after a hold', () => {
    const a = createAnalyzer();
    const { t } = play([V('C3 E3 G3 B3')], { a });
    // legato voice leading, one note at a time, no new bass: C E G B -> C E G A (C6, refinement) -> C Eb G A
    const { steps } = play([V('C3 E3 G3 A3'), V('C3 Eb3 G3 A3')], { a, t0: t, dur: 600 });
    expect(steps[1].name).toBe('C–6');
    expect(steps[1].changed).toBe(true);
  });

  it('pedal re-catch arms a change', () => {
    const a = createAnalyzer();
    let { t } = play([V('C3 E3 G3 B3')], { a });
    // F chord, notes arrive one at a time (no 3-onset group), pedal re-caught
    const f = V('F2 A3 C4 E4');
    const r = a.update(snap(t, f, [f[0]], { pedalRecatch: true, pedal: 1 }));
    t += 16;
    let name = r?.chord?.name;
    for (let i = 0; i < 8; i++, t += 16) name = a.update(snap(t, f, []))?.chord?.name ?? name;
    expect(name).toBe('FΔ7');
  });
});
