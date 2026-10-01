// Rule-based functional grammar for next-chord prediction. Pure, no deps.
import { familyOf, isDom, isMajTonic, isPreDom, plainText } from './chords';
import { diatonic, roman } from './key';
import { keyLabel, mod12, parentMajor, spell, type KeyLike } from './pitch';
import type { Fn, Landing, Prediction, PredictionKind, PredictionStep } from '../../../src/shared/analysis';

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

function rulesFor(c: ChordEvent, key: KeyLike | null, history: ChordEvent[]): Rule[] {
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

  // Coltrane cycle: two equal major-third root moves in a row.
  if (history.length >= 3) {
    const a = history[history.length - 3],
      b = history[history.length - 2],
      cc = history[history.length - 1];
    const m1 = mod12(b.root - a.root),
      m2 = mod12(cc.root - b.root);
    const jump = mod12(cc.root - a.root);
    if ((m1 === 4 || m1 === 8) && m1 === m2 && isMajTonic(cc.q)) add(m1 + 7, '7', 0.6, 'Coltrane cycle');
    else if ((jump === 4 || jump === 8) && isMajTonic(a.q) && isDom(b.q) && isMajTonic(cc.q) && m2 === 5)
      add(jump + 7, '7', 0.45, 'Coltrane cycle');
  }
  return R;
}

/** Roman-numeral degree without the quality suffix ("ii", "♭VI"). */
function degreeOf(root: number, q: string, key: KeyLike): string {
  const r = roman(root, q, key) ?? '';
  return r.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹Δø°+]|sus/g, '');
}

/** Function of a chord in a key. */
export function functionOf(root: number, q: string, key: KeyLike | null): Fn | null {
  if (!key) return null;
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

function describe(root: number, q: string, key: KeyLike | null, forced?: PredictionKind): { roman: string | null; kind: PredictionKind; tonicizes?: string } {
  if (!key) return { roman: null, kind: forced ?? 'diatonic' };
  const rn = roman(root, q, key);
  if (forced) return { roman: rn, kind: forced };
  if (diatonic(root, q, key)) return { roman: rn, kind: 'diatonic' };
  if (familyOf(q) === 'dom') {
    const target = mod12(root + 5);
    const tq = diatonicQ(target, key);
    if (tq && target !== key.tonic) return { roman: `V⁷/${degreeOf(target, tq, key)}`, kind: 'secondary' };
  }
  if (q === 'maj7' || q === '6' || q === 'maj' || isMinorTonicQ(q)) {
    const k: KeyLike = { tonic: root, mode: isMinorTonicQ(q) ? 'minor' : 'major' };
    return { roman: rn, kind: 'modulating', tonicizes: keyLabel(k) };
  }
  return { roman: rn, kind: 'chromatic' };
}

/** At most 3 predictions with normalized probabilities and a reason each; the top one carries the likely chord after it. */
export function predict(c: ChordEvent | null, key: KeyLike | null, history: ChordEvent[], depth = 0): Prediction[] {
  if (!c) return [];
  const rules = rulesFor(c, key, history);
  let sum = 0;
  for (const r of rules) sum += r.w;
  // merge duplicates (same root+quality): keep the strongest reason, add weight
  const merged: { root: number; q: string; w: number; why: string; bw: number; kind?: PredictionKind }[] = [];
  for (const r of rules) {
    const root = mod12(c.root + r.dr);
    const m = merged.find((x) => x.root === root && x.q === r.q);
    if (m) {
      m.w += r.w;
      if (r.w > m.bw) {
        m.bw = r.w;
        m.why = r.why;
        m.kind = r.kind;
      }
    } else merged.push({ root, q: r.q, w: r.w, why: r.why, bw: r.w, kind: r.kind });
  }
  merged.sort((a, b) => b.w - a.w);
  const out: Prediction[] = merged.slice(0, 3).map((m) => {
    const d = describe(m.root, m.q, key, m.kind);
    const p: Prediction = {
      root: m.root,
      name: spell(m.root, key) + plainText(m.q),
      p: Math.round((m.w / sum) * 100) / 100,
      why: m.why,
      q: m.q,
      roman: d.roman,
      fn: functionOf(m.root, m.q, key),
      kind: d.kind,
    };
    if (d.tonicizes) p.tonicizes = d.tonicizes;
    return p;
  });
  // second step: what usually follows the most likely next chord
  if (depth === 0 && out.length && out[0].p >= THEN_MIN_P) {
    const top = out[0];
    const next = predict({ root: top.root, q: top.q }, key, [...history, { root: top.root, q: top.q }], 1)[0];
    if (next && next.p >= THEN_MIN_P) {
      const step: PredictionStep = { root: next.root, name: next.name, q: next.q, roman: next.roman, p: next.p };
      top.then = step;
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
