import { describe, expect, it } from 'vitest';
import { type ChordEvent, landingFor, predict } from '../src/predict';
import type { KeyLike } from '../src/pitch';

const C: KeyLike = { tonic: 0, mode: 'major' };
const Cm: KeyLike = { tonic: 0, mode: 'minor' };
const ev = (root: number, q: string): ChordEvent => ({ root, q });
/** Predict from the last chord of a progression. */
const after = (key: KeyLike | null, ...h: ChordEvent[]) => predict(h[h.length - 1], key, h);

describe('predict', () => {
  it('a secondary dominant resolves to the diatonic quality (A7 → D–7 in C)', () => {
    const p = after(C, ev(9, '7'));
    expect(p[0]).toMatchObject({ name: 'D–7', roman: 'ii⁷', fn: 'SD', kind: 'diatonic' });
  });

  it('V–I in the key is the tonic, with roman numeral and function', () => {
    const p = after(C, ev(7, '7'));
    expect(p[0]).toMatchObject({ name: 'CΔ7', why: 'V–I', roman: 'IΔ⁷', fn: 'T', kind: 'diatonic' });
  });

  it('chains a second step off a confident ii: D–7 → G7 → CΔ7', () => {
    const p = after(C, ev(2, 'm7'));
    expect(p[0].name).toBe('G7');
    expect(p[0].then).toMatchObject({ name: 'CΔ7', roman: 'IΔ⁷' });
    // only the top prediction carries a second step
    for (const q of p.slice(1)) expect(q.then).toBeUndefined();
  });

  it('labels secondary dominants against what they tonicize (I → V⁷/ii)', () => {
    const p = after(C, ev(0, 'maj7'));
    const a7 = p.find((x) => x.name === 'A7')!;
    expect(a7).toMatchObject({ roman: 'V⁷/ii', kind: 'secondary', fn: 'D' });
  });

  it('a ii–V that points outside the key is a modulation', () => {
    const p = after(C, ev(10, 'm7'), ev(3, '7')); // B♭–7 E♭7 → A♭
    expect(p[0]).toMatchObject({ name: 'A♭Δ7', kind: 'modulating', tonicizes: 'A♭' });
  });

  it('in a blues, IV7 goes home to I7, not down a fifth', () => {
    const p = after(C, ev(0, '7'), ev(5, '7'));
    expect(p[0]).toMatchObject({ name: 'C7', why: 'blues IV → I' });
    expect(p.some((x) => x.name === 'B♭Δ7')).toBe(false);
  });

  it('a lone IV7 keeps both readings; a ii–V into it resolves', () => {
    expect(after(C, ev(5, '7')).some((x) => x.name === 'C7')).toBe(true);
    const p = after(C, ev(0, 'm7'), ev(5, '7')); // C–7 F7 → B♭
    expect(p[0].name).toBe('B♭Δ7');
  });

  it('a dominant after a dominant a fifth above continues the cycle', () => {
    const p = after(C, ev(4, '7'), ev(9, '7')); // E7 A7 → D7
    expect(p[0]).toMatchObject({ name: 'D7', why: 'dominant cycle' });
  });

  it('minor ii–V–i lands on the minor tonic', () => {
    const p = after(Cm, ev(2, 'm7b5'), ev(7, '7'));
    expect(p[0].name).toBe('C–6');
    expect(p[0].fn).toBe('T');
  });

  it('VI7 → ii is a turnaround heading to V', () => {
    const p = after(C, ev(9, '7'), ev(2, 'm7'));
    expect(p[0]).toMatchObject({ name: 'G7' });
    expect(p[0].p).toBeGreaterThan(0.6);
  });

  it('never wastes a slot on a same-root refinement (sus → 7, I → I7)', () => {
    for (const c of [ev(7, '7sus4'), ev(0, 'maj7'), ev(2, 'm7')]) {
      for (const p of after(C, c)) expect(p.root).not.toBe(c.root);
    }
  });

  it('works without a key', () => {
    const p = after(null, ev(7, '7'));
    expect(p[0]).toMatchObject({ name: 'CΔ7', roman: null, fn: null });
  });
});

describe('landingFor', () => {
  const h = [ev(2, 'm7'), ev(7, '7')];
  const preds = predict(h[1], C, h);

  it('names a completed ii–V–I', () => {
    const l = landingFor(preds, h[1], ev(0, 'maj7'), C, [...h, ev(0, 'maj7')]);
    expect(l).toMatchObject({ hit: 0, exact: true, label: 'ii–V–I', fn: 'T', from: 7 });
  });

  it('right root, different family is a partial landing', () => {
    const l = landingFor(preds, h[1], ev(0, 'm7'), C, [...h, ev(0, 'm7')]);
    expect(l.exact).toBe(false);
    expect(l.hit).toBeGreaterThanOrEqual(0);
    expect(l.label).toBe('modal interchange');
  });

  it('rewards a tritone sub of the predicted dominant', () => {
    const fromII = predict(ev(2, 'm7'), C, [ev(2, 'm7')]); // top: G7
    const l = landingFor(fromII, ev(2, 'm7'), ev(1, '7'), C, [ev(2, 'm7'), ev(1, '7')]);
    expect(l.label).toMatch(/tritone sub/);
  });

  it('a surprise is just a miss, with no label', () => {
    const l = landingFor(preds, h[1], ev(6, 'm7'), C, [...h, ev(6, 'm7')]);
    expect(l).toMatchObject({ hit: -1, exact: false, label: null });
  });
});
