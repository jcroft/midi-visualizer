// Reharmonization offers: what you *could* play instead, when the next chord
// is clear. Possible, not probable: these never compete with the predictions.
//
// On a dominant resolving down a fifth (G7 → CΔ7): the tritone sub (D♭7),
// the backdoor (B♭7), and a back-cycled chain of subs (E♭7 → A♭7 → D♭7).
// On a ii going to its V (D–7 → G7): ii–subV (D–7 → D♭7) and the backdoor
// ii–V (F–7 → B♭7). Ranked by how little your hands would have to move.
import type { Prediction } from '../../../src/shared/analysis';
import { familyOf, plainText } from './chords';
import { mod12, spell, type KeyLike } from './pitch';
import { chordTones, resolveVoice } from './voicing';

export interface ReharmStep {
  root: number;
  q: string;
  name: string;
}

export interface Reharm {
  /** "tritone sub", "backdoor", "sub cycle", "ii–subV", "backdoor ii–V". */
  why: string;
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
export function reharmsFor(chord: { root: number; q: string } | null, preds: readonly Prediction[], notes: readonly number[], key: KeyLike | null): Reharm[] {
  // A modal vamp's IV⁷ is color, not a V⁷ asking to resolve: no offers inside a modal frame.
  if (!chord || (key && (key.mode === 'dorian' || key.mode === 'mixolydian'))) return [];
  const step = (root: number, q: string): ReharmStep => ({ root: mod12(root), q, name: spell(mod12(root), key) + plainText(q) });
  const next = preds.find((p) => p.p >= REHARM_MIN_P && mod12(p.root - chord.root) === 5);
  if (!next) return [];
  const out: Omit<Reharm, 'cost'>[] = [];
  const fam = familyOf(chord.q);
  const nf = familyOf(next.q);

  if (fam === 'dom' && (nf === 'maj' || nf === 'min')) {
    // V⁷ → I: replace the V.
    const I = next.root;
    out.push({ why: 'tritone sub', path: [step(I + 1, '7')], target: I });
    if (nf === 'maj') out.push({ why: 'backdoor', path: [step(I - 2, '7')], target: I });
    out.push({ why: 'sub cycle', path: [step(I + 3, '7'), step(I + 8, '7'), step(I + 1, '7')], target: I });
  } else if ((chord.q === 'm7' || chord.q === 'm7b5') && nf === 'dom') {
    // ii → V: replace the V, or the whole ii–V.
    const V = next.root;
    const I = mod12(V + 5);
    out.push({ why: 'ii–subV', path: [step(V + 6, '7')], target: I });
    out.push({ why: 'backdoor ii–V', path: [step(I + 5, 'm7'), step(I - 2, '7')], target: I });
  }

  return out
    .map((r) => ({ ...r, cost: notes.length ? moveCost(notes, r.path[0].root, r.path[0].q) : 0 }))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, MAX_OFFERS);
}
