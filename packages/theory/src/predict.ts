// Rule-based functional grammar for next-chord prediction. Pure, no deps.
import { familyOf, isDom, isPreDom, plainText } from './chords';
import { diatonic, roman } from './key';
import { keyLabel, mod12, parentMajor, spell, type KeyLike } from './pitch';
import type { Fn, Landing, MoveRef, Prediction, PredictionKind, PredictionStep } from '../../../src/shared/analysis';
import type { LibContext } from './tracker';

export interface ChordEvent {
  root: number;
  q: string;
}

interface Rule {
  dr: number; // root motion in semitones
  q: string;
  w: number;
  why: string;
  kind?: PredictionKind; // forced kind (substitutions); otherwise derived from the key
}

/** Diatonic seventh-chord quality on each degree (semitones above the tonic). */
const MAJOR_Q: Record<number, string> = { 0: 'maj7', 2: 'm7', 4: 'm7', 5: 'maj7', 7: '7', 9: 'm7', 11: 'm7b5' };
const MINOR_Q: Record<number, string> = { 0: 'm6', 2: 'm7b5', 3: 'maj7', 5: 'm7', 7: '7', 8: 'maj7', 10: '7', 11: 'dim7' };

/** Diatonic quality of the chord built on `pc` in the key, or null if pc isn't a scale degree. */
function diatonicQ(pc: number, key: KeyLike): string | null {
  if (key.mode === 'minor') return MINOR_Q[mod12(pc - key.tonic)] ?? null;
  return MAJOR_Q[mod12(pc - parentMajor(key))] ?? null;
}

const isMinorTonicQ = (q: string) => q === 'm6' || q === 'mMaj7' || q === 'min';

/** True when recent harmony looks like a blues: a dominant seventh on I or IV of the key. */
function bluesy(key: KeyLike | null, history: ChordEvent[]): boolean {
  if (!key) return false;
  if (key.mode === 'mixolydian') return true;
  if (key.mode !== 'major') return false;
  for (let i = Math.max(0, history.length - 4); i < history.length; i++) {
    const h = history[i];
    const d = mod12(h.root - key.tonic);
    if (h.q === '7' && (d === 0 || d === 5)) return true;
  }
  return false;
}

/** True for a modal frame (dorian, mixolydian): numerals count from the modal tonic, function from the parent major. */
export const isModal = (key: KeyLike | null): boolean => !!key && (key.mode === 'dorian' || key.mode === 'mixolydian');

/** The functional key behind a frame: a mode folds to its parent major. */
export function parentKey(key: KeyLike): KeyLike {
  return isModal(key) ? { tonic: parentMajor(key), mode: 'major' } : key;
}

const minorish = (q: string) => q === 'm7' || q === 'min' || q === 'm6';

/**
 * Does a chord belong to a modal vamp? Dorian: i, IV7 (or a IV triad), the
 * half-step side-slip up (the So What bridge), a ♭VII triad, v. Mixolydian: I7,
 * ♭VII and IV triads, v–7. A major seventh chord is a resolution, not part of a
 * vamp: G7 → CΔ7 is V–I even after a long G7, and CΔ7 out of a D–7 vamp lands
 * on the parent major.
 */
export function fitsVamp(key: KeyLike, c: ChordEvent): boolean {
  const deg = mod12(c.root - key.tonic);
  if (key.mode === 'dorian') {
    return (
      (deg === 0 && minorish(c.q)) ||
      (deg === 5 && (isDom(c.q) || c.q === 'maj')) ||
      (deg === 1 && minorish(c.q)) ||
      (deg === 10 && c.q === 'maj') ||
      (deg === 7 && minorish(c.q))
    );
  }
  if (key.mode === 'mixolydian') {
    return (deg === 0 && isDom(c.q)) || ((deg === 10 || deg === 5) && c.q === 'maj') || (deg === 7 && minorish(c.q));
  }
  return false;
}

/** Vamp grammar inside a modal frame; empty when the chord isn't part of the vamp. */
function vampRules(c: ChordEvent, key: KeyLike): Rule[] {
  if (!fitsVamp(key, c)) return [];
  const deg = mod12(c.root - key.tonic);
  const R: Rule[] = [];
  const add = (dr: number, q: string, w: number, why: string, kind?: PredictionKind) => R.push({ dr, q, w, why, kind });
  if (key.mode === 'dorian') {
    if (deg === 0) {
      add(5, '7', 0.4, 'dorian i ↔ IV');
      add(1, 'm7', 0.2, 'side-slip up (So What)');
      add(10, 'maj', 0.12, 'i → ♭VII');
      add(7, 'm7', 0.08, 'i → v');
    } else if (deg === 5) {
      add(7, 'm7', 0.55, 'IV → i vamp');
      add(5, 'maj7', 0.2, 'resolves to the parent major');
    } else if (deg === 1) {
      add(11, 'm7', 0.6, 'slips back down');
      add(5, '7', 0.15, 'dorian i ↔ IV');
    } else {
      add(mod12(-deg), 'm7', 0.6, 'back to i');
    }
  } else {
    if (deg === 0) {
      add(10, 'maj', 0.35, '♭VII → I vamp');
      add(5, 'maj', 0.25, 'I7 → IV');
      add(7, 'm7', 0.15, 'I7 → v–7');
      add(5, 'maj7', 0.15, 'V–I after all');
    } else if (deg === 7) {
      add(5, '7', 0.6, 'v–7 → I7');
    } else {
      add(mod12(-deg), '7', 0.6, deg === 10 ? '♭VII → I' : 'IV → I');
    }
  }
  return R;
}

function rulesFor(c: ChordEvent, key: KeyLike | null, history: ChordEvent[]): Rule[] {
  if (key && isModal(key)) {
    const v = vampRules(c, key);
    if (v.length) return v;
    // Outside the vamp, fall back to the functional grammar of the parent major.
    key = parentKey(key);
  }
  const deg = key ? mod12(c.root - key.tonic) : -1;
  const minorKey = key?.mode === 'minor';
  // history ends with c itself; prev is the chord before it
  const prev = history.length >= 2 ? history[history.length - 2] : null;
  const prev2 = history.length >= 3 ? history[history.length - 3] : null;
  const fromPrev = prev ? mod12(c.root - prev.root) : -1;
  const R: Rule[] = [];
  const add = (dr: number, q: string, w: number, why: string, kind?: PredictionKind) => R.push({ dr, q, w, why, kind });

  switch (c.q) {
    case 'm7':
    case 'min':
    case 'm6':
    case 'mMaj7':
      if (key && deg === 0) {
        // minor tonic
        add(5, 'm7', 0.3, 'i → iv');
        add(8, 'maj7', 0.2, 'i → ♭VI');
        add(2, 'm7b5', 0.25, 'minor ii–V');
        add(7, '7', 0.2, 'i → V');
        break;
      }
      add(5, '7', deg === 9 ? 0.3 : 0.55, 'ii–V pull');
      // VI7 → ii (or vi → ii) → V: the turnaround is on its way home
      if (prev && fromPrev === 5 && (prev.q === '7' || prev.q === 'm7')) add(5, '7', 0.3, 'turnaround');
      add(11, '7', 0.15, 'tritone sub of V', 'sub');
      add(6, '7', 0.1, 'tritone ii–V', 'sub');
      if (deg === 9) add(5, 'm7', 0.35, 'vi → ii turnaround');
      if (deg === 4) add(5, '7', 0.2, 'iii → VI7');
      if (key && deg === 5 && !minorKey) add(5, '7', 0.25, 'backdoor ♭VII7', 'sub');
      add(1, 'm7', 0.06, 'side-slip up');
      break;
    case 'm7b5':
      add(5, '7', 0.65, 'minor ii–V');
      add(11, '7', 0.15, 'tritone sub of V', 'sub');
      break;
    case '7':
    case '7sus4': {
      const iiV = !!prev && isPreDom(prev.q) && fromPrev === 5;
      // Once the blues is established, I7 and IV7 trade places; a ii–V into either still resolves.
      const blues = !iiV && (deg === 5 || deg === 0) && key?.mode !== 'minor' && bluesy(key, history.slice(0, -1));
      if (key && deg === 10 && !minorKey) {
        add(2, 'maj7', 0.55, 'backdoor resolution', 'sub');
      }
      if (key && deg === 1) add(11, minorKey ? 'm6' : 'maj7', 0.55, 'tritone sub resolves down', 'sub');
      if (blues && deg === 5) {
        add(7, '7', 0.35, 'blues IV → I');
        add(1, 'dim7', 0.2, '♯iv° passing');
      } else if (blues && deg === 0) {
        add(5, '7', 0.45, 'blues I → IV');
      } else {
        // V–I: the target takes the quality of the degree a fifth down (A7 → D–7 in C)
        const target = mod12(c.root + 5);
        let tq = key ? diatonicQ(target, key) ?? 'maj7' : 'maj7';
        if (tq === 'm7b5' || tq === 'dim7') tq = 'maj7';
        if (key && minorKey && target === key.tonic) tq = 'm6';
        const why = !key || mod12(target - key.tonic) === 0 ? 'V–I' : 'secondary V';
        // IV7 out of the blues: it may still head home bluesily
        const iv7 = key?.mode === 'major' && deg === 5 && !iiV;
        add(5, tq, iv7 ? 0.3 : 0.45, why);
        if (iv7) {
          add(7, '7', 0.25, 'blues IV → I');
          add(1, 'dim7', 0.1, '♯iv° passing');
        }
        // completing a ii–V: the I is very likely
        if (iiV) {
          if (prev!.q === 'm7b5') add(5, 'm6', 0.35, 'minor ii–V–i');
          else add(5, tq, 0.35, 'ii–V–I');
          add(5, 'm7', 0.08, 'ii–V chain');
        }
      }
      // a dominant following a dominant a fifth above: rhythm-changes bridge, Sweet Georgia Brown
      if (prev && isDom(prev.q) && fromPrev === 5 && !blues) add(5, '7', 0.5, 'dominant cycle');
      else add(5, '7', 0.15, 'dominant chain');
      add(6, '7', 0.12, 'tritone sub', 'sub');
      if (!key || deg === 7) add(2, 'm7', 0.12, 'deceptive (vi)');
      add(11, 'maj7', 0.06, 'down a half step');
      break;
    }
    case 'maj7':
    case '6':
    case 'maj':
      if (key && deg === 5 && !minorKey) {
        add(0, 'm7', 0.3, 'IV → iv');
        add(1, 'dim7', 0.15, '♯iv° passing');
        add(11, 'm7', 0.15, 'IV → iii');
        break;
      }
      if (key && deg === 8 && minorKey) {
        add(6, 'm7b5', 0.3, '♭VI → iiø');
        add(11, '7', 0.25, '♭VI → V');
        break;
      }
      {
        // just landed a ii–V–I: head back around
        const cadence = prev && prev2 && isDom(prev.q) && fromPrev === 5 && isPreDom(prev2.q) && mod12(prev.root - prev2.root) === 5;
        const more = cadence ? 0.15 : 0;
        add(9, '7', 0.3 + more, 'I–VI7 turnaround');
        add(2, 'm7', 0.25 + more, 'back to ii');
      }
      add(9, 'm7', 0.15, 'I → vi');
      add(5, 'maj7', 0.12, 'I → IV');
      add(5, 'm7', 0.08, 'backdoor iv', 'sub');
      add(1, 'dim7', 0.08, 'passing ♯I°');
      break;
    case 'dim7':
    case 'dim':
      add(1, 'm7', 0.4, 'passing diminished resolves up');
      add(1, 'maj7', 0.3, 'passing diminished resolves up');
      add(11, 'maj7', 0.15, 'common-tone diminished');
      break;
    default:
      add(5, '7', 0.4, 'down a fifth');
      break;
  }

  // (Coltrane changes are a move in the library now: see moves.ts.)
  return R;
}

/** Roman-numeral degree without the quality suffix ("ii", "♭VI"). */
function degreeOf(root: number, q: string, key: KeyLike): string {
  const r = roman(root, q, key) ?? '';
  return r.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹Δø°+]|sus/g, '');
}

/** Function of a chord in a key. */
export function functionOf(root: number, q: string, frame: KeyLike | null): Fn | null {
  if (!frame) return null;
  const key = parentKey(frame);
  const fam = familyOf(q);
  if (fam === 'dom' || fam === 'dim') return 'D';
  const deg = mod12(root - key.tonic);
  if (key.mode === 'minor') {
    if (deg === 0 || deg === 3) return 'T';
    if (deg === 2 || deg === 5 || deg === 8) return 'SD';
    return null;
  }
  if (deg === 0 || deg === 4 || deg === 9) return 'T';
  if (deg === 2 || deg === 5 || deg === 8) return 'SD';
  if (deg === 11 && fam === 'hdim') return 'D';
  return null;
}

/**
 * Numeral and kind of a chord in a frame. Numerals count from the frame's
 * tonic (so in D dorian, G7 is IV⁷, the same frame as the center numeral);
 * whether it is diatonic is judged in the parent major.
 */
function describe(root: number, q: string, frame: KeyLike | null, forced?: PredictionKind): { roman: string | null; kind: PredictionKind; tonicizes?: string } {
  if (!frame) return { roman: null, kind: forced ?? 'diatonic' };
  const key = parentKey(frame);
  const rn = roman(root, q, frame);
  if (forced) return { roman: rn, kind: forced };
  if (diatonic(root, q, key)) return { roman: rn, kind: 'diatonic' };
  if (familyOf(q) === 'dom') {
    const target = mod12(root + 5);
    const tq = diatonicQ(target, key);
    if (tq && target !== frame.tonic) return { roman: `V⁷/${degreeOf(target, tq, frame)}`, kind: 'secondary' };
  }
  if (q === 'maj7' || q === '6' || q === 'maj' || isMinorTonicQ(q)) {
    const k: KeyLike = { tonic: root, mode: isMinorTonicQ(q) ? 'minor' : 'major' };
    return { roman: rn, kind: 'modulating', tonicizes: keyLabel(k) };
  }
  return { roman: rn, kind: 'chromatic' };
}

interface Cand {
  root: number;
  q: string;
  /** Probability from the rules and from the library, before blending. */
  pr: number;
  pl: number;
  why: string;
  libWhy: string;
  kind?: PredictionKind;
  move?: MoveRef;
  loop?: boolean;
  then?: { root: number; q: string };
}

/** Triad session: predict what the player would play (G, not G7; a V stays V7 if 7ths are around). */
function asTriad(q: string, dom7: boolean): string {
  switch (q) {
    case 'maj7':
    case '6':
      return 'maj';
    case 'm7':
    case 'm6':
      return 'min';
    case '7':
      return dom7 ? '7' : 'maj';
    default:
      return q;
  }
}

/**
 * At most 3 predictions with normalized probabilities and a reason each; the
 * top one carries the likely chord after it. With `lib`, the rules blend with
 * the move library: P = α·P_lib + (1−α)·P_rules, α growing with the strongest
 * match, and a chord the library backs names its move.
 */
export function predict(c: ChordEvent | null, key: KeyLike | null, history: ChordEvent[], depth = 0, lib?: LibContext | null): Prediction[] {
  if (!c) return [];
  const rules = rulesFor(c, key, history);
  let sum = 0;
  for (const r of rules) sum += r.w;
  // merge duplicates (same root + family): keep the strongest reason, add weight
  const merged: Cand[] = [];
  const find = (root: number, q: string) => merged.find((x) => x.root === root && familyOf(x.q) === familyOf(q));
  const best = new Map<Cand, number>();
  for (const r of rules) {
    const root = mod12(c.root + r.dr);
    const m = find(root, r.q);
    if (m) {
      m.pr += r.w / sum;
      if (r.w > (best.get(m) ?? 0)) {
        best.set(m, r.w);
        m.why = r.why;
        m.kind = r.kind;
        m.q = r.q;
      }
    } else {
      const x: Cand = { root, q: r.q, pr: r.w / sum, pl: 0, why: r.why, libWhy: '', kind: r.kind };
      best.set(x, r.w);
      merged.push(x);
    }
  }
  const alpha = lib && lib.cands.length ? lib.alpha : 0;
  if (lib && alpha > 0) {
    // the library's view: the strongest match per chord, others add a little
    const per = new Map<Cand, { top: number; rest: number }>();
    for (const lc of lib.cands) {
      let m = find(lc.root, lc.q);
      if (!m) {
        m = { root: lc.root, q: lc.q, pr: 0, pl: 0, why: '', libWhy: '', kind: undefined };
        merged.push(m);
      }
      const a = per.get(m) ?? { top: 0, rest: 0 };
      if (lc.w > a.top) {
        a.rest += a.top;
        a.top = lc.w;
        m.libWhy = lc.why;
        m.move = lc.move;
        m.loop = lc.loop;
        m.then = lc.then;
        if (m.pr === 0 || lc.loop) m.q = lc.q;
      } else a.rest += lc.w;
      per.set(m, a);
    }
    // sharpened, so the strongest match leads and a crowd of weak ones doesn't
    const lw = (a: { top: number; rest: number }) => Math.pow(a.top + 0.3 * a.rest, 3);
    let lsum = 0;
    for (const a of per.values()) lsum += lw(a);
    for (const [m, a] of per) m.pl = lw(a) / lsum;
  }
  const P = (m: Cand) => alpha * m.pl + (1 - alpha) * m.pr;
  merged.sort((a, b) => P(b) - P(a));
  const top3 = merged.slice(0, 3);
  const tot = merged.reduce((a, m) => a + P(m), 0) || 1;
  const out: Prediction[] = top3.map((m) => {
    const q = lib?.triads ? asTriad(m.q, lib.dom7) : m.q;
    // the library names the chord when it carries a real share of it
    const libLed = !!m.move && alpha * m.pl >= 0.4 * P(m);
    const d = describe(m.root, q, key, libLed ? undefined : m.kind);
    const p: Prediction = {
      root: m.root,
      name: spell(m.root, key) + plainText(q),
      p: Math.round((P(m) / tot) * 100) / 100,
      why: libLed ? m.libWhy : m.why || m.libWhy,
      q,
      roman: d.roman,
      fn: functionOf(m.root, q, key),
      kind: d.kind,
    };
    if (d.tonicizes) p.tonicizes = d.tonicizes;
    if (m.move && libLed) p.move = m.move;
    if (m.loop && libLed) p.loop = true;
    return p;
  });
  // second step: what usually follows the most likely next chord (the move says, when it led)
  if (depth === 0 && out.length && out[0].p >= THEN_MIN_P) {
    const top = out[0];
    const tm = top3[0];
    if (top.move && tm.then) {
      const q = lib?.triads ? asTriad(tm.then.q, lib.dom7) : tm.then.q;
      top.then = { root: tm.then.root, name: spell(tm.then.root, key) + plainText(q), q, roman: describe(tm.then.root, q, key).roman, p: top.p };
    } else {
      const next = predict({ root: top.root, q: top.q }, key, [...history, { root: top.root, q: top.q }], 1)[0];
      if (next && next.p >= THEN_MIN_P) {
        const step: PredictionStep = { root: next.root, name: next.name, q: next.q, roman: next.roman, p: next.p };
        top.then = step;
      }
    }
  }
  return out;
}

/** Only chain a second step off a confident first one (and keep a confident second). */
export const THEN_MIN_P = 0.4;

/**
 * How the chord event `ev` relates to the predictions that were showing for
 * the chord before it. `history` ends with ev.
 */
export function landingFor(prevPreds: Prediction[], from: ChordEvent, ev: ChordEvent, key: KeyLike | null, history: ChordEvent[]): Landing {
  const fam = familyOf(ev.q);
  let hit = prevPreds.findIndex((p) => p.root === ev.root && familyOf(p.q) === fam);
  const exact = hit >= 0;
  if (!exact) hit = prevPreds.findIndex((p) => p.root === ev.root);
  const fn = functionOf(ev.root, ev.q, key);
  let label: string | null = null;
  const prev2 = history.length >= 3 ? history[history.length - 3] : null;
  if (exact) {
    const p = prevPreds[hit];
    const cadence = isDom(from.q) && mod12(ev.root - from.root) === 5 && prev2 && isPreDom(prev2.q) && mod12(from.root - prev2.root) === 5;
    if (cadence) label = prev2!.q === 'm7b5' || isMinorTonicQ(ev.q) ? 'ii–V–i' : 'ii–V–I';
    else if (/turnaround/.test(p.why)) label = 'turnaround';
    else if (/backdoor/.test(p.why)) label = 'backdoor';
    else if (/tritone/.test(p.why)) label = 'tritone sub';
    else if (/Coltrane/.test(p.why)) label = 'Coltrane';
  } else if (hit >= 0) {
    label = 'modal interchange';
  } else {
    const top = prevPreds[0];
    if (top && isDom(ev.q) && familyOf(top.q) === 'dom' && mod12(ev.root - top.root) === 6) label = 'tritone sub!';
    else if (top && key && isDom(ev.q) && key.mode !== 'minor' && mod12(ev.root - key.tonic) === 10) label = 'backdoor';
  }
  return { from: from.root, hit, exact, label, fn };
}
