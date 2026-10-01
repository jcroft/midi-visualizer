import { expect, it } from 'vitest';
import type { PianoSnapshot } from '../../../src/shared/analysis';
import { createAnalyzer } from '../src/index';

it('update() on a 30-note snapshot is well under 1 ms', () => {
  const a = createAnalyzer();
  const notes = Array.from({ length: 30 }, (_, i) => 36 + ((i * 7) % 50));
  const snaps: PianoSnapshot[] = [];
  for (let i = 0; i < 64; i++) {
    snaps.push({
      type: 'snapshot',
      t: 0,
      held: notes.slice(0, 10 + (i % 5)),
      sounding: notes.map((note, j) => ({ note, w: 1 - ((i + j) % 10) / 12 })),
      onsets: i % 8 === 0 ? notes.slice(i % 20, (i % 20) + 4) : [],
      pedal: 1,
      pedalRecatch: i % 32 === 0,
    });
  }
  let t = 0;
  for (let i = 0; i < 500; i++) a.update({ ...snaps[i % 64], t: (t += 8) }); // warm up
  const n = 4000;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const s = snaps[i % 64];
    s.t = t += 8;
    a.update(s);
  }
  const avg = (performance.now() - t0) / n;
  console.log(`theory update avg ${(avg * 1000).toFixed(1)} µs`);
  expect(avg).toBeLessThan(0.5);
});
