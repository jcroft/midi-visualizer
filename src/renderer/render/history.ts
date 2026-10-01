// The lead-sheet strip along the bottom of the compass view: past chords
// scroll left from a "now" point under the compass, the current chord sits just
// left of it, and the predicted next chords sit just right of it in outline.
//
// Tiers (see compass.ts): past entries are HEARD (grey, no glow), the current
// chord is PLAYED (white), the future is PREDICTED (outline, dotted underline).
import type { Scene } from 'three/webgpu';
import type { Fn, Reread } from '@shared/analysis';
import { chordTones, resolveVoice, voiceLeading, type FnClass, type VoicingReading } from '@theory/voicing';
import { cssOklch, oklchToLinear } from './color';
import type { Layout } from './layout';
import type { SpriteBatch } from './sprites';
import { TextLayer } from './text';
import { DISPLAY_FONT, HISTORY_FADE_POW, HISTORY_MAX, HISTORY_SPEED_R, MONO_FONT } from './tuning';
import { ROLE_RGB, fnRgb } from './taxonomy';

/** At most this many voices (lowest first: the left hand) get a hidden-voice line. */
const VOICE_CAP = 5;
/** Tension samples kept for the curve (one per ~4 px of scroll). */
const TENSION_CAP = 1024;
const TENSION_STEP_PX = 4;
const lin = (L: number, C: number, h: number) => oklchToLinear(L, C, h, new Float32Array(3));
/** The tension ribbon runs from a cool, quiet grey-blue at rest to a hot coral at full pull. */
const CALM = lin(0.6, 0.05, 240);
const HOT = lin(0.74, 0.16, 30);

interface Entry {
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
  }

  layout(): void {
    const { R, h, dpr } = this.L;
    this.nameSize = Math.max(16, R * 0.07);
    this.romanSize = Math.max(10, R * 0.032);
    this.H = Math.ceil(this.romanSize * 1.2 + this.nameSize * 1.15 + this.romanSize * 1.5 + 8);
    this.W = Math.ceil(R * 1.0);
    // Clear of the button row (which fades out while playing), with room under it for the hidden voices.
    this.bandH = this.voicesOn ? Math.max(28, R * 0.16) : 0;
    this.ribbonH = this.tensionOn ? Math.max(14, R * 0.07) : 0;
    this.y = Math.max(this.H / 2 + 64, h * 0.045 + this.H / 2) + this.bandH + this.ribbonH;
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
  }

  /** Top edge of the strip (y-up), for keeping prediction labels clear of it. */
  get top(): number {
    return this.y + this.H / 2;
  }

  /** True while the newest entry is still sounding. */
  get hasCurrent(): boolean {
    const cur = this.entries[this.entries.length - 1];
    return !!cur && Number.isNaN(cur.t1);
  }

  /** A new chord event. */
  push(name: string, roman: string, root: number, fn: Fn | null, keyChange: string, t: number): void {
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
    const e: Entry = { name, roman, root, fn, keyChange, t0: t, t1: NaN, w: this.nameWidth(name, roman), layer, x0: 0, x1: 0, was: '', pivot: '', voices: [], roles: [] };
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
    if (t - last < TENSION_STEP_PX / (HISTORY_SPEED_R * this.L.R)) return;
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
    const v = HISTORY_SPEED_R * this.L.R;
    const gap = this.nameSize * 0.9;
    const span = cx - 24;
    const barY = this.y - this.H / 2 + 4;

    // Lay out newest to oldest, pushing older entries left so names never overlap.
    let limit = cx;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
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

    for (const e of this.entries) {
      const cur = Number.isNaN(e.t1);
      const d = cx - e.x0;
      const fade = cur ? 1 : 0.85 * Math.pow(Math.max(0, 1 - d / span), HISTORY_FADE_POW);
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
      if (!e.voices.length) continue;
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
    if (!showFuture || !last || !Number.isNaN(last.t1) || !last.voices.length || !f) return;
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
    const v = HISTORY_SPEED_R * this.L.R;
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
