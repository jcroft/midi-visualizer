// The lead-sheet strip along the bottom of the compass view: past chords
// scroll left from a "now" point under the compass, the current chord sits just
// left of it, and the predicted next chords sit just right of it in outline.
//
// Tiers (see compass.ts): past entries are HEARD (grey, no glow), the current
// chord is PLAYED (white), the future is PREDICTED (outline, dotted underline).
//
// Above the names, brackets span the moves you played (ii–V–I, Axis): dotted
// and open while forming, solid once complete, grey once the music went
// elsewhere. When a loop locks, its laps fold into one repeat sign,
// ‖: C G A– F :‖ ×3, with the chord now sounding lit; breaking it unfolds the
// strip and marks the chord where it broke.
import type { Scene } from 'three/webgpu';
import type { Fn, LoopLock, MoveMark, Reread } from '@shared/analysis';
import { chordTones, resolveVoice, voiceLeading, type FnClass, type VoicingReading } from '@theory/voicing';
import { cssOklch, oklchToLinear } from './color';
import type { Layout } from './layout';
import type { SpriteBatch } from './sprites';
import { TextLayer } from './text';
import { DISPLAY_FONT, HISTORY_FADE_POW, HISTORY_MAX, HISTORY_SPEED, MONO_FONT } from './tuning';
import { ROLE_RGB, fnRgb } from './taxonomy';

/** At most this many voices (lowest first: the left hand) get a hidden-voice line. */
const VOICE_CAP = 5;
/** Tension samples kept for the curve (one per ~4 px of scroll). */
const TENSION_CAP = 1024;
const TENSION_STEP_PX = 4;
/** A bracket's label: "Axis 2/4" while forming, "Axis ×2" while a loop runs, the name once done. */
function bracketText(m: MoveMark): string {
  if (m.state === 'forming') return `${m.name} ${m.step}/${m.of}`;
  if (m.state === 'running') return `↻ ${m.name} ×${Math.max(1, Math.floor(m.laps))}`;
  return m.name;
}

const lin = (L: number, C: number, h: number) => oklchToLinear(L, C, h, new Float32Array(3));
/** The tension ribbon runs from a cool, quiet grey-blue at rest to a hot coral at full pull. */
const CALM = lin(0.6, 0.05, 240);
const HOT = lin(0.74, 0.16, 30);

interface Entry {
  /** Chord-event sequence number from the analyzer (brackets and loops refer to it). */
  seq: number;
  /** Folded into the loop block this frame. */
  folded: boolean;
  /** This chord broke a locked loop. */
  broke: boolean;
  name: string;
  roman: string;
  root: number;
  fn: Fn | null;
  /** Key label when this chord arrived in a new key (drawn as a double barline + label). */
  keyChange: string;
  t0: number;
  /** End time; NaN while it is the current chord. */
  t1: number;
  /** Measured width of the name, px. */
  w: number;
  layer: TextLayer;
  /** Laid-out left/right edges this frame (CSS px). */
  x0: number;
  x1: number;
  /** The name it had before hindsight reread it ("B°7"), and its numeral in the old key at a pivot. */
  was: string;
  pivot: string;
  /** Hidden voices: the voicing's lowest notes, low to high, and each one's role. */
  voices: number[];
  roles: FnClass[];
}

interface Bracket {
  mark: MoveMark;
  layer: TextLayer;
  text: string;
  /** Measured label width, px. */
  tw: number;
}

interface Future {
  name: string;
  roman: string;
  root: number;
  q: string;
}

export class HistoryStrip {
  private readonly entries: Entry[] = [];
  private readonly spare: TextLayer[] = [];
  private readonly futureLayers: TextLayer[];
  private future: Future[] = [];
  private futureKey = '';
  private readonly futureW = [0, 0];
  private readonly measure = document.createElement('canvas').getContext('2d')!;
  private nameSize = 20;
  private romanSize = 11;
  private H = 60;
  private W = 300;
  private y = 60;
  /** The Hidden voices layer: lines under the strip, one per voice. */
  voicesOn = true;
  private bandH = 0;
  private bandLo = 48;
  private bandHi = 72;
  private voiceKey = '';
  /** The Tension curve layer: a ribbon under everything, rising with harmonic tension. */
  tensionOn = true;
  /** The Move brackets layer, and Loop lock. */
  bracketsOn = true;
  loopOn = true;
  private readonly brackets = new Map<string, Bracket>();
  private readonly spareBrackets: TextLayer[] = [];
  private bracketRow = 16;
  private loop: LoopLock | null = null;
  private readonly loopLayer: TextLayer;
  private loopKey = '';
  private loopNames: { name: string; roman: string; root: number }[] = [];
  private loopCur = -1;
  private loopLaps = 0;
  private loopName = '';
  /** Width of the folded loop block, eased so the strip doesn't jump. */
  private loopW = 0;
  private loopTarget = 0;
  private ribbonH = 0;
  private readonly tenT = new Float64Array(TENSION_CAP);
  private readonly tenV = new Float32Array(TENSION_CAP);
  private tenHead = 0;
  private tenCount = 0;

  constructor(
    private readonly scene: Scene,
    private readonly L: Layout,
  ) {
    this.futureLayers = [0, 1].map(
      (i) => new TextLayer(scene, 60, (ctx, w, h) => this.drawFuture(ctx, w, h, i), { out: 0.15, outRise: 0, in: 0.25, inRise: 0, delay: 0.35 }),
    );
    this.loopLayer = new TextLayer(scene, 60, (ctx, w, h) => this.drawLoop(ctx, w, h), { out: 0.15, outRise: 0, in: 0.2, inRise: 0, delay: 0 });
  }

  /** Scroll speed, px per second. */
  private get speed(): number {
    return HISTORY_SPEED * this.nameSize;
  }

  layout(): void {
    const { R, h, dpr } = this.L;
    // Sized from the lead-sheet band along the bottom (a quarter of the height).
    const S = this.L.sheetH || h * 0.25;
    this.nameSize = Math.max(16, S * 0.15);
    this.romanSize = Math.max(10, S * 0.058);
    this.H = Math.ceil(this.romanSize * 1.2 + this.nameSize * 1.15 + this.romanSize * 1.5 + 8);
    this.W = Math.ceil(Math.max(R * 1.0, this.nameSize * 9));
    this.bandH = this.voicesOn ? Math.max(28, S * 0.17) : 0;
    this.ribbonH = this.tensionOn ? Math.max(14, S * 0.07) : 0;
    this.bracketRow = this.bracketsOn ? Math.max(14, this.romanSize * 1.45) : 0;
    // Clear of the button row (which fades out while playing), hidden voices and tension under the names.
    const margin = Math.max(40, S * 0.15);
    this.y = margin + this.ribbonH + this.bandH + this.H / 2;
    for (const e of this.entries) {
      e.layer.place(0, this.y, this.W, this.H, dpr);
      e.w = this.nameWidth(e.name, e.roman);
      e.layer.changed();
    }
    for (const l of this.spare) l.place(0, this.y, this.W, this.H, dpr);
    for (const l of this.futureLayers) {
      l.place(0, this.y, this.W, this.H, dpr);
      l.changed();
    }
    for (const b of this.brackets.values()) {
      b.layer.place(0, 0, this.W, this.bracketRow, dpr);
      b.layer.changed();
    }
    this.loopLayer.place(0, this.y, this.L.w, this.H, dpr);
    this.loopKey = '';
  }

  /** Top edge of the strip (y-up), for keeping prediction labels clear of it. */
  get top(): number {
    return this.y + this.H / 2 + 2 * this.bracketRow;
  }

  /** True while the newest entry is still sounding. */
  get hasCurrent(): boolean {
    const cur = this.entries[this.entries.length - 1];
    return !!cur && Number.isNaN(cur.t1);
  }

  /** A new chord event. */
  push(name: string, roman: string, root: number, fn: Fn | null, keyChange: string, t: number, seq = -1): void {
    const cur = this.entries[this.entries.length - 1];
    if (cur && Number.isNaN(cur.t1)) cur.t1 = t;
    let layer = this.spare.pop();
    if (!layer) {
      if (this.entries.length >= HISTORY_MAX) {
        layer = this.entries.shift()!.layer;
      } else {
        const idx = this.entries.length;
        layer = new TextLayer(this.scene, 60, (ctx, w, h) => this.drawEntry(ctx, w, h, layer!), { out: 0.12, outRise: 0, in: 0.16, inRise: 4, delay: 0 });
        layer.place(0, this.y, this.W, this.H, this.L.dpr);
        void idx;
      }
    }
    const e: Entry = { seq, folded: false, broke: false, name, roman, root, fn, keyChange, t0: t, t1: NaN, w: this.nameWidth(name, roman), layer, x0: 0, x1: 0, was: '', pivot: '', voices: [], roles: [] };
    this.entries.push(e);
    layer.changed();
  }

  /** The current chord's spelling or numeral got refined (same chord event). */
  refine(name: string, roman: string, root: number): void {
    const cur = this.entries[this.entries.length - 1];
    if (!cur || !Number.isNaN(cur.t1) || (cur.name === name && cur.roman === roman)) return;
    cur.name = name;
    cur.roman = roman;
    cur.root = root;
    cur.w = this.nameWidth(name, roman);
    cur.layer.changed();
  }

  /**
   * Hindsight on the newest entry, from the chord event that follows it:
   * a new name (the old one shown small above it) and/or its numeral in the new key.
   */
  reread(r: Reread): void {
    const e = this.entries[this.entries.length - 1];
    if (!e) return;
    if (r.name && r.name !== e.name) {
      e.was = e.name;
      e.name = r.name;
    }
    if (r.pivot && r.pivot !== r.roman) e.pivot = r.pivot;
    if (r.roman) e.roman = r.roman;
    e.w = this.nameWidth(e.name, e.pivot ? `${e.pivot} → ${e.roman}` : e.roman);
    e.layer.changed();
  }

  /** The voicing now sounding, for the current entry's hidden-voice lines. */
  setVoices(r: VoicingReading | null): void {
    const cur = this.entries[this.entries.length - 1];
    if (!cur || !Number.isNaN(cur.t1) || !r || r.voices.length < 2) return;
    const vs = r.voices.slice(0, VOICE_CAP);
    const key = vs.map((v) => v.note).join(',');
    if (key === this.voiceKey && cur.voices.length) return;
    this.voiceKey = key;
    cur.voices = vs.map((v) => v.note);
    cur.roles = vs.map((v) => v.cls);
  }

  /** A tension sample (0..1), kept at most one per few px of scroll. */
  pushTension(t: number, v: number): void {
    const last = this.tenCount ? this.tenT[(this.tenHead + TENSION_CAP - 1) % TENSION_CAP] : -1e9;
    if (t - last < TENSION_STEP_PX / this.speed) return;
    this.tenT[this.tenHead] = t;
    this.tenV[this.tenHead] = v;
    this.tenHead = (this.tenHead + 1) % TENSION_CAP;
    this.tenCount = Math.min(TENSION_CAP, this.tenCount + 1);
  }

  /** Silence: the current chord ends. */
  end(t: number): void {
    const cur = this.entries[this.entries.length - 1];
    if (cur && Number.isNaN(cur.t1)) cur.t1 = t;
  }

  /** Bracket updates from a chord event: upsert by key. */
  setMarks(marks: readonly MoveMark[]): void {
    for (const m of marks) {
      let b = this.brackets.get(m.key);
      if (!b) {
        let layer = this.spareBrackets.pop();
        if (!layer) {
          const bl: TextLayer = new TextLayer(this.scene, 45, (ctx, w, h) => this.drawBracketLabel(ctx, w, h, bl), { out: 0.15, outRise: 0, in: 0.2, inRise: 2, delay: 0 });
          layer = bl;
        }
        layer.place(0, 0, this.W, this.bracketRow, this.L.dpr);
        b = { mark: m, layer, text: '', tw: 0 };
        this.brackets.set(m.key, b);
      }
      b.mark = m;
      const text = bracketText(m);
      if (text !== b.text) {
        b.text = text;
        this.measure.font = `600 ${this.romanSize * 0.95}px ${MONO_FONT}`;
        b.tw = this.measure.measureText(text).width + text.length;
        b.layer.changed();
      }
    }
  }

  /** The loop in force (or the one just broken). */
  setLoop(loop: LoopLock | null): void {
    if (loop?.broke) {
      const cur = this.entries[this.entries.length - 1];
      if (cur && cur.seq === loop.to && !cur.broke) {
        cur.broke = true;
        cur.layer.changed();
      }
    }
    this.loop = loop && !loop.broke ? loop : null;
  }

  setFuture(f: Future[]): void {
    const key = f.map((x) => x.name + x.roman).join('|');
    if (key === this.futureKey) return;
    this.futureKey = key;
    this.future = f;
    for (let i = 0; i < 2; i++) {
      this.futureW[i] = f[i] ? this.nameWidth(f[i].name, f[i].roman) : 0;
      this.futureLayers[i].changed();
    }
  }

  draw(sp: SpriteBatch, t: number, visible: boolean, showFuture: boolean, voices = false): void {
    const { cx } = this.L;
    const v = this.speed;
    const gap = this.nameSize * 0.9;
    const span = cx - 24;
    const barY = this.y - this.H / 2 + 4;

    // Loop lock: the laps fold into one block ending at now.
    const loop = this.loopOn ? this.loop : null;
    const folded = (e: Entry) => !!loop && e.seq >= loop.from && e.seq <= loop.to;
    this.updateLoopBlock(loop);
    this.loopW += (this.loopTarget - this.loopW) * 0.18;
    if (Math.abs(this.loopTarget - this.loopW) < 0.5) this.loopW = this.loopTarget;

    // Lay out newest to oldest, pushing older entries left so names never overlap.
    let limit = cx - (this.loopW > 1 ? this.loopW + gap * 0.6 : 0);
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      e.folded = folded(e);
      if (e.folded) {
        e.x0 = cx - this.loopW;
        e.x1 = cx;
        continue;
      }
      const cur = Number.isNaN(e.t1);
      const x1 = Math.min(cur ? cx : cx - (t - e.t1) * v, limit);
      const x0 = Math.min(cx - (t - e.t0) * v, x1 - (e.w + gap));
      e.x0 = x0;
      e.x1 = x1;
      limit = x0;
    }
    // Drop entries that have scrolled off the left edge.
    while (this.entries.length && this.entries[0].x1 < 24) {
      const old = this.entries.shift()!;
      old.layer.opacity = 0;
      old.layer.changed();
      old.layer.update(t);
      this.spare.push(old.layer);
    }

    // The loop block.
    this.loopLayer.opacity = visible && loop ? 1 : 0;
    this.loopLayer.at(cx - this.loopW + this.L.w / 2, this.y);
    this.loopLayer.moveTo(cx - this.loopW + this.L.w / 2, this.y);
    this.loopLayer.update(t);
    if (visible && loop && this.loopW > 1) {
      const x0 = cx - this.loopW;
      const c = fnRgb(null, this.loopNames[this.loopCur]?.root ?? 0);
      sp.rect(x0 + this.loopW / 2, barY, this.loopW / 2, 1.5, c[0], c[1], c[2], 0.75);
    }

    for (const e of this.entries) {
      const cur = Number.isNaN(e.t1);
      const d = cx - e.x0;
      const fade = folded(e) ? 0 : cur ? 1 : 0.85 * Math.pow(Math.max(0, 1 - d / span), HISTORY_FADE_POW);
      const op = visible ? fade : 0;
      e.layer.opacity = op;
      e.layer.at(e.x0 + this.W / 2, this.y);
      e.layer.moveTo(e.x0 + this.W / 2, this.y);
      e.layer.update(t);
      if (op <= 0.01) continue;
      // Duration bar, colored by function.
      const c = fnRgb(e.fn, e.root);
      const bx0 = e.x0;
      const bx1 = Math.max(bx0 + 4, e.x1 - gap * 0.4);
      sp.rect((bx0 + bx1) / 2, barY, (bx1 - bx0) / 2, 1.5, c[0], c[1], c[2], op * (cur ? 0.9 : 0.6));
      // Barline (double at a key change).
      sp.rect(bx0 - 6, this.y, 0.5, this.H * 0.32, 0.6, 0.64, 0.78, op * 0.35);
      if (e.keyChange) sp.rect(bx0 - 9, this.y, 0.5, this.H * 0.32, 0.6, 0.64, 0.78, op * 0.35);
      // Where a loop broke: an amber double bar.
      if (e.broke) {
        sp.rect(bx0 - 6, this.y, 0.8, this.H * 0.4, 0.95, 0.72, 0.35, op * 0.8);
        sp.rect(bx0 - 9, this.y, 0.8, this.H * 0.4, 0.95, 0.72, 0.35, op * 0.8);
      }
    }

    if (visible && this.bracketsOn) this.drawBrackets(sp, t, gap, span, loop);
    else for (const b of this.brackets.values()) {
      b.layer.opacity = 0;
      b.layer.update(t);
    }

    if (visible && voices && this.voicesOn) this.drawVoices(sp, t, gap, showFuture);
    if (visible && this.tensionOn) this.drawTension(sp, t);

    // The future, right of now: outline names with dotted underlines.
    let fx = cx + gap;
    for (let i = 0; i < 2; i++) {
      const f = this.future[i];
      const l = this.futureLayers[i];
      l.opacity = visible && showFuture && f ? (i === 0 ? 0.75 : 0.4) : 0;
      l.at(fx + this.W / 2, this.y);
      l.moveTo(fx + this.W / 2, this.y);
      l.update(t);
      if (f && l.opacity > 0.01) {
        const c = fnRgb(null, f.root);
        const w = this.futureW[i];
        for (let x = fx; x < fx + w; x += 6) sp.disc(x, barY, 1, c[0], c[1], c[2], l.opacity * 0.7);
        fx += w + gap;
      }
    }
  }

  /**
   * Hidden voices: under the strip, one line per voice of each voicing, at its
   * pitch. Past lines are heard (grey, tinted by role), the current one is
   * played (its role color: guide tones gold), joined chord to chord by how
   * each voice moved; from now, each line continues dotted to where it would go
   * in the predicted chord.
   */
  private drawVoices(sp: SpriteBatch, t: number, gap: number, showFuture: boolean): void {
    const { cx, R } = this.L;
    const top = this.y - this.H / 2 - 4;
    const bot = top - this.bandH + 6;
    const span = cx - 24;
    // The band's pitch range follows the visible voices, smoothly.
    let lo = 200, hi = -1;
    for (const e of this.entries) for (const n of e.voices) {
      if (e.x1 < 24) continue;
      lo = Math.min(lo, n);
      hi = Math.max(hi, n);
    }
    if (hi < 0) return;
    if (hi - lo < 10) {
      const m = (hi + lo) / 2;
      lo = m - 5;
      hi = m + 5;
    }
    const k = 0.08;
    this.bandLo += (lo - 1 - this.bandLo) * k;
    this.bandHi += (hi + 1 - this.bandHi) * k;
    const yOf = (n: number) => bot + ((n - this.bandLo) / Math.max(1, this.bandHi - this.bandLo)) * (top - bot);
    const thick = Math.max(1, R * 0.0035);
    const grey = [0.55, 0.58, 0.68];

    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (!e.voices.length || e.folded) continue;
      const cur = Number.isNaN(e.t1);
      const fade = cur ? 1 : 0.85 * Math.pow(Math.max(0, 1 - (cx - e.x0) / span), 1.2);
      if (fade < 0.02) continue;
      const xa = e.x0;
      const xb = Math.max(xa + 4, e.x1 - gap * 0.4);
      for (let j = 0; j < e.voices.length; j++) {
        const c = ROLE_RGB[e.roles[j]];
        const tint = cur ? 1 : 0.35;
        const r = c[0] * tint + grey[0] * (1 - tint), g = c[1] * tint + grey[1] * (1 - tint), b = c[2] * tint + grey[2] * (1 - tint);
        const y = yOf(e.voices[j]);
        sp.line(xa, y, xb, y, thick * (e.roles[j] === 'guide' ? 1.4 : 1), r, g, b, (cur ? 0.85 : 0.5) * fade);
      }
      // Join to the next voicing, voice by voice.
      const n = this.entries[i + 1];
      if (!n || !n.voices.length || n.x0 - xb > gap * 4) continue;
      for (const m of voiceLeading(e.voices, n.voices)) {
        if (m.from === null || m.to === null) continue;
        const fromRole = e.roles[e.voices.indexOf(m.from)];
        const toRole = n.roles[n.voices.indexOf(m.to)];
        const step = Math.abs(m.to - m.from);
        const gold = fromRole === 'guide' && toRole === 'guide' && step > 0 && step <= 2;
        const c = gold ? ROLE_RGB.guide : grey;
        sp.line(xb, yOf(m.from), n.x0, yOf(m.to), thick * (gold ? 1.4 : 1), c[0], c[1], c[2], (gold ? 0.75 : 0.4) * fade);
      }
    }

    // From now into the predicted chord: dotted, where each voice would go.
    const last = this.entries[this.entries.length - 1];
    const f = this.future[0];
    if (!showFuture || !last || last.folded || !Number.isNaN(last.t1) || !last.voices.length || !f) return;
    const tones = chordTones(f.root, f.q);
    const x0 = Math.max(last.x0 + 4, last.x1 - gap * 0.4);
    const x1 = cx + gap + this.futureW[0];
    const op = this.futureLayers[0].opacity;
    if (op < 0.02) return;
    for (let j = 0; j < last.voices.length; j++) {
      const from = last.voices[j];
      const d = resolveVoice(from, tones);
      const to = from + (d ?? 0);
      const c = d !== null && d !== 0 && last.roles[j] === 'guide' ? ROLE_RGB.guide : grey;
      const y0 = yOf(from), y1 = yOf(to);
      const len = x1 - x0;
      for (let x = 4; x < len; x += 6) {
        const u = x / len;
        const e = Math.min(1, u * 3);
        sp.disc(x0 + x, y0 + (y1 - y0) * e, 1, c[0], c[1], c[2], 0.6 * op * (d === null ? 0.4 : 1));
      }
    }
    void t;
  }

  /**
   * The tension curve: a slim ribbon below the hidden voices, scrolling with the
   * lead sheet. Its height and heat follow tension, so a chorus that stayed high
   * and never came down is plain to see. Structure tier: tinted, no glow.
   */
  private drawTension(sp: SpriteBatch, t: number): void {
    const { cx } = this.L;
    if (!this.tenCount) return;
    const v = this.speed;
    const base = this.y - this.H / 2 - 4 - this.bandH - this.ribbonH;
    const hh = this.ribbonH - 4;
    const span = cx - 24;
    // a hairline floor, so the ribbon reads as a gauge even at rest
    sp.rect((24 + cx) / 2, base, span / 2, 0.5, 0.6, 0.64, 0.78, 0.18);
    let xr = cx; // right edge of the newest sample: now
    for (let i = 0; i < this.tenCount; i++) {
      const j = (this.tenHead + TENSION_CAP - 1 - i) % TENSION_CAP;
      const x = cx - (t - this.tenT[j]) * v;
      if (x < 24) break;
      // each sample spans to the newer one, so a slow frame leaves no gaps
      const hw = Math.max(TENSION_STEP_PX / 2, (xr - x) / 2) + 0.3;
      const mx = (x + xr) / 2;
      xr = x;
      const val = this.tenV[j];
      if (val < 0.01) continue;
      const fade = Math.pow(Math.max(0, 1 - (cx - x) / span), 0.8);
      const r = CALM[0] + (HOT[0] - CALM[0]) * val, g = CALM[1] + (HOT[1] - CALM[1]) * val, b = CALM[2] + (HOT[2] - CALM[2]) * val;
      const h = Math.max(1, val * hh);
      sp.rect(mx, base + h / 2, hw, h / 2, r, g, b, (0.45 + 0.45 * val) * fade);
    }
  }

  /** Content of the loop block: the lap's chords in played order, which one sounds, laps so far. */
  private updateLoopBlock(loop: LoopLock | null): void {
    if (!loop) {
      this.loopTarget = 0;
      if (this.loopKey) {
        this.loopKey = '';
        this.loopLayer.changed();
      }
      return;
    }
    const p = loop.period;
    const lap = this.entries.filter((e) => e.seq > loop.to - p && e.seq <= loop.to);
    const names: { name: string; roman: string; root: number }[] = new Array(p);
    for (const e of lap) names[(((e.seq - loop.from) % p) + p) % p] = { name: e.name, roman: e.roman, root: e.root };
    for (let i = 0; i < p; i++) names[i] ??= { name: '·', roman: '', root: 0 };
    const cur = (((loop.to - loop.from) % p) + p) % p;
    const laps = Math.floor(loop.laps + 1e-6);
    const key = names.map((n) => n.name + n.roman).join('|') + `|${cur}|${laps}|${loop.name}`;
    if (key !== this.loopKey) {
      this.loopKey = key;
      this.loopNames = names;
      this.loopCur = cur;
      this.loopLaps = laps;
      this.loopName = loop.name ?? '';
      this.loopLayer.changed();
      this.loopTarget = this.loopWidth();
    }
  }

  private loopWidth(): number {
    const gap = this.nameSize * 0.55;
    let w = this.nameSize * 0.9; // ‖:
    for (const n of this.loopNames) w += this.nameWidth(n.name, n.roman) + gap;
    this.measure.font = `600 ${this.romanSize * 1.3}px ${MONO_FONT}`;
    w += this.nameSize * 0.6 + this.measure.measureText(`×${this.loopLaps}`).width + 6;
    return Math.min(w, this.L.w - 8);
  }

  private drawLoop(ctx: CanvasRenderingContext2D, _w: number, h: number): void {
    if (!this.loopKey) return;
    const gap = this.nameSize * 0.55;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const nameY = 2 + this.romanSize * 1.2;
    const signTop = nameY;
    const signH = this.nameSize * 1.1;
    const sign = (x: number, open: boolean) => {
      // ‖: or :‖ drawn as two bars and two dots
      ctx.fillStyle = 'rgba(200,206,225,0.85)';
      const thin = Math.max(1, this.nameSize * 0.04), thick = Math.max(2, this.nameSize * 0.11);
      const d = this.nameSize * 0.08;
      if (open) {
        ctx.fillRect(x, signTop, thick, signH);
        ctx.fillRect(x + thick + d, signTop, thin, signH);
        const dx = x + thick + d + thin + d * 1.6;
        ctx.beginPath();
        ctx.arc(dx, signTop + signH * 0.36, d * 0.8, 0, Math.PI * 2);
        ctx.arc(dx, signTop + signH * 0.64, d * 0.8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const dx = x + d * 0.8;
        ctx.beginPath();
        ctx.arc(dx, signTop + signH * 0.36, d * 0.8, 0, Math.PI * 2);
        ctx.arc(dx, signTop + signH * 0.64, d * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(dx + d * 1.6, signTop, thin, signH);
        ctx.fillRect(dx + d * 1.6 + thin + d, signTop, thick, signH);
      }
    };
    sign(0, true);
    let x = this.nameSize * 0.9;
    // the name rides on the bracket above; without brackets it sits on the block itself
    if (this.loopName && !this.bracketsOn) {
      ctx.font = `600 ${this.romanSize}px ${MONO_FONT}`;
      ctx.letterSpacing = '1.5px';
      ctx.fillStyle = 'rgba(200,206,225,0.8)';
      ctx.fillText(`↻ ${this.loopName.toUpperCase()}`, x, 2);
      ctx.letterSpacing = '0px';
    }
    this.loopNames.forEach((n, i) => {
      const cur = i === this.loopCur;
      ctx.font = `${cur ? 600 : 500} ${this.nameSize}px ${DISPLAY_FONT}`;
      ctx.fillStyle = cur ? 'rgba(244,246,252,1)' : 'rgba(170,176,192,1)';
      ctx.fillText(n.name, x, nameY);
      if (n.roman) {
        ctx.font = `500 ${this.romanSize}px ${MONO_FONT}`;
        ctx.fillStyle = cssOklch(n.root, cur ? 0.78 : 0.66, 0.06, 1);
        ctx.fillText(n.roman, x, nameY + this.nameSize * 1.15);
      }
      x += this.nameWidth(n.name, n.roman) + gap;
    });
    sign(x - gap * 0.4, false);
    x += this.nameSize * 0.6;
    ctx.font = `600 ${this.romanSize * 1.3}px ${MONO_FONT}`;
    ctx.fillStyle = 'rgba(200,206,225,0.9)';
    ctx.fillText(`×${this.loopLaps}`, x, nameY + this.nameSize * 0.2);
    void h;
  }

  /**
   * Move brackets above the names. Each spans the entries of its chord events;
   * a forming move is dotted and open on the right, a running loop solid and
   * open, a finished move closed, a move the music left greyed out.
   */
  private drawBrackets(sp: SpriteBatch, t: number, gap: number, span: number, loop: LoopLock | null): void {
    const { cx } = this.L;
    const base = this.y + this.H / 2 + 2;
    const live = new Set<string>();
    // Labels never overlap: the newest brackets claim their space first.
    const taken: [number, number, number][] = [];
    const order = [...this.brackets].sort((a, b) => b[1].mark.to - a[1].mark.to || a[1].mark.level - b[1].mark.level);
    for (const [key, b] of order) {
      const m = b.mark;
      let first: Entry | null = null, last: Entry | null = null;
      for (const e of this.entries) {
        if (e.seq < m.from || e.seq > m.to) continue;
        first ??= e;
        last = e;
      }
      if (!first || !last) {
        // scrolled off (or never shown): retire it once its chords are gone
        if (this.entries.length && this.entries[0].seq > m.to) {
          b.layer.opacity = 0;
          b.layer.changed();
          b.layer.update(t);
          this.spareBrackets.push(b.layer);
          this.brackets.delete(key);
        }
        continue;
      }
      // Inside a folded loop only the loop's own bracket shows, over the block.
      const inFold = !!loop && m.from >= loop.from;
      if (inFold && !(m.loop && m.level === 0)) {
        b.layer.opacity = 0;
        b.layer.update(t);
        continue;
      }
      live.add(key);
      const x0 = inFold ? cx - this.loopW : first.x0;
      const cur = Number.isNaN(last.t1);
      const x1 = inFold ? cx : cur ? cx : Math.max(x0 + 8, last.x1 - gap * 0.4);
      const fade = Math.pow(Math.max(0, 1 - (cx - x0) / span), 0.7) * 0.6 + (cur ? 0.4 : 0.25);
      const y = base + this.bracketRow * (m.level + 0.15);
      const left = m.state === 'left';
      const c = left ? [0.55, 0.58, 0.66] : [0.78, 0.82, 0.95];
      const op = Math.min(1, fade) * (left ? 0.4 : m.state === 'forming' ? 0.75 : 0.9);
      const tick = this.bracketRow * 0.35;
      const th = Math.max(1, this.nameSize * 0.035);
      if (m.state === 'forming') {
        for (let x = x0; x < x1; x += 5) sp.disc(x, y, th * 0.6, c[0], c[1], c[2], op);
      } else {
        sp.rect((x0 + x1) / 2, y, (x1 - x0) / 2, th / 2, c[0], c[1], c[2], op);
      }
      sp.rect(x0, y - tick / 2, th / 2, tick / 2, c[0], c[1], c[2], op);
      if (m.state === 'done' || left) sp.rect(x1, y - tick / 2, th / 2, tick / 2, c[0], c[1], c[2], op);
      // the label sits on the line at the left, its canvas hanging right, if it has room;
      // once the bracket's start scrolls off, the label sticks to the window's edge
      const lx = Math.max(x0, Math.min(16, x1 - b.tw - 3));
      const lx0 = lx + 3, lx1 = lx + 3 + b.tw;
      const clear = !taken.some(([lv, a0, a1]) => lv === m.level && a0 < lx1 + 8 && lx0 < a1 + 8);
      if (clear) taken.push([m.level, lx0, lx1]);
      b.layer.opacity = clear ? op : 0;
      b.layer.at(lx + this.W / 2 + 3, y + this.bracketRow * 0.42);
      b.layer.moveTo(lx + this.W / 2 + 3, y + this.bracketRow * 0.42);
      b.layer.update(t);
    }
    for (const [key, b] of this.brackets) {
      if (live.has(key)) continue;
      b.layer.opacity = 0;
      b.layer.update(t);
    }
  }

  private drawBracketLabel(ctx: CanvasRenderingContext2D, _w: number, h: number, layer: TextLayer): void {
    let b: Bracket | undefined;
    for (const x of this.brackets.values()) if (x.layer === layer) b = x;
    if (!b) return;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${this.romanSize * 0.95}px ${MONO_FONT}`;
    ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(214,220,240,1)';
    ctx.fillText(b.text, 0, h / 2);
    ctx.letterSpacing = '0px';
  }

  private nameWidth(name: string, roman: string): number {
    this.measure.font = `500 ${this.nameSize}px ${DISPLAY_FONT}`;
    let w = this.measure.measureText(name).width;
    this.measure.font = `500 ${this.romanSize}px ${MONO_FONT}`;
    w = Math.max(w, this.measure.measureText(roman).width);
    return Math.min(w, this.W - 4);
  }

  private drawEntry(ctx: CanvasRenderingContext2D, _w: number, h: number, layer: TextLayer): void {
    const e = this.entries.find((x) => x.layer === layer);
    if (!e) return;
    const cur = Number.isNaN(e.t1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let y = 2;
    let tx = 0;
    if (e.keyChange) {
      ctx.font = `600 ${this.romanSize}px ${MONO_FONT}`;
      ctx.letterSpacing = '2px';
      ctx.fillStyle = 'rgba(200,206,225,0.8)';
      ctx.fillText(e.keyChange.toUpperCase(), 0, y);
      tx = ctx.measureText(e.keyChange.toUpperCase()).width + 8;
      ctx.letterSpacing = '0px';
    }
    if (e.broke) {
      ctx.font = `600 ${this.romanSize}px ${MONO_FONT}`;
      ctx.letterSpacing = '1px';
      ctx.fillStyle = 'rgba(242,184,90,0.9)';
      ctx.fillText('↻ BREAK', tx, y);
      tx += ctx.measureText('↻ BREAK').width + 8;
      ctx.letterSpacing = '0px';
    }
    if (e.was) {
      // Reread in hindsight: the old reading, small, with an arrow to the name below.
      ctx.font = `500 ${this.romanSize}px ${MONO_FONT}`;
      ctx.fillStyle = 'rgba(170,176,192,0.75)';
      ctx.fillText(`${e.was} ↘`, tx, y);
    }
    y += this.romanSize * 1.2;
    ctx.font = `${cur ? 600 : 500} ${this.nameSize}px ${DISPLAY_FONT}`;
    ctx.fillStyle = cur ? 'rgba(244,246,252,1)' : 'rgba(170,176,192,1)';
    ctx.fillText(e.name, 0, y);
    y += this.nameSize * 1.15;
    if (e.roman) {
      ctx.font = `500 ${this.romanSize}px ${MONO_FONT}`;
      let x = 0;
      if (e.pivot) {
        // A pivot: its numeral in the old key, then in the new one.
        ctx.fillStyle = 'rgba(170,176,192,0.75)';
        const s = `${e.pivot} → `;
        ctx.fillText(s, 0, y);
        x = ctx.measureText(s).width;
      }
      ctx.fillStyle = cssOklch(e.root, 0.72, 0.06, 1);
      ctx.fillText(e.roman, x, y);
    }
    void h;
  }

  private drawFuture(ctx: CanvasRenderingContext2D, _w: number, _h: number, i: number): void {
    const f = this.future[i];
    if (!f) return;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let y = 2 + this.romanSize * 1.2;
    ctx.font = `400 ${this.nameSize}px ${DISPLAY_FONT}`;
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = cssOklch(f.root, 0.72, 0.07, 1);
    ctx.strokeText(f.name, 0.5, y);
    y += this.nameSize * 1.15;
    if (f.roman) {
      ctx.font = `500 ${this.romanSize}px ${MONO_FONT}`;
      ctx.fillStyle = cssOklch(f.root, 0.62, 0.05, 1);
      ctx.fillText(f.roman, 0, y);
    }
  }
}
