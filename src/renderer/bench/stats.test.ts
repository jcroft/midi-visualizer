import { describe, expect, it } from 'vitest';
import type { PianoEvent } from '@shared/events';
import {
  FRAME_CAP,
  FrameStats,
  KEYBED_USB_MS,
  LatencyProbe,
  PANEL_MS,
  percentileSorted,
  toCsv,
} from './stats';

const on = (t: number, recvT = t, src = 'midi:S61', note = 60): PianoEvent & { type: 'on' } => ({
  type: 'on',
  note,
  vel: 100,
  t,
  recvT,
  src,
});

/** Drive n frames at a fixed interval with a fixed CPU cost. */
function run(stats: FrameStats, n: number, interval: number, cost = 2, start = 1000): number {
  let t = start;
  for (let i = 0; i < n; i++) {
    stats.frameStart(t, t + 0.5);
    stats.frameEnd(t + 0.5 + cost);
    t += interval;
  }
  return t;
}

describe('percentileSorted', () => {
  it('interpolates', () => {
    const a = Float64Array.from([1, 2, 3, 4, 5]);
    expect(percentileSorted(a, 5, 50)).toBe(3);
    expect(percentileSorted(a, 5, 0)).toBe(1);
    expect(percentileSorted(a, 5, 100)).toBe(5);
    expect(percentileSorted(a, 5, 25)).toBe(2);
    expect(Number.isNaN(percentileSorted(a, 0, 50))).toBe(true);
  });
});

describe('FrameStats', () => {
  it('estimates 120 Hz and reports no drops for steady pacing', () => {
    const s = new FrameStats();
    run(s, 600, 1000 / 120);
    const sum = s.summary();
    expect(sum.frames).toBe(599); // first frame has no delta
    expect(sum.refreshHz).toBeCloseTo(120, 3);
    expect(sum.delta.p99).toBeCloseTo(8.333, 2);
    expect(sum.dropped).toBe(0);
    expect(sum.cpu.p50).toBeCloseTo(2, 6);
    expect(sum.longFrames).toBe(0);
  });

  it('counts dropped frames and missed vsyncs', () => {
    const s = new FrameStats();
    const iv = 1000 / 120;
    let t = run(s, 200, iv);
    // one 2-interval gap (1 missed) and one 4-interval gap (3 missed)
    t += iv;
    t = run(s, 1, iv, 2, t);
    t += 3 * iv;
    run(s, 200, iv, 2, t);
    const sum = s.summary();
    expect(sum.dropped).toBe(2);
    expect(sum.missedVsyncs).toBe(4);
    expect(sum.refreshHz).toBeCloseTo(120, 1);
  });

  it('counts long CPU frames and treats long pauses as gaps', () => {
    const s = new FrameStats();
    let t = run(s, 100, 1000 / 60);
    t = run(s, 3, 1000 / 60, 20, t); // 20 ms CPU > 16.7 ms interval
    run(s, 10, 1000 / 60, 2, t + 5000); // window hidden for 5 s
    const sum = s.summary();
    expect(sum.longFrames).toBe(3);
    expect(sum.gaps).toBe(1);
    expect(sum.dropped).toBe(0);
    expect(sum.refreshHz).toBeCloseTo(60, 1);
  });

  it('is a bounded ring', () => {
    const s = new FrameStats();
    run(s, FRAME_CAP * 3, 8);
    const sum = s.summary();
    expect(sum.frames).toBe(FRAME_CAP);
    expect(sum.totalFrames).toBe(FRAME_CAP * 3 - 1);
    expect(s.samples().deltaMs.length).toBe(FRAME_CAP);
    s.reset();
    expect(s.summary().frames).toBe(0);
  });
});

describe('LatencyProbe', () => {
  const iv = 1000 / 120;

  /** Warm up the probe's interval estimate with steady frames. */
  function warm(p: LatencyProbe, start = 1000, n = 20): number {
    let t = start;
    for (let i = 0; i < n; i++) {
      p.frameSubmitted(t, t + 1);
      t += iv;
    }
    return t;
  }

  it('measures frame, submit and transport legs and estimates photon', () => {
    const p = new LatencyProbe();
    const frameT = warm(p);
    const evT = frameT - 3; // driver stamp 3 ms before the frame began
    p.noteSeen(on(evT, evT + 0.4), frameT);
    p.frameSubmitted(frameT, frameT + 2); // submitted 2 ms into the frame
    const s = p.summary();
    expect(s.n).toBe(1);
    expect(s.toFrame.p50).toBeCloseTo(3, 6);
    expect(s.toSubmit.p50).toBeCloseTo(5, 6);
    expect(s.transport.p50).toBeCloseTo(0.4, 6);
    // next vsync = frameT + iv; + 1 compositor frame + panel; from evT; + keybed/USB
    const expected = 3 + 2 * iv + PANEL_MS + KEYBED_USB_MS;
    expect(s.keyToPhoton.p50).toBeCloseTo(expected, 3);
  });

  it('rounds up to the vsync after a late submit', () => {
    const p = new LatencyProbe();
    const frameT = warm(p);
    p.noteSeen(on(frameT), frameT);
    p.frameSubmitted(frameT, frameT + iv + 1); // overran one interval
    const s = p.summary();
    expect(s.keyToPhoton.p50).toBeCloseTo(3 * iv + PANEL_MS + KEYBED_USB_MS, 3);
  });

  it('attributes submit only to notes drained in that frame', () => {
    const p = new LatencyProbe();
    let t = warm(p);
    p.noteSeen(on(t - 1, t - 1, 'midi:S61', 60), t);
    p.noteSeen(on(t - 2, t - 2, 'midi:S61', 64), t);
    p.frameSubmitted(t, t + 1);
    t += iv;
    p.noteSeen(on(t - 1, t - 1, 'midi:S61', 67), t);
    p.frameSubmitted(t, t + 4);
    const rows = p.rows();
    expect(rows.map((r) => r.toSubmitMs)).toEqual([2, 3, 5]);
  });

  it('excludes synthetic sources from summaries but keeps them in rows', () => {
    const p = new LatencyProbe();
    const t = warm(p);
    p.noteSeen(on(t - 1, t - 1, 'demo'), t);
    p.noteSeen(on(t - 1, t - 1, 'file:take.mid'), t);
    p.noteSeen(on(t - 1, t - 1, 'qwerty'), t);
    p.frameSubmitted(t, t + 1);
    expect(p.summary().n).toBe(1);
    expect(p.rows().length).toBe(3);
    expect(p.rows()[0].live).toBe(false);
  });

  it('falls back to recvT when the driver stamp is 0', () => {
    const p = new LatencyProbe();
    const t = warm(p);
    p.noteSeen(on(0, t - 2), t);
    p.frameSubmitted(t, t + 1);
    expect(p.summary().toFrame.p50).toBeCloseTo(2, 6);
  });

  it('filters by mode tag', () => {
    const p = new LatencyProbe();
    let t = warm(p);
    p.noteSeen(on(t - 1), t);
    p.frameSubmitted(t, t + 1);
    p.setTag('flash');
    t += iv;
    p.noteSeen(on(t - 4), t);
    p.frameSubmitted(t, t + 1);
    expect(p.summary().n).toBe(2);
    expect(p.summary('flash').n).toBe(1);
    expect(p.summary('flash').toFrame.p50).toBeCloseTo(4, 6);
    expect(p.summary('stress').n).toBe(0);
  });

  it('builds a report with meta, summaries and CSV', () => {
    const p = new LatencyProbe();
    const stats = new FrameStats();
    run(stats, 300, iv);
    let t = warm(p);
    for (let i = 0; i < 60; i++) {
      p.noteSeen(on(t - 1, t - 0.5, 'midi:S61', 60 + (i % 12)), t);
      p.frameSubmitted(t, t + 1.5);
      t += iv;
    }
    p.setMeta('backend', 'webgpu');
    const r = p.report(stats, { mode: 'flash' });
    expect(r.meta.backend).toBe('webgpu');
    expect(r.meta.mode).toBe('flash');
    expect(r.summary.latency.n).toBe(60);
    expect(r.bars.latencyPass).toBe(true);
    expect(r.bars.framePass).toBe(true);
    expect(r.samples.notes.length).toBe(60);
    const csv = toCsv(r.samples.notes);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(61);
    expect(lines[0].startsWith('note,vel,src,mode')).toBe(true);
    expect(() => JSON.parse(JSON.stringify(r))).not.toThrow();
  });
});
