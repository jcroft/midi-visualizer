// The lead-sheet strip along the bottom of the compass view: past chords
// scroll left from a "now" point under the compass, the current chord sits just
// left of it, and the predicted next chords sit just right of it in outline.
//
// Tiers (see compass.ts): past entries are HEARD (grey, no glow), the current
// chord is PLAYED (white), the future is PREDICTED (outline, dotted underline).
import type { Scene } from 'three/webgpu';
import type { Fn } from '@shared/analysis';
import { cssOklch } from './color';
import type { Layout } from './layout';
import type { SpriteBatch } from './sprites';
import { TextLayer } from './text';
import { DISPLAY_FONT, HISTORY_FADE_POW, HISTORY_MAX, HISTORY_SPEED_R, MONO_FONT } from './tuning';
import { fnRgb } from './taxonomy';

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
}

interface Future {
  name: string;
  roman: string;
  root: number;
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
    // Clear of the button row (which fades out while playing).
    this.y = Math.max(this.H / 2 + 64, h * 0.045 + this.H / 2);
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
    const e: Entry = { name, roman, root, fn, keyChange, t0: t, t1: NaN, w: this.nameWidth(name, roman), layer, x0: 0, x1: 0 };
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

  draw(sp: SpriteBatch, t: number, visible: boolean, showFuture: boolean): void {
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
    if (e.keyChange) {
      ctx.font = `600 ${this.romanSize}px ${MONO_FONT}`;
      ctx.letterSpacing = '2px';
      ctx.fillStyle = 'rgba(200,206,225,0.8)';
      ctx.fillText(e.keyChange.toUpperCase(), 0, y);
      ctx.letterSpacing = '0px';
    }
    y += this.romanSize * 1.2;
    ctx.font = `${cur ? 600 : 500} ${this.nameSize}px ${DISPLAY_FONT}`;
    ctx.fillStyle = cur ? 'rgba(244,246,252,1)' : 'rgba(170,176,192,1)';
    ctx.fillText(e.name, 0, y);
    y += this.nameSize * 1.15;
    if (e.roman) {
      ctx.font = `500 ${this.romanSize}px ${MONO_FONT}`;
      ctx.fillStyle = cssOklch(e.root, 0.72, 0.06, 1);
      ctx.fillText(e.roman, 0, y);
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
