// Reharmonization offers: what you *could* play instead, when the next chord
// is clear. Possible, not probable: these never compete with the predictions.
//
// Offers come from the move library: every cadence that lands on the chord
// you're heading for offers its approach as an alternative, named by its move
// and style. On G7 → CΔ7 that's the tritone sub (D♭7), the backdoor (B♭7), the
// minor plagal (F–7), ♭VI–♭VII–I (B♭) and so on; on D–7 → G7 it's ii–♭II7–I
// (D♭7) and the backdoor ii–V (F–7 → B♭7). The sub cycle (E♭7 → A♭7 → D♭7) is
// added by hand. Ranked by how little your hands would move, the styles in
// play, and the move's tier.
import type { Prediction } from '../../../src/shared/analysis';
import { familyOf, plainText } from './chords';
import { ALL_MOVES, classFit, classQuality, type Move, type MoveStep } from './moves';
import { mod12, parentMajor, spell, type KeyLike } from './pitch';
import { chordTones, resolveVoice } from './voicing';

export interface ReharmStep {
  root: number;
  q: string;
  name: string;
}

export interface Reharm {
  /** The move it comes from ("tritone sub", "backdoor", "ii–♭II7–I"), or "sub cycle". */
  why: string;
  /** The library move, and the styles it belongs to. */
  move: { id: string; styles: string[] } | null;
  /** The chords to play instead, in order. */
  path: ReharmStep[];
  /** Root of the chord the path lands on (the target it reharmonizes toward). */
  target: number;
  /** Total semitones your voices would move into the first chord (lower is smoother). */
  cost: number;
}

/** Only offer when the next chord is at least this likely. */
export const REHARM_MIN_P = 0.3;
const MAX_OFFERS = 3;

/** Semitones the held voices move to reach the nearest tones of a chord (a voice with nowhere near costs 3). */
export function moveCost(notes: readonly number[], root: number, q: string): number {
  const tones = chordTones(root, q);
  // Tensions a player would happily land on count too: the 9th and 13th of a dominant, the 9th of anything.
  const fam = familyOf(q);
  tones.push(mod12(root + 2));
  if (fam === 'dom') tones.push(mod12(root + 9));
  let c = 0;
  for (const n of notes) {
    const d = resolveVoice(n, tones);
    c += d === null ? 3 : Math.abs(d);
  }
  return c;
}

/** Reharm offers for the chord now sounding, given the predictions and the voices your hands hold. */
export function reharmsFor(
  chord: { root: number; q: string } | null,
  preds: readonly Prediction[],
  notes: readonly number[],
  key: KeyLike | null,
  style: Partial<Record<string, number>> = {},
  triads = false,
): Reharm[] {
  if (!chord) return [];
  // Inside a modal frame a vamp's IV⁷ is color, not a V⁷ asking to resolve. Offer only when the
  // music is heading for the parent major's tonic (G mixolydian = V of C, going to C), in that key.
  const modal = !!key && (key.mode === 'dorian' || key.mode === 'mixolydian');
  if (modal) key = { tonic: parentMajor(key!), mode: 'major' };
  const next = preds.find((p) => p.p >= REHARM_MIN_P && mod12(p.root - chord.root) === 5 && (!modal || p.root === key!.tonic));
  if (!next) return [];
  const fam = familyOf(chord.q);
  const nf = familyOf(next.q);
  const step = (root: number, q: string): ReharmStep => ({ root: mod12(root), q, name: spell(mod12(root), key) + plainText(q) });
  const fromStep = (I: number, s: MoveStep) => step(I + s.deg, classQuality(s.cls, triads, s.cls === 'D'));

  type Cand = Omit<Reharm, 'cost'> & { rank: number };
  const out: Cand[] = [];
  const seen = new Set<string>();
  const add = (why: string, move: Move | null, styles: string[], path: ReharmStep[], target: number, order: number) => {
    const sig = path.map((p) => p.root + p.q).join(' ');
    if (seen.has(sig) || path.some((p) => p.root === chord.root)) return;
    seen.add(sig);
    const fit = Math.max(0, ...styles.map((st) => style[st] ?? 0));
    const tier = move ? move.tier : 1;
    out.push({ why, move: move ? { id: move.id, styles } : null, path, target, rank: -1.5 * fit + 0.75 * (tier - 1) + order * 0.01 });
  };
  // shortest first, so an approach is named by its plainest move (tritone sub, not ii–♭II7–I)
  const cadences = ALL_MOVES.filter((m) => m.kind === 'cadence' && m.steps.length >= 2 && m.steps.at(-1)!.deg === 0).sort(
    (a, b) => a.steps.length - b.steps.length,
  );

  if (fam === 'dom' && (nf === 'maj' || nf === 'min')) {
    // V⁷ → I: any library approach to I other than V itself.
    const I = next.root;
    cadences.forEach((m, i) => {
      if (classFit(m.steps.at(-1)!.cls, next.q) < 0.8) return;
      const pen = m.steps.at(-2)!;
      if (pen.deg === 7) return;
      add(m.name, m, m.styles, [fromStep(I, pen)], I, i);
    });
    add('sub cycle', null, ['jazz'], [step(I + 3, '7'), step(I + 8, '7'), step(I + 1, '7')], I, cadences.length);
  } else if ((chord.q === 'm7' || chord.q === 'm7b5') && nf === 'dom') {
    // ii → V: another dominant into I (keeping the ii), or a whole other ii–V.
    const V = next.root;
    const I = mod12(V + 5);
    cadences.forEach((m, i) => {
      const n = m.steps.length;
      const pen = m.steps[n - 2];
      if (pen.cls !== 'D' || pen.deg === 7) return;
      const pre = n >= 3 ? m.steps[n - 3] : null;
      const minorPre = !!pre && (pre.cls === 'm7' || pre.cls === 'm' || pre.cls === 'ø');
      if (minorPre && pre!.deg === 2) add(m.name, m, m.styles, [fromStep(I, pen)], I, i);
      else if (minorPre) add(m.name + ' ii–V', m, m.styles, [fromStep(I, pre!), fromStep(I, pen)], I, i);
    });
  }

  return out
    .map(({ rank, ...r }) => ({ ...r, cost: notes.length ? moveCost(notes, r.path[0].root, r.path[0].q) : 0, rank }))
    .sort((a, b) => a.cost + a.rank * 3 - (b.cost + b.rank * 3))
    .slice(0, MAX_OFFERS)
    .map(({ rank, ...r }) => (void rank, r));
}
