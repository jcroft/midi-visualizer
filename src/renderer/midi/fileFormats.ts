// Pure (de)serializers for recordings: lossless .jsonl session logs and
// Type 0 Standard MIDI Files (PPQ 1000 @ 60 BPM => 1 tick = 1 ms).
//
// @tonejs/midi's encoder always writes Format 1 with a separate conductor
// track, so the SMF is written by hand here (it's ~80 lines); @tonejs/midi is
// used to READ .mid files (replay) and in the tests to verify what we write.
import type { PianoEvent } from '@shared/events';

export interface Marker {
  t: number;
  text: string;
}

// ---------------------------------------------------------------- .jsonl ----

/**
 * Line 1: {"kind":"header",...}. Then one PianoEvent JSON per line (they have
 * `type`), interleaved in time order with {"kind":"marker","t","text"} lines.
 */
export function toJsonl(events: readonly PianoEvent[], markers: readonly Marker[], meta: Record<string, unknown> = {}): string {
  const out: string[] = [JSON.stringify({ kind: 'header', format: 'midi-visualizer-session', version: 1, ...meta })];
  let mi = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    while (mi < markers.length && markers[mi].t <= ev.t) out.push(markerLine(markers[mi++]));
    out.push(JSON.stringify(ev));
  }
  while (mi < markers.length) out.push(markerLine(markers[mi++]));
  return out.join('\n') + '\n';
}

function markerLine(m: Marker): string {
  return JSON.stringify({ kind: 'marker', t: m.t, text: m.text });
}

const TYPES = new Set(['on', 'off', 'cc', 'pat', 'panic']);

export function parseJsonl(text: string): { events: PianoEvent[]; markers: Marker[] } {
  const events: PianoEvent[] = [];
  const markers: Marker[] = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let o: any;
    try {
      o = JSON.parse(s);
    } catch {
      continue;
    }
    if (!o || typeof o !== 'object') continue;
    if (o.kind === 'marker' && typeof o.t === 'number') markers.push({ t: o.t, text: String(o.text ?? '') });
    else if (TYPES.has(o.type) && typeof o.t === 'number') events.push(o as PianoEvent);
  }
  return { events, markers };
}

// ------------------------------------------------------------------ .mid ----

class ByteWriter {
  buf = new Uint8Array(4096);
  len = 0;
  private ensure(n: number) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const b = new Uint8Array(cap);
    b.set(this.buf.subarray(0, this.len));
    this.buf = b;
  }
  u8(...bs: number[]) {
    this.ensure(bs.length);
    for (const b of bs) this.buf[this.len++] = b & 0xff;
  }
  bytes(b: Uint8Array) {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  u16(v: number) {
    this.u8(v >> 8, v);
  }
  u32(v: number) {
    this.u8(v >>> 24, v >>> 16, v >>> 8, v);
  }
  vlq(v: number) {
    v = Math.max(0, Math.floor(v));
    const tmp = [v & 0x7f];
    while ((v >>= 7)) tmp.unshift((v & 0x7f) | 0x80);
    this.u8(...tmp);
  }
  out(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/**
 * SMF text is de-facto Latin-1/ASCII (midi-file, many DAWs), so marker text is
 * transliterated to lead-sheet ASCII. The .jsonl keeps the original labels.
 */
export function asciiLabel(s: string): string {
  return s
    .replace(/ø7?/g, 'm7b5')
    .replace(/Δ/g, 'maj')
    .replace(/[–−]/g, '-')
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .replace(/[°o]7/g, 'dim7')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)))
    .replace(/[^\x20-\x7e]/g, '?');
}

const clamp7 = (x: number) => (x < 0 ? 0 : x > 127 ? 127 : Math.round(x));

interface TrackEv {
  tick: number;
  order: number;
  bytes: number[] | null; // channel message
  meta?: { type: number; data: Uint8Array };
}

/**
 * Writes a Type 0 SMF, channel 1. Times are relative to `t0` (defaults to the
 * first event). Note-offs without a matching on are dropped; notes still held
 * at the end are closed at the last tick. Panic -> CC123. Markers -> FF 06.
 */
export function toSmf(events: readonly PianoEvent[], markers: readonly Marker[] = [], opts: { name?: string; t0?: number } = {}): Uint8Array {
  const t0 = opts.t0 ?? (events.length ? events[0].t : markers.length ? markers[0].t : 0);
  const tick = (t: number) => Math.max(0, Math.round(t - t0));
  const evs: TrackEv[] = [];
  let order = 0;
  const open = new Uint16Array(128);
  const enc = new TextEncoder();

  if (opts.name) evs.push({ tick: 0, order: order++, bytes: null, meta: { type: 0x03, data: enc.encode(asciiLabel(opts.name)) } });
  // 60 BPM = 1,000,000 µs per quarter
  evs.push({ tick: 0, order: order++, bytes: null, meta: { type: 0x51, data: new Uint8Array([0x0f, 0x42, 0x40]) } });
  evs.push({ tick: 0, order: order++, bytes: null, meta: { type: 0x58, data: new Uint8Array([4, 2, 24, 8]) } });

  let last = 0;
  for (const ev of events) {
    const tk = tick(ev.t);
    if (tk > last) last = tk;
    switch (ev.type) {
      case 'on':
        open[ev.note]++;
        evs.push({ tick: tk, order: order++, bytes: [0x90, ev.note & 0x7f, Math.max(1, clamp7(ev.vel * 127))] });
        break;
      case 'off':
        if (!open[ev.note]) break;
        open[ev.note]--;
        evs.push({ tick: tk, order: order++, bytes: [0x80, ev.note & 0x7f, clamp7(ev.vel * 127)] });
        break;
      case 'cc':
        evs.push({ tick: tk, order: order++, bytes: [0xb0, ev.cc & 0x7f, clamp7(ev.value * 127)] });
        break;
      case 'pat':
        evs.push({ tick: tk, order: order++, bytes: [0xa0, ev.note & 0x7f, clamp7(ev.value * 127)] });
        break;
      case 'panic':
        open.fill(0);
        evs.push({ tick: tk, order: order++, bytes: [0xb0, 123, 0] });
        break;
    }
  }
  for (const m of markers) {
    const tk = tick(m.t);
    if (tk > last) last = tk;
    evs.push({ tick: tk, order: order++, bytes: null, meta: { type: 0x06, data: enc.encode(asciiLabel(m.text)) } });
  }
  for (let n = 0; n < 128; n++) {
    for (let k = 0; k < open[n]; k++) evs.push({ tick: last, order: order++, bytes: [0x80, n, 0] });
  }
  evs.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const trk = new ByteWriter();
  let prev = 0;
  for (const e of evs) {
    trk.vlq(e.tick - prev);
    prev = e.tick;
    if (e.meta) {
      trk.u8(0xff, e.meta.type);
      trk.vlq(e.meta.data.length);
      trk.bytes(e.meta.data);
    } else trk.u8(...e.bytes!);
  }
  trk.u8(0x00, 0xff, 0x2f, 0x00);
  const body = trk.out();

  const w = new ByteWriter();
  w.u8(0x4d, 0x54, 0x68, 0x64); // MThd
  w.u32(6);
  w.u16(0); // format 0
  w.u16(1); // one track
  w.u16(1000); // PPQ
  w.u8(0x4d, 0x54, 0x72, 0x6b); // MTrk
  w.u32(body.length);
  w.bytes(body);
  return w.out();
}
