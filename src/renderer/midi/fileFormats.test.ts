import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import type { PianoEvent } from '@shared/events';
import { asciiLabel, parseJsonl, toJsonl, toSmf } from './fileFormats';
import { buildDemo, sequenceFromJsonl, sequenceFromMidi } from './replay';

const evs: PianoEvent[] = [
  { type: 'cc', cc: 64, value: 1, t: 1000, recvT: 1001, src: 'midi:x' },
  { type: 'on', note: 60, vel: 0.5, t: 1000, recvT: 1001, src: 'midi:x' },
  { type: 'pat', note: 60, value: 0.2, t: 1100, recvT: 1101, src: 'midi:x' },
  { type: 'off', note: 60, vel: 0, t: 1500, recvT: 1501, src: 'midi:x' },
  { type: 'on', note: 64, vel: 1, t: 1600, recvT: 1601, src: 'midi:x' }, // left open
  { type: 'cc', cc: 64, value: 0, t: 2000, recvT: 2001, src: 'midi:x' },
];
const markers = [{ t: 1000, text: 'CΔ7' }, { t: 1600, text: 'Key: C' }];

describe('asciiLabel', () => {
  it('transliterates lead-sheet symbols', () => {
    expect(asciiLabel('CΔ7')).toBe('Cmaj7');
    expect(asciiLabel('D–9')).toBe('D-9');
    expect(asciiLabel('Bø7')).toBe('Bm7b5');
    expect(asciiLabel('E♭Δ9')).toBe('Ebmaj9');
    expect(asciiLabel('A7alt')).toBe('A7alt');
    expect(asciiLabel('Key: F♯ minor')).toBe('Key: F# minor');
  });
});

describe('jsonl', () => {
  it('round-trips events and markers losslessly', () => {
    const text = toJsonl(evs, markers, { started: 'x' });
    const back = parseJsonl(text);
    expect(back.events).toEqual(evs);
    expect(back.markers).toEqual(markers);
    expect(sequenceFromJsonl(text).events[1]).toMatchObject({ at: 0, type: 'on', note: 60 });
  });
});

describe('SMF', () => {
  it('writes Type 0, PPQ 1000 @ 60 BPM, 1 tick = 1 ms, with markers and CC64', () => {
    const bytes = toSmf(evs, markers, { name: 'take' });
    expect(bytes[9]).toBe(0); // format 0
    expect((bytes[12] << 8) | bytes[13]).toBe(1000);
    const m = new Midi(bytes);
    expect(m.header.tempos[0].bpm).toBeCloseTo(60);
    const notes = m.tracks.flatMap((t) => t.notes);
    expect(notes.map((n) => n.midi)).toEqual([60, 64]);
    expect(notes[0].ticks).toBe(0);
    expect(notes[0].durationTicks).toBe(500);
    expect(notes[1].ticks).toBe(600);
    expect(notes[1].durationTicks).toBe(400); // closed at last tick
    const sus = m.tracks.flatMap((t) => t.controlChanges[64] ?? []);
    expect(sus.map((c) => [c.ticks, c.value])).toEqual([[0, 1], [1000, 0]]);
    const mk = m.header.meta.filter((e) => e.type === 'marker');
    expect(mk.map((e) => [e.ticks, e.text])).toEqual([[0, 'Cmaj7'], [600, 'Key: C']]);
    // and it replays
    const seq = sequenceFromMidi(bytes);
    expect(seq.events.find((e) => e.type === 'on')).toMatchObject({ at: 0, note: 60 });
  });
});

describe('demo', () => {
  it('is ~30 s, sorted, balanced on/off, pedal changes', () => {
    let i = 0;
    const seq = buildDemo(() => ((i = (i * 9301 + 49297) % 233280) / 233280));
    expect(seq.len).toBeGreaterThan(25_000);
    expect(seq.len).toBeLessThan(45_000);
    for (let k = 1; k < seq.events.length; k++) expect(seq.events[k].at).toBeGreaterThanOrEqual(seq.events[k - 1].at);
    const ons = seq.events.filter((e) => e.type === 'on').length;
    const offs = seq.events.filter((e) => e.type === 'off').length;
    expect(ons).toBe(offs);
    expect(seq.events.filter((e) => e.type === 'cc').length).toBeGreaterThan(10);
    expect(seq.events[seq.events.length - 1].at).toBeLessThanOrEqual(seq.len);
  });
});
