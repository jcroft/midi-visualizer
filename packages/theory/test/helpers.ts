import type { Analysis, PianoSnapshot } from '../../../src/shared/analysis';
import { type Analyzer, createAnalyzer } from '../src/index';

export const N = (name: string): number => {
  const m = /^([A-G])([b#]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(name);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C'];
  return 12 * (Number(m[3]) + 1) + base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};
export const V = (s: string): number[] => s.split(/\s+/).filter(Boolean).map(N);

export function snap(t: number, held: number[], onsets: number[] = [], extra: Partial<PianoSnapshot> = {}): PianoSnapshot {
  return {
    type: 'snapshot',
    t,
    held,
    sounding: held.map((note) => ({ note, w: 1 })),
    onsets,
    pedal: 0,
    pedalRecatch: false,
    ...extra,
  };
}

export interface Step {
  name: string | undefined;
  changed: boolean;
  last: Analysis | null;
}

/**
 * Play block chords, each `dur` ms, snapshots every 16 ms (as the renderer
 * would), onsets listed for the first 60 ms. Returns the label in force at the
 * end of each chord and whether a chord event fired during it.
 */
export function play(chords: number[][], opts: { dur?: number; a?: Analyzer; t0?: number } = {}): { steps: Step[]; a: Analyzer; t: number } {
  const a = opts.a ?? createAnalyzer();
  const dur = opts.dur ?? 600;
  let t = opts.t0 ?? 1000;
  let last: Analysis | null = null;
  const steps: Step[] = [];
  for (const notes of chords) {
    const start = t;
    let changed = false;
    for (; t < start + dur; t += 16) {
      const r = a.update(snap(t, notes, t - start < 60 ? notes : []));
      if (r) {
        last = r;
        if (r.changed) changed = true;
      }
    }
    steps.push({ name: last?.chord?.name, changed, last });
  }
  return { steps, a, t };
}

export const transpose = (notes: number[], k: number) => notes.map((n) => n + k);
