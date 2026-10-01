// Stateful analyzer: PianoSnapshot -> Analysis. Pure TypeScript; time only
// arrives through snapshot.t, so it is deterministic and testable.
import type { Analysis, ChordReading, KeyReading, Landing, PianoSnapshot, Prediction } from '../../../src/shared/analysis';
import {
  type Cand,
  NQ,
  PRESENT,
  TEMPLATES,
  familyOf,
  isDom,
  isMajTonic,
  isMinTonic,
  isPreDom,
  makeCands,
  qualityText,
  scoreAll,
} from './chords';
import { KeyTracker, diatonic, roman } from './key';
import { mod12, keyLabel, parentMajor, spell, type KeyLike, type Mode } from './pitch';
import { type ChordEvent, landingFor, predict } from './predict';

// ---- tuning ---------------------------------------------------------------
const ARM_MS = 250; // a trigger (3+ onsets / new bass / pedal re-catch) arms a change for this long
const HOLD_ARMED_MS = 100; // armed: new label must stay best this long...
const MARGIN_ARMED = 1.0; // ...or win by this much
const HOLD_UNARMED_MS = 350; // no trigger: slower, and needs a margin
const MARGIN_UNARMED = 0.3;
const HOLD_INVALID_MS = 150; // current chord's required tones are gone (legato voice leading)
const HOLD_REFINE_MS = 90; // same root/function, different extensions
const STICKY_SAME = 0.4;
const STICKY_ROOT = 0.2;
const LOCAL_KEY_TTL = 16000;
const LOCAL_MISS_IMPLIED = 2; // an unresolved ii–V's key lapses after this many unrelated chords
const LOCAL_MISS = 3;
const MODAL_MS = 4000;
const CONF_K = 1.4;
const YOUNG_MS = 150;

interface Reading {
  root: number;
  qi: number; // template index, or -1 cluster, -2 quartal
  q: string;
  rootInferred: boolean;
  bass: number | null;
  slash: number | null;
  rel: number;
}

interface LocalKey extends KeyLike {
  implied: boolean;
  t: number;
  /** Consecutive chord events that don't belong to this local key. */
  miss: number;
}

export interface Analyzer {
  update(snapshot: PianoSnapshot): Analysis | null;
  reset(): void;
  /**
   * True while a candidate label is waiting out its hysteresis hold. The host
   * should call update() again (same snapshot, later t) if no new snapshot
   * arrives, or the pending change could stall when the keyboard is still.
   */
  wantsTick(): boolean;
}

export function createAnalyzer(): Analyzer {
  return new AnalyzerImpl();
}

const fam = (q: string) => familyOf(q);

class AnalyzerImpl implements Analyzer {
  private readonly cands: Cand[] = makeCands();
  private readonly pool = new Float64Array(12);
  private readonly noteW = new Float64Array(128);
  private readonly onsetT = new Float64Array(128).fill(-1e9);
  private readonly groupSize = new Uint8Array(128);
  private readonly inOnsets = new Uint8Array(128);
  private readonly held = new Uint8Array(128);
  private readonly notes: number[] = []; // sorted, reused
  private readonly gkey = new KeyTracker();
  private keyChanges = 0;

  private lastT = -1;
  private lastTriggerT = -1e9;
  private lastBassNote = -1;
  private cur: Reading | null = null;
  private curName = '';
  private curSince = 0;
  private curCommitT = -1e9;
  private lastEvent: ChordEvent | null = null;
  private prevEvent: ChordEvent | null = null;
  private history: ChordEvent[] = [];
  private local: LocalKey | null = null;
  private pendName: string | null = null;
  private pendSince = 0;
  private predictions: Prediction[] = [];
  private landing: Landing | null = null;
  private last: Analysis | null = null;

  reset(): void {
    this.pool.fill(0);
    this.noteW.fill(0);
    this.onsetT.fill(-1e9);
    this.groupSize.fill(0);
    this.inOnsets.fill(0);
    this.held.fill(0);
    this.notes.length = 0;
    this.gkey.reset();
    this.keyChanges = 0;
    this.lastT = -1;
    this.lastTriggerT = -1e9;
    this.lastBassNote = -1;
    this.cur = null;
    this.curName = '';
    this.curCommitT = -1e9;
    this.lastEvent = this.prevEvent = null;
    this.history = [];
    this.local = null;
    this.pendName = null;
    this.predictions = [];
    this.landing = null;
    this.last = null;
  }

  wantsTick(): boolean {
    return this.pendName !== null;
  }

  update(s: PianoSnapshot): Analysis | null {
    const t = s.t;
    const dt = this.lastT < 0 ? 0 : Math.min(250, Math.max(0, t - this.lastT));
    this.lastT = t;

    // ---- onsets --------------------------------------------------------
    let fresh = 0;
    const nOn = s.onsets.length;
    for (let i = 0; i < nOn; i++) {
      const n = s.onsets[i];
      if (this.inOnsets[n] !== 2) {
        // not seen in the previous snapshot's onset list => a new strike
        if (this.inOnsets[n] === 0) {
          this.onsetT[n] = t;
          this.groupSize[n] = 0;
          fresh++;
        }
      }
      this.inOnsets[n] = 3; // mark as current
    }
    for (let n = 0; n < 128; n++) {
      if (this.inOnsets[n] === 3) {
        this.inOnsets[n] = 2;
        if (nOn > this.groupSize[n]) this.groupSize[n] = nOn;
      } else this.inOnsets[n] = 0;
    }
    if (fresh > 0 && nOn >= 3) this.lastTriggerT = t;
    if (s.pedalRecatch) this.lastTriggerT = t;

    // ---- notes & weights ------------------------------------------------
    const notes = this.notes;
    for (let i = 0; i < notes.length; i++) this.noteW[notes[i]] = 0;
    notes.length = 0;
    this.held.fill(0);
    for (let i = 0; i < s.held.length; i++) {
      const n = s.held[i];
      this.held[n] = 1;
      if (this.noteW[n] === 0) notes.push(n);
      this.noteW[n] = 1;
    }
    for (let i = 0; i < s.sounding.length; i++) {
      const { note, w } = s.sounding[i];
      if (w <= 0.02) continue;
      if (this.noteW[note] === 0) notes.push(note);
      if (w > this.noteW[note]) this.noteW[note] = w;
    }
    notes.sort((a, b) => a - b);

    // hand split: largest gap > a 5th, else a fixed split when the span is wide
    let split = 128;
    if (notes.length > 1) {
      let gap = 7,
        at = -1;
      for (let i = 1; i < notes.length; i++) {
        const g = notes[i] - notes[i - 1];
        if (g > gap) {
          gap = g;
          at = i;
        }
      }
      if (at > 0) split = notes[at];
      else if (notes[notes.length - 1] - notes[0] > 14) split = 60;
    }

    this.pool.fill(0);
    let bassNote = -1;
    const armedNow = t - this.lastTriggerT <= 80;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      let w = this.noteW[n];
      const isHeld = this.held[n] === 1;
      const upper = n >= split;
      if (!isHeld) w *= upper ? 0.7 : 0.9;
      const age = t - this.onsetT[n];
      // quick single RH notes are melody / passing tones
      if (upper && age < YOUNG_MS && this.groupSize[n] < 3) w *= 0.4;
      // right after a new chord attack, older non-held (pedalled) notes recede
      if (armedNow && !isHeld && age > 120) w *= 0.5;
      this.noteW[n] = w;
      const pc = n % 12;
      if (w > this.pool[pc]) this.pool[pc] = w;
      if (bassNote < 0 && w >= PRESENT) bassNote = n;
    }
    if (bassNote >= 0 && bassNote !== this.lastBassNote) {
      if (t - this.onsetT[bassNote] <= 60) this.lastTriggerT = t; // new bass note
      this.lastBassNote = bassNote;
    }
    if (bassNote < 0) this.lastBassNote = -1;

    this.gkey.addPool(this.pool, dt, t);

    let mask = 0,
      active = 0;
    for (let pc = 0; pc < 12; pc++)
      if (this.pool[pc] >= PRESENT) {
        mask |= 1 << pc;
        active++;
      }

    let changed = false;
    let runner: { c: Cand; conf: number } | null = null;
    let conf = 0;

    if (active === 0) {
      // silence: the label goes dark, context is kept
      this.cur = null;
      this.curName = '';
      this.pendName = null;
    } else if (active >= 3) {
      const bass = bassNote >= 0 ? bassNote % 12 : -1;
      const bassStrength = bassNote < 0 ? 0 : bassNote < 48 ? 1 : bassNote < 55 ? 0.6 : 0.3;
      scoreAll(this.pool, mask, bass, bassStrength, this.cands);
      const keyCtx = this.contextKey();
      // Re-reading the *same* notes as "the next chord" (E–11 → A9sus) must not
      // earn a ii–V bonus; transitions from the current chord count only after
      // a trigger, or once the current chord's required tones are gone.
      const curC0 = this.cur && this.cur.qi >= 0 ? this.cands[this.cur.root * NQ + this.cur.qi] : null;
      const allowMove =
        !this.cur || (t - this.lastTriggerT <= ARM_MS && this.lastTriggerT > this.curCommitT + 60) || !curC0 || !curC0.valid;
      this.applyContext(keyCtx, allowMove);

      // best and runner-up (distinct root)
      let best: Cand | null = null;
      for (const c of this.cands) if (c.valid && (!best || c.total > best.total)) best = c;

      // cluster / quartal special readings
      let special: Reading | null = null;
      if (active >= 3) {
        const cluster = hasSemitoneRun(mask);
        if (cluster && (!best || best.unexplained >= 0.6)) {
          special = { root: bass >= 0 ? bass : 0, qi: -1, q: 'cluster', rootInferred: false, bass, slash: null, rel: 0 };
        } else if (!best && this.isQuartal()) {
          special = { root: bass >= 0 ? bass : 0, qi: -2, q: 'quartal', rootInferred: false, bass, slash: null, rel: 0 };
        }
      }

      const bestReading = special ?? (best ? this.toReading(best, bass, bassStrength) : null);
      if (bestReading) {
        const bestName = this.nameOf(bestReading, keyCtx);
        const bestTotal = best ? best.total : 0;
        const curCand = this.cur && this.cur.qi >= 0 ? this.cands[this.cur.root * NQ + this.cur.qi] : null;
        const curValid = !!this.cur && (this.cur.qi < 0 ? !!special && special.q === this.cur.q : !!curCand?.valid);
        const curTotal = curValid && curCand ? curCand.total : -Infinity;
        const armed = t - this.lastTriggerT <= ARM_MS;

        if (this.cur && bestName === this.curName) {
          this.pendName = null;
        } else {
          if (this.pendName !== bestName) {
            this.pendName = bestName;
            this.pendSince = t;
          }
          const hold = t - this.pendSince;
          let commit = false;
          let refinement = false;
          if (!this.cur) {
            commit = armed || hold >= HOLD_ARMED_MS;
          } else if (bestReading.root === this.cur.root && fam(bestReading.q) === fam(this.cur.q)) {
            refinement = true;
            commit = armed || hold >= HOLD_REFINE_MS;
          } else {
            const margin = bestTotal - curTotal;
            commit =
              (armed && (margin >= MARGIN_ARMED || hold >= HOLD_ARMED_MS)) ||
              (!armed && hold >= HOLD_UNARMED_MS && margin >= MARGIN_UNARMED) ||
              (!curValid && hold >= HOLD_INVALID_MS);
          }
          if (commit) {
            const isEvent =
              !refinement &&
              (!this.lastEvent ||
                this.lastEvent.root !== bestReading.root ||
                fam(this.lastEvent.q) !== fam(bestReading.q));
            this.cur = bestReading;
            this.curCommitT = t;
            this.pendName = null;
            if (isEvent) {
              changed = true;
              this.curSince = t;
              this.onChordEvent({ root: bestReading.root, q: bestReading.q }, bestReading, t);
            } else if (this.lastEvent) {
              this.lastEvent = { root: bestReading.root, q: bestReading.q };
              this.history[this.history.length - 1] = this.lastEvent;
            }
            this.curName = this.nameOf(bestReading, this.contextKey());
          }
        }
      }

      // confidence of the displayed reading and the runner-up ghost
      if (this.cur) {
        const curC = this.cur.qi >= 0 ? this.cands[this.cur.root * NQ + this.cur.qi] : null;
        const z = this.softmaxZ();
        if (this.cur.qi < 0) conf = this.cur.qi === -1 ? 0.15 : 0.25;
        else if (curC && curC.valid) conf = Math.exp(CONF_K * (curC.total - z.max)) / z.sum;
        else conf = 0.1;
        if (this.cur.qi >= 0 && this.isQuartal()) conf = Math.min(conf, 0.35);
        // runner-up: best valid reading with a different root
        let r: Cand | null = null;
        for (const c of this.cands) if (c.valid && c.root !== this.cur.root && (!r || c.total > r.total)) r = c;
        if (r) runner = { c: r, conf: Math.exp(CONF_K * (r.total - z.max)) / z.sum };
      }
    }
    // with 1–2 sounding pitch classes the current chord is simply held

    return this.emit(s, changed, conf, runner);
  }

  // ---- context ----------------------------------------------------------

  /** Key used for context, spelling and Roman numerals (local beats global). */
  private contextKey(): KeyLike | null {
    if (this.local && this.lastT - this.local.t > LOCAL_KEY_TTL) this.local = null;
    if (this.local) return this.local;
    const g = this.gkey.estimate();
    return g && g.conf >= 0.15 ? g : null;
  }

  private applyContext(key: KeyLike | null, allowMove: boolean): void {
    const cur = this.cur;
    const lastEv = this.lastEvent;
    for (const c of this.cands) {
      if (!c.valid) continue;
      const q = TEMPLATES[c.qi].q;
      let bonus = 0;
      // transition from the chord that would precede this one
      const prev = lastEv && c.root === lastEv.root ? this.prevEvent : lastEv;
      // (a refinement keeps a little of what justified the current chord, not all of it)
      if (prev && (prev !== lastEv || allowMove || !cur)) bonus += transition(prev, c.root, q) * (prev === lastEv ? 1 : 0.6);
      if (key) {
        const kk: KeyLike = key.mode === 'dorian' || key.mode === 'mixolydian' ? { tonic: parentMajor(key), mode: 'major' } : key;
        if (diatonic(c.root, q, kk)) bonus += 0.25;
        if (this.local && this.local.implied && c.root === this.local.tonic && (isMajTonic(q) || isMinTonic(q)))
          bonus += 0.4;
      }
      if (cur && cur.qi >= 0 && c.root === cur.root) bonus += c.qi === cur.qi ? STICKY_SAME : STICKY_ROOT;
      c.total = c.base + bonus;
    }
  }

  private softmaxZ(): { max: number; sum: number } {
    // one strongest reading per root, so near-duplicate qualities don't split confidence
    let max = -Infinity;
    for (const c of this.cands) if (c.valid && c.total > max) max = c.total;
    let sum = 0;
    for (let root = 0; root < 12; root++) {
      let m = -Infinity;
      for (let qi = 0; qi < NQ; qi++) {
        const c = this.cands[root * NQ + qi];
        if (c.valid && c.total > m) m = c.total;
      }
      if (m > -Infinity) sum += Math.exp(CONF_K * (m - max));
    }
    return { max, sum: sum || 1 };
  }

  private isQuartal(): boolean {
    const n = this.notes;
    let prev = -1,
      count = 0,
      fourths = 0;
    for (let i = 0; i < n.length; i++) {
      if (this.noteW[n[i]] < PRESENT) continue;
      if (prev >= 0) {
        const iv = n[i] - prev;
        if (iv === 5 || iv === 6) fourths++;
        count++;
      }
      prev = n[i];
    }
    return count >= 2 && fourths >= 2 && fourths >= count - 1;
  }

  private toReading(c: Cand, bass: number, bassStrength: number): Reading {
    const q = TEMPLATES[c.qi].q;
    let slash: number | null = null;
    if (bass >= 0 && bass !== c.root && bassStrength >= 0.6) {
      const role = TEMPLATES[c.qi].roles[mod12(bass - c.root)];
      if (c.rootPresent || role === 0) slash = bass;
    }
    return { root: c.root, qi: c.qi, q, rootInferred: !c.rootPresent, bass: bass >= 0 ? bass : null, slash, rel: c.rel };
  }

  private nameOf(r: Reading, key: KeyLike | null): string {
    if (r.qi === -1) return `cluster on ${spell(r.root, key)}`;
    if (r.qi === -2) return `${spell(r.root, key)} quartal`;
    let name = spell(r.root, key) + qualityText(r.q, r.rel);
    if (r.slash !== null) name += `/${spell(r.slash, key)}`;
    return name;
  }

  private onChordEvent(ev: ChordEvent, r: Reading, t: number): void {
    const prev = this.lastEvent;
    this.prevEvent = prev;
    this.lastEvent = ev;
    this.history.push(ev);
    if (this.history.length > 6) this.history.shift();
    if (r.qi >= 0) this.gkey.addChord(ev.root, TEMPLATES[r.qi].guides, t);
    this.updateLocalKey(prev, ev, t);
    // a confirmed global modulation overrides an older local reading
    if (this.gkey.changes !== this.keyChanges) {
      this.keyChanges = this.gkey.changes;
      const g = this.gkey.estimate();
      if (this.local && g && this.local.tonic !== g.tonic && t - this.local.t > 1000) this.local = null;
    }
    this.landing = prev && this.predictions.length ? landingFor(this.predictions, prev, ev, this.contextKey(), this.history) : null;
    this.predictions = r.qi >= 0 ? predict(ev, this.contextKey(), this.history) : [];
  }

  private updateLocalKey(prev: ChordEvent | null, ev: ChordEvent, t: number): void {
    const loc = this.local;
    if (prev) {
      const m = mod12(ev.root - prev.root);
      if (isPreDom(prev.q) && isDom(ev.q) && m === 5) {
        this.local = { tonic: mod12(ev.root + 5), mode: prev.q === 'm7b5' ? 'minor' : 'major', implied: true, t, miss: 0 };
        return;
      }
      if (isPreDom(prev.q) && isDom(ev.q) && m === 11) {
        this.local = { tonic: mod12(ev.root - 1), mode: prev.q === 'm7b5' ? 'minor' : 'major', implied: true, t, miss: 0 };
        return;
      }
      const tonicish = isMajTonic(ev.q) || isMinTonic(ev.q);
      if (isDom(prev.q) && tonicish && (m === 5 || m === 11 || (m === 2 && isMajTonic(ev.q)))) {
        const minor = isMinTonic(ev.q);
        // an m7 arrival that is already ii/iii/vi of the current key is just a chain, not a new key
        const ref = loc ?? this.gkey.estimate();
        if (!(ev.q === 'm7' && ref && diatonic(ev.root, ev.q, ref))) {
          this.local = { tonic: ev.root, mode: minor ? 'minor' : 'major', implied: false, t, miss: 0 };
          return;
        }
      }
    }
    if (loc) {
      if (loc.implied && ev.root === loc.tonic && (isMajTonic(ev.q) || isMinTonic(ev.q))) {
        this.local = { tonic: loc.tonic, mode: isMinTonic(ev.q) ? 'minor' : 'major', implied: false, t, miss: 0 };
      } else if (diatonic(ev.root, ev.q, loc) || (isDom(ev.q) && mod12(ev.root - loc.tonic) === 7)) {
        loc.t = t;
        loc.miss = 0;
      } else if (++loc.miss >= (loc.implied ? LOCAL_MISS_IMPLIED : LOCAL_MISS)) {
        // the music has moved on without resolving here
        this.local = null;
      }
    }
  }

  private keyReading(): KeyReading | null {
    const cur = this.cur;
    if (cur && cur.qi >= 0 && this.lastT - this.curSince >= MODAL_MS) {
      let mode: Mode | null = null;
      if (cur.q === 'm7' || cur.q === 'min') mode = 'dorian';
      else if (isDom(cur.q)) mode = 'mixolydian';
      if (mode && !(this.local && !this.local.implied && this.local.tonic !== cur.root && this.lastT - this.local.t < 2000)) {
        const k = { tonic: cur.root, mode };
        return { tonic: k.tonic, mode, label: keyLabel(k), conf: 0.5, implied: false };
      }
    }
    const g = this.gkey.estimate();
    const k = this.contextKey();
    if (!k) return null;
    if (this.local && k === this.local) {
      let conf = this.local.implied ? 0.55 : 0.75;
      if (g && g.tonic === this.local.tonic && g.mode === this.local.mode) conf += 0.15;
      return { tonic: k.tonic, mode: k.mode, label: keyLabel(k), conf, implied: this.local.implied };
    }
    return { tonic: k.tonic, mode: k.mode, label: keyLabel(k), conf: Math.min(1, g ? g.conf : 0), implied: false };
  }

  // ---- output -----------------------------------------------------------

  private emit(s: PianoSnapshot, changed: boolean, conf: number, runner: { c: Cand; conf: number } | null): Analysis | null {
    const key = this.keyReading();
    const spellKey = this.contextKey();
    let chord: ChordReading | null = null;
    let rn: string | null = null;
    if (this.cur) {
      const r = this.cur;
      chord = {
        name: this.nameOf(r, spellKey),
        root: r.root,
        quality: r.q,
        conf: round2(conf),
        rootInferred: r.rootInferred,
        bass: r.bass,
      };
      this.curName = chord.name;
      if (key && r.qi >= 0) rn = roman(r.root, r.q, key);
    }
    let runnerUp: ChordReading | null = null;
    if (runner && this.cur) {
      const rr = this.toReading(runner.c, this.cur.bass ?? -1, 0);
      runnerUp = {
        name: this.nameOf(rr, spellKey),
        root: rr.root,
        quality: rr.q,
        conf: round2(runner.conf),
        rootInferred: rr.rootInferred,
        bass: rr.bass,
      };
    }
    const pcs: number[] = new Array(12);
    for (let i = 0; i < 12; i++) pcs[i] = round2(Math.min(1, this.pool[i]));

    const prev = this.last;
    if (
      prev &&
      !changed &&
      sameChord(prev.chord, chord) &&
      prev.runnerUp?.name === runnerUp?.name &&
      prev.key?.label === key?.label &&
      prev.key?.implied === key?.implied &&
      prev.roman === rn &&
      maxDiff(prev.pcs, pcs) < 0.03
    )
      return null;

    const a: Analysis = {
      type: 'analysis',
      t: s.t,
      pcs,
      chord,
      runnerUp,
      key,
      roman: rn,
      predictions: this.predictions,
      landing: changed ? this.landing : null,
      changed,
    };
    this.last = a;
    return a;
  }
}

function transition(prev: ChordEvent, root: number, q: string): number {
  const m = mod12(root - prev.root);
  let b = 0;
  if (m === 5) {
    b += 0.3; // down a fifth
    if (isPreDom(prev.q) && isDom(q)) b += 1.0; // ii–V
    if (isDom(prev.q) && (isMajTonic(q) || isMinTonic(q))) b += 0.8; // V–I
    if (isDom(prev.q) && isDom(q)) b += 0.3; // dominant chain
  } else if (m === 11) {
    if (isDom(prev.q) && (isMajTonic(q) || isMinTonic(q))) b += 0.6; // tritone-sub resolution
    if (isPreDom(prev.q) && isDom(q)) b += 0.5; // ii–subV
  } else if (m === 2) {
    if (isDom(prev.q) && isMajTonic(q)) b += 0.3; // backdoor
  } else if (m === 6 && isDom(prev.q) && isDom(q)) {
    b += 0.2; // tritone swap
  }
  return b;
}

function hasSemitoneRun(mask: number): boolean {
  for (let pc = 0; pc < 12; pc++) {
    if ((mask >> pc) & 1 && (mask >> ((pc + 1) % 12)) & 1 && (mask >> ((pc + 2) % 12)) & 1) return true;
  }
  return false;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function sameChord(a: ChordReading | null, b: ChordReading | null): boolean {
  if (!a || !b) return a === b;
  return a.name === b.name && Math.abs(a.conf - b.conf) < 0.04 && a.rootInferred === b.rootInferred;
}

function maxDiff(a: number[], b: number[]): number {
  let m = 0;
  for (let i = 0; i < 12; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}
