// Pure MIDI helpers (no DOM): byte parsing -> PianoEvent, cross-port de-dupe,
// port classification and selection persistence. Unit-tested in node.
import type { PianoEvent } from '@shared/events';

/** Data-byte count for a channel-voice status nibble (0x80..0xE0). */
function dataLen(status: number): number {
  const hi = status & 0xf0;
  return hi === 0xc0 || hi === 0xd0 ? 1 : 2;
}

/**
 * Parses one Web MIDI message (or several concatenated, with running status)
 * and calls `emit` for each normalized PianoEvent. Channels are merged.
 * Filters realtime (clock, active sensing...), sysex, and messages we don't use
 * (program change, channel pressure, pitch bend). Never throws.
 *
 * CC120 (all sound off) and CC123 (all notes off) become `panic`.
 * CC121 (reset all controllers) is passed through as `{type:'cc', cc:121}`;
 * PianoState treats it as "all pedals up".
 */
export function parseMidi(
  data: ArrayLike<number>,
  t: number,
  recvT: number,
  src: string,
  emit: (ev: PianoEvent) => void,
): void {
  const n = data.length;
  let i = 0;
  let status = 0;
  while (i < n) {
    const b = data[i];
    if (b >= 0xf8) {
      i++; // realtime: clock, start/stop, active sensing, reset — ignore
      continue;
    }
    if (b === 0xf0) {
      // sysex: skip to EOX
      i++;
      while (i < n && data[i] !== 0xf7) i++;
      i++;
      status = 0;
      continue;
    }
    if (b >= 0xf1) {
      // system common: skip with its data bytes
      i += b === 0xf2 ? 3 : b === 0xf1 || b === 0xf3 ? 2 : 1;
      status = 0;
      continue;
    }
    if (b & 0x80) {
      status = b;
      i++;
    } else if (status === 0) {
      i++; // stray data byte
      continue;
    }
    const len = dataLen(status);
    if (i + len > n) return; // truncated
    const d1 = data[i] & 0x7f;
    const d2 = len === 2 ? data[i + 1] & 0x7f : 0;
    i += len;
    switch (status & 0xf0) {
      case 0x90:
        if (d2 === 0) emit({ type: 'off', note: d1, vel: 0, t, recvT, src });
        else emit({ type: 'on', note: d1, vel: d2 / 127, t, recvT, src });
        break;
      case 0x80:
        emit({ type: 'off', note: d1, vel: d2 / 127, t, recvT, src });
        break;
      case 0xa0:
        emit({ type: 'pat', note: d1, value: d2 / 127, t, recvT, src });
        break;
      case 0xb0:
        if (d1 === 120 || d1 === 123) emit({ type: 'panic', t, recvT, src });
        else emit({ type: 'cc', cc: d1, value: d2 / 127, t, recvT, src });
        break;
      default:
        break; // program change, channel pressure, pitch bend: ignored
    }
  }
}

/**
 * Drops a message identical to one received from a DIFFERENT port within
 * `windowMs` (a piano on both USB and Bluetooth doubles every note).
 * Allocation-free ring buffer.
 */
export class Deduper {
  private readonly keys: Int32Array;
  private readonly ports: Int32Array;
  private readonly times: Float64Array;
  private head = 0;
  constructor(private readonly windowMs = 3, size = 64) {
    this.keys = new Int32Array(size);
    this.ports = new Int32Array(size).fill(-1);
    this.times = new Float64Array(size).fill(-Infinity);
  }
  /** Packs up to the first 3 bytes, channel-merged (status high nibble only for voice messages). */
  static key(data: ArrayLike<number>): number {
    let s = data.length > 0 ? data[0] : 0;
    if (s >= 0x80 && s < 0xf0) {
      s &= 0xf0;
      // note-on vel 0 == note-off for de-dupe purposes
      if (s === 0x90 && data.length > 2 && data[2] === 0) return (0x80 << 16) | ((data[1] & 0x7f) << 8);
    }
    const d1 = data.length > 1 ? data[1] : 0;
    const d2 = data.length > 2 ? data[2] : 0;
    return (s << 16) | (d1 << 8) | d2;
  }
  /** Returns true if this message is a duplicate and should be dropped; otherwise records it. */
  isDuplicate(key: number, port: number, t: number): boolean {
    const size = this.keys.length;
    for (let i = 0; i < size; i++) {
      if (this.keys[i] === key && this.ports[i] !== port && this.ports[i] !== -1 && Math.abs(t - this.times[i]) <= this.windowMs) {
        // consume the match so a third copy (or a genuine repeat) isn't swallowed
        this.ports[i] = -1;
        return true;
      }
    }
    const h = this.head;
    this.keys[h] = key;
    this.ports[h] = port;
    this.times[h] = t;
    this.head = (h + 1) % size;
    return false;
  }
  reset(): void {
    this.ports.fill(-1);
    this.times.fill(-Infinity);
  }
}

/** DAW / virtual / loopback ports are not selected by default (e.g. NI "KONTROL DAW", "Komplete Kontrol DAW - 1"). */
export function looksLikeDawPort(name: string): boolean {
  return /\bDAW\b|IAC|virtual|loopMIDI|loopback|Midi Through|\bthru\b/i.test(name);
}

export function looksBluetooth(name: string): boolean {
  return /bluetooth|\bBLE\b/i.test(name);
}

export function portKey(name: string, manufacturer: string): string {
  return manufacturer + '|' + name;
}

export interface PersistedSelection {
  /** Port keys the user had selected. */
  selected: string[];
  /** Every port key the user has seen in the selector (so new devices get the default rule). */
  known: string[];
}

export function shouldSelect(name: string, manufacturer: string, persisted: PersistedSelection | null): boolean {
  const k = portKey(name, manufacturer);
  if (persisted && persisted.known.includes(k)) return persisted.selected.includes(k);
  return !looksLikeDawPort(name);
}

export function parsePersisted(raw: string | null): PersistedSelection | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && Array.isArray(o.selected) && Array.isArray(o.known)) {
      return { selected: o.selected.map(String), known: o.known.map(String) };
    }
  } catch {
    /* ignore */
  }
  return null;
}
