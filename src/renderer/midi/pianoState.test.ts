import { describe, expect, it } from 'vitest';
import type { PianoEvent } from '@shared/events';
import { PianoState, TAU_DAMPED } from './pianoState';

const on = (note: number, t: number, vel = 0.8, src = 'a'): PianoEvent => ({ type: 'on', note, vel, t, recvT: t, src });
const off = (note: number, t: number, src = 'a'): PianoEvent => ({ type: 'off', note, vel: 0, t, recvT: t, src });
const cc = (c: number, raw: number, t: number): PianoEvent => ({ type: 'cc', cc: c, value: raw / 127, t, recvT: t, src: 'a' });
const panic = (t: number): PianoEvent => ({ type: 'panic', t, recvT: t, src: 'a' });

const notesOf = (s: { sounding: { note: number }[] }) => s.sounding.map((x) => x.note);

describe('PianoState', () => {
  it('ref-counts duplicate note-ons per pitch', () => {
    const p = new PianoState();
    p.apply(on(60, 0, 0.8, 'ch1'));
    p.apply(on(60, 1, 0.8, 'ch2'));
    p.apply(off(60, 2, 'ch1'));
    expect(p.isHeld(60)).toBe(true);
    p.apply(off(60, 3, 'ch2'));
    expect(p.isHeld(60)).toBe(false);
    p.apply(off(60, 4)); // extra off doesn't underflow
    p.apply(on(60, 5));
    p.apply(off(60, 6));
    expect(p.isHeld(60)).toBe(false);
  });

  it('sustain hysteresis: down at >=64, stays down until <40', () => {
    const p = new PianoState();
    p.apply(cc(64, 63, 0));
    expect(p.sustainDown).toBe(false);
    p.apply(cc(64, 64, 1));
    expect(p.sustainDown).toBe(true);
    p.apply(on(60, 2));
    p.apply(off(60, 3));
    expect(p.isSounding(60)).toBe(true);
    p.apply(cc(64, 45, 4)); // half pedal: still down
    expect(p.sustainDown).toBe(true);
    expect(p.pedal).toBeCloseTo(45 / 127);
    expect(p.isSounding(60)).toBe(true);
    p.apply(cc(64, 39, 5));
    expect(p.sustainDown).toBe(false);
    expect(p.isSounding(60)).toBe(false);
  });

  it('sostenuto latches only notes held at pedal-down', () => {
    const p = new PianoState();
    p.apply(on(48, 0));
    p.apply(cc(66, 127, 10));
    p.apply(off(48, 20));
    p.apply(on(60, 30));
    p.apply(off(60, 40));
    expect(p.isSounding(48)).toBe(true);
    expect(p.isSounding(60)).toBe(false);
    p.apply(cc(66, 0, 50));
    expect(p.isSounding(48)).toBe(false);
  });

  it('snapshot only when changed; onsets within 60 ms; re-strike is a new onset', () => {
    const p = new PianoState();
    expect(p.snapshot(0)).toBeNull();
    p.apply(on(60, 100));
    p.apply(on(64, 105));
    let s = p.snapshot(110)!;
    expect(s.held).toEqual([60, 64]);
    expect(s.onsets).toEqual([60, 64]);
    expect(p.snapshot(111)).toBeNull();
    s = p.snapshot(163)!; // onset of 60 expired (>60 ms), 64 still within
    expect(s.onsets).toEqual([64]);
    s = p.snapshot(200)!;
    expect(s.onsets).toEqual([]);
    // re-strike of a sustained note
    p.apply(cc(64, 127, 210));
    p.apply(off(60, 220));
    p.snapshot(230);
    p.apply(on(60, 300));
    s = p.snapshot(301)!;
    expect(s.onsets).toEqual([60]);
    expect(s.held).toEqual([60, 64]);
  });

  it('pedalRecatch true exactly once on up->down', () => {
    const p = new PianoState();
    p.apply(on(60, 0));
    expect(p.snapshot(1)!.pedalRecatch).toBe(false);
    p.apply(cc(64, 127, 10));
    const s = p.snapshot(11)!;
    expect(s.pedalRecatch).toBe(true);
    expect(s.pedal).toBe(1);
    p.apply(cc(64, 100, 12)); // still down: no recatch
    p.apply(cc(64, 0, 20));
    expect(p.snapshot(21)!.pedalRecatch).toBe(false);
  });

  it('released notes decay fast with pedal up, slowly with pedal down', () => {
    const up = new PianoState();
    up.apply(on(60, 0, 1));
    up.apply(off(60, 100));
    const wUp = up.weight(60, 100 + TAU_DAMPED);
    const down = new PianoState();
    down.apply(cc(64, 127, 0));
    down.apply(on(60, 0, 1));
    down.apply(off(60, 100));
    const wDown = down.weight(60, 100 + TAU_DAMPED);
    expect(wUp).toBeLessThan(wDown);
    expect(wUp / up.weight(60, 100)).toBeCloseTo(Math.exp(-1), 2);
    expect(wDown).toBeGreaterThan(0.8);
    // tail eventually leaves the sounding set
    up.snapshot(101);
    const s = up.snapshot(100 + TAU_DAMPED * 6)!;
    expect(notesOf(s)).toEqual([]);
  });

  it('pedaled D–7 fades under a fresh G7 (old notes weigh less)', () => {
    const p = new PianoState();
    p.apply(cc(64, 127, 0));
    for (const n of [50, 53, 57, 60]) p.apply(on(n, 0, 0.7));
    for (const n of [50, 53, 57, 60]) p.apply(off(n, 1500));
    for (const n of [55, 59, 62, 65]) p.apply(on(n, 2000, 0.7));
    const s = p.snapshot(2010)!;
    const w = new Map(s.sounding.map((x) => [x.note, x.w]));
    expect(w.get(50)!).toBeLessThan(w.get(55)! * 0.9);
    expect(s.held).toEqual([55, 59, 62, 65]);
  });

  it('held notes keep a floor weight', () => {
    const p = new PianoState();
    p.apply(on(60, 0, 1));
    expect(p.weight(60, 60_000)).toBeGreaterThan(0.3);
  });

  it('decay-only snapshots throttled to <=60 Hz', () => {
    const p = new PianoState();
    p.apply(on(60, 0, 1));
    p.apply(off(60, 0));
    p.snapshot(100); // flushes change; onset not yet expired... ensure clean state
    p.snapshot(200);
    let n = 0;
    for (let t = 200; t < 400; t += 2) if (p.snapshot(t)) n++;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(Math.ceil(200 / (1000 / 60)) + 1);
  });

  it('panic and CC121 reset', () => {
    const p = new PianoState();
    p.apply(cc(64, 127, 0));
    p.apply(on(60, 1));
    p.apply(panic(2));
    expect(p.isHeld(60)).toBe(false);
    expect(p.pedal).toBe(0);
    const s = p.snapshot(3)!;
    expect(s.sounding).toEqual([]);
    expect(p.snapshot(4)).toBeNull();
    p.apply(cc(64, 127, 5));
    p.apply(cc(121, 0, 6));
    expect(p.sustainDown).toBe(false);
  });
});
