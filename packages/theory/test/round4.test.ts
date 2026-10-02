import { describe, expect, it } from 'vitest';
import type { Prediction } from '../../../src/shared/analysis';
import { readLineNote, scaleFor, type LineNote } from '../src/scales';
import { reharmsFor } from '../src/reharm';
import { tensionOf } from '../src/tension';
import type { KeyLike } from '../src/pitch';
import { V } from './helpers';

const pcsOf = (notes: number[]): number[] => {
  const p = new Array(12).fill(0);
  for (const n of notes) p[n % 12] = 1;
  return p;
};
const C: KeyLike = { tonic: 0, mode: 'major' };
const Ddor: KeyLike = { tonic: 2, mode: 'dorian' };
const Cmin: KeyLike = { tonic: 0, mode: 'minor' };
const pred = (root: number, q: string, p: number, name = ''): Prediction => ({ root, q, p, name, why: '', roman: null, fn: null, kind: 'diatonic' });

describe('scale halo', () => {
  it('a So What vamp is D dorian with the ♮6 marked', () => {
    const s = scaleFor(2, 'm7', pcsOf(V('D3 G3 C4 F4 A4')), Ddor)!;
    expect(s.name).toBe('D dorian');
    expect(s.pcs).toEqual([2, 4, 5, 7, 9, 11, 0]);
    expect(s.marks).toEqual([{ pc: 11, kind: 'color', label: '♮6' }]);
  });

  it('G7 with ♭9 and ♯9 switches to the altered scale, tensions in magenta', () => {
    const s = scaleFor(7, '7', pcsOf(V('G2 F3 B3 Eb4 Ab4 Bb4')), C)!;
    expect(s.mode).toBe('altered');
    expect(s.marks.map((m) => m.label)).toEqual(['♭9', '♯9', '♯11', '♭13']);
    expect(s.marks.every((m) => m.kind === 'alt')).toBe(true);
  });

  it('G13(♭9) is half-whole, a plain G13 is mixolydian, and V⁷(♭9) in a minor key is phrygian dominant', () => {
    expect(scaleFor(7, '7', pcsOf(V('G2 F3 Ab3 B3 E4')), C)!.mode).toBe('half-whole');
    expect(scaleFor(7, '7', pcsOf(V('G2 F3 B3 E4')), C)!.mode).toBe('mixolydian');
    expect(scaleFor(7, '7', pcsOf(V('G2 F3 Ab3 B3')), Cmin)!.mode).toBe('phrygian dominant');
  });

  it('IVΔ7 is lydian, IΔ7 is ionian, and a ♯11 makes any major 7th lydian', () => {
    expect(scaleFor(5, 'maj7', pcsOf(V('F3 A3 C4 E4')), C)!.mode).toBe('lydian');
    expect(scaleFor(0, 'maj7', pcsOf(V('C3 E3 G3 B3')), C)!.mode).toBe('ionian');
    expect(scaleFor(0, 'maj7', pcsOf(V('C3 E3 B3 F#4')), C)!.mode).toBe('lydian');
  });

  it('iii is phrygian and vi aeolian in a major key; m7♭5 is locrian', () => {
    expect(scaleFor(4, 'm7', pcsOf(V('E3 G3 B3 D4')), C)!.mode).toBe('phrygian');
    expect(scaleFor(9, 'm7', pcsOf(V('A3 C4 E4 G4')), C)!.mode).toBe('aeolian');
    expect(scaleFor(11, 'm7b5', pcsOf(V('B3 D4 F4 A4')), C)!.mode).toBe('locrian');
  });
});

describe('line reading', () => {
  const dorian = scaleFor(2, 'm7', pcsOf(V('D3 F3 A3 C4')), Ddor)!;
  const run = (notes: number[]): LineNote[] => {
    const out: LineNote[] = [];
    notes.forEach((n, i) => out.push(readLineNote(n, i * 0.2, out, dorian)));
    return out;
  };

  it('scale tones light; a chromatic note reads as an approach', () => {
    const [a, b, c] = run(V('A4 G#4 G4'));
    expect(a.kind).toBe('in');
    expect(b.kind).toBe('approach');
    expect(c.kind).toBe('in');
  });

  it('closing in on a target from above and below marks an enclosure', () => {
    // E above, C♯ below, D the target.
    const line = run(V('E5 C#5 D5'));
    expect(line[2]).toMatchObject({ kind: 'in', enclosure: true });
    // A plain scale run is no enclosure.
    expect(run(V('C5 D5 E5'))[2].enclosure).toBe(false);
  });

  it('notes too far apart in time are not one line', () => {
    const a = readLineNote(V('E5')[0], 0, [], dorian);
    const b = readLineNote(V('C#5')[0], 0.2, [a], dorian);
    expect(readLineNote(V('D5')[0], 2, [a, b], dorian).enclosure).toBe(false);
  });
});

describe('reharm offers', () => {
  it('on G7 going to CΔ7: library approaches to C, named by their move, smoothest first', () => {
    const offers = reharmsFor({ root: 7, q: '7' }, [pred(0, 'maj7', 0.7, 'CΔ7')], V('F3 B3 E4'), C, { jazz: 1 });
    expect(offers.map((o) => o.why)).toEqual(['tritone sub', 'minor plagal', 'backdoor']);
    expect(offers[0].path.map((s) => s.name)).toEqual(['D♭7']);
    expect(offers[0].move).toMatchObject({ id: 'jazz.tritone-sub', styles: ['jazz'] });
    expect(offers.find((o) => o.why === 'backdoor')!.path.map((s) => s.name)).toEqual(['B♭7']);
    for (const o of offers) expect(o.target).toBe(0);
  });

  it('the style in play reorders them: a pop session hears plagal and ♭VI–♭VII–I first, as triads', () => {
    const offers = reharmsFor({ root: 7, q: '7' }, [pred(0, 'maj', 0.7, 'C')], V('G3 B3 D4'), C, { pop: 1, rock: 0.6 }, true);
    expect(offers.map((o) => o.why)).toContain('♭VI–♭VII–I');
    expect(offers.find((o) => o.why === '♭VI–♭VII–I')!.path.map((s) => s.name)).toEqual(['B♭']);
    expect(offers.map((o) => o.why)).not.toContain('tritone sub');
  });

  it('the sub cycle is still offered by hand', () => {
    const offers = reharmsFor({ root: 7, q: '7' }, [pred(0, 'maj7', 0.7, 'CΔ7')], [], C, { jazz: 1 });
    expect(offers.length).toBe(3);
    const all = reharmsFor({ root: 7, q: '7' }, [pred(0, 'maj7', 0.7, 'CΔ7')], V('Eb3 G3 Db4'), C, { jazz: 1 });
    expect(all.find((o) => o.why === 'sub cycle')?.path.map((s) => s.name)).toEqual(['E♭7', 'A♭7', 'D♭7']);
  });

  it('on D–7 going to G7: ii–♭II7–I and the backdoor ii–V', () => {
    const offers = reharmsFor({ root: 2, q: 'm7' }, [pred(7, '7', 0.6, 'G7')], V('F3 A3 C4 E4'), C);
    expect(offers.map((o) => o.why).sort()).toEqual(['backdoor ii–V', 'ii–♭II7–I']);
    expect(offers.find((o) => o.why === 'backdoor ii–V')!.path.map((s) => s.name)).toEqual(['F–7', 'B♭7']);
  });

  it('nothing is offered when the next chord is unclear or not a resolution', () => {
    expect(reharmsFor({ root: 7, q: '7' }, [pred(0, 'maj7', 0.2)], [], C)).toEqual([]);
    expect(reharmsFor({ root: 0, q: 'maj7' }, [pred(5, 'maj7', 0.8)], [], C)).toEqual([]);
  });
});

describe('tension curve', () => {
  it('rests on the tonic, rises on the dominant, spikes on an altered dominant', () => {
    const I = tensionOf({ root: 0, q: 'maj7' }, pcsOf(V('C3 E3 G3 B3')), C);
    const V7 = tensionOf({ root: 7, q: '7' }, pcsOf(V('G2 F3 B3 E4')), C);
    const alt = tensionOf({ root: 7, q: '7' }, pcsOf(V('G2 F3 B3 Eb4 Ab4')), C);
    expect(I).toBeLessThan(0.3);
    expect(V7).toBeGreaterThan(I + 0.15);
    expect(alt).toBeGreaterThan(V7 + 0.2);
  });

  it('a chord far from the key sits higher than the same chord at home', () => {
    const home = tensionOf({ root: 0, q: 'maj7' }, pcsOf(V('C3 E3 G3 B3')), C);
    const away = tensionOf({ root: 6, q: 'maj7' }, pcsOf(V('F#3 A#3 C#4 F4')), C);
    expect(away).toBeGreaterThan(home + 0.2);
  });

  it('is zero in silence and never leaves 0..1', () => {
    expect(tensionOf(null, new Array(12).fill(0), C)).toBe(0);
    expect(tensionOf({ root: 1, q: '7' }, new Array(12).fill(1), C)).toBeLessThanOrEqual(1);
  });
});

describe('reharm offers in a modal frame', () => {
  it('a dorian vamp’s IV⁷ is color, so nothing is offered', () => {
    expect(reharmsFor({ root: 2, q: 'm7' }, [pred(7, '7', 0.6, 'G7')], [], Ddor)).toEqual([]);
  });
  it('a dorian vamp’s G7 heading back to D–7 gets nothing either', () => {
    expect(reharmsFor({ root: 7, q: '7' }, [pred(2, 'm7', 0.7, 'D–7')], [], Ddor)).toEqual([]);
  });
  it('G mixolydian (= V of C) heading for C is offered the C-major alternates', () => {
    const Gmix: KeyLike = { tonic: 7, mode: 'mixolydian' };
    const offers = reharmsFor({ root: 7, q: '7' }, [pred(0, 'maj7', 0.7, 'CΔ7')], V('F3 B3 E4'), Gmix, { jazz: 1 });
    expect(offers.map((o) => o.why)).toContain('tritone sub');
    expect(offers.find((o) => o.why === 'tritone sub')!.path[0].name).toBe('D♭7');
  });
});
