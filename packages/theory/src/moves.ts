// The move library: small, key-free chord moves written as roman numerals.
// Pure data plus the parser for the numeral shorthand. Matching lives in match.ts.
//
// A move is one line:
//
//   mv('pop.axis', 'I V vi IV', { name: 'Axis', kind: 'loop', styles: ['pop', 'rock'] })
//
// Numerals are relative to the move's own tonic, which the matcher works out
// from the chords, so every move works in every key.
//
//   Case        I = major, i = minor. A bare numeral is loose: V accepts G and G7,
//               ii accepts D– and D–7.
//   7           strict where the 7th carries the meaning: V7 / ♭VII7 / ♭II7 need
//               the dominant 7th (a plain triad feeds the rock or modal reading).
//               ii7 asks for a minor 7th (a triad still counts, a little less).
//   Δ ø ° + sus major 7th (or 6), half-diminished, diminished, augmented, sus.
//   ♭ ♯         chromatic degrees: ♭VII, ♯iv°.
//   ( )         an optional chord the move can do without: (iv7) ♭VII7 I.
//
// A loop keeps predicting its next chord and matches from any starting chord.
// A cadence predicts its arrival, then lets go.

import { MINE_SPECS } from './mine';

export type Style = 'jazz' | 'pop' | 'rock' | 'gospel' | 'blues' | 'folk' | 'latin' | 'film' | 'modal' | 'classical' | 'mine';

export const STYLES: readonly Style[] = ['jazz', 'pop', 'rock', 'gospel', 'blues', 'folk', 'latin', 'film', 'modal', 'classical'];

/** How strictly a step matches a chord's quality. */
export type StepClass = 'M' | 'm' | 'D' | 'm7' | 'Δ' | 'mΔ' | 'ø' | '°' | '+' | 'sus';

export interface MoveStep {
  /** Semitones above the move's tonic. */
  deg: number;
  cls: StepClass;
  opt: boolean;
  /** The numeral as written ("♭VII7"). */
  text: string;
}

export type MoveKind = 'cadence' | 'loop';

export interface Move {
  id: string;
  name: string;
  kind: MoveKind;
  styles: Style[];
  steps: MoveStep[];
  /** The numerals as written, for display: "I V vi IV". */
  roman: string;
  /** 1 must-have, 2 next, 3 later. Lower tiers weigh a little less. */
  tier: 1 | 2 | 3;
  /**
   * Loops only: another name when home is elsewhere in the loop, as [semitones
   * above the move's tonic, name]. Used when the key's tonic sits there, or the
   * loop was entered on that chord (the Axis entered from vi is the minor epic).
   */
  alias?: [number, string][];
}

interface MoveOpts {
  name: string;
  kind: MoveKind;
  styles: Style[];
  tier?: 1 | 2 | 3;
  alias?: [number, string][];
}

const NUMERALS: [string, number][] = [
  ['VII', 11],
  ['VI', 9],
  ['IV', 5],
  ['V', 7],
  ['III', 4],
  ['II', 2],
  ['I', 0],
];

/** Parse one numeral: "(iv7)", "♭VII7", "♯iv°", "IΔ", "iiø", "Vsus". */
export function parseStep(tok: string): MoveStep {
  let s = tok.trim();
  let opt = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    opt = true;
    s = s.slice(1, -1);
  }
  const text = s;
  let acc = 0;
  if (s[0] === '♭' || s[0] === 'b') {
    acc = -1;
    s = s.slice(1);
  } else if (s[0] === '♯' || s[0] === '#') {
    acc = 1;
    s = s.slice(1);
  }
  const upper = s.toUpperCase();
  const hit = NUMERALS.find(([n]) => upper.startsWith(n));
  if (!hit) throw new Error(`bad numeral "${tok}"`);
  const [num, base] = hit;
  const written = s.slice(0, num.length);
  const minor = written === written.toLowerCase();
  if (!minor && written !== num) throw new Error(`mixed-case numeral "${tok}"`);
  const suf = s.slice(num.length);
  let cls: StepClass;
  switch (suf) {
    case '':
    case '6':
      cls = minor ? 'm' : suf === '6' ? 'Δ' : 'M';
      break;
    case '7':
      cls = minor ? 'm7' : 'D';
      break;
    case 'Δ':
    case 'Δ7':
      cls = minor ? 'mΔ' : 'Δ';
      break;
    case 'ø':
    case 'ø7':
      cls = 'ø';
      break;
    case '°':
    case '°7':
      cls = '°';
      break;
    case '+':
      cls = '+';
      break;
    case 'sus':
    case '7sus':
      cls = 'sus';
      break;
    default:
      throw new Error(`bad suffix "${suf}" in "${tok}"`);
  }
  return { deg: (((base + acc) % 12) + 12) % 12, cls, opt, text };
}

export function mv(id: string, roman: string, o: MoveOpts): Move {
  const steps = roman.split(/\s+/).filter(Boolean).map(parseStep);
  return { id, name: o.name, kind: o.kind, styles: o.styles, steps, roman: roman.replace(/[()]/g, ''), tier: o.tier ?? 1, alias: o.alias };
}

/**
 * How well a played chord quality fills a step class, 0..1 (0 = not at all).
 * Loose classes take triads and 7ths alike; strict ones want what defines the move.
 */
export function classFit(cls: StepClass, q: string): number {
  switch (cls) {
    case 'M':
      return q === 'maj' || q === 'maj7' || q === '6' ? 1 : q === '7' ? 0.85 : q === 'sus4' || q === '7sus4' ? 0.6 : 0;
    case 'm':
      return q === 'min' || q === 'm7' || q === 'm6' ? 1 : q === 'mMaj7' ? 0.9 : q === 'm7b5' ? 0.5 : 0;
    case 'D':
      return q === '7' ? 1 : q === '7sus4' ? 0.85 : 0;
    case 'm7':
      return q === 'm7' ? 1 : q === 'min' ? 0.85 : q === 'm6' ? 0.7 : q === 'm7b5' ? 0.5 : 0;
    case 'Δ':
      return q === 'maj7' || q === '6' ? 1 : q === 'maj' ? 0.8 : 0;
    case 'mΔ':
      return q === 'mMaj7' ? 1 : q === 'm6' ? 0.7 : 0;
    case 'ø':
      return q === 'm7b5' ? 1 : q === 'dim7' ? 0.6 : q === 'dim' ? 0.7 : q === 'm7' ? 0.5 : 0;
    case '°':
      return q === 'dim7' || q === 'dim' ? 1 : q === 'm7b5' ? 0.5 : 0;
    case '+':
      return q === 'aug' ? 1 : 0;
    case 'sus':
      return q === '7sus4' || q === 'sus4' ? 1 : q === '7' ? 0.4 : 0;
  }
}

/** The quality to predict for a step: what the class means, as a triad in a triad session. */
export function classQuality(cls: StepClass, triads: boolean, dominant: boolean): string {
  switch (cls) {
    case 'M':
      return triads ? 'maj' : dominant ? '7' : 'maj7';
    case 'm':
      return triads ? 'min' : 'm7';
    case 'D':
      return '7';
    case 'm7':
      return 'm7';
    case 'Δ':
      return triads ? 'maj' : 'maj7';
    case 'mΔ':
      return 'mMaj7';
    case 'ø':
      return 'm7b5';
    case '°':
      return 'dim7';
    case '+':
      return 'aug';
    case 'sus':
      return '7sus4';
  }
}

// ---- the library -------------------------------------------------------------

const J: Style[] = ['jazz'];

export const LIBRARY: Move[] = [
  // Jazz
  mv('jazz.ii-V-I', 'ii V7 I', { name: 'ii–V–I', kind: 'cadence', styles: ['jazz', 'pop', 'classical'] }),
  mv('jazz.minor-ii-V-i', 'iiø V7 i', { name: 'minor ii–V–i', kind: 'cadence', styles: J }),
  mv('jazz.ii-subV-I', 'ii7 ♭II7 I', { name: 'ii–♭II7–I', kind: 'cadence', styles: J }),
  mv('jazz.tritone-sub', '♭II7 I', { name: 'tritone sub', kind: 'cadence', styles: J }),
  mv('jazz.backdoor', '(iv7) ♭VII7 I', { name: 'backdoor', kind: 'cadence', styles: ['jazz', 'gospel'] }),
  mv('jazz.I-vi-ii-V', 'I vi ii V7', { name: 'I–vi–ii–V', kind: 'loop', styles: J }),
  mv('jazz.I-VI7-ii-V', 'I VI7 ii V7', { name: 'I–VI7–ii–V', kind: 'loop', styles: ['jazz', 'gospel'] }),
  mv('jazz.iii-VI-ii-V', 'iii7 VI7 ii7 V7', { name: 'iii–VI–ii–V', kind: 'loop', styles: J }),
  mv('jazz.extended-dominants', 'III7 VI7 II7 V7 I', { name: 'extended dominants', kind: 'cadence', styles: ['jazz', 'folk'] }),
  mv('jazz.circle', 'vi ii V I IV viiø III7', { name: 'diatonic circle', kind: 'loop', styles: ['jazz', 'pop'] }),
  mv('jazz.minor-turnaround', 'i ♭VI iiø V7', { name: 'minor turnaround', kind: 'loop', styles: J, tier: 2 }),
  mv('jazz.descending-ii-Vs', 'iii7 VI7 ♭iii7 ♭VI7 ii7 V7 I', { name: 'descending ii–Vs', kind: 'cadence', styles: J, tier: 2 }),
  mv('jazz.ii-Vs-down-a-step', 'ii7 V7 IΔ i7 IV7 ♭VIIΔ', { name: 'ii–Vs down a step', kind: 'cadence', styles: J, tier: 2 }),
  mv('jazz.passing-sharp-i', 'I ♯i° ii', { name: 'passing ♯i°', kind: 'cadence', styles: ['jazz', 'gospel'], tier: 2 }),
  mv('jazz.dameron', 'IΔ ♭III7 ♭VI7 ♭II7', { name: 'Tadd Dameron turnaround', kind: 'loop', styles: J, tier: 3 }),
  mv('jazz.coltrane', 'IΔ ♭III7 ♭VIΔ VII7 IIIΔ V7', { name: 'Coltrane changes', kind: 'loop', styles: J, tier: 3 }),
  mv('jazz.bossa-flat-II', 'ii7 V7 ♭IIΔ', { name: 'deceptive ♭IIΔ', kind: 'cadence', styles: ['jazz', 'latin'], tier: 3 }),

  // Pop
  // The same loop entered from vi, or heard in the minor key, is the "minor epic" i–♭VI–♭III–♭VII.
  mv('pop.axis', 'I V vi IV', { name: 'Axis', kind: 'loop', styles: ['pop', 'rock'], alias: [[9, 'minor epic']] }),
  mv('pop.doo-wop', 'I vi IV V', { name: 'doo-wop', kind: 'loop', styles: ['pop', 'folk'] }),
  mv('pop.IV-iv-I', 'IV iv I', { name: 'IV–iv–I', kind: 'cadence', styles: ['pop', 'gospel', 'jazz'] }),
  mv('pop.mario', '♭VI ♭VII I', { name: '♭VI–♭VII–I', kind: 'cadence', styles: ['pop', 'rock', 'film'] }),
  mv('pop.creep', 'I III IV iv', { name: 'Creep', kind: 'loop', styles: ['pop', 'rock'], tier: 2 }),
  mv('pop.pachelbel', 'I V vi iii IV I IV V', { name: 'Pachelbel', kind: 'loop', styles: ['pop', 'classical'], tier: 2 }),
  mv('pop.royal-road', 'IVΔ V7 iii vi', { name: 'royal road', kind: 'loop', styles: ['pop'], tier: 2 }),
  mv('pop.two-of-us', 'IVΔ III7 vi7 v7 I7', { name: 'Just the Two of Us', kind: 'loop', styles: ['pop', 'gospel'], tier: 2 }),
  mv('pop.I-IV-vi-V', 'I IV vi V', { name: 'I–IV–vi–V', kind: 'loop', styles: ['pop'], tier: 2 }),
  mv('pop.I-iii-IV-V', 'I iii IV V', { name: 'I–iii–IV–V', kind: 'loop', styles: ['pop', 'folk'], tier: 3 }),

  // Rock
  mv('rock.I-IV-V-IV', 'I IV V IV', { name: 'I–IV–V–IV', kind: 'loop', styles: ['rock', 'latin'] }),
  // Heard from the IV as home it is I–V–IV (C G F in C is the double plagal of G).
  mv('rock.double-plagal', 'I ♭VII IV', { name: 'double plagal', kind: 'loop', styles: ['rock', 'blues'], alias: [[5, 'I–V–IV']] }),
  // Heard from the ♭VII as home it is the lydian I–II.
  mv('rock.I-bVII', 'I ♭VII', { name: 'I–♭VII vamp', kind: 'loop', styles: ['rock', 'folk', 'modal', 'film'], alias: [[10, 'lydian I–II']] }),
  mv('rock.aeolian', 'i ♭VII ♭VI ♭VII', { name: 'aeolian vamp', kind: 'loop', styles: ['rock', 'pop'] }),
  mv('rock.I-IV', 'I IV', { name: 'I–IV pendulum', kind: 'loop', styles: ['rock', 'gospel', 'folk'] }),
  mv('rock.hey-joe', '♭VI ♭III ♭VII IV I', { name: 'Hey Joe', kind: 'loop', styles: ['rock'], tier: 2 }),
  mv('rock.i-bIII-IV', 'i ♭III IV', { name: 'i–♭III–IV riff', kind: 'loop', styles: ['rock'], tier: 2 }),
  mv('rock.phrygian', 'i ♭II', { name: 'phrygian vamp', kind: 'loop', styles: ['rock', 'modal'], tier: 3 }),

  // Gospel, R&B, neo-soul
  mv('gospel.soul-dominant', 'Vsus I', { name: 'soul dominant', kind: 'cadence', styles: ['gospel', 'pop'] }),
  mv('gospel.amen', 'IV I', { name: 'plagal (amen)', kind: 'cadence', styles: ['gospel', 'classical', 'rock'] }),
  mv('gospel.minor-plagal', 'iv I', { name: 'minor plagal', kind: 'cadence', styles: ['gospel', 'pop', 'jazz'] }),
  mv('gospel.walk-up', 'I I7 IV ♯iv° I VI7 ii V7', { name: 'gospel walk-up', kind: 'loop', styles: ['gospel'] }),
  mv('gospel.vi-II7-V-I', 'vi7 II7 V7 I', { name: 'vi–II7–V–I', kind: 'cadence', styles: ['gospel', 'jazz'], tier: 2 }),
  mv('gospel.I-vi', 'IΔ vi7', { name: 'I–vi pendulum', kind: 'loop', styles: ['gospel', 'pop'], tier: 2 }),
  mv('gospel.descent', 'IVΔ iii ii IΔ', { name: 'IV–iii–ii–I descent', kind: 'cadence', styles: ['gospel', 'pop'], tier: 2 }),
  mv('gospel.sharp-iv-passing', 'IV ♯iv° I', { name: '♯iv° passing', kind: 'cadence', styles: ['gospel', 'jazz', 'blues'], tier: 2 }),
  mv('gospel.back-cycle', 'VII7 III7 VI7 II7 V7 I', { name: 'back-cycling', kind: 'cadence', styles: ['gospel', 'jazz'], tier: 3 }),

  // Blues (as chord changes: repeated bars are one chord)
  mv('blues.12-bar', 'I7 IV7 I7 V IV7 I7 V', { name: '12-bar blues', kind: 'loop', styles: ['blues', 'rock'] }),
  mv('blues.12-bar-quick', 'I7 IV7 I7 IV7 I7 V IV7 I7 V', { name: '12-bar, quick change', kind: 'loop', styles: ['blues'] }),
  mv('blues.jazz', 'I7 IV7 I7 v7 I7 IV7 ♯iv° I7 VI7 ii7 V7', { name: 'jazz blues', kind: 'loop', styles: ['blues', 'jazz'] }),
  mv('blues.minor', 'i iv i ♭VI7 V7 i V7', { name: 'minor blues', kind: 'loop', styles: ['blues', 'jazz'] }),
  mv('blues.I7-IV7', 'I7 IV7', { name: 'blues I7–IV7', kind: 'loop', styles: ['blues', 'gospel'] }),
  mv('blues.bVI7-V7', 'I ♭VI7 V7', { name: '♭VI7–V7 turnaround', kind: 'cadence', styles: ['blues', 'jazz'] }),
  mv('blues.V-IV-I', 'V IV I', { name: 'V–IV–I', kind: 'cadence', styles: ['blues', 'rock'] }),
  mv('blues.8-bar', 'I V IV I V I V', { name: '8-bar blues', kind: 'loop', styles: ['blues'], tier: 2 }),

  // Folk, country
  mv('folk.I-IV-I-V', 'I IV I V', { name: 'I–IV–I–V', kind: 'loop', styles: ['folk', 'blues', 'pop'] }),
  mv('folk.I-V7', 'I V7', { name: 'I–V7 vamp', kind: 'loop', styles: ['folk', 'latin'] }),
  mv('folk.ragtime', 'I VI7 II7 V7 I', { name: 'ragtime', kind: 'cadence', styles: ['folk', 'jazz'], tier: 2 }),
  mv('folk.II7-V7', 'I II7 V7 I', { name: 'II7–V7–I', kind: 'cadence', styles: ['folk', 'jazz'], tier: 2 }),
  mv('folk.i-bVII', 'i ♭VII', { name: 'i–♭VII vamp', kind: 'loop', styles: ['folk', 'rock', 'modal'], tier: 2 }),

  // Latin, bossa
  mv('latin.ipanema', 'IΔ II7 ii7 ♭II7', { name: 'Ipanema', kind: 'loop', styles: ['latin', 'jazz'] }),
  mv('latin.andalusian', 'i ♭VII ♭VI V', { name: 'Andalusian', kind: 'loop', styles: ['latin', 'pop', 'rock'] }),
  mv('latin.bolero', 'i iv V7 i', { name: 'minor cadence', kind: 'cadence', styles: ['latin', 'classical'], tier: 2 }),
  mv('latin.tango', 'i V7', { name: 'i–V7 vamp', kind: 'loop', styles: ['latin', 'folk'], tier: 2 }),
  mv('latin.phrygian-dominant', 'I ♭II', { name: 'phrygian dominant', kind: 'loop', styles: ['latin', 'film'], tier: 2 }),

  // Film
  mv('film.mediant-bVI', 'I ♭VI', { name: 'mediant ♭VI', kind: 'loop', styles: ['film'], tier: 2, alias: [[8, 'mediant III']] }),
  mv('film.mediant-bIII', 'I ♭III', { name: 'mediant ♭III', kind: 'loop', styles: ['film', 'rock'], tier: 2 }),
  mv('film.zimmer', 'i v ♭VII IV', { name: 'i–v–♭VII–IV', kind: 'loop', styles: ['film'], tier: 2 }),
  mv('film.i-bVI', 'i ♭VI', { name: 'i–♭VI pendulum', kind: 'loop', styles: ['film', 'pop'], tier: 2 }),
  mv('film.hexatonic', 'I ♭vi', { name: 'hexatonic pole', kind: 'loop', styles: ['film'], tier: 3 }),
  mv('film.I-i', 'I i', { name: 'major–minor shift', kind: 'loop', styles: ['film'], tier: 3 }),

  // Modal, EDM
  // In the key a whole step down it is a ii–V vamp (D–7 G7 in C).
  mv('modal.dorian', 'i7 IV7', { name: 'dorian vamp', kind: 'loop', styles: ['modal', 'jazz', 'latin'], alias: [[10, 'ii–V vamp']] }),
  mv('modal.aeolian', '♭VI ♭VII i', { name: 'aeolian ♭VI–♭VII–i', kind: 'loop', styles: ['modal', 'rock', 'pop'] }),
  mv('modal.dorian-i-ii', 'i ii', { name: 'dorian i–ii', kind: 'loop', styles: ['modal'], tier: 2 }),
  mv('modal.so-what', 'i7 ♯i7', { name: 'side-slip', kind: 'loop', styles: ['modal', 'jazz'], tier: 2 }),
  mv('modal.mixolydian-I-v', 'I v', { name: 'mixolydian I–v', kind: 'loop', styles: ['modal', 'rock'], tier: 3 }),

  // Classical
  mv('classical.authentic', 'IV V I', { name: 'authentic cadence', kind: 'cadence', styles: ['classical', 'pop', 'folk'] }),
  mv('classical.half', 'I IV V', { name: 'half cadence', kind: 'cadence', styles: ['classical', 'pop'] }),
  mv('classical.deceptive', 'V vi', { name: 'deceptive', kind: 'cadence', styles: ['classical', 'pop', 'jazz'] }),
  mv('classical.phrygian-half', 'iv V', { name: 'phrygian half cadence', kind: 'cadence', styles: ['classical', 'latin'], tier: 2 }),
  mv('classical.neapolitan', '♭II V i', { name: 'Neapolitan', kind: 'cadence', styles: ['classical'], tier: 2 }),
  mv('classical.monte', 'I7 IV II7 V', { name: 'Monte', kind: 'cadence', styles: ['classical'], tier: 3 }),
  mv('classical.fonte', 'VI7 ii V7 I', { name: 'Fonte', kind: 'cadence', styles: ['classical', 'jazz'], tier: 3 }),
  mv('classical.picardy', 'iv V7 I', { name: 'Picardy third', kind: 'cadence', styles: ['classical'], tier: 3 }),
];

/** Moves the player named themselves (see scripts/learn-moves.ts and mine.ts); they join the library as "mine". */
export const MINE: Move[] = MINE_SPECS.map(([roman, name, kind], i) => mv(`mine.${i + 1}`, roman, { name, kind, styles: ['mine'] }));

export const ALL_MOVES: Move[] = [...LIBRARY, ...MINE];

export const moveById = (id: string): Move | undefined => ALL_MOVES.find((m) => m.id === id);

/** The steps of a move as a key-free signature: degrees and classes (rotation-normalized for loops). */
export function signature(m: Move): string {
  const req = m.steps.filter((s) => !s.opt);
  const enc = (steps: MoveStep[]) => {
    const t0 = steps[0].deg;
    return steps.map((s) => `${(((s.deg - t0) % 12) + 12) % 12}${s.cls}`).join(' ');
  };
  if (m.kind === 'cadence') return `c:${enc(req)}`;
  const rots = req.map((_, i) => enc([...req.slice(i), ...req.slice(0, i)]));
  return `l:${rots.sort()[0]}`;
}

/**
 * Library sanity: unique ids, no two moves with the same signature, and no loop
 * that is just a shorter loop played twice. Returns the problems found (empty = fine).
 */
export function validateLibrary(moves: readonly Move[] = ALL_MOVES): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  const sigs = new Map<string, string>();
  for (const m of moves) {
    if (ids.has(m.id)) out.push(`duplicate id ${m.id}`);
    ids.add(m.id);
    const req = m.steps.filter((s) => !s.opt);
    if (req.length < 2) out.push(`${m.id}: needs at least two required chords`);
    if (m.kind === 'loop' && m.steps.some((s) => s.opt)) out.push(`${m.id}: loops can't have optional chords`);
    const sig = signature(m);
    const other = sigs.get(sig);
    if (other) out.push(`${m.id} duplicates ${other}`);
    sigs.set(sig, m.id);
    if (m.kind === 'loop') {
      const n = req.length;
      for (let p = 1; p < n; p++) {
        if (n % p) continue;
        if (req.every((s, i) => s.deg === req[i % p].deg && s.cls === req[i % p].cls)) out.push(`${m.id} is a ${p}-chord loop repeated`);
      }
    }
    for (let i = 1; i < req.length; i++) {
      const a = req[i - 1], b = req[i];
      if (a.deg === b.deg && a.cls === b.cls) out.push(`${m.id}: the same chord twice in a row can't be heard as two`);
    }
    if (m.kind === 'loop' && req.length > 1 && req[0].deg === req[req.length - 1].deg && req[0].cls === req[req.length - 1].cls)
      out.push(`${m.id}: loop starts and ends on the same chord`);
  }
  return out;
}
