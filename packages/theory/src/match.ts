// Matching recent chords against the move library. Pure, no deps.
//
// On each chord, every move is lined up so that its step `pos` falls on the
// newest chord; that fixes the move's tonic. The walk then runs backwards
// through the history: a chord fills the step before it, an optional step is
// skipped, or a small detour is absorbed (a passing diminished, a chromatic
// approach, an inserted ii or secondary dominant, a tritone sub in place of a
// dominant). A cadence must reach its first step inside the history; a loop
// runs back as far as it keeps fitting, from any starting chord.
import { familyOf, isDom } from './chords';
import { type Move, type MoveStep, ALL_MOVES, classFit } from './moves';
import { mod12, type KeyLike } from './pitch';

export interface Chord {
  root: number;
  q: string;
}

export interface Detour {
  /** History index of the absorbed chord. */
  at: number;
  why: 'passing °' | 'approach' | 'ii–V' | 'secondary V' | 'tritone sub';
}

export interface Match {
  move: Move;
  tonic: number;
  /** History index of the first chord of the match (the newest is always the last chord). */
  start: number;
  /** Step index the newest chord fills. */
  pos: number;
  /** Steps filled by played chords. */
  filled: number;
  /** Loops: steps filled / loop length. */
  laps: number;
  /** A cadence whose last step just sounded. */
  complete: boolean;
  /** Average fit of the filled steps, 0..1. */
  fit: number;
  detours: Detour[];
  /** Loops: the quality last played on each step (for predicting it again). */
  seen: (string | null)[];
  /** The name to show (an alias when home sits elsewhere in a loop). */
  name: string;
  /** Semitones from the move's tonic to the home that name implies (0 unless an alias). */
  home: number;
  /** 0..1: how strongly the history supports this match. */
  strength: number;
}

/** Longest stretch of history the matcher looks at. */
export const MATCH_WINDOW = 16;
const MAX_DETOURS = 2;
const DETOUR_COST = 0.25;

/** How a played chord fills a step in a given tonic (0 = not at all). */
function fill(step: MoveStep, c: Chord, tonic: number): number {
  if (mod12(c.root - tonic) !== step.deg) return 0;
  return classFit(step.cls, c.q);
}

/**
 * A dominant step a tritone sub can stand in for (V7, a loose V, II7, VI7 ...).
 * Not a step that is itself a sub (♭II7, ♭V7): its tritone sub is the plain V.
 */
const subbable = (step: MoveStep) => step.deg !== 1 && step.deg !== 6 && (step.cls === 'D' || (step.cls === 'M' && (step.deg === 7 || step.deg === 2)));

/** A chord that only leads into the next one and can be absorbed by any move. */
function detourInto(c: Chord, next: Chord): Detour['why'] | null {
  const up = mod12(next.root - c.root);
  const fam = familyOf(c.q);
  if (fam === 'dim' && (c.q === 'dim7' ? mod12(up - 1) % 3 === 0 : up === 1)) return 'passing °';
  if (isDom(c.q) && up === 11 && isDom(next.q)) return 'approach';
  if (fam !== 'other' && fam === familyOf(next.q) && (up === 1 || up === 11)) return 'approach';
  if ((c.q === 'm7' || c.q === 'm7b5' || c.q === 'min') && isDom(next.q) && (up === 5 || up === 11)) return 'ii–V';
  if (isDom(c.q) && up === 5) return 'secondary V';
  return null;
}

interface Walk {
  filled: number;
  fitSum: number;
  start: number;
  /** Cadence: reached the first step. */
  done: boolean;
  detours: Detour[];
  seen: Map<number, string>;
}

/**
 * Walk back from history index h (the chord that should fill step s) for a
 * move with a fixed tonic. Returns the best way to explain the chords, or
 * null when a cadence can't be completed back to its first step.
 */
function walkBack(H: readonly Chord[], h: number, s: number, tonic: number, move: Move, lo: number, budget: number, depth: number): Walk | null {
  const n = move.steps.length;
  const loop = move.kind === 'loop';
  if (!loop && s < 0) return { filled: 0, fitSum: 0, start: h + 1, done: true, detours: [], seen: new Map() };
  if (h < lo) {
    if (loop) return { filled: 0, fitSum: 0, start: h + 1, done: false, detours: [], seen: new Map() };
    // a cadence may still finish if only optional steps remain
    for (let k = s; k >= 0; k--) if (!move.steps[k].opt) return null;
    return { filled: 0, fitSum: 0, start: h + 1, done: true, detours: [], seen: new Map() };
  }
  // loops: don't wrap past one full window
  if (loop && depth >= MATCH_WINDOW) return { filled: 0, fitSum: 0, start: h + 1, done: false, detours: [], seen: new Map() };
  const step = move.steps[loop ? mod12n(s, n) : s];
  const c = H[h];
  let best: Walk | null = null;
  const better = (w: Walk | null) => {
    if (!w) return;
    if (!best) best = w;
    else if (w.done !== best.done ? w.done : w.filled !== best.filled ? w.filled > best.filled : w.fitSum - w.detours.length * DETOUR_COST > best.fitSum - best.detours.length * DETOUR_COST) best = w;
  };

  // The chord fills this step.
  // An optional chord counts a little less: D–7 G7 is more likely ii–V in C than the backdoor of A.
  let f = fill(step, c, tonic) * (step.opt ? 0.85 : 1);
  let sub = false;
  // A tritone sub fills a dominant step (D♭7 for G7).
  if (!f && subbable(step) && isDom(c.q) && mod12(c.root - tonic) === mod12(step.deg + 6) && budget > 0) {
    f = 0.75;
    sub = true;
  }
  if (f > 0) {
    const w = walkBack(H, h - 1, s - 1, tonic, move, lo, sub ? budget - 1 : budget, depth + 1);
    if (w) {
      const seen = new Map(w.seen);
      const si = loop ? mod12n(s, n) : s;
      seen.set(si, c.q);
      better({
        filled: w.filled + 1,
        fitSum: w.fitSum + f,
        start: w.start,
        done: w.done,
        detours: sub ? [...w.detours, { at: h, why: 'tritone sub' }] : w.detours,
        seen,
      });
    } else if (loop) {
      better({ filled: 1, fitSum: f, start: h, done: false, detours: [], seen: new Map([[mod12n(s, n), c.q]]) });
    }
  }
  // An optional step the player skipped.
  if (!loop && step.opt) better(walkBack(H, h, s - 1, tonic, move, lo, budget, depth));
  // A detour into the chord after it (never the newest chord itself).
  if (budget > 0 && h + 1 < H.length) {
    const why = detourInto(c, H[h + 1]);
    if (why) {
      const w = walkBack(H, h - 1, s, tonic, move, lo, budget - 1, depth + 1);
      if (w && (w.filled > 0 || w.done)) better({ ...w, detours: [...w.detours, { at: h, why }] });
    }
  }
  return best;
}

const mod12n = (x: number, n: number) => ((x % n) + n) % n;

export interface MatchContext {
  key?: KeyLike | null;
  /** 0..1 per style, from the style tracker; missing styles count as neutral. */
  style?: Partial<Record<string, number>>;
  moves?: readonly Move[];
}

/** A loop entered on (or heard from) another chord may go by another name: [name, its home above the tonic]. */
function nameFor(move: Move, tonic: number, firstDeg: number, key: KeyLike | null | undefined): [string, number] {
  if (!move.alias) return [move.name, 0];
  for (const [deg, name] of move.alias) {
    if (key && key.tonic === mod12(tonic + deg)) return [name, deg];
  }
  if (key && key.tonic === tonic) return [move.name, 0];
  for (const [deg, name] of move.alias) if (firstDeg === deg) return [name, deg];
  return [move.name, 0];
}

/** Style multiplier, 0.75..1.3: a move from the styles in play is a little more likely, never ruled out. */
export function styleMul(move: Move, style: MatchContext['style']): number {
  if (!style) return 1;
  let best = 0;
  for (const s of move.styles) best = Math.max(best, style[s] ?? 0);
  return 0.75 + 0.55 * Math.min(1, best);
}

/**
 * Every move that fits the end of the history, strongest first. A match must
 * fill at least two steps; a loop shorter than three steps needs three chords.
 */
export function matchMoves(history: readonly Chord[], ctx: MatchContext = {}): Match[] {
  const H = history;
  const last = H.length - 1;
  if (last < 1) return [];
  const lo = Math.max(0, H.length - MATCH_WINDOW);
  const out: Match[] = [];
  const moves = ctx.moves ?? ALL_MOVES;
  for (const move of moves) {
    const n = move.steps.length;
    const loop = move.kind === 'loop';
    let bestForMove: Match | null = null;
    for (let pos = 0; pos < n; pos++) {
      const step = move.steps[pos];
      const c = H[last];
      // The newest chord fixes the tonic (directly, or as a tritone sub of a dominant step).
      const tonics: number[] = [mod12(c.root - step.deg)];
      if (subbable(step) && isDom(c.q)) tonics.push(mod12(c.root - step.deg - 6));
      for (const tonic of tonics) {
        const w = walkBack(H, last, pos, tonic, move, lo, MAX_DETOURS, 0);
        if (!w || w.filled < 2) continue;
        if (!loop && !w.done) continue;
        if (loop && w.filled < Math.min(3, n + 1) && n <= 2) continue;
        const req = move.steps.filter((s) => !s.opt).length;
        const laps = loop ? w.filled / n : w.filled / req;
        const complete = !loop && isLastRequired(move, pos);
        const fit = w.fitSum / w.filled;
        const seen: (string | null)[] = new Array(n).fill(null);
        for (const [i, q] of w.seen) seen[i] = q;
        const firstDeg = mod12(H[w.start].root - tonic);
        const m: Match = {
          move,
          tonic,
          start: w.start,
          pos,
          filled: w.filled,
          laps,
          complete,
          fit,
          detours: w.detours,
          seen,
          name: '',
          home: 0,
          strength: 0,
        };
        [m.name, m.home] = nameFor(move, tonic, firstDeg, ctx.key);
        m.strength = strengthOf(m, ctx);
        if (!bestForMove || m.strength > bestForMove.strength) bestForMove = m;
      }
    }
    if (bestForMove) out.push(bestForMove);
  }
  out.sort((a, b) => b.strength - a.strength);
  return out;
}

function isLastRequired(move: Move, pos: number): boolean {
  for (let k = pos + 1; k < move.steps.length; k++) if (!move.steps[k].opt) return false;
  return true;
}

/**
 * 0..1. Grows with the chords explained (a long match is rarely a coincidence),
 * scaled by how well they fit, the move's tier, the style in play and whether
 * the move's home agrees with the key; detours cost a little each.
 */
function strengthOf(m: Match, ctx: MatchContext): number {
  const n = m.move.steps.length;
  const loop = m.move.kind === 'loop';
  // A loop only means something once half a lap or so has gone by (a 2-chord loop: three chords).
  const k = loop ? Math.min(m.filled, n + 4) - Math.max(0, n / 2 - 1) : m.filled;
  let s = 1 - Math.exp(-0.55 * Math.max(0, k - 1));
  s *= Math.pow(m.fit, 1.5);
  s *= m.move.tier === 1 ? 1 : m.move.tier === 2 ? 0.9 : 0.8;
  s *= styleMul(m.move, ctx.style);
  if (loop && m.laps >= 1) s *= 1.15;
  if (!loop && m.complete) s *= 1.05;
  // a cadence only half heard is weaker evidence than one nearly done
  if (!loop && !m.complete) s *= Math.sqrt((m.pos + 1) / m.move.steps.length);
  const key = ctx.key;
  // A two-chord cadence (IV–I, V–vi) is everywhere; it counts when it lands on the key's home.
  if (!loop && m.move.steps.filter((x) => !x.opt).length <= 2 && (!key || key.tonic !== m.tonic)) s *= key ? 0.6 : 0.8;
  if (key) {
    const homes = [m.tonic, ...(m.move.alias ?? []).map(([d]) => mod12(m.tonic + d))];
    s *= homes.includes(key.tonic) ? 1.12 : 0.92;
  }
  s -= DETOUR_COST * 0.4 * m.detours.length;
  return Math.max(0, Math.min(1, s));
}

/** Pitch-class root and step of what a match expects `ahead` chords from now, or null (past the end of a cadence). */
export function nextStep(m: Match, ahead = 1): { root: number; step: MoveStep; index: number } | null {
  const steps = m.move.steps;
  const n = steps.length;
  const i = m.move.kind === 'loop' ? (m.pos + ahead) % n : m.pos + ahead;
  if (i >= n) return null;
  return { root: mod12(m.tonic + steps[i].deg), step: steps[i], index: i };
}

// ---- generic repeats ------------------------------------------------------------

export interface Repeat {
  /** Chords per lap. */
  period: number;
  /** Trailing chords that equal the chord one period earlier. */
  run: number;
  /** Laps heard so far (run / period + 1). */
  laps: number;
  /** History index where the repeating stretch starts. */
  start: number;
}

const same = (a: Chord, b: Chord) => a.root === b.root && familyOf(a.q) === familyOf(b.q);

/**
 * The shortest 2- to 8-chord stretch the end of the history keeps repeating,
 * so a loop nobody wrote down still gets loop lock. Null until at least two
 * chords of the second lap agree.
 */
export function findRepeat(history: readonly Chord[], minRun = 2): Repeat | null {
  const H = history;
  for (let p = 2; p <= 8; p++) {
    let run = 0;
    for (let i = H.length - 1; i - p >= 0 && same(H[i], H[i - p]); i--) run++;
    // shortest period first, so A B A B is period 2, not 4
    if (run >= Math.max(minRun, 1)) {
      return { period: p, run, laps: run / p + 1, start: H.length - run - p };
    }
  }
  return null;
}
