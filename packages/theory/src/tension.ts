// Harmonic tension, 0..1: one number for how far the sound is from rest.
//
// Three parts: the chord's quality (a major triad rests, an altered dominant
// pulls hardest), roughness (half steps, ♭9s and tritones among what sounds),
// and distance from the key (notes outside it, and how far the root is round
// the circle of fifths). Pure, no deps.
import { PRESENT } from './chords';
import { mod12, parentMajor, type KeyLike } from './pitch';

const QUALITY: Record<string, number> = {
  maj: 0.06,
  '6': 0.12,
  maj7: 0.16,
  min: 0.14,
  m7: 0.2,
  m6: 0.24,
  mMaj7: 0.34,
  sus4: 0.2,
  '7sus4': 0.3,
  '7': 0.42,
  m7b5: 0.42,
  dim: 0.5,
  dim7: 0.55,
  aug: 0.5,
};
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

/** Steps round the circle of fifths between two pitch classes (0..6). */
const fifthsApart = (a: number, b: number): number => {
  const d = Math.abs(FIFTHS.indexOf(mod12(a)) - FIFTHS.indexOf(mod12(b)));
  return Math.min(d, 12 - d);
};

export interface ChordLike {
  root: number;
  q: string;
}

/** Tension of what is sounding: chord quality + roughness + distance from the key, clamped to 0..1. */
export function tensionOf(chord: ChordLike | null, pcs: ArrayLike<number>, key: KeyLike | null): number {
  const on = (pc: number) => (pcs[mod12(pc)] ?? 0) >= PRESENT;
  let n = 0;
  for (let pc = 0; pc < 12; pc++) if (on(pc)) n++;
  if (n === 0) return 0;

  let t = chord ? QUALITY[chord.q] ?? 0.3 : 0.25;

  // Alterations on a dominant: each ♭9, ♯9, ♯11, ♭13 adds pull.
  if (chord && (chord.q === '7' || chord.q === '7sus4')) {
    for (const iv of [1, 3, 6, 8]) if (on(chord.root + iv)) t += 0.09;
  }

  // Roughness: half steps (♭9s fold to these) and tritones among the sounding pitch classes.
  let semis = 0, tris = 0;
  for (let pc = 0; pc < 12; pc++) {
    if (!on(pc)) continue;
    if (on(pc + 1)) semis++;
    if (pc < 6 && on(pc + 6)) tris++;
  }
  t += Math.min(0.2, 0.05 * semis) + Math.min(0.12, 0.04 * tris);

  // Distance from the key: notes outside its scale, and the root's distance round the circle.
  if (key) {
    const pm = parentMajor(key);
    let outside = 0;
    for (let pc = 0; pc < 12; pc++) {
      if (!on(pc)) continue;
      const rel = mod12(pc - pm);
      const minorOk = key.mode === 'minor' && (mod12(pc - key.tonic) === 11 || mod12(pc - key.tonic) === 9);
      if (!MAJOR.includes(rel) && !minorOk) outside++;
    }
    t += Math.min(0.2, 0.06 * outside);
    if (chord) t += 0.12 * (fifthsApart(chord.root, key.tonic) / 6);
  }
  return Math.max(0, Math.min(1, t));
}
