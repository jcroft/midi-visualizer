// Micro progressions in the analyzer: named moves in the predictions, brackets,
// loop lock, landings, style and triad predictions.
import { describe, expect, it } from 'vitest';
import type { Analysis } from '../../../src/shared/analysis';
import { type Analyzer, createAnalyzer } from '../src/index';
import { V, play } from './helpers';

/** Play voicings; return the analysis in force after each chord and every chord-event analysis. */
function run(chords: string[], a: Analyzer = createAnalyzer()) {
  const events: Analysis[] = [];
  const update = a.update.bind(a);
  a.update = (s) => {
    const r = update(s);
    if (r?.changed) events.push(r);
    return r;
  };
  const { steps } = play(chords.map(V), { a, dur: 700 });
  return { after: steps.map((s) => s.last!), names: steps.map((s) => s.name), events, a };
}

// Axis in C as root-position triads: C G Am F, twice.
const AXIS = ['C3 E3 G3', 'G2 B2 D3', 'A2 C3 E3', 'F2 A2 C3'];
const TWO_FIVE_ONE = ['D3 F3 A3 C4 E4', 'G2 F3 B3 E4', 'C3 E3 B3 D4'];
const BLUES = ['C3 E3 G3 Bb3', 'F3 A3 C4 Eb4', 'C3 E3 G3 Bb3', 'G2 B2 D3 F3', 'F3 A3 C4 Eb4', 'C3 E3 G3 Bb3', 'G2 B2 D3 F3'];

describe('predictions name the move', () => {
  it('after a ii–V the I "completes ii–V–I"', () => {
    const { after } = run(TWO_FIVE_ONE.slice(0, 2));
    expect(after[1].predictions[0]).toMatchObject({ name: 'CΔ7', why: 'completes ii–V–I', move: { name: 'ii–V–I', step: 3, of: 3, completes: true } });
  });

  it('inside a loop the next chord carries the move and its step', () => {
    const { after } = run([...AXIS, AXIS[0]]);
    expect(after[4].predictions[0]).toMatchObject({ name: 'G', why: 'Axis 2/4', move: { id: 'pop.axis', step: 2, of: 4, loop: true } });
  });

  it('predicts triads in a triad session (F, not FΔ7)', () => {
    const { after } = run(AXIS.slice(0, 3));
    expect(after[2].predictions[0].name).toBe('F');
  });

  it('a landing names the move, its style, and a running count', () => {
    const { events } = run([...TWO_FIVE_ONE, 'A2 G3 C#4 F4', ...TWO_FIVE_ONE]);
    const landed = events.filter((e) => e.landing?.move?.id === 'jazz.ii-V-I').map((e) => e.landing!.move!);
    expect(landed[0]).toMatchObject({ name: 'ii–V–I', style: 'jazz', count: 1 });
    expect(landed.at(-1)!.count).toBe(2);
  });
});

describe('loop lock', () => {
  it('locks when the same four chords come round twice, names it, and marks the predictions ↻', () => {
    const { after, events } = run([...AXIS, ...AXIS]);
    expect(after[6].loop).toBeNull();
    expect(after[7].loop).toMatchObject({ period: 4, laps: 2, name: 'Axis', broke: false });
    expect(after[7].predictions[0]).toMatchObject({ name: 'C', loop: true });
    expect(events.at(-1)!.seq).toBe(8);
  });

  it('breaking the loop unfolds it, marking where it broke', () => {
    const { after } = run([...AXIS, ...AXIS, 'D3 F3 A3']);
    expect(after[8].loop).toMatchObject({ broke: true, period: 4 });
  });

  it('a loop nobody wrote down still locks', () => {
    const { after } = run(['C3 E3 G3 B3', 'Ab2 C3 Eb3 G3', 'Db3 F3 Ab3 C4', 'C3 E3 G3 B3', 'Ab2 C3 Eb3 G3', 'Db3 F3 Ab3 C4']);
    expect(after[5].loop).toMatchObject({ period: 3, name: null });
    expect(after[5].predictions[0]).toMatchObject({ name: 'CΔ7', loop: true, why: 'loop ↻' });
  });
});

describe('brackets on the lead sheet', () => {
  it('a backdoor after a ii–V–I gets its own bracket, not a one-lap I–♭VII vamp', () => {
    const { events } = run([...TWO_FIVE_ONE, 'F2 Eb3 Ab3 C4', 'Bb2 Ab3 D4 G4', 'C3 G3 B3 E4']);
    const ids = events.at(-1)!.moves!.map((m) => m.id);
    expect(ids).toContain('jazz.backdoor');
    expect(ids).not.toContain('rock.I-bVII');
  });

  it('a ii–V–I forms over two chords, then closes on the I', () => {
    const { events } = run(TWO_FIVE_ONE);
    const two = events[1].moves!.find((m) => m.id === 'jazz.ii-V-I')!;
    expect(two).toMatchObject({ state: 'forming', step: 2, of: 3, from: 1, to: 2, level: 0 });
    const three = events[2].moves!.find((m) => m.id === 'jazz.ii-V-I')!;
    expect(three).toMatchObject({ key: two.key, state: 'done', from: 1, to: 3 });
    expect(three.path).toEqual([2, 7, 0]);
  });

  it('a move the music walks away from is left, not marked wrong', () => {
    const { events } = run([...TWO_FIVE_ONE.slice(0, 2), 'E3 G#3 B3 D4']);
    const left = events[2].moves!.find((m) => m.id === 'jazz.ii-V-I');
    expect(left).toMatchObject({ state: 'left', to: 2 });
  });

  it('never more than two brackets cover the newest chord', () => {
    const { events } = run([...AXIS, ...AXIS]);
    for (const e of events) expect(e.moves!.filter((m) => m.to === e.seq && m.state !== 'left' && m.state !== 'done').length).toBeLessThanOrEqual(2);
  });
});

describe('style', () => {
  it('reads pop/rock from triad loops, jazz from ii–Vs, blues from dominant 7ths on I and IV', () => {
    expect(['pop', 'rock']).toContain(run([...AXIS, ...AXIS]).after[7].style!.lead);
    expect(run([...TWO_FIVE_ONE, 'A2 G3 C#4 F4', ...TWO_FIVE_ONE]).after[6].style!.lead).toBe('jazz');
    expect(run(BLUES).after[6].style!.lead).toBe('blues');
  });

  it('leaning toward a style is reported back and tips the predictions', () => {
    const { a, after } = run(AXIS.slice(0, 2));
    expect(after[1].style?.lean ?? null).toBeNull();
    a.lean('rock');
    const r = a.update({ type: 'snapshot', t: 99999, held: V(AXIS[1]), sounding: V(AXIS[1]).map((note) => ({ note, w: 1 })), onsets: [], pedal: 0, pedalRecatch: false });
    expect(r!.style!.lean).toBe('rock');
  });
});

describe('the move helps read the chord', () => {
  it('reads F7 (not C–6/F) when a blues expects the IV7', () => {
    expect(run(BLUES.slice(0, 5)).names[4]).toBe('F7');
  });
});
