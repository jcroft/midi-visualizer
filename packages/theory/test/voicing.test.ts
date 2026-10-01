import { describe, expect, it } from 'vitest';
import { analyzeVoicing, voiceLeading } from '../src/voicing';

const fns = (r: ReturnType<typeof analyzeVoicing>) => r!.voices.map((v) => v.fn);

describe('analyzeVoicing', () => {
  it('rootless A on D–7', () => {
    const r = analyzeVoicing([53, 57, 60, 64], 2, 'm7');
    expect(fns(r)).toEqual(['♭3', '5', '♭7', '9']);
    expect(r).toMatchObject({ type: 'rootlessA', spread: 11, rootInferred: true });
  });

  it('rootless B on G7', () => {
    const r = analyzeVoicing([53, 57, 59, 64], 7, '7');
    expect(fns(r)).toEqual(['♭7', '9', '3', '13']);
    expect(r!.type).toBe('rootlessB');
  });

  it('shell 1-7-3 on G7', () => {
    const r = analyzeVoicing([43, 53, 59], 7, '7');
    expect(fns(r)).toEqual(['R', '♭7', '3']);
    expect(r).toMatchObject({ type: 'shell', label: 'shell 1-7-3', split: null });
  });

  it('upper-structure II over C7', () => {
    const r = analyzeVoicing([52, 58, 74, 78, 81], 0, '7');
    expect(fns(r)).toEqual(['3', '♭7', '9', '♯11', '13']);
    expect(r).toMatchObject({ type: 'ust', label: 'UST II', split: 2, rootInferred: true });
    expect(r!.voices.map((v) => v.hand).join('')).toBe('LLRRR');
  });

  it('So What on E–7', () => {
    const r = analyzeVoicing([52, 57, 62, 67, 71], 4, 'm7');
    expect(fns(r)).toEqual(['R', '11', '♭7', '♭3', '5']);
    expect(r!.type).toBe('soWhat');
  });

  it('drop 2 and drop 3 on CΔ7', () => {
    expect(analyzeVoicing([55, 60, 64, 71], 0, 'maj7')!.type).toBe('drop2');
    expect(analyzeVoicing([52, 60, 67, 71], 0, 'maj7')!.type).toBe('drop3');
  });

  it('cluster on C7', () => {
    const r = analyzeVoicing([58, 60, 61, 63], 0, '7');
    expect(fns(r)).toEqual(['♭7', 'R', '♭9', '♯9']);
    expect(r!.type).toBe('cluster');
  });

  it('flags close thirds low in the bass as muddy', () => {
    expect(analyzeVoicing([36, 40, 43, 47], 0, 'maj7')!.muddy).toBe(true);
    expect(analyzeVoicing([48, 52, 55, 59], 0, 'maj7')!.muddy).toBe(false);
  });

  it('needs at least two notes', () => {
    expect(analyzeVoicing([60], 0, 'maj7')).toBeNull();
  });
});

describe('voiceLeading', () => {
  it('pairs in order when the counts match: ii–V guide tones move by step', () => {
    // D–7 (F A C E) → G7 (F A B E): C falls a half step to B
    const m = voiceLeading([53, 57, 60, 64], [53, 57, 59, 64]);
    expect(m.map((x) => x.to! - x.from!)).toEqual([0, 0, -1, 0]);
  });

  it('greedily pairs nearest when a voice enters', () => {
    const m = voiceLeading([60, 64], [59, 64, 67]);
    expect(m).toContainEqual({ from: 64, to: 64 });
    expect(m).toContainEqual({ from: 60, to: 59 });
    expect(m).toContainEqual({ from: null, to: 67 });
  });
});
