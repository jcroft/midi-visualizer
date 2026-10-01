// Rule-based functional grammar for next-chord prediction. Pure, no deps.
import { isDom, isMajTonic, plainText } from './chords';
import { mod12, spell, type KeyLike } from './pitch';
import type { Prediction } from '../../../src/shared/analysis';

export interface ChordEvent {
  root: number;
  q: string;
}

interface Rule {
  dr: number; // root motion in semitones
  q: string;
  w: number;
  why: string;
}

function rulesFor(c: ChordEvent, key: KeyLike | null, history: ChordEvent[]): Rule[] {
  const deg = key ? mod12(c.root - key.tonic) : -1;
  const minorKey = key?.mode === 'minor';
  const R: Rule[] = [];
  const add = (dr: number, q: string, w: number, why: string) => R.push({ dr, q, w, why });

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
        break;
      }
      add(5, '7', deg === 9 ? 0.3 : 0.55, 'ii–V pull');
      add(11, '7', 0.15, 'tritone sub of V');
      if (deg === 9) add(5, 'm7', 0.35, 'vi → ii turnaround');
      if (deg === 4) add(5, '7', 0.1, 'iii → VI7 chain');
      if (key && deg === 5 && !minorKey) add(5, '7', 0.25, 'backdoor ♭VII7');
      add(1, 'm7', 0.06, 'side-slip up');
      break;
    case 'm7b5':
      add(5, '7', 0.65, 'minor ii–V');
      add(11, '7', 0.15, 'tritone sub of V');
      add(3, 'm7', 0.08, 'ø7 as iv–6 color');
      break;
    case '7':
    case '7sus4':
      if (c.q === '7sus4') add(0, '7', 0.3, 'sus resolves to 3rd');
      if (key && deg === 10 && !minorKey) add(2, 'maj7', 0.55, 'backdoor resolution');
      if (key && deg === 1) add(11, key.mode === 'minor' ? 'm6' : 'maj7', 0.55, 'tritone sub resolves down');
      add(5, minorKey && mod12(c.root + 5 - (key?.tonic ?? 0)) === 0 ? 'm6' : 'maj7', 0.45, 'V–I');
      add(5, '7', 0.15, 'dominant chain');
      add(6, '7', 0.12, 'tritone sub');
      add(2, 'm7', 0.12, 'deceptive (vi)');
      add(11, 'maj7', 0.06, 'down a half step');
      break;
    case 'maj7':
    case '6':
    case 'maj':
      if (key && deg === 5 && !minorKey) {
        add(0, 'm7', 0.3, 'IV → iv');
        add(1, 'dim7', 0.15, '♯iv° passing');
        add(11, 'm7', 0.15, 'IV → iii');
        break;
      }
      add(9, '7', 0.3, 'I–VI7 turnaround');
      add(2, 'm7', 0.25, 'back to ii');
      add(9, 'm7', 0.15, 'I → vi');
      add(0, '7', 0.12, 'I7 → IV');
      add(5, 'm7', 0.08, 'backdoor iv');
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

/** At most 3 predictions with normalized probabilities and a reason each. */
export function predict(c: ChordEvent | null, key: KeyLike | null, history: ChordEvent[]): Prediction[] {
  if (!c) return [];
  const rules = rulesFor(c, key, history);
  let sum = 0;
  for (const r of rules) sum += r.w;
  // merge duplicates (same root+quality): keep the strongest reason, add weight
  const merged: { root: number; q: string; w: number; why: string; bw: number }[] = [];
  for (const r of rules) {
    const root = mod12(c.root + r.dr);
    const m = merged.find((x) => x.root === root && x.q === r.q);
    if (m) {
      m.w += r.w;
      if (r.w > m.bw) {
        m.bw = r.w;
        m.why = r.why;
      }
    } else merged.push({ root, q: r.q, w: r.w, why: r.why, bw: r.w });
  }
  merged.sort((a, b) => b.w - a.w);
  return merged.slice(0, 3).map((m) => ({
    root: m.root,
    name: spell(m.root, key) + plainText(m.q),
    p: Math.round((m.w / sum) * 100) / 100,
    why: m.why,
  }));
}
