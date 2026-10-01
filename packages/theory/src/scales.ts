// Chord-scales and line reading. Pure, no deps.
//
// The scale is the one a player would think of over the chord in this key:
// D dorian on a D–7 vamp, G altered on G7(♭9♯9), C lydian on CΔ7(♯11). A
// line is the right hand's single notes against it: inside the scale, a
// chromatic approach, or a target closed in on from both sides (an enclosure).
import { familyOf } from './chords';

const SCALE_PRESENT = 0.5;
import { mod12, parentMajor, spell, type KeyLike } from './pitch';

export interface ScaleMark {
  pc: number;
  /** color: the note that gives the scale its sound (dorian ♮6, lydian ♯4). alt: an altered tension (♭9 ♯9 ♯11 ♭13). */
  kind: 'color' | 'alt';
  /** "♮6", "♯11", "♭9". */
  label: string;
}

export interface ScaleReading {
  root: number;
  /** "dorian", "altered", "lydian ♭7". */
  mode: string;
  /** "D dorian". */
  name: string;
  /** Pitch classes, ascending from the root. */
  pcs: number[];
  marks: ScaleMark[];
}

interface Shape {
  mode: string;
  ivs: number[];
  marks: [number, ScaleMark['kind'], string][];
}

const S = (mode: string, ivs: number[], marks: Shape['marks'] = []): Shape => ({ mode, ivs, marks });

const IONIAN = S('ionian', [0, 2, 4, 5, 7, 9, 11]);
const LYDIAN = S('lydian', [0, 2, 4, 6, 7, 9, 11], [[6, 'color', '♯4']]);
const DORIAN = S('dorian', [0, 2, 3, 5, 7, 9, 10], [[9, 'color', '♮6']]);
const PHRYGIAN = S('phrygian', [0, 1, 3, 5, 7, 8, 10], [[1, 'color', '♭2']]);
const AEOLIAN = S('aeolian', [0, 2, 3, 5, 7, 8, 10], [[8, 'color', '♭6']]);
const MELODIC = S('melodic minor', [0, 2, 3, 5, 7, 9, 11], [[9, 'color', '♮6'], [11, 'color', '♮7']]);
const MIXOLYDIAN = S('mixolydian', [0, 2, 4, 5, 7, 9, 10]);
const LYDIAN_DOM = S('lydian ♭7', [0, 2, 4, 6, 7, 9, 10], [[6, 'color', '♯11']]);
const ALTERED = S('altered', [0, 1, 3, 4, 6, 8, 10], [[1, 'alt', '♭9'], [3, 'alt', '♯9'], [6, 'alt', '♯11'], [8, 'alt', '♭13']]);
const HALF_WHOLE = S('half-whole', [0, 1, 3, 4, 6, 7, 9, 10], [[1, 'alt', '♭9'], [3, 'alt', '♯9'], [6, 'alt', '♯11']]);
const MIXO_B13 = S('mixolydian ♭13', [0, 2, 4, 5, 7, 8, 10], [[8, 'alt', '♭13']]);
const PHRYG_DOM = S('phrygian dominant', [0, 1, 4, 5, 7, 8, 10], [[1, 'alt', '♭9'], [8, 'alt', '♭13']]);
const LOCRIAN = S('locrian', [0, 1, 3, 5, 6, 8, 10], [[6, 'color', '♭5']]);
const LOCRIAN_N2 = S('locrian ♮2', [0, 2, 3, 5, 6, 8, 10], [[2, 'color', '♮9']]);
const WHOLE_HALF = S('whole-half', [0, 2, 3, 5, 6, 8, 9, 11]);
const WHOLE_TONE = S('whole tone', [0, 2, 4, 6, 8, 10]);

const MAJOR_DEGREE = [0, 2, 4, 5, 7, 9, 11];

/** Which degree (0..6) of the key's parent major a root sits on, or -1. */
function degreeIn(root: number, key: KeyLike): number {
  return MAJOR_DEGREE.indexOf(mod12(root - parentMajor(key)));
}

function pick(root: number, q: string, has: (iv: number) => boolean, key: KeyLike | null): Shape | null {
  const modal = key && (key.mode === 'dorian' || key.mode === 'mixolydian') && key.tonic === root;
  const fam = familyOf(q);
  const deg = key ? degreeIn(root, key) : -1;
  const minorKey = key?.mode === 'minor';
  switch (fam) {
    case 'aug':
      return WHOLE_TONE;
    case 'maj':
      if (has(6)) return LYDIAN;
      // IV of the key is lydian; I is ionian. Off the key, lydian is the jazz default for a major 7th.
      if (key && deg === 3) return LYDIAN;
      if (key && deg === 0) return IONIAN;
      return q === 'maj' && key ? IONIAN : LYDIAN;
    case 'min':
      if (q === 'm6' || q === 'mMaj7') return MELODIC;
      if (modal && key!.mode === 'dorian') return DORIAN;
      if (minorKey && key!.tonic === root) return has(9) ? DORIAN : AEOLIAN;
      if (key && deg === 2) return PHRYGIAN;
      if (key && deg === 5) return AEOLIAN;
      return DORIAN;
    case 'dom':
    case 'sus':
      if (q === 'sus4' || q === '7sus4') return MIXOLYDIAN;
      if (has(1) && has(9)) return HALF_WHOLE; // ♭9 with the natural 13: the diminished sound
      if (has(1) || has(3) || has(8)) {
        // A V⁷ going to a minor tonic, with only ♭9/♭13 sounding, is phrygian dominant; any ♯9 makes it altered.
        if (minorKey && mod12(root - key!.tonic) === 7 && !has(3)) return has(1) ? PHRYG_DOM : MIXO_B13;
        return ALTERED;
      }
      if (has(6)) return LYDIAN_DOM;
      // A dominant a whole step below the tonic (backdoor ♭VII⁷) or a tritone sub is lydian ♭7 by default.
      if (key && !modal && (mod12(root - key.tonic) === 10 || mod12(root - key.tonic) === 1)) return LYDIAN_DOM;
      return MIXOLYDIAN;
    case 'hdim':
      return has(2) ? LOCRIAN_N2 : LOCRIAN;
    case 'dim':
      return q === 'dim7' ? WHOLE_HALF : LOCRIAN;
    default:
      return null;
  }
}

/** The chord-scale for a chord, given which pitch classes sound (pool weights) and the key. */
export function scaleFor(root: number, q: string, pcs: ArrayLike<number>, key: KeyLike | null): ScaleReading | null {
  // Firmly sounding only: a tension still ringing from the last chord shouldn't pick this chord's scale.
  const has = (iv: number) => (pcs[mod12(root + iv)] ?? 0) >= SCALE_PRESENT;
  const s = pick(root, q, has, key);
  if (!s) return null;
  return {
    root,
    mode: s.mode,
    name: `${spell(root, key)} ${s.mode}`,
    pcs: s.ivs.map((iv) => mod12(root + iv)),
    marks: s.marks.map(([iv, kind, label]) => ({ pc: mod12(root + iv), kind, label })),
  };
}

// ---- line reading ----------------------------------------------------------

export type LineKind = 'in' | 'approach';

export interface LineNote {
  note: number;
  t: number;
  kind: LineKind;
  /** This note was closed in on from above and below by the two notes before it. */
  enclosure: boolean;
}

/** Notes further apart than this (s) aren't one line. */
export const LINE_GAP = 0.9;

/**
 * Read one right-hand note against the scale. Inside the scale it just lights;
 * outside it is a chromatic approach (deliberate, not wrong). When the two notes
 * before it sit one on each side within a whole step, and this note is a scale
 * or chord tone, the three make an enclosure of this target.
 */
export function readLineNote(note: number, t: number, prev: readonly LineNote[], scale: ScaleReading | null, chordPcs: readonly number[] = []): LineNote {
  const pc = mod12(note);
  const inside = !scale || scale.pcs.includes(pc) || chordPcs.includes(pc);
  let enclosure = false;
  const n = prev.length;
  if (inside && n >= 2) {
    const a = prev[n - 2], b = prev[n - 1];
    if (t - b.t < LINE_GAP && b.t - a.t < LINE_GAP) {
      const da = a.note - note, db = b.note - note;
      enclosure = da !== 0 && db !== 0 && Math.sign(da) !== Math.sign(db) && Math.abs(da) <= 2 && Math.abs(db) <= 2;
    }
  }
  return { note, t, kind: inside ? 'in' : 'approach', enclosure };
}
