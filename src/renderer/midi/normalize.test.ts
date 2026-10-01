import { describe, expect, it } from 'vitest';
import type { PianoEvent } from '@shared/events';
import { Deduper, looksBluetooth, looksLikeDawPort, parseMidi, parsePersisted, shouldSelect } from './normalize';

const parse = (bytes: number[], t = 10) => {
  const out: PianoEvent[] = [];
  parseMidi(bytes, t, 12, 'midi:test', (e) => out.push(e));
  return out;
};

describe('parseMidi', () => {
  it('note-on, note-on vel 0 = off, note-off, channels merged', () => {
    expect(parse([0x90, 60, 127])).toEqual([{ type: 'on', note: 60, vel: 1, t: 10, recvT: 12, src: 'midi:test' }]);
    expect(parse([0x93, 60, 0])[0]).toMatchObject({ type: 'off', note: 60, vel: 0 });
    expect(parse([0x81, 61, 64])[0]).toMatchObject({ type: 'off', note: 61, vel: 64 / 127 });
  });
  it('CC as 0..1, poly aftertouch as pat', () => {
    expect(parse([0xb0, 64, 127])[0]).toMatchObject({ type: 'cc', cc: 64, value: 1 });
    expect(parse([0xa2, 60, 63])[0]).toMatchObject({ type: 'pat', note: 60, value: 63 / 127 });
  });
  it('CC120 / CC123 -> panic; CC121 passes through as cc', () => {
    expect(parse([0xb0, 123, 0])[0].type).toBe('panic');
    expect(parse([0xb5, 120, 0])[0].type).toBe('panic');
    expect(parse([0xb0, 121, 0])[0]).toMatchObject({ type: 'cc', cc: 121 });
  });
  it('ignores active sensing, clock, sysex, program change, pitch bend', () => {
    expect(parse([0xfe])).toEqual([]);
    expect(parse([0xf8])).toEqual([]);
    expect(parse([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7])).toEqual([]);
    expect(parse([0xc0, 5])).toEqual([]);
    expect(parse([0xe0, 0, 64])).toEqual([]);
  });
  it('handles running status and interleaved realtime bytes', () => {
    const ev = parse([0x90, 60, 100, 64, 90, 0xf8, 67, 0]);
    expect(ev.map((e) => e.type)).toEqual(['on', 'on', 'off']);
    expect(ev.map((e) => (e as { note: number }).note)).toEqual([60, 64, 67]);
  });
  it('does not throw on truncated or junk input', () => {
    expect(parse([0x90, 60])).toEqual([]);
    expect(parse([60, 70])).toEqual([]);
    expect(parse([])).toEqual([]);
  });
});

describe('Deduper', () => {
  it('drops an identical message from a different port within 3 ms', () => {
    const d = new Deduper(3);
    const k = Deduper.key([0x90, 60, 100]);
    expect(d.isDuplicate(k, 0, 100)).toBe(false);
    expect(d.isDuplicate(k, 1, 102.5)).toBe(true);
  });
  it('keeps repeats from the same port (fast repeated notes) and late copies', () => {
    const d = new Deduper(3);
    const k = Deduper.key([0x90, 60, 100]);
    expect(d.isDuplicate(k, 0, 100)).toBe(false);
    expect(d.isDuplicate(k, 0, 101)).toBe(false);
    expect(d.isDuplicate(k, 1, 110)).toBe(false);
  });
  it('a match is consumed, so a genuine third copy is kept', () => {
    const d = new Deduper(3);
    const k = Deduper.key([0x90, 60, 100]);
    d.isDuplicate(k, 0, 100);
    expect(d.isDuplicate(k, 1, 101)).toBe(true);
    expect(d.isDuplicate(k, 1, 101.5)).toBe(false);
  });
  it('different notes or velocities are not duplicates; channels merge; vel0 on == off', () => {
    const d = new Deduper(3);
    d.isDuplicate(Deduper.key([0x90, 60, 100]), 0, 100);
    expect(d.isDuplicate(Deduper.key([0x90, 60, 99]), 1, 100)).toBe(false);
    expect(d.isDuplicate(Deduper.key([0x91, 60, 100]), 1, 100)).toBe(true);
    expect(Deduper.key([0x90, 62, 0])).toBe(Deduper.key([0x80, 62, 0]));
  });
});

describe('port classification', () => {
  it('excludes DAW/virtual ports by default, keeps the Kontrol keyboard port', () => {
    expect(looksLikeDawPort('Komplete Kontrol S61 MK3')).toBe(false);
    expect(looksLikeDawPort('KONTROL S61 MK3')).toBe(false);
    expect(looksLikeDawPort('Komplete Kontrol S61 MK3 DAW')).toBe(true);
    expect(looksLikeDawPort('KONTROL DAW')).toBe(true);
    expect(looksLikeDawPort('Komplete Kontrol DAW - 1')).toBe(true);
    expect(looksLikeDawPort('IAC Driver Bus 1')).toBe(true);
    expect(looksLikeDawPort('Roland Digital Piano')).toBe(false);
  });
  it('flags Bluetooth', () => {
    expect(looksBluetooth('FP-30X Bluetooth')).toBe(true);
    expect(looksBluetooth('WIDI BLE')).toBe(true);
    expect(looksBluetooth('Komplete Kontrol S61 MK3')).toBe(false);
  });
  it('persisted choice wins for known ports, default rule for new ones', () => {
    const p = parsePersisted(JSON.stringify({ selected: ['NI|KONTROL DAW'], known: ['NI|KONTROL DAW', 'NI|S61'] }));
    expect(shouldSelect('KONTROL DAW', 'NI', p)).toBe(true);
    expect(shouldSelect('S61', 'NI', p)).toBe(false);
    expect(shouldSelect('New Piano', 'Yamaha', p)).toBe(true);
    expect(shouldSelect('Other DAW', 'X', null)).toBe(false);
    expect(parsePersisted('garbage')).toBeNull();
  });
});
