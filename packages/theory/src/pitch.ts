// Pitch-class helpers and key-aware enharmonic spelling. Pure, no deps.

export type Mode = 'major' | 'minor' | 'dorian' | 'mixolydian';

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** Jazz default when no key is known (or for chromatic roots): D♭ E♭ F♯ A♭ B♭. */
const NEUTRAL = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

const MAJOR_KEY_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR_KEY_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
// relative-major tonics that use sharps (G D A E B); everything else with accidentals uses flats
const SHARP_MAJORS = new Set([7, 2, 9, 4, 11]);

export interface KeyLike {
  tonic: number;
  mode: Mode;
}

/** Tonic of the relative major (parent scale) for a key/mode. */
export function parentMajor(k: KeyLike): number {
  switch (k.mode) {
    case 'minor':
      return mod12(k.tonic + 3);
    case 'dorian':
      return mod12(k.tonic - 2);
    case 'mixolydian':
      return mod12(k.tonic + 5);
    default:
      return k.tonic;
  }
}

function inScale(pc: number, k: KeyLike): boolean {
  const rel = mod12(pc - parentMajor(k));
  if (MAJOR_SCALE.includes(rel)) return true;
  // harmonic/melodic minor: raised 7th of the minor tonic, and raised 6th
  if (k.mode === 'minor') {
    const r = mod12(pc - k.tonic);
    return r === 11 || r === 9;
  }
  return false;
}

/**
 * Spell a pitch class for display. Diatonic notes follow the key signature
 * (G♯ in E, D♭ in A♭); chromatic notes fall back to the jazz-neutral table.
 */
export function spell(pc: number, key: KeyLike | null): string {
  pc = mod12(pc);
  if (!key) return NEUTRAL[pc];
  if (inScale(pc, key)) {
    const pm = parentMajor(key);
    if (pm === 0) return NEUTRAL[pc];
    return SHARP_MAJORS.has(pm) ? SHARP[pc] : FLAT[pc];
  }
  // chromatic: flat keys keep flats (G♭ in A♭); sharp keys use the neutral table (B♭7 in E, not A♯7)
  const pm = parentMajor(key);
  return pm !== 0 && !SHARP_MAJORS.has(pm) ? FLAT[pc] : NEUTRAL[pc];
}

export function keyLabel(k: KeyLike): string {
  switch (k.mode) {
    case 'major':
      return MAJOR_KEY_NAMES[k.tonic];
    case 'minor':
      return `${MINOR_KEY_NAMES[k.tonic]} minor`;
    case 'dorian':
      return `${MINOR_KEY_NAMES[k.tonic]} dorian`;
    case 'mixolydian':
      return `${MAJOR_KEY_NAMES[k.tonic]} mixolydian`;
  }
}

/** Rotate a 12-bit pitch-class mask so bit 0 is `root`. */
export function rotMask(mask: number, root: number): number {
  return ((mask >> root) | (mask << (12 - root))) & 0xfff;
}
