// Voicing analysis: what each sounding note is doing in the chord, and what
// kind of voicing the hand shape is (shell, rootless A/B, upper structure,
// So What, drop 2/3, cluster). Pure; cheap enough to run on every change.
import { QINDEX, TEMPLATES } from './chords';
import { mod12 } from './pitch';

export type VoicingType = 'shell' | 'rootlessA' | 'rootlessB' | 'ust' | 'quartal' | 'soWhat' | 'drop2' | 'drop3' | 'cluster' | 'close' | 'open';
/** root, guide tones (3 and 7, or 6 / sus 4), fifth, tensions (9 11 13), altered tensions, outside the chord. */
export type FnClass = 'root' | 'guide' | 'fifth' | 'tension' | 'alt' | 'outside';

export interface Voice {
  note: number;
  pc: number;
  /** Chord-tone function: "R", "3", "♭7", "9", "♯11", ... */
  fn: string;
  cls: FnClass;
  hand: 'L' | 'R';
}

export interface VoicingReading {
  /** Low to high. */
  voices: Voice[];
  type: VoicingType;
  /** Short name: "rootless A", "UST ♭VI", "drop 2", "shell 1-7-3", "So What". */
  label: string;
  position: 'close' | 'open';
  /** Adjacent gaps in semitones. */
  intervals: number[];
  spread: number;
  /** Index of the first right-hand voice, or null when it reads as one hand. */
  split: number | null;
  rootInferred: boolean;
  /** A small interval low in the bass (below the low-interval limit). */
  muddy: boolean;
}

/** Function and class of interval `i` above the root, given the chord quality template id. */
export function voiceFunction(i: number, q: string): { fn: string; cls: FnClass } {
  const minor = q === 'm7' || q === 'm6' || q === 'mMaj7' || q === 'min' || q === 'm7b5';
  const sus = q === 'sus4' || q === '7sus4';
  const dim = q === 'dim' || q === 'dim7';
  const has3 = !minor && !sus && !dim;
  switch (mod12(i)) {
    case 0:
      return { fn: 'R', cls: 'root' };
    case 1:
      return { fn: '♭9', cls: 'alt' };
    case 2:
      return { fn: '9', cls: 'tension' };
    case 3:
      if (has3 && !sus) return { fn: '♯9', cls: 'alt' };
      return { fn: '♭3', cls: minor || dim ? 'guide' : 'outside' };
    case 4:
      return has3 ? { fn: '3', cls: 'guide' } : { fn: '♮3', cls: 'outside' };
    case 5:
      return sus ? { fn: '4', cls: 'guide' } : { fn: '11', cls: 'tension' };
    case 6:
      if (q === 'm7b5' || q === 'dim' || q === 'dim7') return { fn: '♭5', cls: 'fifth' };
      return { fn: '♯11', cls: 'alt' };
    case 7:
      return { fn: '5', cls: 'fifth' };
    case 8:
      if (q === 'aug') return { fn: '♯5', cls: 'fifth' };
      return { fn: '♭13', cls: 'alt' };
    case 9:
      if (q === '6' || q === 'm6') return { fn: '6', cls: 'guide' };
      if (q === 'dim7') return { fn: '°7', cls: 'guide' };
      return { fn: '13', cls: 'tension' };
    case 10:
      return { fn: '♭7', cls: q === 'maj7' || q === 'mMaj7' ? 'outside' : 'guide' };
    default:
      return { fn: '7', cls: q === 'maj7' || q === 'mMaj7' ? 'guide' : 'outside' };
  }
}

const UST_NAME: Record<number, string> = { 2: 'II', 3: '♭III', 6: '♭V', 8: '♭VI', 9: 'VI' };

const isGuide = (v: Voice, kind: '3' | '7') => (kind === '3' ? v.fn === '3' || v.fn === '♭3' : v.fn === '♭7' || v.fn === '7' || v.fn === '°7' || v.fn === '6');

/**
 * Read a voicing. `notes` are sounding MIDI notes (any order, duplicates ok);
 * `root` and `q` come from the chord reading (q is the template id: "7", "m7", "maj7"...).
 */
export function analyzeVoicing(notes: readonly number[], root: number, q: string): VoicingReading | null {
  const sorted = [...new Set(notes)].sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i] - sorted[i - 1]);
  const spread = sorted[sorted.length - 1] - sorted[0];

  // Hand split: the biggest gap, if it is over an octave (or the voicing spans two octaves).
  let split: number | null = null;
  let maxGap = 0;
  let maxAt = -1;
  intervals.forEach((g, i) => {
    if (g > maxGap) {
      maxGap = g;
      maxAt = i + 1;
    }
  });
  if (maxGap > 12 || (spread > 24 && maxAt > 0)) split = maxAt;

  const voices: Voice[] = sorted.map((note, i) => {
    const f = voiceFunction(note - root, q);
    return { note, pc: mod12(note), fn: f.fn, cls: f.cls, hand: split !== null && i >= split ? 'R' : 'L' };
  });
  const rootInferred = !voices.some((v) => v.cls === 'root');
  let muddy = false;
  for (let i = 0; i < intervals.length; i++) if (intervals[i] < 5 && sorted[i] < 48) muddy = true;

  const base = { voices, intervals, spread, split, rootInferred, muddy, position: (spread <= 12 ? 'close' : 'open') as 'close' | 'open' };
  const out = (type: VoicingType, label: string): VoicingReading => ({ ...base, type, label });

  // 1. Upper-structure triad: a major/minor triad in the right hand over 3 and 7 in the left.
  if (split !== null && (q === '7' || q === '7sus4')) {
    const lh = voices.slice(0, split);
    const rh = sorted.slice(split);
    if (rh.length === 3 && lh.some((v) => isGuide(v, '3')) && lh.some((v) => isGuide(v, '7'))) {
      const tri = triadRoot(rh);
      if (tri) {
        const rel = mod12(tri.root - root);
        const name = UST_NAME[rel];
        if (name) return out('ust', `UST ${tri.minor ? name.toLowerCase() : name}`);
      }
    }
  }

  // Classify the left hand alone when it carries 3+ notes, else the whole voicing.
  const part = split !== null && split >= 3 ? voices.slice(0, split) : voices;
  const pn = part.map((v) => v.note);
  const pint: number[] = [];
  for (let i = 1; i < pn.length; i++) pint.push(pn[i] - pn[i - 1]);
  const pspread = pn[pn.length - 1] - pn[0];

  // 2. So What / quartal.
  if (pint.length === 4 && pint.join() === '5,5,5,4') return out('soWhat', 'So What');
  if (pn.length >= 3 && pint.every((g) => g === 5 || g === 6) && pint.filter((g) => g === 5).length >= 2) return out('quartal', 'quartal');

  // 3. Shell: root at the bottom, then 3 and 7.
  if (part.length === 3 && part[0].cls === 'root' && part.some((v) => isGuide(v, '3')) && part.some((v) => isGuide(v, '7'))) {
    return out('shell', isGuide(part[1], '3') ? 'shell 1-3-7' : 'shell 1-7-3');
  }

  // 4. Rootless A / B (Bill Evans): no root, 3 and 7 present, within an octave.
  if ((part.length === 3 || part.length === 4) && !part.some((v) => v.cls === 'root') && part.some((v) => isGuide(v, '3')) && part.some((v) => isGuide(v, '7')) && pspread <= 12) {
    if (isGuide(part[0], '3')) return out('rootlessA', 'rootless A');
    if (isGuide(part[0], '7')) return out('rootlessB', 'rootless B');
  }

  // 5. Drop 2 / drop 3: raise the lowest voice an octave; if that's close position, which voice was dropped?
  if (pn.length === 4 && new Set(pn.map(mod12)).size === 4 && pspread > 12) {
    const raised = [...pn.slice(1), pn[0] + 12].sort((a, b) => a - b);
    if (raised[3] - raised[0] < 12) {
      const at = raised.indexOf(pn[0] + 12);
      if (at === 2) return out('drop2', 'drop 2');
      if (at === 1) return out('drop3', 'drop 3');
    }
  }

  // 6. Cluster: 3+ notes all within a whole step of each other, at least one half step.
  if (pn.length >= 3 && pint.every((g) => g <= 2) && pint.includes(1)) return out('cluster', 'cluster');

  return spread <= 12 ? out('close', 'close') : out('open', 'open');
}

/** Root of a major or minor triad in any inversion, or null. */
function triadRoot(notes: number[]): { root: number; minor: boolean } | null {
  const pcs = [...new Set(notes.map(mod12))];
  if (pcs.length !== 3) return null;
  for (const r of pcs) {
    const rel = pcs.map((p) => mod12(p - r)).sort((a, b) => a - b).join();
    if (rel === '0,4,7') return { root: r, minor: false };
    if (rel === '0,3,7') return { root: r, minor: true };
  }
  return null;
}

/** One pairing between an old and a new voice; either side may be missing (a voice entering or leaving). */
export interface VoiceMove {
  from: number | null;
  to: number | null;
}

/**
 * Pair voices across a chord change by least total motion: in order when the
 * counts match, otherwise greedily nearest-first. Notes are MIDI numbers.
 */
export function voiceLeading(prev: readonly number[], next: readonly number[]): VoiceMove[] {
  const a = [...prev].sort((x, y) => x - y);
  const b = [...next].sort((x, y) => x - y);
  if (a.length === b.length) return a.map((from, i) => ({ from, to: b[i] }));
  const pairs: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) pairs.push({ i, j, d: Math.abs(a[i] - b[j]) });
  pairs.sort((p, q) => p.d - q.d);
  const ua = new Set<number>();
  const ub = new Set<number>();
  const moves: VoiceMove[] = [];
  for (const p of pairs) {
    if (ua.has(p.i) || ub.has(p.j)) continue;
    ua.add(p.i);
    ub.add(p.j);
    moves.push({ from: a[p.i], to: b[p.j] });
  }
  for (let i = 0; i < a.length; i++) if (!ua.has(i)) moves.push({ from: a[i], to: null });
  for (let j = 0; j < b.length; j++) if (!ub.has(j)) moves.push({ from: null, to: b[j] });
  return moves;
}

/** Pitch classes of a chord's frame: root, guide tones, fifth (no extensions). */
export function chordTones(root: number, q: string): number[] {
  const t = TEMPLATES[QINDEX[q] ?? -1];
  if (!t) return [mod12(root)];
  const out: number[] = [];
  for (let i = 0; i < 12; i++) if (t.roles[i] >= 1 && t.roles[i] <= 3) out.push(mod12(root + i));
  return out;
}

/**
 * Where one voice would go in the next chord: the nearest of its chord tones
 * within a whole step, in semitones (0 = a common tone stays). Steps of a half
 * step beat whole steps; null when nothing is that close.
 */
export function resolveVoice(note: number, tones: readonly number[]): number | null {
  let best: number | null = null;
  for (const d of [0, -1, 1, -2, 2]) {
    if (tones.includes(mod12(note + d))) {
      best = d;
      break;
    }
  }
  return best;
}

export interface Tendency {
  /** Pitch class that leans. */
  from: number;
  /** Pitch class it leans toward. */
  to: number;
  /** Signed semitones (±1 or ±2). */
  d: number;
  cls: FnClass;
}

/**
 * Tendency tones: each sounding guide tone, tension or alteration that would
 * move by step into a chord tone of the predicted chord (in G13 → CΔ7 the F
 * leans down to E and the B up to C). Common tones and roots/fifths are left out.
 */
export function tendencies(voices: readonly { pc: number; cls: FnClass }[], root: number, q: string): Tendency[] {
  const tones = chordTones(root, q);
  const out: Tendency[] = [];
  for (const v of voices) {
    if (v.cls !== 'guide' && v.cls !== 'tension' && v.cls !== 'alt') continue;
    if (out.some((x) => x.from === v.pc)) continue;
    if (tones.includes(v.pc)) continue; // a common tone stays put
    const d = resolveVoice(v.pc, tones);
    if (d === null || d === 0) continue;
    out.push({ from: v.pc, to: mod12(v.pc + d), d, cls: v.cls });
  }
  return out;
}
