// Learn moves from your own playing, and see how much of it the library explains.
//
//   npm run learn -- ~/Documents/"MIDI Visualizer"        (every saved take in the folder)
//   npm run learn -- take1.mid take2.jsonl [--add] [--min-keys 1] [--verbose]
//   npm run learn -- --demo --verbose
//
// Each take is replayed through the same analyzer the app runs (16 ms snapshots).
// It prints:
//   coverage: the share of chord events that sat inside a named move, and the moves that landed;
//   patterns: three- and four-chord runs the library doesn't name that came back at least
//     twice, in at least two keys (--min-keys), written as numerals in the move shorthand.
// --verbose prints each take's chords, unexplained ones marked with a dot.
// --add appends those patterns to packages/theory/src/mine.ts as your own moves ("mine").
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Analysis } from '@shared/analysis';
import type { PianoEvent } from '@shared/events';
import { createAnalyzer } from '@theory/analyzer';
import { ALL_MOVES, classFit, moveById, mv, signature, type StepClass } from '@theory/moves';
import { MINE_SPECS } from '@theory/mine';
import { PianoState } from '../src/renderer/midi/pianoState';
import { buildDemo, sequenceFromJsonl, sequenceFromMidi, type Sequence } from '../src/renderer/midi/replay';

interface ChordEv {
  seq: number;
  root: number;
  q: string;
  name: string;
  tonic: number;
  take: string;
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const add = args.includes('--add');
const verbose = args.includes('--verbose');
const mk = args.indexOf('--min-keys');
const minKeys = mk >= 0 ? Number(args[mk + 1]) : 2;
// a folder means every take in it (the .jsonl when a take was saved both ways)
const files = args
  .filter((a, i) => !a.startsWith('--') && !(mk >= 0 && i === mk + 1))
  .flatMap((f) => {
    if (!statSync(f).isDirectory()) return [f];
    const names = readdirSync(f).filter((n) => /\.(jsonl|mid)$/i.test(n));
    return names.filter((n) => n.endsWith('.jsonl') || !names.includes(n.replace(/\.mid$/i, '.jsonl'))).map((n) => join(f, n));
  });
const takes: [string, Sequence][] = files.map((f) => [f, f.endsWith('.jsonl') ? sequenceFromJsonl(readFileSync(f, 'utf8')) : sequenceFromMidi(readFileSync(f))]);
if (args.includes('--demo')) {
  let s = 7;
  takes.push(['demo', buildDemo(() => ((s = (s * 16807) % 2147483647) / 2147483647))]);
}
if (!takes.length) {
  console.log('usage: scripts/learn-moves.ts -- <take.mid|take.jsonl>... [--add] [--min-keys N] | --demo');
  process.exit(1);
}

// ---------------------------------------------------------------- replay ----

function replay(name: string, seq: Sequence): { chords: ChordEv[]; covered: Set<number>; landed: Map<string, number> } {
  const a = createAnalyzer();
  const piano = new PianoState();
  const bySeq = new Map<number, ChordEv>();
  const covered = new Set<number>();
  const landed = new Map<string, number>();
  let i = 0;
  const ev = seq.events;
  const ms = (t: number) => t + 1000;
  for (let t = 0; t <= seq.len + 1500; t += 16) {
    for (; i < ev.length && ev[i].at <= t; i++) {
      const e = ev[i];
      const tt = ms(e.at);
      const pe: PianoEvent | null =
        e.type === 'on' || e.type === 'off'
          ? { type: e.type, note: e.note, vel: e.vel, t: tt, recvT: tt, src: 'learn' }
          : e.type === 'cc'
            ? { type: 'cc', cc: e.cc, value: e.value, t: tt, recvT: tt, src: 'learn' }
            : null;
      if (pe) piano.apply(pe);
    }
    const snap = piano.snapshot(ms(t));
    if (!snap) continue;
    const r: Analysis | null = a.update(snap);
    if (!r || !r.chord || r.seq <= 0) continue;
    // a refinement (same seq) renames the chord event it belongs to
    bySeq.set(r.seq, { seq: r.seq, root: r.chord.root, q: r.chord.quality, name: r.chord.name, tonic: r.key?.tonic ?? r.chord.root, take: name });
    for (const m of r.moves ?? []) if (m.state !== 'left') for (let s = m.from; s <= m.to; s++) covered.add(s);
    const lm = r.landing?.move;
    if (lm && r.changed) {
      landed.set(lm.name, (landed.get(lm.name) ?? 0) + 1);
      const mvv = moveById(lm.id);
      const n = mvv && mvv.kind === 'cadence' ? mvv.steps.filter((x) => !x.opt).length : 0;
      for (let s = r.seq - n + 1; s <= r.seq; s++) covered.add(s);
    }
  }
  return { chords: [...bySeq.values()].sort((x, y) => x.seq - y.seq), covered, landed };
}

// --------------------------------------------------------------- numerals ----

const DEG = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
const ORDER: StepClass[] = ['Δ', 'D', 'm7', 'ø', '°', 'mΔ', '+', 'sus', 'M', 'm'];
const MINORISH = new Set<StepClass>(['m', 'm7', 'ø', '°', 'mΔ']);
const SUFFIX: Record<StepClass, string> = { M: '', m: '', D: '7', m7: '7', Δ: 'Δ', mΔ: 'Δ', ø: 'ø', '°': '°', '+': '+', sus: 'sus' };

function classOf(q: string): StepClass | null {
  let best: StepClass | null = null;
  let bf = 0;
  for (const c of ORDER) {
    const f = classFit(c, q);
    if (f >= 1) return c;
    if (f > bf) [best, bf] = [c, f];
  }
  return bf >= 0.6 ? best : null;
}

function numeral(c: ChordEv): string | null {
  const cls = classOf(c.q);
  if (!cls) return null;
  const d = DEG[(((c.root - c.tonic) % 12) + 12) % 12];
  const acc = d.match(/^[♭♯]?/)![0];
  const body = d.slice(acc.length);
  return acc + (MINORISH.has(cls) ? body.toLowerCase() : body) + SUFFIX[cls];
}

// ------------------------------------------------------------------- run ----

let total = 0;
let explained = 0;
const landedAll = new Map<string, number>();
const grams = new Map<string, { count: number; keys: Set<number>; where: string[] }>();
const known = new Set(ALL_MOVES.map(signature));

for (const [name, seq] of takes) {
  const { chords, covered, landed } = replay(name, seq);
  if (verbose) console.log(`\n${basename(name)}: ` + chords.map((c) => `${covered.has(c.seq) ? '' : '·'}${c.name}`).join('  '));
  total += chords.length;
  explained += chords.filter((c) => covered.has(c.seq)).length;
  for (const [k, v] of landed) landedAll.set(k, (landedAll.get(k) ?? 0) + v);
  for (const n of [3, 4]) {
    for (let i = 0; i + n <= chords.length; i++) {
      const w = chords.slice(i, i + n);
      if (w.every((c) => covered.has(c.seq))) continue;
      // numerals in the key in force when the run ends (where it was heading)
      const home = w[n - 1].tonic;
      const nums = w.map((c) => numeral({ ...c, tonic: home }));
      if (nums.some((x) => !x)) continue;
      const roman = nums.join(' ');
      if (new Set(nums).size < n || nums.some((x, j) => j && x === nums[j - 1])) continue;
      const sig = signature(mv('probe', roman, { name: '', kind: 'cadence', styles: [] }));
      if (known.has(sig)) continue;
      const g = grams.get(roman) ?? { count: 0, keys: new Set(), where: [] };
      g.count++;
      g.keys.add(home);
      if (g.where.length < 3) g.where.push(`${basename(name)}: ${w.map((c) => c.name).join(' ')}`);
      grams.set(roman, g);
    }
  }
}

const pct = total ? Math.round((100 * explained) / total) : 0;
console.log(`\nCoverage: ${explained} of ${total} chord events (${pct}%) sat inside a named move.`);
if (landedAll.size) {
  console.log('\nMoves that landed:');
  for (const [k, v] of [...landedAll].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
}

let found = [...grams.entries()].filter(([, g]) => g.count >= 2 && g.keys.size >= minKeys);
// drop a three-chord run that only ever came inside a longer one
found = found.filter(([r, g]) => !found.some(([r2, g2]) => r2 !== r && r2.includes(r) && g2.count >= g.count));
found.sort((a, b) => b[1].count - a[1].count);
console.log(found.length ? `\nPatterns the library doesn't name (≥2 times, ≥${minKeys} key${minKeys > 1 ? 's' : ''}):` : '\nNo unnamed patterns came back often enough.');
for (const [r, g] of found) {
  console.log(`  ${String(g.count).padStart(3)}×  ${r.padEnd(22)} in ${g.keys.size} key${g.keys.size > 1 ? 's' : ''}`);
  for (const w of g.where) console.log(`         ${w}`);
}

if (add && found.length) {
  const have = new Set(MINE_SPECS.map(([r]) => r));
  const fresh = found.map(([r]) => r).filter((r) => !have.has(r));
  const specs = [...MINE_SPECS, ...fresh.map((r): [string, string, 'cadence' | 'loop'] => [r, r.replace(/ /g, '–'), 'cadence'])];
  const file = resolve(import.meta.dirname ?? '.', '../packages/theory/src/mine.ts');
  const src = readFileSync(file, 'utf8');
  const body = specs.map(([r, n, k]) => `  [${JSON.stringify(r)}, ${JSON.stringify(n)}, '${k}'],`).join('\n');
  writeFileSync(file, src.replace(/export const MINE_SPECS[\s\S]*$/, `export const MINE_SPECS: [string, string, 'cadence' | 'loop'][] = [\n${body}\n];\n`));
  console.log(`\nAdded ${fresh.length} to mine.ts. Rename them there; run the tests to check none duplicates a library move.`);
}
