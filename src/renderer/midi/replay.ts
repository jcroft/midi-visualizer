// CONTRACT (owned by the MIDI worker). Demo progression + .mid/.jsonl replay through the same bus.
//
// Scheduling: one timer at a time, armed for the next due event (setTimeout,
// capped at 16 ms) and topped up from rAF, so timer clamping in a background
// tab can't stall a burst. Each event's `t` is its scheduled time on the
// performance.now() clock; `recvT` is when it was actually emitted.
import { Midi } from '@tonejs/midi';
import type { EventBus, PianoEvent } from '@shared/events';
import { parseJsonl } from './fileFormats';

/** Offset-timed event without clock fields; `at` is ms from the start of the sequence. */
export type SeqEvent =
  | { at: number; type: 'on'; note: number; vel: number }
  | { at: number; type: 'off'; note: number; vel: number }
  | { at: number; type: 'cc'; cc: number; value: number }
  | { at: number; type: 'pat'; note: number; value: number }
  | { at: number; type: 'panic' };

export interface Sequence {
  events: SeqEvent[];
  /** Total length in ms (for looping). */
  len: number;
}

// ------------------------------------------------------------- demo ----

/**
 * ~30 s of medium-swing jazz piano: ii–V–I in C (with roots), B♭ (rootless
 * A/B voicings + bebop line), F with a tritone sub (G♭7), D minor with Eø7 →
 * A7alt and an altered-scale run, and E♭ with a closing filigree. Legato
 * pedaling (pedal up at the change, re-caught ~80 ms after).
 * `rand` is injectable for deterministic tests.
 */
export function buildDemo(rand: () => number = Math.random): Sequence {
  const B = 500; // ms per beat (120 BPM)
  const ev: SeqEvent[] = [];
  let t = 400;
  const jit = (v: number, amt = 0.12) => Math.max(0.05, Math.min(1, v + (rand() - 0.5) * amt));
  const on = (at: number, note: number, vel: number) => ev.push({ at, type: 'on', note, vel: jit(vel) });
  const off = (at: number, note: number) => ev.push({ at, type: 'off', note, vel: 0.3 });
  const pedal = (at: number, value: number) => ev.push({ at, type: 'cc', cc: 64, value });

  /** Rolled chord held for `beats`; pedal lifted just before the next change and re-caught after the next attack. */
  const chord = (notes: number[], beats: number, vel = 0.58, roll = 12) => {
    notes.forEach((m, i) => on(t + i * roll, m, vel + (i === 0 ? 0.06 : 0)));
    pedal(t + 80, 1);
    notes.forEach((m) => off(t + beats * B - 60, m));
    pedal(t + beats * B - 40, 0);
    t += beats * B;
  };
  /** Right-hand line on top of whatever the left hand holds: [note, beats] pairs, swung eighths. */
  const line = (start: number, notes: number[], swing = true): number => {
    let lt = start;
    notes.forEach((m, i) => {
      const d = swing ? (i % 2 ? 0.34 : 0.66) * B : 0.5 * B;
      on(lt, m, 0.56 + (i % 2 ? -0.08 : 0.1));
      off(lt + d * 0.88, m);
      lt += d;
    });
    return lt;
  };

  // 1. ii–V–I in C with roots: D–9, G13, CΔ9
  chord([38, 53, 57, 60, 64], 4, 0.55);
  chord([43, 53, 57, 59, 64], 4, 0.62);
  chord([36, 52, 55, 59, 62], 4, 0.5);
  t += 300;

  // 2. B♭: rootless C–9 (A) → F13 (B) → B♭Δ9 with a bebop line
  chord([51, 55, 58, 62], 4, 0.5);
  chord([51, 55, 57, 62], 4, 0.58);
  {
    const lh = [50, 53, 57, 60]; // D F A C
    lh.forEach((m, i) => on(t + i * 12, m, 0.5));
    pedal(t + 80, 1);
    const end = line(t + B, [74, 72, 70, 69, 67, 65, 64, 65, 66, 67, 69, 70, 72, 74, 77, 76, 74, 73, 74]);
    on(end + 60, 81, 0.7);
    off(end + 1300, 81);
    lh.forEach((m) => off(end + 1500, m));
    pedal(end + 1520, 0);
    t = end + 1800;
  }

  // 3. F with a tritone sub: G–9 → G♭7(♯11) (subV of F) → FΔ9
  chord([43, 53, 57, 58, 62], 4, 0.55); // G + F A B♭ D
  chord([42, 52, 56, 58, 63], 4, 0.6); // G♭ + E A♭ B♭ E♭
  chord([41, 57, 60, 64, 67], 6, 0.52); // F + A C E G
  t += 200;

  // 4. D minor: Eø7 → A7alt (+ altered run) → D–9
  chord([40, 50, 55, 58, 62], 4, 0.55); // E + D G B♭ D
  {
    const lh = [45, 55, 61, 65]; // A + G C♯ F (3, ♭7, ♭13) ...
    lh.forEach((m, i) => on(t + i * 12, m, 0.6));
    on(t + 40, 72, 0.6); // ♯9 on top
    pedal(t + 80, 1);
    // altered scale A B♭ C D♭ E♭ F G, descending filigree in sixteenths
    const run = [82, 79, 77, 75, 73, 72, 70, 69, 67, 65, 63, 61];
    let rt = t + B;
    run.forEach((m, i) => {
      on(rt, m, 0.5 + 0.03 * (run.length - i) / run.length);
      off(rt + 110, m);
      rt += 125;
    });
    off(t + 4 * B - 60, 72);
    lh.forEach((m) => off(t + 4 * B - 60, m));
    pedal(t + 4 * B - 40, 0);
    t += 4 * B;
  }
  chord([38, 53, 57, 60, 64, 69], 6, 0.5); // D–9 (D + F A C E A)
  t += 200;

  // 5. E♭: F–9 → B♭13 → E♭Δ9 with a closing arpeggio, half-pedal shimmer
  chord([41, 56, 60, 63, 67], 3, 0.55);
  chord([46, 56, 60, 62, 67], 3, 0.6);
  {
    const lh = [39, 55, 58, 62, 65]; // E♭ + G B♭ D F
    lh.forEach((m, i) => on(t + i * 14, m, 0.5));
    pedal(t + 80, 1);
    let at = t + B;
    for (const m of [70, 74, 77, 79, 82, 86, 89, 86, 82]) {
      on(at, m, 0.45);
      off(at + 160, m);
      at += 150;
    }
    pedal(at + 400, 0.55); // half pedal: thins the wash
    lh.forEach((m) => off(at + 1600, m));
    pedal(at + 1700, 0);
    t = at + 3000; // let it breathe before looping
  }

  ev.sort((a, b) => a.at - b.at);
  return { events: ev, len: t };
}

// ------------------------------------------------------------- files ----

/** Standard MIDI File -> sequence (all tracks merged; CC64/66/67 kept). */
export function sequenceFromMidi(data: ArrayBuffer | Uint8Array): Sequence {
  const midi = new Midi(data);
  const ev: SeqEvent[] = [];
  for (const tr of midi.tracks) {
    for (const n of tr.notes) {
      const at = n.time * 1000;
      ev.push({ at, type: 'on', note: n.midi, vel: Math.max(1 / 127, n.velocity) });
      ev.push({ at: at + n.duration * 1000, type: 'off', note: n.midi, vel: n.noteOffVelocity ?? 0 });
    }
    for (const cc of [64, 66, 67]) {
      for (const c of tr.controlChanges[cc] ?? []) ev.push({ at: c.time * 1000, type: 'cc', cc, value: c.value });
    }
  }
  // stable sort; at equal times put offs first so a re-strike isn't swallowed
  const rank = (e: SeqEvent) => (e.type === 'off' ? 0 : e.type === 'cc' ? 1 : 2);
  ev.sort((a, b) => a.at - b.at || rank(a) - rank(b));
  const len = ev.length ? ev[ev.length - 1].at : 0;
  return { events: ev, len };
}

/** Recorder .jsonl -> sequence (times relative to the first event). */
export function sequenceFromJsonl(text: string): Sequence {
  const { events } = parseJsonl(text);
  if (!events.length) return { events: [], len: 0 };
  events.sort((a, b) => a.t - b.t);
  const t0 = events[0].t;
  const ev: SeqEvent[] = events.map((e) => {
    const at = e.t - t0;
    switch (e.type) {
      case 'on':
      case 'off':
        return { at, type: e.type, note: e.note, vel: e.vel };
      case 'cc':
        return { at, type: 'cc', cc: e.cc, value: e.value };
      case 'pat':
        return { at, type: 'pat', note: e.note, value: e.value };
      default:
        return { at, type: 'panic' };
    }
  });
  return { events: ev, len: ev[ev.length - 1].at };
}

function toEvent(e: SeqEvent, t: number, recvT: number, src: string): PianoEvent {
  switch (e.type) {
    case 'on':
    case 'off':
      return { type: e.type, note: e.note, vel: e.vel, t, recvT, src };
    case 'cc':
      return { type: 'cc', cc: e.cc, value: e.value, t, recvT, src };
    case 'pat':
      return { type: 'pat', note: e.note, value: e.value, t, recvT, src };
    default:
      return { type: 'panic', t, recvT, src };
  }
}

// ---------------------------------------------------------- player ----

export class Replayer {
  playing = false;
  private seq: Sequence | null = null;
  private idx = 0;
  private start = 0;
  private src = 'demo';
  private loop = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;
  private done: (() => void) | null = null;

  constructor(private readonly bus: EventBus) {}

  /** Loops a built-in jazz demo (ii–V–Is, rootless voicings, pedal) until stop(). */
  playDemo(): void {
    this.begin(buildDemo(), 'demo', true);
  }

  /** Plays a Standard MIDI File or a recorded .jsonl session. Resolves when it finishes or is stopped. */
  playFile(name: string, data: ArrayBuffer): Promise<void> {
    let seq: Sequence;
    try {
      seq = /\.jsonl?$/i.test(name) ? sequenceFromJsonl(new TextDecoder().decode(data)) : sequenceFromMidi(data);
    } catch (err) {
      return Promise.reject(err);
    }
    this.stop(); // resolves any previous playFile promise first
    const p = new Promise<void>((resolve) => (this.done = resolve));
    this.begin(seq, 'file:' + name, false);
    return p;
  }

  stop(): void {
    if (!this.playing) return;
    this.halt();
    const now = performance.now();
    this.bus.emit({ type: 'panic', t: now, recvT: now, src: this.src });
  }

  private begin(seq: Sequence, src: string, loop: boolean): void {
    this.stop();
    this.seq = seq;
    this.src = src;
    this.loop = loop;
    this.idx = 0;
    this.start = performance.now();
    this.playing = true;
    this.pump();
  }

  private halt(): void {
    this.playing = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.raf = 0;
    const d = this.done;
    this.done = null;
    d?.();
  }

  private readonly pump = (): void => {
    // whichever of timer/rAF fired first wins; cancel the other
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.timer = null;
    this.raf = 0;
    const seq = this.seq;
    if (!this.playing || !seq) return;
    const now = performance.now();
    const evs = seq.events;
    while (this.idx < evs.length && this.start + evs[this.idx].at <= now) {
      const e = evs[this.idx++];
      this.bus.emit(toEvent(e, this.start + e.at, performance.now(), this.src));
      if (!this.playing) return; // a listener stopped us
    }
    if (this.idx >= evs.length && now >= this.start + seq.len) {
      if (this.loop) {
        this.start += seq.len;
        this.seq = buildDemo();
        this.idx = 0;
      } else {
        this.stop(); // finished: panic clears any note/pedal a truncated take left on
        return;
      }
    }
    const cur = this.seq!;
    const next = this.idx < cur.events.length ? this.start + cur.events[this.idx].at : this.start + cur.len;
    const wait = Math.max(0, Math.min(16, next - performance.now()));
    this.timer = setTimeout(this.pump, wait);
    if (typeof requestAnimationFrame === 'function') this.raf = requestAnimationFrame(this.pump);
  };
}
