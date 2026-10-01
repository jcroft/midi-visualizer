// The Compass: 12 pitch classes in circle-of-fifths order, lit by what's
// sounding, with a polygon between them, a needle to the chord root, a dim
// key arc, prediction ghosts, and the chord / key / roman text.
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, MeshBasicNodeMaterial, type Scene, Vector3 } from 'three/webgpu';
import { uniform, vec4 } from 'three/tsl';
import type { Analysis } from '@shared/analysis';
import { BRIGHT_RGB, DIM_RGB, NOTE_RGB, POLY_RGB, cssOklch, fifthsPos } from './color';
import { type Layout, premultipliedBlend } from './layout';
import { type Spring, nearestAngle, stepSpring } from './spring';
import type { Cell, SpriteBatch } from './sprites';
import { TextLayer } from './text';
import {
  CHORD_FADE_IN,
  CHORD_FADE_OUT,
  CHORD_SIZE_R,
  DISPLAY_FONT,
  KEY_FADE,
  KEY_OMEGA,
  LABEL_RISE_PX,
  LIT_THRESHOLD,
  LOW_CONF,
  LOW_CONF_OPACITY,
  MONO_FONT,
  NEEDLE_OMEGA,
  NODE_FLARE_TAU,
  PC_SMOOTH_TAU,
  PRED_DELAY,
  PRED_FADE,
  PRED_MIN_OPACITY,
  RIPPLE_TIME,
} from './tuning';

const STEP = Math.PI / 6;
/** Angle of a pitch class on the ring: C at the top, fifths clockwise (y-up radians). */
export const angOf = (pc: number): number => Math.PI / 2 - fifthsPos(pc) * STEP;
const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** Parent major scale of a key, so the arc covers the 7 diatonic pitch classes. */
function parentMajor(tonic: number, mode: string): number {
  if (mode === 'minor') return mod12(tonic + 3);
  if (mode === 'dorian') return mod12(tonic - 2);
  if (mode === 'mixolydian') return mod12(tonic + 5);
  return tonic;
}

// Linear-sRGB greys used for structure.
const RING_GREY = [0.46, 0.52, 0.72] as const;
const LABEL_LIT = [0.83, 0.85, 0.94] as const;
const LABEL_DIM = [0.3, 0.34, 0.45] as const;

export class Compass {
  private a: Analysis | null = null;
  private readonly disp = new Float32Array(12);
  private readonly flare = new Float32Array(12);
  private readonly w = new Float32Array(12);
  private readonly lit = new Int8Array(12);
  private readonly litOrder = new Int8Array(12);

  private readonly needle: Spring = { x: angOf(0), v: 0 };
  private readonly keyArc: Spring = { x: angOf(0), v: 0 };
  private readonly keyTick: Spring = { x: angOf(0), v: 0 };
  private keyChangeT = -1e9;
  private lastKeyTonic = -1;
  private lastRoot = -1;

  private readonly ripRoot = new Int8Array(4).fill(-1);
  private readonly ripT = new Float64Array(4);
  private ripHead = 0;

  // Text state, captured when it changes.
  private chordName = '';
  private chordRoot = 0;
  private runner = '';
  private roman = '';
  private faint = false;
  private chordKey = '';
  private keyText = '';
  private predKey = '';
  private predT = -1e9;

  private readonly chordLayer: TextLayer;
  private readonly keyLayer: TextLayer;
  private readonly predLayer: TextLayer;

  // Polygon fill (triangle fan of up to 12 vertices).
  private readonly polyPos = new Float32Array(12 * 3);
  private readonly polyAttr: BufferAttribute;
  private readonly polyGeo: BufferGeometry;
  private readonly polyColor = uniform(new Vector3());
  private readonly polyAlpha = uniform(0);
  private readonly polyMesh: Mesh;

  private pcCells: Cell[] = [];
  private pedalCell: Cell | null = null;

  constructor(
    scene: Scene,
    private readonly L: Layout,
  ) {
    this.chordLayer = new TextLayer(scene, 60, (ctx, w, h) => this.drawChord(ctx, w, h), {
      out: CHORD_FADE_OUT,
      outRise: LABEL_RISE_PX,
      in: CHORD_FADE_IN,
      inRise: LABEL_RISE_PX,
      delay: 0,
    });
    this.keyLayer = new TextLayer(scene, 60, (ctx, w, h) => this.drawKey(ctx, w, h), {
      out: KEY_FADE,
      outRise: 0,
      in: KEY_FADE,
      inRise: 0,
      delay: 0,
    });
    this.predLayer = new TextLayer(scene, 45, (ctx, w, h) => this.drawPreds(ctx, w, h), {
      out: 0.15,
      outRise: 0,
      in: PRED_FADE,
      inRise: 0,
      delay: PRED_DELAY,
    });
    this.chordLayer.changed(); // shows "play a chord"

    const geo = new BufferGeometry();
    this.polyAttr = new BufferAttribute(this.polyPos, 3);
    this.polyAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', this.polyAttr);
    const idx: number[] = [];
    for (let i = 1; i < 11; i++) idx.push(0, i, i + 1);
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.polyGeo = geo;
    const mat = new MeshBasicNodeMaterial();
    mat.fragmentNode = vec4(this.polyColor.mul(this.polyAlpha), this.polyAlpha);
    premultipliedBlend(mat);
    this.polyMesh = new Mesh(geo, mat);
    this.polyMesh.frustumCulled = false;
    this.polyMesh.renderOrder = 40;
    scene.add(this.polyMesh);
  }

  setCells(pcCells: Cell[], pedalCell: Cell): void {
    this.pcCells = pcCells;
    this.pedalCell = pedalCell;
  }

  layout(): void {
    const { cx, cy, R, dpr } = this.L;
    this.chordLayer.place(cx, cy - R * 0.06, R * 2.0, R * 1.3, dpr);
    this.keyLayer.place(cx, cy + R * 1.62, R * 3.6, Math.max(18, R * 0.2), dpr);
    this.predLayer.place(cx, cy, R * 3.6, R * 3.6, dpr);
  }

  noteOn(note: number, vel: number): void {
    const pc = note % 12;
    if (vel > this.flare[pc]) this.flare[pc] = vel;
  }

  setAnalysis(a: Analysis, t: number): void {
    const prev = this.a;
    this.a = a;
    const c = a.chord;
    if (c) {
      const runner = c.conf < LOW_CONF && a.runnerUp ? a.runnerUp.name : '';
      const faint = c.conf < LOW_CONF;
      const roman = a.roman ?? '';
      const key = c.name + '|' + runner + '|' + roman + '|' + (faint ? 1 : 0);
      if (key !== this.chordKey) {
        this.chordKey = key;
        this.chordName = c.name;
        this.chordRoot = c.root;
        this.runner = runner;
        this.roman = roman;
        this.faint = faint;
        this.chordLayer.changed();
      }
      // Landed on a predicted root: ripple.
      if (a.changed && c.root !== this.lastRoot && prev && prev.predictions) {
        for (const p of prev.predictions) {
          if (p.root === c.root) {
            this.ripRoot[this.ripHead] = c.root;
            this.ripT[this.ripHead] = t;
            this.ripHead = (this.ripHead + 1) % this.ripRoot.length;
            break;
          }
        }
      }
      this.lastRoot = c.root;
    }

    const k = a.key;
    let kt = '';
    if (k) {
      let label = k.label.toUpperCase();
      if (k.mode === 'major' && !/MAJOR/.test(label)) label += ' MAJOR';
      kt = 'KEY · ' + label + (k.implied ? ' (IMPLIED)' : '');
      if (k.tonic !== this.lastKeyTonic) {
        this.keyChangeT = t;
        this.lastKeyTonic = k.tonic;
      }
    }
    if (kt !== this.keyText) {
      this.keyText = kt;
      this.keyLayer.changed();
    }

    let pk = '';
    for (const p of a.predictions) pk += p.root + p.name + Math.round(p.p * 20) + ';';
    if (pk !== this.predKey) {
      this.predKey = pk;
      this.predT = t;
      this.predLayer.changed();
    }
  }

  /**
   * Draw into the sprite batch. `instant` = 12 immediate pitch-class levels from
   * the local note state (so nodes light on the same frame as the key press).
   */
  draw(sp: SpriteBatch, t: number, dt: number, instant: Float32Array, pedalDown: boolean): void {
    const { cx, cy, R } = this.L;
    const s = R / 180; // size reference
    const a = this.a;
    const chord = a?.chord ?? null;

    // ---- weights ----
    const kSmooth = 1 - Math.exp(-dt / PC_SMOOTH_TAU);
    const kFlare = Math.exp(-dt / NODE_FLARE_TAU);
    let nLit = 0;
    for (let pc = 0; pc < 12; pc++) {
      const target = a ? a.pcs[pc] ?? 0 : 0;
      this.disp[pc] += (target - this.disp[pc]) * kSmooth;
      this.flare[pc] *= kFlare;
      const w = Math.min(1, Math.max(this.disp[pc], instant[pc]));
      this.w[pc] = w;
      this.lit[pc] = w > LIT_THRESHOLD ? 1 : 0;
    }
    // Lit pitch classes in ring order (by fifths position) -> convex polygon.
    for (let f = 0; f < 12; f++) {
      const pc = (f * 7) % 12; // inverse of fifthsPos
      if (this.lit[pc]) this.litOrder[nLit++] = pc;
    }

    // ---- springs ----
    if (chord) stepSpring(this.needle, nearestAngle(this.needle.x, angOf(chord.root)), NEEDLE_OMEGA, dt);
    const key = a?.key ?? null;
    if (key) {
      stepSpring(this.keyArc, nearestAngle(this.keyArc.x, angOf(parentMajor(key.tonic, key.mode))), KEY_OMEGA, dt);
      stepSpring(this.keyTick, nearestAngle(this.keyTick.x, angOf(key.tonic)), KEY_OMEGA, dt);
    }

    // ---- ring ----
    sp.ring(cx, cy, R, 1, RING_GREY[0], RING_GREY[1], RING_GREY[2], 0.16);

    // ---- key arc (covers the 7 diatonic pcs: IV .. VII of the parent major) ----
    if (key) {
      const pm = parentMajor(key.tonic, key.mode) * 3;
      const conf = 0.45 + 0.55 * Math.min(1, key.conf);
      const thick = Math.max(6, R * 0.07);
      sp.arc(cx, cy, R * 1.2, thick, this.keyArc.x - 2 * STEP, 3.4 * STEP, key.implied ? 14 : 0, DIM_RGB[pm], DIM_RGB[pm + 1], DIM_RGB[pm + 2], 0.55 * conf);
      const flash = Math.exp(-(t - this.keyChangeT) / 0.6);
      const tk = key.tonic * 3;
      sp.arc(cx, cy, R * 1.2, thick, this.keyTick.x, 0.13, 0, BRIGHT_RGB[tk], BRIGHT_RGB[tk + 1], BRIGHT_RGB[tk + 2], (0.5 + 0.5 * flash) * conf, true);
    }

    // ---- prediction ghosts: dotted curves from the root, opacity = p ----
    if (chord && a && a.predictions.length) {
      const fade = Math.min(1, Math.max(0, (t - this.predT - PRED_DELAY) / PRED_FADE));
      const x0 = cx + Math.cos(angOf(chord.root)) * R;
      const y0 = cy + Math.sin(angOf(chord.root)) * R;
      for (let i = 0; i < a.predictions.length && i < 3; i++) {
        const p = a.predictions[i];
        const op = Math.max(PRED_MIN_OPACITY, Math.min(1, p.p)) * fade;
        if (op <= 0.002) continue;
        const ar = angOf(p.root);
        const x1 = cx + Math.cos(ar) * R;
        const y1 = cy + Math.sin(ar) * R;
        const c3 = p.root * 3;
        const cr = BRIGHT_RGB[c3], cg = BRIGHT_RGB[c3 + 1], cb = BRIGHT_RGB[c3 + 2];
        sp.arc(x1, y1, 11 * s, 1.2, 0, Math.PI, 10, cr, cg, cb, op);
        if (p.root === chord.root) continue;
        let mx = (x0 + x1) / 2 - cx;
        let my = (y0 + y1) / 2 - cy;
        let ml = Math.hypot(mx, my);
        if (ml < 1e-3) {
          // Opposite side of the ring: bulge perpendicular.
          mx = -(y1 - y0);
          my = x1 - x0;
          ml = Math.hypot(mx, my) || 1;
        }
        const qx = cx + (mx / ml) * R * 1.55;
        const qy = cy + (my / ml) * R * 1.55;
        const approxLen = Math.hypot(qx - x0, qy - y0) + Math.hypot(x1 - qx, y1 - qy);
        const n = Math.max(4, Math.min(64, Math.floor(approxLen / (7 * s))));
        const dotR = (i === 0 ? 1.6 : 1.15) * Math.max(1, s);
        for (let k = 1; k < n; k++) {
          const u = k / n;
          const v = 1 - u;
          const x = v * v * x0 + 2 * v * u * qx + u * u * x1;
          const y = v * v * y0 + 2 * v * u * qy + u * u * y1;
          sp.disc(x, y, dotR, cr, cg, cb, op);
        }
      }
    }

    // ---- polygon between lit pitch classes ----
    if (nLit >= 3 && chord) {
      for (let i = 0; i < nLit; i++) {
        const ang = angOf(this.litOrder[i]);
        this.polyPos[i * 3] = cx + Math.cos(ang) * R;
        this.polyPos[i * 3 + 1] = cy + Math.sin(ang) * R;
        this.polyPos[i * 3 + 2] = 0;
      }
      this.polyAttr.needsUpdate = true;
      this.polyGeo.setDrawRange(0, (nLit - 2) * 3);
      const r3 = chord.root * 3;
      this.polyColor.value.set(POLY_RGB[r3], POLY_RGB[r3 + 1], POLY_RGB[r3 + 2]);
      this.polyAlpha.value = 0.16;
      this.polyMesh.visible = true;
      for (let i = 0; i < nLit; i++) {
        const p0 = this.litOrder[i];
        const p1 = this.litOrder[(i + 1) % nLit];
        sp.line(
          cx + Math.cos(angOf(p0)) * R, cy + Math.sin(angOf(p0)) * R,
          cx + Math.cos(angOf(p1)) * R, cy + Math.sin(angOf(p1)) * R,
          1.2, BRIGHT_RGB[r3], BRIGHT_RGB[r3 + 1], BRIGHT_RGB[r3 + 2], 0.4, true,
        );
      }
    } else {
      this.polyGeo.setDrawRange(0, 0);
      this.polyMesh.visible = false;
    }

    // ---- tritone shimmer (tension is a white-hot line, never a hue) ----
    for (let p = 0; p < 6; p++) {
      if (this.w[p] > 0.5 && this.w[p + 6] > 0.5) {
        const sh = 0.35 + 0.25 * Math.sin(t * 18);
        const a0 = angOf(p), a1 = angOf(p + 6);
        sp.line(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R, cx + Math.cos(a1) * R, cy + Math.sin(a1) * R, 1.5, 1, 0.92, 0.8, sh, true);
      }
    }

    // ---- nodes ----
    for (let pc = 0; pc < 12; pc++) {
      const ang = angOf(pc);
      const x = cx + Math.cos(ang) * R;
      const y = cy + Math.sin(ang) * R;
      const w = this.w[pc];
      const f = this.flare[pc];
      const c3 = pc * 3;
      if (w > 0.05 || f > 0.02) {
        // Saturation flares only on attack: blend toward the flare color.
        sp.glow(x, y, R * 0.2 * w + 6 + f * 14 * s, NOTE_RGB[c3] + f, NOTE_RGB[c3 + 1] + f, NOTE_RGB[c3 + 2] + f, 0.85 * w + f * 0.8);
        sp.disc(x, y, (3 + 4 * w) * Math.max(1, s), NOTE_RGB[c3] * (0.8 + w) + f * 0.5, NOTE_RGB[c3 + 1] * (0.8 + w) + f * 0.5, NOTE_RGB[c3 + 2] * (0.8 + w) + f * 0.5, 1);
      } else {
        sp.disc(x, y, 3 * Math.max(1, s), 0.3, 0.33, 0.45, 0.4);
      }
      const cell = this.pcCells[pc];
      if (cell) {
        const lc = w > LIT_THRESHOLD ? LABEL_LIT : LABEL_DIM;
        sp.glyph(cx + Math.cos(ang) * R * 0.84, cy + Math.sin(ang) * R * 0.84, cell, lc[0], lc[1], lc[2], w > LIT_THRESHOLD ? 0.9 : 0.6);
      }
    }

    // ---- inferred root: a hollow ring (rootless voicing) ----
    if (chord && chord.rootInferred) {
      const ang = angOf(chord.root);
      const c3 = chord.root * 3;
      sp.ring(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, 9 * Math.max(1, s), 1.6, BRIGHT_RGB[c3], BRIGHT_RGB[c3 + 1], BRIGHT_RGB[c3 + 2], 0.9);
    }

    // ---- needle ----
    if (chord) {
      const c3 = chord.root * 3;
      sp.arc(cx, cy, R * 1.07, 2.5, this.needle.x, 0.09, 0, BRIGHT_RGB[c3], BRIGHT_RGB[c3 + 1], BRIGHT_RGB[c3 + 2], 0.95, true);
    }

    // ---- ripples ----
    for (let i = 0; i < this.ripRoot.length; i++) {
      const root = this.ripRoot[i];
      if (root < 0) continue;
      const age = t - this.ripT[i];
      if (age > RIPPLE_TIME || age < 0) {
        this.ripRoot[i] = -1;
        continue;
      }
      const ang = angOf(root);
      const c3 = root * 3;
      sp.ring(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, 8 + age * 70 * s, 2, BRIGHT_RGB[c3], BRIGHT_RGB[c3 + 1], BRIGHT_RGB[c3 + 2], 1 - age / RIPPLE_TIME, true);
    }

    // ---- pedal indicator (bottom right) ----
    if (this.pedalCell) {
      const pc = this.pedalCell;
      const px = this.L.w - 28 - pc.w / 2;
      const py = 22;
      const op = pedalDown ? 0.85 : 0.35;
      sp.glyph(px, py, pc, LABEL_LIT[0], LABEL_LIT[1], LABEL_LIT[2], op);
      const dx = px + pc.w / 2 + 8;
      if (pedalDown) sp.disc(dx, py, 4, LABEL_LIT[0], LABEL_LIT[1], LABEL_LIT[2], op);
      else sp.ring(dx, py, 3.5, 1.2, LABEL_LIT[0], LABEL_LIT[1], LABEL_LIT[2], op);
    }

    // ---- text ----
    this.chordLayer.opacity = chord ? (chord.conf < LOW_CONF ? LOW_CONF_OPACITY : 1) : this.chordName ? 0.35 : 0.6;
    this.keyLayer.opacity = key ? 0.6 + 0.4 * Math.min(1, key.conf) : 0;
    this.predLayer.opacity = chord ? 1 : 0;
    this.chordLayer.update(t);
    this.keyLayer.update(t);
    this.predLayer.update(t);
  }

  // ---------- canvas text ----------

  private drawChord(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const R = this.L.R;
    const size = R * CHORD_SIZE_R;
    ctx.textBaseline = 'alphabetic';
    if (!this.chordName) {
      ctx.textAlign = 'center';
      ctx.font = `400 ${size * 0.32}px ${DISPLAY_FONT}`;
      ctx.fillStyle = 'rgba(170,178,200,0.8)';
      ctx.fillText('play a chord', w / 2, h / 2 + size * 0.1);
      return;
    }
    const m = this.chordName.match(/^([A-G][♭♯b#]?)([^/]*)(\/.*)?$/);
    const root = m ? m[1] : this.chordName;
    const qual = m ? m[2] : '';
    const slash = m && m[3] ? m[3] : '';
    const rf = `${this.faint ? 400 : 600} ${size}px ${DISPLAY_FONT}`;
    const qf = `${this.faint ? 400 : 500} ${size * 0.58}px ${DISPLAY_FONT}`;
    ctx.textAlign = 'left';
    ctx.font = rf;
    const rw = ctx.measureText(root).width;
    const sw = ctx.measureText(slash).width;
    ctx.font = qf;
    const qw = ctx.measureText(qual).width;
    const x = w / 2 - (rw + qw + sw) / 2;
    const base = h / 2 + size * 0.33;
    ctx.fillStyle = 'rgba(242,244,250,1)';
    ctx.font = rf;
    ctx.fillText(root, x, base);
    ctx.font = qf;
    ctx.fillText(qual, x + rw + 1, base - size * 0.42);
    ctx.font = rf;
    ctx.fillText(slash, x + rw + qw + 2, base);

    ctx.textAlign = 'center';
    let y = base + size * 0.62;
    if (this.runner) {
      ctx.font = `400 ${size * 0.34}px ${DISPLAY_FONT}`;
      ctx.fillStyle = 'rgba(200,206,225,0.5)';
      ctx.fillText('or ' + this.runner, w / 2, y);
      y += size * 0.5;
    }
    if (this.roman) {
      ctx.font = `500 ${Math.max(10, size * 0.3)}px ${MONO_FONT}`;
      ctx.fillStyle = cssOklch(this.chordRoot, 0.82, 0.08, 0.9);
      ctx.letterSpacing = '2px';
      ctx.fillText(this.roman, w / 2, y);
      ctx.letterSpacing = '0px';
    }
  }

  private drawKey(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.keyText) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `500 ${Math.max(10, this.L.R * 0.085)}px ${MONO_FONT}`;
    ctx.fillStyle = 'rgba(205,212,232,1)';
    ctx.letterSpacing = '2px';
    ctx.fillText(this.keyText, w / 2, h / 2);
    ctx.letterSpacing = '0px';
  }

  private drawPreds(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const a = this.a;
    if (!a || !a.chord) return;
    const R = this.L.R;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < a.predictions.length && i < 3; i++) {
      const p = a.predictions[i];
      const op = Math.max(PRED_MIN_OPACITY, Math.min(1, p.p));
      // Two predictions can share a root (e.g. C7 as V and as VI7): fan them along the ring.
      let stack = 0;
      for (let j = 0; j < i; j++) if (a.predictions[j].root === p.root) stack++;
      const ang = angOf(p.root) - stack * 0.32;
      const rr = R * 1.42;
      const lx = w / 2 + Math.cos(ang) * rr;
      const ly = h / 2 - Math.sin(ang) * rr; // canvas is y-down
      ctx.font = `500 ${Math.max(10, R * 0.1)}px ${DISPLAY_FONT}`;
      ctx.lineWidth = 1;
      ctx.strokeStyle = cssOklch(p.root, 0.85, 0.08, Math.min(1, op * 1.6));
      ctx.strokeText(p.name, lx, ly);
      ctx.font = `400 ${Math.max(9, R * 0.065)}px ${MONO_FONT}`;
      ctx.fillStyle = `rgba(190,198,220,${Math.min(1, op * 1.4)})`;
      ctx.fillText(`${Math.round(p.p * 100)}% ${p.why}`, lx, ly + R * 0.11);
    }
  }
}
