// Moves over time: which library moves the music is in, their brackets on the
// lead sheet, loop lock, the style the music leans toward, and what the
// library predicts next. Owned by the analyzer; pure, no deps.
import type { LoopLock, MoveMark, MoveRef, StyleReading } from '../../../src/shared/analysis';
import { familyOf, isDom } from './chords';
import { type Chord, type Match, MATCH_WINDOW, findRepeat, matchMoves, nextStep } from './match';
import { type Move, type Style, STYLES, classQuality } from './moves';
import { mod12, type KeyLike } from './pitch';

/** A chord the library predicts, before blending with the rules. */
export interface LibCand {
  root: number;
  q: string;
  /** 0..1, the match strength behind it. */
  w: number;
  why: string;
  move: MoveRef;
  /** The chord after it, when the move says. */
  then?: { root: number; q: string };
  loop: boolean;
}

/** What the library adds to a prediction: candidates, how much to trust them, and the session's texture. */
export interface LibContext {
  cands: LibCand[];
  /** Blend weight of the library against the rules, 0..0.8. */
  alpha: number;
  /** Mostly triads lately: predict triads (G, not G7). */
  triads: boolean;
  /** A dominant 7th was played lately (so a triad session's V may still be V7). */
  dom7: boolean;
}

interface Seq extends Chord {
  seq: number;
}

/** Only matches at least this strong make predictions or brackets. */
const LIB_MIN = 0.15;
const BRACKET_MIN = 0.4;
const STYLE_DECAY = 0.85;
const TEXTURE_SPAN = 8;

const TRIADS = new Set(['maj', 'min', 'dim', 'aug', 'sus4']);

export class MoveTracker {
  private hist: Seq[] = [];
  private open = new Map<string, MoveMark>();
  private counts = new Map<string, number>();
  private evidence = new Map<Style, number>();
  private styleShares: Partial<Record<string, number>> = {};
  private loop: LoopLock | null = null;
  private matches: Match[] = [];
  lean: Style | null = null;

  reset(): void {
    this.hist = [];
    this.open.clear();
    this.counts.clear();
    this.evidence.clear();
    this.styleShares = {};
    this.loop = null;
    this.matches = [];
  }

  /** Hindsight reread the newest chord (C♯°7 → A7♭9). */
  replaceLast(c: Chord): void {
    const h = this.hist[this.hist.length - 1];
    if (h) {
      h.root = c.root;
      h.q = c.q;
    }
  }

  /** Session count of a move's completions (cadences landed, loop laps finished). */
  count(id: string): number {
    return this.counts.get(id) ?? 0;
  }

  /** A new chord event. */
  onChord(c: Chord, seq: number, key: KeyLike | null): { marks: MoveMark[]; loop: LoopLock | null; landing: { move: Move; name: string; laps: number; count: number; style: string | null } | null } {
    this.hist.push({ root: c.root, q: c.q, seq });
    if (this.hist.length > MATCH_WINDOW) this.hist.shift();
    const ms = matchMoves(this.hist, { key, style: this.relStyle() });
    this.matches = ms.filter((m) => m.strength >= LIB_MIN);
    this.updateStyle(c, key);
    const loop = this.updateLoop(seq);
    const marks = this.updateBrackets(seq);
    // A landing: the strongest match just completed a cadence or came round a full lap.
    let landing = null;
    const top = this.matches[0];
    if (top && top.strength >= 0.4) {
      const n = top.move.steps.length;
      const lap = top.move.kind === 'loop' && top.filled >= n && top.filled % n === 0;
      if (top.complete || lap) {
        const count = (this.counts.get(top.move.id) ?? 0) + 1;
        this.counts.set(top.move.id, count);
        landing = { move: top.move, name: top.name, laps: Math.floor(top.laps), count, style: this.styleOf(top.move) };
      }
    }
    return { marks, loop, landing };
  }

  /** The library's predictions for the chord after the newest one (refigured for a new frame on request). */
  lib(key: KeyLike | null, refigure = false): LibContext {
    if (refigure && this.hist.length) this.matches = matchMoves(this.hist, { key, style: this.relStyle() }).filter((m) => m.strength >= LIB_MIN);
    const tex = this.texture();
    const cands: LibCand[] = [];
    for (const m of this.matches) {
      const nx = nextStep(m);
      if (!nx) continue;
      const n = m.move.steps.length;
      const after = nextStep(m, 2);
      const dominant = nx.step.deg === 7 || (!!after && mod12(after.root - nx.root) === 5);
      const seen = m.move.kind === 'loop' ? m.seen[nx.index] : null;
      const q = seen ?? classQuality(nx.step.cls, tex.triads, dominant && (!tex.triads || tex.dom7));
      const loop = m.move.kind === 'loop';
      const completes = !loop && isLast(m.move, nx.index);
      const ref: MoveRef = { id: m.move.id, name: m.name, step: nx.index + 1, of: n, loop, laps: Math.floor(m.laps * 10) / 10, completes, styles: m.move.styles };
      const why = completes ? `completes ${m.name}` : `${m.name} ${nx.index + 1}/${n}`;
      let then: LibCand['then'];
      if (after) {
        const seenAfter = loop ? m.seen[after.index] : null;
        const after2 = nextStep(m, 3);
        const dom2 = after.step.deg === 7 || (!!after2 && mod12(after2.root - after.root) === 5);
        then = { root: after.root, q: seenAfter ?? classQuality(after.step.cls, tex.triads, dom2 && (!tex.triads || tex.dom7)) };
      }
      // ↻ only once a loop has come round
      cands.push({ root: nx.root, q, w: m.strength, why, move: ref, then, loop: loop && m.laps >= 1 });
    }
    // A loop nobody wrote down: once it has come round, its next chord is the one a lap ago.
    if (this.loop && !this.loop.broke) {
      const p = this.loop.period;
      const prev = this.hist[this.hist.length - p];
      const after = this.hist[this.hist.length - p + 1];
      if (prev) {
        const w = Math.min(0.95, 0.45 + 0.12 * (this.loop.laps - 1) * p);
        const name = this.loop.name ?? 'loop';
        const ref: MoveRef = { id: 'loop', name, step: 1, of: p, loop: true, laps: Math.floor(this.loop.laps * 10) / 10, completes: false, styles: [] };
        cands.push({ root: prev.root, q: prev.q, w, why: `${name} ↻`, move: ref, then: after ? { root: after.root, q: after.q } : undefined, loop: true });
      }
    }
    const top = cands.reduce((a, c) => Math.max(a, c.w), 0);
    // only the leading readings speak; a crowd of weak partial matches is noise
    cands.splice(0, cands.length, ...cands.filter((c) => c.w >= 0.6 * top));
    return { cands, alpha: Math.min(0.8, top), triads: tex.triads, dom7: tex.dom7 };
  }

  /** Style shares for display, strongest first, plus the lean. */
  styleReading(): StyleReading | null {
    const total = [...this.evidence.values()].reduce((a, b) => a + b, 0);
    if (total < 0.3) return this.lean ? { shares: [], lead: null, lean: this.lean } : null;
    const shares = STYLES.map((s) => ({ style: s as string, share: (this.evidence.get(s) ?? 0) / total }))
      .filter((x) => x.share >= 0.12)
      .sort((a, b) => b.share - a.share)
      .slice(0, 3)
      .map((x) => ({ style: x.style, share: Math.round(x.share * 100) / 100 }));
    return { shares, lead: shares[0]?.style ?? null, lean: this.lean };
  }

  // ---- internals -------------------------------------------------------------

  /** Style shares scaled so the strongest is 1 (the lean, when set, counts as strongest). */
  private relStyle(): Partial<Record<string, number>> {
    const out: Partial<Record<string, number>> = {};
    let max = 0;
    for (const v of this.evidence.values()) max = Math.max(max, v);
    if (max > 0) for (const [s, v] of this.evidence) out[s] = v / max;
    if (this.lean) {
      for (const s of STYLES) out[s] = (out[s] ?? 0) * 0.6;
      out[this.lean] = 1;
    }
    return out;
  }

  private styleOf(move: Move): string | null {
    let best: string | null = null;
    let bv = -1;
    for (const s of move.styles) {
      const v = this.lean === s ? 2 : this.styleShares[s] ?? 0;
      if (v > bv) {
        bv = v;
        best = s;
      }
    }
    return best;
  }

  /** Evidence for each style from the chord itself and the moves it's part of; older evidence fades. */
  private updateStyle(c: Chord, key: KeyLike | null): void {
    for (const [s, v] of this.evidence) this.evidence.set(s, v * STYLE_DECAY);
    const add = (s: Style, v: number) => this.evidence.set(s, (this.evidence.get(s) ?? 0) + v);
    const fam = familyOf(c.q);
    const deg = key ? mod12(c.root - key.tonic) : -1;
    if (c.q === 'maj' || c.q === 'min') {
      add('pop', 0.25);
      add('rock', 0.2);
      add('folk', 0.15);
    } else if (c.q === 'maj7' || c.q === 'm7' || c.q === 'm7b5' || c.q === '6' || c.q === 'm6') {
      add('jazz', 0.3);
      add('gospel', 0.12);
    }
    if (isDom(c.q)) {
      if (key && key.mode !== 'minor' && (deg === 0 || deg === 5)) add('blues', 0.45);
      else {
        add('jazz', 0.15);
        add('gospel', 0.08);
      }
    }
    if (c.q === 'sus4' || c.q === '7sus4') add('gospel', 0.2);
    if (c.q === 'dim7') {
      add('gospel', 0.1);
      add('jazz', 0.1);
    }
    if (key && key.mode !== 'minor' && fam === 'maj' && (deg === 10 || deg === 8 || deg === 3)) {
      add('rock', 0.25);
      add('pop', 0.15);
      add('film', 0.1);
    }
    for (const m of this.matches.slice(0, 3)) {
      const v = (m.strength * (m.move.kind === 'loop' && m.laps >= 1 ? 0.8 : 0.5)) / m.move.styles.length;
      for (const s of m.move.styles) if (s !== 'mine') add(s, v);
    }
    const total = [...this.evidence.values()].reduce((a, b) => a + b, 0) || 1;
    this.styleShares = {};
    for (const [s, v] of this.evidence) this.styleShares[s] = v / total;
  }

  private texture(): { triads: boolean; dom7: boolean } {
    const span = this.hist.slice(-TEXTURE_SPAN);
    if (span.length < 3) return { triads: false, dom7: false };
    const tri = span.filter((c) => TRIADS.has(c.q)).length;
    return { triads: tri / span.length >= 0.6, dom7: span.some((c) => c.q === '7') };
  }

  private updateLoop(seq: number): LoopLock | null {
    const r = findRepeat(this.hist);
    const was = this.loop;
    // locked once the whole period has come round a second time (or two chords of a 2-chord loop)
    if (r && r.run >= r.period) {
      const named = this.matches.find((m) => m.move.kind === 'loop' && m.move.steps.length === r.period && m.filled >= r.period + r.run - 1);
      this.loop = { period: r.period, laps: Math.round(r.laps * 100) / 100, from: this.hist[r.start].seq, to: seq, name: named?.name ?? null, broke: false };
      return this.loop;
    }
    if (was && !was.broke) {
      // still going round, just not locked at this length (shouldn't happen), or broken here
      this.loop = { ...was, to: seq, broke: true };
      return this.loop;
    }
    this.loop = null;
    return null;
  }

  /** At most two brackets cover the newest chord; brackets the music walked away from close. */
  private updateBrackets(seq: number): MoveMark[] {
    // a loop shows once half a lap is in (three chords at least); a second bracket needs three chords of its own
    const cands = this.matches.filter(
      (m) => m.strength >= BRACKET_MIN && (m.move.kind === 'cadence' || m.filled >= Math.max(3, Math.ceil(m.move.steps.length / 2))),
    );
    const picked: Match[] = [];
    for (const m of cands) {
      if (picked.length >= 2) break;
      if (!picked.length) {
        picked.push(m);
        continue;
      }
      // Both end on the newest chord, so a different start means one nests inside the other.
      if (m.start !== picked[0].start && m.move.id !== picked[0].move.id && m.filled >= 3) picked.push(m);
    }
    const out: MoveMark[] = [];
    const touched = new Set<string>();
    picked.forEach((m, level) => {
      const startSeq = this.hist[m.start].seq;
      let mark: MoveMark | undefined;
      for (const o of this.open.values()) if (o.id === m.move.id && o.tonic === m.tonic && o.to === seq - 1) mark = o;
      const n = m.move.steps.length;
      const loop = m.move.kind === 'loop';
      const state: MoveMark['state'] = loop ? (m.laps >= 1 ? 'running' : 'forming') : m.complete ? 'done' : 'forming';
      if (mark) {
        mark.from = Math.min(mark.from, startSeq);
        mark.to = seq;
        Object.assign(mark, { name: m.name, step: m.pos + 1, laps: Math.round(m.laps * 100) / 100, state, level, at: m.pos });
      } else {
        mark = {
          key: `${m.move.id}@${m.tonic}@${startSeq}`,
          id: m.move.id,
          name: m.name,
          loop,
          styles: m.move.styles,
          from: startSeq,
          to: seq,
          step: m.pos + 1,
          of: n,
          laps: Math.round(m.laps * 100) / 100,
          state,
          level,
          roman: m.move.roman,
          tonic: m.tonic,
          path: m.move.steps.map((s) => mod12(m.tonic + s.deg)),
          at: m.pos,
        };
        this.open.set(mark.key, mark);
      }
      touched.add(mark.key);
      out.push({ ...mark, path: [...mark.path] });
      if (state === 'done') this.open.delete(mark.key);
    });
    for (const [k, o] of [...this.open]) {
      if (touched.has(k)) continue;
      o.state = o.state === 'running' ? 'done' : 'left';
      out.push({ ...o, path: [...o.path] });
      this.open.delete(k);
    }
    return out;
  }
}

function isLast(move: Move, i: number): boolean {
  for (let k = i + 1; k < move.steps.length; k++) if (!move.steps[k].opt) return false;
  return true;
}
