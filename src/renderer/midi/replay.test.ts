import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus, type PianoEvent } from '@shared/events';
import { Replayer } from './replay';
import { toJsonl } from './fileFormats';

afterEach(() => vi.useRealTimers());

describe('Replayer', () => {
  it('plays a .jsonl in time, then panics and resolves', async () => {
    vi.useFakeTimers();
    const bus = new EventBus();
    const got: PianoEvent[] = [];
    bus.on((e) => got.push(e));
    const src = 'midi:x';
    const text = toJsonl(
      [
        { type: 'on', note: 60, vel: 0.5, t: 5000, recvT: 5000, src },
        { type: 'off', note: 60, vel: 0, t: 5200, recvT: 5200, src },
      ],
      [],
    );
    const r = new Replayer(bus);
    const done = r.playFile('take.jsonl', new TextEncoder().encode(text).buffer as ArrayBuffer);
    expect(got.map((e) => e.type)).toEqual(['on']);
    await vi.advanceTimersByTimeAsync(100);
    expect(got.length).toBe(1);
    await vi.advanceTimersByTimeAsync(150);
    await done;
    expect(got.map((e) => e.type)).toEqual(['on', 'off', 'panic']);
    expect(got[1].t - got[0].t).toBe(200);
    expect(got[0].src).toBe('file:take.jsonl');
    expect(r.playing).toBe(false);
  });

  it('demo loops until stop(), which emits panic', async () => {
    vi.useFakeTimers();
    const bus = new EventBus();
    const got: PianoEvent[] = [];
    bus.on((e) => got.push(e));
    const r = new Replayer(bus);
    r.playDemo();
    await vi.advanceTimersByTimeAsync(80_000);
    const ons = got.filter((e) => e.type === 'on');
    expect(ons.length).toBeGreaterThan(150);
    r.stop();
    expect(got[got.length - 1].type).toBe('panic');
    const n = got.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(got.length).toBe(n);
  });
});
