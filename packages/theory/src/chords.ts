// Chord templates, lead-sheet naming, and pool scoring. Pure, no deps.
import { mod12, rotMask } from './pitch';

export const PRESENT = 0.25; // pool weight at which a pitch class counts as sounding

// interval roles
const NONE = 0,
  ROOT = 1,
  REQ = 2,
  FIFTH = 3,
  EXT = 4,
  ALT = 5;

/** Value of an explained/unexplained pitch class per unit weight. */
const ROLE_VALUE = [-1.6, 0.9, 1.2, 0.5, 0.25, 0.1];
const ROOT_MISSING = -0.3;
const ROOTLESS_FORM = 0.6;

export type Family = 'maj' | 'min' | 'dom' | 'hdim' | 'dim' | 'aug' | 'sus';

export interface Template {
  q: string;
  roles: Int8Array; // 12 roles by interval
  must: number[]; // intervals that must be present
  prior: number;
  family: Family;
  /** Rootless A/B voicing forms as interval bitmasks (root absent). */
  rootless: number[];
  /** Guide tones (3rd/7th or equivalents) used to feed key tracking. */
  guides: number[];
}

const bits = (ivs: number[]) => ivs.reduce((m, iv) => m | (1 << iv), 0);

function T(
  q: string,
  family: Family,
  spec: { req: number[]; fifth?: number[]; ext?: number[]; alt?: number[]; must?: number[] },
  prior = 0,
  rootless: number[][] = [],
): Template {
  const roles = new Int8Array(12);
  roles[0] = ROOT;
  for (const iv of spec.req) roles[iv] = REQ;
  for (const iv of spec.fifth ?? []) roles[iv] = FIFTH;
  for (const iv of spec.ext ?? []) roles[iv] = EXT;
  for (const iv of spec.alt ?? []) roles[iv] = ALT;
  return {
    q,
    roles,
    must: [...spec.req, ...(spec.must ?? [])],
    prior,
    family,
    rootless: rootless.map(bits),
    guides: spec.req,
  };
}

export const TEMPLATES: Template[] = [
  T('maj7', 'maj', { req: [4, 11], fifth: [7], ext: [2, 9], alt: [6] }, 0, [
    [4, 7, 11, 2],
    [4, 11, 2],
    [4, 9, 11, 2],
    [11, 2, 4, 7],
  ]),
  T('6', 'maj', { req: [4, 9], fifth: [7], ext: [2] }, -0.1, [[4, 7, 9, 2]]),
  T('m7', 'min', { req: [3, 10], fifth: [7], ext: [2, 5], alt: [9] }, 0, [
    [3, 7, 10, 2],
    [3, 10, 2],
    [3, 5, 10, 2],
  ]),
  T('m6', 'min', { req: [3, 9], fifth: [7], ext: [2, 5] }, -0.15),
  T('mMaj7', 'min', { req: [3, 11], fifth: [7], ext: [2, 5, 9] }, -0.25),
  T('7', 'dom', { req: [4, 10], fifth: [7], ext: [2, 9], alt: [1, 3, 6, 8] }, 0, [
    [4, 9, 10, 2],
    [4, 7, 10, 2],
    [4, 10, 2],
    [4, 9, 10],
    [4, 10, 1, 8],
    [4, 10, 3, 8],
  ]),
  T('m7b5', 'hdim', { req: [3, 10], fifth: [6], must: [6], ext: [2, 5, 8] }),
  T('dim7', 'dim', { req: [3, 9], fifth: [6], must: [6], ext: [2, 5, 8, 11] }),
  T('7sus4', 'dom', { req: [5, 10], fifth: [7], ext: [2, 9], alt: [1, 8] }, -0.1),
  T('maj', 'maj', { req: [4, 7], ext: [2, 9] }, -0.35),
  T('min', 'min', { req: [3, 7], ext: [2, 5] }, -0.35),
  T('aug', 'aug', { req: [4, 8], ext: [2] }, -0.5),
  T('dim', 'dim', { req: [3, 6] }, -0.6),
  T('sus4', 'sus', { req: [5, 7], ext: [2] }, -0.5),
];
export const NQ = TEMPLATES.length;
export const QINDEX: Record<string, number> = Object.fromEntries(TEMPLATES.map((t, i) => [t.q, i]));

export function familyOf(q: string): Family | 'other' {
  const i = QINDEX[q];
  return i === undefined ? 'other' : TEMPLATES[i].family;
}
export const isDom = (q: string) => q === '7' || q === '7sus4';
export const isPreDom = (q: string) => q === 'm7' || q === 'm7b5';
export const isMajTonic = (q: string) => q === 'maj7' || q === '6' || q === 'maj';
export const isMinTonic = (q: string) => q === 'm6' || q === 'mMaj7' || q === 'min' || q === 'm7';
export const isMinorish = (q: string) =>
  q === 'm7' || q === 'm6' || q === 'mMaj7' || q === 'min' || q === 'm7b5' || q === 'dim7' || q === 'dim';

/** Lead-sheet suffix (Δ and – style) given the template and which intervals sound (rel bitmask). */
export function qualityText(q: string, rel: number): string {
  const has = (iv: number) => ((rel >> iv) & 1) === 1;
  switch (q) {
    case 'maj7': {
      const s = has(2) && has(9) ? 'Δ13' : has(2) ? 'Δ9' : 'Δ7';
      return has(6) ? `${s}(♯11)` : s;
    }
    case '6':
      return has(2) ? '6/9' : '6';
    case 'm7':
      return has(5) ? '–11' : has(2) ? '–9' : '–7';
    case 'm6':
      return has(2) ? '–6/9' : '–6';
    case 'mMaj7':
      return has(2) ? '–Δ9' : '–Δ7';
    case '7': {
      const alts = (has(1) ? 1 : 0) + (has(3) ? 1 : 0) + (has(6) ? 1 : 0) + (has(8) ? 1 : 0);
      if (alts >= 2 && !has(7)) return '7alt';
      const base = has(9) ? '13' : has(2) ? '9' : '7';
      if (!alts) return base;
      let a = '';
      if (has(1)) a += '♭9';
      if (has(3)) a += '♯9';
      if (has(6)) a += '♯11';
      if (has(8)) a += '♭13';
      return `${base}(${a})`;
    }
    case 'm7b5':
      return 'ø7';
    case 'dim7':
      return '°7';
    case '7sus4':
      if (has(1)) return '7sus(♭9)';
      return has(9) ? '13sus' : has(2) ? '9sus' : '7sus4';
    case 'maj':
      return has(2) ? 'add9' : '';
    case 'min':
      return has(2) ? '–(add9)' : '–';
    case 'aug':
      return '+';
    case 'dim':
      return '°';
    case 'sus4':
      return 'sus4';
  }
  return q;
}

/** Plain suffix used for predictions (no extensions known). */
export const plainText = (q: string) => qualityText(q, 0);

export interface Cand {
  root: number;
  qi: number;
  valid: boolean;
  base: number; // template fit + bass
  total: number; // base + context
  rootPresent: boolean;
  rootlessForm: boolean;
  unexplained: number;
  rel: number; // active mask relative to root
}

export function makeCands(): Cand[] {
  const out: Cand[] = [];
  for (let root = 0; root < 12; root++)
    for (let qi = 0; qi < NQ; qi++)
      out.push({ root, qi, valid: false, base: 0, total: 0, rootPresent: false, rootlessForm: false, unexplained: 0, rel: 0 });
  return out;
}

/**
 * Template-fit score for every (root, quality). `bass` is a pitch class or -1;
 * `bassStrength` 0..1 scales the bass-root prior (a low bass note is strong evidence).
 */
export function scoreAll(pool: ArrayLike<number>, mask: number, bass: number, bassStrength: number, out: Cand[]): void {
  for (let root = 0; root < 12; root++) {
    const rel = rotMask(mask, root);
    for (let qi = 0; qi < NQ; qi++) {
      const c = out[root * NQ + qi];
      const t = TEMPLATES[qi];
      c.rel = rel;
      c.valid = false;
      let ok = true;
      for (let k = 0; k < t.must.length; k++) {
        if (pool[mod12(root + t.must[k])] < PRESENT) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      let s = t.prior;
      let unexplained = 0;
      for (let iv = 0; iv < 12; iv++) {
        const w = pool[(root + iv) % 12];
        if (w <= 0.02) continue;
        const role = t.roles[iv];
        s += ROLE_VALUE[role] * w;
        if (role === NONE) unexplained += w;
      }
      const rootPresent = pool[root] >= PRESENT;
      let rootlessForm = false;
      if (!rootPresent) {
        s += ROOT_MISSING;
        for (let k = 0; k < t.rootless.length; k++) {
          if (t.rootless[k] === rel) {
            rootlessForm = true;
            s += ROOTLESS_FORM;
            break;
          }
        }
      }
      if (bass >= 0) {
        const bi = mod12(bass - root);
        if (bi === 0) s += 1.0 * bassStrength;
        else if (rootPresent && t.roles[bi] !== NONE) s -= 0.1 * bassStrength;
        // a deep bass note that is not the root argues against an implied root
        else if (!rootPresent) s -= (0.6 * Math.max(0, bassStrength - 0.6)) / 0.4;
      }
      c.valid = true;
      c.base = s;
      c.total = s;
      c.rootPresent = rootPresent;
      c.rootlessForm = rootlessForm;
      c.unexplained = unexplained;
    }
  }
}
