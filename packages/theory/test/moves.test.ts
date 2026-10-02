// Every move in the library checks itself: in four keys, as triads and as 7th
// chords, from every starting chord if it's a loop, and with a passing chord
// slipped in. Adding a move is one line in moves.ts; these tests write themselves.
import { describe, expect, it } from 'vitest';
import { type Chord, findRepeat, matchMoves, nextStep } from '../src/match';
import { ALL_MOVES, type Move, type MoveStep, type StepClass, parseStep, validateLibrary } from '../src/moves';
import { mod12 } from '../src/pitch';

const TRIAD: Record<StepClass, string> = { M: 'maj', m: 'min', D: '7', m7: 'min', Δ: 'maj', mΔ: 'mMaj7', ø: 'dim', '°': 'dim', '+': 'aug', sus: 'sus4' };
const SEVENTH: Record<StepClass, string> = { M: 'maj7', m: 'm7', D: '7', m7: 'm7', Δ: 'maj7', mΔ: 'mMaj7', ø: 'm7b5', '°': 'dim7', '+': 'aug', sus: '7sus4' };
const KEYS = [0, 3, 6, 9];

const chordOf = (s: MoveStep, tonic: number, table: Record<StepClass, string>): Chord => ({ root: mod12(tonic + s.deg), q: table[s.cls] });

/** Transpositions that map a loop onto itself (Coltrane changes repeat every major third): any of them is the right home. */
function homes(move: Move, T: number): number[] {
  if (move.kind !== 'loop') return [T];
  const sig = (t: number) => move.steps.map((s) => `${mod12(s.deg + t)}${s.cls}`).sort().join();
  const base = sig(0);
  return Array.from({ length: 12 }, (_, t) => t).filter((t) => sig(t) === base).map((t) => mod12(T + t));
}

/** Matches for `move` in this history that are strong enough to make predictions. */
const found = (H: Chord[], move: Move) => matchMoves(H).filter((m) => m.move.id === move.id && m.strength >= 0.15);

describe('the move library', () => {
  it('passes its own validation (unique ids, no duplicate shapes, no doubled loops)', () => {
    expect(validateLibrary()).toEqual([]);
  });

  it('parses the numeral shorthand', () => {
    expect(parseStep('♭VII7')).toMatchObject({ deg: 10, cls: 'D', opt: false });
    expect(parseStep('(iv7)')).toMatchObject({ deg: 5, cls: 'm7', opt: true });
    expect(parseStep('♯iv°')).toMatchObject({ deg: 6, cls: '°' });
    expect(parseStep('IΔ')).toMatchObject({ deg: 0, cls: 'Δ' });
    expect(parseStep('iiø')).toMatchObject({ deg: 2, cls: 'ø' });
    expect(parseStep('V')).toMatchObject({ deg: 7, cls: 'M' });
    expect(parseStep('vi')).toMatchObject({ deg: 9, cls: 'm' });
    expect(() => parseStep('Vx')).toThrow();
  });
});

for (const move of ALL_MOVES) {
  describe(`${move.id} (${move.roman})`, () => {
    const n = move.steps.length;
    for (const [texture, table] of [['triads', TRIAD], ['7ths', SEVENTH]] as const) {
      it(`is found in four keys, as ${texture}`, () => {
        for (const T of KEYS) {
          if (move.kind === 'cadence') {
            const H = move.steps.map((s) => chordOf(s, T, table));
            // the whole cadence completes it
            const done = found(H, move);
            expect(done.some((m) => m.complete && m.tonic === T), `${move.id} complete in ${T}`).toBe(true);
            // all but the last chord predicts the last
            const part = found(H.slice(0, -1), move).find((m) => m.tonic === T);
            if (H.length > 2) {
              expect(part, `${move.id} partial in ${T}`).toBeTruthy();
              expect(nextStep(part!)!.root).toBe(H[H.length - 1].root);
            }
          } else {
            for (let r = 0; r < n; r++) {
              const len = n + Math.max(2, Math.ceil(n / 2));
              const H = Array.from({ length: len }, (_, i) => chordOf(move.steps[(r + i) % n], T, table));
              const ms = found(H, move).filter((m) => homes(move, T).includes(m.tonic));
              expect(ms.length, `${move.id} from step ${r} in ${T}`).toBeGreaterThan(0);
              expect(nextStep(ms[0])!.root).toBe(mod12(T + move.steps[(r + len) % n].deg));
            }
          }
        }
      });
    }

    it('survives a passing diminished chord slipped in', () => {
      const T = 2;
      const base = move.kind === 'cadence' ? move.steps : [...move.steps, ...move.steps.slice(0, Math.max(2, Math.ceil(n / 2)))];
      const H = base.map((s) => chordOf(s, T, SEVENTH));
      if (H.length < 3) return;
      // a °7 a half step below the third chord
      const at = 2;
      H.splice(at, 0, { root: mod12(H[at].root - 1), q: 'dim7' });
      const ms = found(H, move).filter((m) => homes(move, T).includes(m.tonic));
      expect(ms.length, move.id).toBeGreaterThan(0);
    });
  });
}

describe('generic repeats', () => {
  it('locks onto a loop nobody wrote down', () => {
    const H: Chord[] = [
      { root: 0, q: 'maj7' },
      { root: 8, q: 'maj7' },
      { root: 1, q: 'maj7' },
      { root: 0, q: 'maj7' },
      { root: 8, q: 'maj7' },
      { root: 1, q: 'maj7' },
    ];
    expect(findRepeat(H)).toMatchObject({ period: 3, run: 3, laps: 2 });
    expect(findRepeat(H.slice(0, 4))).toBeNull();
  });
});
