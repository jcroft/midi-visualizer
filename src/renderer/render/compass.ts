// The Compass: 12 pitch classes in circle-of-fifths order, lit by what's
// sounding, with a polygon between them, a needle (and trail) at the chord
// root, a key arc, an orbit of predicted next chords, and the chord / key /
// roman text. Every part is a layer that can be switched off (layers.ts).
//
// Radius stack (multiples of R): pitch names 0.84, ring 1, needle track 1.06,
// key arc 1.14, prediction orbit 1.30, prediction labels from 1.40 outward.
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, MeshBasicNodeMaterial, type Scene, Vector3 } from 'three/webgpu';
import { uniform, vec4 } from 'three/tsl';
import type { Analysis, Fn, Prediction } from '@shared/analysis';
import { BRIGHT_RGB, DIM_RGB, NOTE_RGB, POLY_RGB, cssOklch, fifthsPos } from './color';
import { type Layers, allLayersOn } from './layers';
import { type Layout, premultipliedBlend } from './layout';
import { type Spring, nearestAngle, stepSpring } from './spring';
import type { Cell, SpriteBatch } from './sprites';
import { TextLayer } from './text';
import {
  BADGE_FADE,
  BADGE_HOLD,
  BREATH_DEPTH,
  BREATH_HZ,
  CHORD_FADE_IN,
  CHORD_FADE_OUT,
  CHORD_MAX_W_R,
  CHORD_SIZE_R,
  COMET_FADE,
  COMET_FILL,
  DISPLAY_FONT,
  HAIRLINE,
  HISTORY_LEN,
  HISTORY_OPACITY,
  IDLE_AFTER,
  KEY_ARC_R,
  KEY_ARC_THICK,
  KEY_FADE,
  KEY_OMEGA,
  LABEL_RISE_PX,
  LIT_THRESHOLD,
  LOW_CONF,
  LOW_CONF_OPACITY,
  MONO_FONT,
  NEEDLE_OMEGA,
  NEEDLE_R,
  NODE_FLARE_TAU,
  ORBIT_R,
  PC_SMOOTH_TAU,
  POLY_ALPHA,
  PRED_DELAY,
  PRED_FADE,
  PRED_LABEL_R,
  PRED_OPACITY_BASE,
  PRED_OPACITY_GAIN,
  PRED_PULSE_DEPTH,
  PRED_PULSE_PERIOD,
  PRED_SIZE_BASE,
  PRED_SIZE_GAIN,
  RIPPLE_TIME,
  THEN_DIM,
  TRAIL_FADE,
  TRAIL_LEN,
  TRITONE_BASE,
  TRITONE_HZ,
  TRITONE_SWING,
} from './tuning';

const STEP = Math.PI / 6;
/** Angle of a pitch class on the ring: C at the top, fifths clockwise (y-up radians). */
export const angOf = (pc: number): number => Math.PI / 2 - fifthsPos(pc) * STEP;
const mod12 = (n: number): number => ((n % 12) + 12) % 12;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Parent major scale of a key, so the arc covers the 7 diatonic pitch classes. */
function parentMajor(tonic: number, mode: string): number {
  if (mode === 'minor') return mod12(tonic + 3);
  if (mode === 'dorian') return mod12(tonic - 2);
  if (mode === 'mixolydian') return mod12(tonic + 5);
  return tonic;
}

/** Prediction opacity from its probability. */
export const predOpacity = (p: number): number => Math.min(1, PRED_OPACITY_BASE + PRED_OPACITY_GAIN * p);

// Linear-sRGB greys used for structure.
const RING_GREY = [0.46, 0.52, 0.72] as const;
const LABEL_LIT = [0.83, 0.85, 0.94] as const;
const LABEL_DIM = [0.3, 0.34, 0.45] as const;

/** How a predicted chord's label hangs off its anchor point. */
type Align = 'left' | 'right' | 'top' | 'bottom';

/** One prediction label, laid out. Sizes are CSS px. */
interface PredLabel {
  root: number;
  name: string;
  sub: string;
  nameSize: number;
  subSize: number;
  align: Align;
  /** Anchor point on the label's inner edge (y-up). */
  ax: number;
  ay: number;
  /** Bounding box (y-up). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  opacity: number;
}

/** Prediction label canvas size, as multiples of R. */
const PRED_W = 1.3;
const PRED_H = 0.42;
const RIPPLES = 6;

export class Compass {
  layers: Layers = allLayersOn();

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

  // Trail of recent roots on the needle track (newest first) and when each was left.
  private readonly trailRoot = new Int8Array(TRAIL_LEN).fill(-1);
  private readonly trailT = new Float64Array(TRAIL_LEN);

  // Ripples on the ring: root, start time, strength 0..1, duration.
  private readonly ripRoot = new Int8Array(RIPPLES).fill(-1);
  private readonly ripT = new Float64Array(RIPPLES);
  private readonly ripK = new Float32Array(RIPPLES);
  private readonly ripDur = new Float32Array(RIPPLES);
  private ripHead = 0;

  // Landing comet: the ghost arc that was right fills in.
  private cometFrom = -1;
  private cometTo = -1;
  private cometT = -1e9;

  // Idle breathing.
  private noteFlag = false;
  private lastNoteT = 0;

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
  private badge = '';
  private badgeRoot = 0;
  private badgeT = -1e9;
  private readonly history: { name: string; roman: string; root: number }[] = [];

  private readonly chordLayer: TextLayer;
  private readonly keyLayer: TextLayer;
  private readonly predLayers: TextLayer[] = [];
  private readonly predLabels: (PredLabel | null)[] = [null, null, null];
  private readonly predLabelKeys = ['', '', ''];
  /** Last opacity of each label, kept while it fades out. */
  private readonly predLabelOp = [0, 0, 0];
  private thenOp = 0;
  private readonly thenLayer: TextLayer;
  private thenLabel: PredLabel | null = null;
  private thenKey = '';
  private readonly badgeLayer: TextLayer;
  private readonly historyLayer: TextLayer;
  private readonly measure = document.createElement('canvas').getContext('2d')!;

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
    const predFade = { out: 0.2, outRise: 0, in: PRED_FADE, inRise: 0, delay: PRED_DELAY };
    for (let i = 0; i < 3; i++) {
      this.predLayers.push(new TextLayer(scene, 45, (ctx, w, h) => this.drawPred(ctx, w, h, this.predLabels[i]), predFade));
    }
    this.thenLayer = new TextLayer(scene, 45, (ctx, w, h) => this.drawPred(ctx, w, h, this.thenLabel), {
      ...predFade,
      delay: PRED_DELAY + 0.15,
    });
    this.badgeLayer = new TextLayer(scene, 60, (ctx, w, h) => this.drawBadge(ctx, w, h), {
      out: 0.15,
      outRise: 0,
      in: 0.16,
      inRise: LABEL_RISE_PX,
      delay: 0.05,
    });
    this.historyLayer = new TextLayer(scene, 60, (ctx, w, h) => this.drawHistory(ctx, w, h), {
      out: 0.25,
      outRise: 0,
      in: 0.25,
      inRise: 0,
      delay: 0,
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

  setLayers(layers: Layers): void {
    this.layers = { ...layers };
  }

  layout(): void {
    const { cx, cy, R, dpr, w, h } = this.L;
    const compassView = this.L.view === 'compass';
    this.chordLayer.place(cx, cy - R * 0.06, R * 2.0, R * 1.3, dpr);
    if (compassView) {
      // Top right, out of the compass's way (the HUD lives top left).
      const kw = Math.max(260, R * 1.4);
      const kh = Math.max(20, R * 0.09);
      this.keyLayer.place(w - 24 - kw / 2, h - 24 - kh / 2, kw, kh, dpr);
    } else {
      this.keyLayer.place(cx, cy + R * 1.62, R * 3.6, Math.max(18, R * 0.2), dpr);
    }
    for (const l of this.predLayers) l.place(cx, cy, R * PRED_W, R * PRED_H, dpr);
    this.thenLayer.place(cx, cy, R * PRED_W, R * PRED_H, dpr);
    this.badgeLayer.place(cx, cy - R * 0.66, R * 1.6, Math.max(18, R * 0.12), dpr);
    const hh = Math.max(36, R * 0.15);
    const hw = Math.min(w * 0.42, Math.max(320, R * 1.9));
    this.historyLayer.place(24 + hw / 2, 64 + hh / 2, hw, hh, dpr);
    this.layoutPreds(true);
    this.historyLayer.changed();
    this.keyLayer.changed();
  }

  noteOn(note: number, vel: number): void {
    const pc = note % 12;
    if (vel > this.flare[pc]) this.flare[pc] = vel;
    this.noteFlag = true;
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

      // Chord history: a new event appends, a refinement rewrites the last entry.
      const last = this.history[this.history.length - 1];
      if (a.changed || !last) {
        this.history.push({ name: c.name, roman, root: c.root });
        if (this.history.length > HISTORY_LEN) this.history.shift();
        this.historyLayer.changed();
      } else if (last.name !== c.name || last.roman !== roman) {
        last.name = c.name;
        last.roman = roman;
        last.root = c.root;
        this.historyLayer.changed();
      }

      if (a.changed && c.root !== this.lastRoot) {
        // The root we left joins the trail.
        if (this.lastRoot >= 0) {
          for (let i = TRAIL_LEN - 1; i > 0; i--) {
            this.trailRoot[i] = this.trailRoot[i - 1];
            this.trailT[i] = this.trailT[i - 1];
          }
          this.trailRoot[0] = this.lastRoot;
          this.trailT[0] = t;
        }
      }

      // How did this chord relate to what we predicted?
      const land = a.landing;
      if (a.changed && land) {
        const hit = land.hit >= 0 && prev ? prev.predictions[land.hit] : null;
        if (land.exact && hit) {
          this.ripple(c.root, t, fnStrength(land.fn), RIPPLE_TIME);
          if (land.from !== c.root) {
            this.cometFrom = land.from;
            this.cometTo = c.root;
            this.cometT = t;
          }
        } else if (hit) {
          this.ripple(c.root, t, 0.5, RIPPLE_TIME); // right root, different color
        } else {
          this.ripple(c.root, t, 0.3, RIPPLE_TIME * 2); // a surprise: one slow, curious shimmer
        }
        if (land.label) {
          this.badge = land.label;
          this.badgeRoot = c.root;
          this.badgeT = t;
          this.badgeLayer.changed();
        }
      }
      if (a.changed) this.lastRoot = c.root;
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

    // The ghost arcs restart their fade-in only when the predicted chords change, not when a probability shifts.
    let pk = '';
    for (const p of a.predictions) pk += p.root + p.name + (p.then ? p.then.name : '') + ';';
    if (pk !== this.predKey) {
      this.predKey = pk;
      this.predT = t;
    }
    this.layoutPreds(false);
  }

  private ripple(root: number, t: number, k: number, dur: number): void {
    const i = this.ripHead;
    this.ripHead = (this.ripHead + 1) % RIPPLES;
    this.ripRoot[i] = root;
    this.ripT[i] = t;
    this.ripK[i] = k;
    this.ripDur[i] = dur;
  }

  // ---------- prediction label layout ----------

  /** Lay out the prediction labels around the orbit; crossfade the ones whose content or place changed. */
  private layoutPreds(force: boolean): void {
    const a = this.a;
    // Predictions stay up through a silence: the gap is exactly when "what's next" is useful.
    const preds = a ? a.predictions.slice(0, 3) : [];
    const placed: PredLabel[] = [];
    const out: (PredLabel | null)[] = [null, null, null];
    for (let i = 0; i < preds.length; i++) {
      const p = preds[i];
      let lab: PredLabel | null = this.makeLabel(p, i === 0, null, predOpacity(p.p));
      const host = placed.find((q) => overlaps(q, lab!, this.L.R * 0.02));
      if (host) {
        // Second tier, next to the label it hit.
        const cand = this.makeLabel(p, i === 0, host, predOpacity(p.p));
        lab = placed.some((q) => overlaps(q, cand, this.L.R * 0.02)) ? null : cand;
      }
      if (!lab) {
        // Still colliding two tiers out: merge onto the label it hits.
        const probe = this.makeLabel(p, false, null, 0);
        const host = placed.find((q) => overlaps(q, probe, this.L.R * 0.02));
        if (host) host.name += ' · ' + p.name;
        continue;
      }
      placed.push(lab);
      out[i] = lab;
    }

    // The second step, if it has room.
    let then: PredLabel | null = null;
    const top = preds[0];
    if (top && top.then) {
      const step = top.then;
      const pseudo: Prediction = { root: step.root, name: step.name, p: step.p, why: '', q: step.q, roman: step.roman, fn: null, kind: 'diatonic' };
      const op = predOpacity(top.p) * THEN_DIM;
      const cand = this.makeLabel(pseudo, false, null, op, 0.62);
      const host = placed.find((q) => overlaps(q, cand, this.L.R * 0.02));
      if (!host) then = cand;
      else {
        const c2 = this.makeLabel(pseudo, false, host, op, 0.62);
        if (!placed.some((q) => overlaps(q, c2, this.L.R * 0.02))) then = c2;
      }
    }

    for (let i = 0; i < 3; i++) {
      const lab = out[i];
      const key = lab ? `${lab.name}|${lab.sub}|${lab.align}|${Math.round(lab.ax)}|${Math.round(lab.ay)}|${lab.nameSize.toFixed(1)}` : '';
      this.predLabels[i] = lab;
      if (lab) this.predLabelOp[i] = lab.opacity;
      if (key !== this.predLabelKeys[i] || force) {
        this.predLabelKeys[i] = key;
        if (lab) this.predLayers[i].at(...this.canvasCenter(lab));
        this.predLayers[i].changed();
      }
    }
    const tk = then ? `${then.name}|${then.sub}|${Math.round(then.ax)}|${Math.round(then.ay)}` : '';
    this.thenLabel = then;
    if (then) this.thenOp = then.opacity;
    if (tk !== this.thenKey || force) {
      this.thenKey = tk;
      if (then) this.thenLayer.at(...this.canvasCenter(then));
      this.thenLayer.changed();
    }
  }

  /**
   * Lay out one label at its root's angle. With `host` (a label it collided
   * with) it becomes second tier: smaller, and stacked beside the host,
   * below it at the sides of the ring, to its right at 12 and 6 o'clock.
   */
  private makeLabel(p: Prediction, top: boolean, host: PredLabel | null, opacity: number, scale = 1): PredLabel {
    const { cx, cy, R } = this.L;
    const nameSize = (PRED_SIZE_BASE + PRED_SIZE_GAIN * Math.sqrt(Math.max(0, p.p))) * R * (host ? 0.85 : 1) * scale;
    const subSize = Math.max(10, R * 0.04 * (scale < 1 ? 0.85 : 1));
    const parts: string[] = [];
    if (p.roman) parts.push(p.roman);
    if (top) parts.push(p.why);
    if (p.kind === 'modulating' && p.tonicizes) parts.push(`→ ${p.tonicizes}`);
    const sub = parts.join('  ·  ');

    this.measure.font = `600 ${nameSize}px ${DISPLAY_FONT}`;
    let bw = this.measure.measureText(p.name).width;
    if (sub) {
      this.measure.font = `500 ${subSize}px ${MONO_FONT}`;
      bw = Math.max(bw, this.measure.measureText(sub).width + sub.length * 0.5);
    }
    bw = Math.min(bw, R * PRED_W);
    const bh = nameSize * 1.05 + (sub ? subSize * 1.35 : 0);

    const ang = angOf(p.root);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const align: Align = Math.abs(c) < 0.42 ? (s > 0 ? 'top' : 'bottom') : c > 0 ? 'left' : 'right';
    const gap = R * 0.03;
    let ax = cx + c * R * PRED_LABEL_R;
    let ay = cy + s * R * PRED_LABEL_R;
    if (host) {
      if (align === 'left' || align === 'right') ay = host.y0 - gap - bh / 2;
      else ax = host.x1 + gap + bw / 2;
    }
    let x0: number, x1: number, y0: number, y1: number;
    if (align === 'left') [x0, x1, y0, y1] = [ax, ax + bw, ay - bh / 2, ay + bh / 2];
    else if (align === 'right') [x0, x1, y0, y1] = [ax - bw, ax, ay - bh / 2, ay + bh / 2];
    else if (align === 'top') [x0, x1, y0, y1] = [ax - bw / 2, ax + bw / 2, ay, ay + bh];
    else [x0, x1, y0, y1] = [ax - bw / 2, ax + bw / 2, ay - bh, ay];
    return { root: p.root, name: p.name, sub, nameSize, subSize, align, ax, ay, x0, y0, x1, y1, opacity };
  }

  /** Center of the label's canvas so its block hangs off the anchor on the right side. */
  private canvasCenter(l: PredLabel): [number, number] {
    const W = this.L.R * PRED_W;
    const H = this.L.R * PRED_H;
    if (l.align === 'left') return [l.ax + W / 2, l.ay];
    if (l.align === 'right') return [l.ax - W / 2, l.ay];
    if (l.align === 'top') return [l.ax, l.ay + H / 2];
    return [l.ax, l.ay - H / 2];
  }

  /**
   * Draw into the sprite batch. `instant` = 12 immediate pitch-class levels from
   * the local note state (so nodes light on the same frame as the key press).
   */
  draw(sp: SpriteBatch, t: number, dt: number, instant: Float32Array, pedalDown: boolean): void {
    const { cx, cy, R } = this.L;
    const s = R / 180; // size reference
    const hair = Math.max(1, R * HAIRLINE);
    const a = this.a;
    const chord = a?.chord ?? null;
    const on = this.layers;

    if (this.noteFlag) {
      this.noteFlag = false;
      this.lastNoteT = t;
    }
    const idle = t - this.lastNoteT - IDLE_AFTER;
    const breath = idle > 0 ? 1 + BREATH_DEPTH * Math.sin(2 * Math.PI * BREATH_HZ * idle) : 1;

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
    sp.ring(cx, cy, R, hair, RING_GREY[0], RING_GREY[1], RING_GREY[2], 0.16 * breath);

    // ---- key arc (covers the 7 diatonic pcs: IV .. VII of the parent major) ----
    if (key && on.key) {
      const pm = parentMajor(key.tonic, key.mode) * 3;
      const conf = 0.45 + 0.55 * Math.min(1, key.conf);
      const thick = Math.max(6, R * KEY_ARC_THICK);
      const kr = R * KEY_ARC_R;
      sp.arc(cx, cy, kr, thick, this.keyArc.x - 2 * STEP, 3.4 * STEP, key.implied ? 14 : 0, DIM_RGB[pm], DIM_RGB[pm + 1], DIM_RGB[pm + 2], 0.55 * conf * breath);
      const flash = Math.exp(-(t - this.keyChangeT) / 0.6);
      const tk = key.tonic * 3;
      sp.arc(cx, cy, kr, thick, this.keyTick.x, 0.13, 0, BRIGHT_RGB[tk], BRIGHT_RGB[tk + 1], BRIGHT_RGB[tk + 2], (0.5 + 0.5 * flash) * conf, true);
    }

    // ---- prediction orbit: satellites, ghost arcs, the second step ----
    if (on.predictions) this.drawPredictions(sp, t);

    // ---- polygon between lit pitch classes ----
    if (nLit >= 3 && chord && on.shape) {
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
      this.polyAlpha.value = POLY_ALPHA;
      this.polyMesh.visible = true;
      for (let i = 0; i < nLit; i++) {
        const p0 = this.litOrder[i];
        const p1 = this.litOrder[(i + 1) % nLit];
        sp.line(
          cx + Math.cos(angOf(p0)) * R, cy + Math.sin(angOf(p0)) * R,
          cx + Math.cos(angOf(p1)) * R, cy + Math.sin(angOf(p1)) * R,
          hair * 1.2, BRIGHT_RGB[r3], BRIGHT_RGB[r3 + 1], BRIGHT_RGB[r3 + 2], 0.4, true,
        );
      }
    } else {
      this.polyGeo.setDrawRange(0, 0);
      this.polyMesh.visible = false;
    }

    // ---- tritone shimmer (tension is a white-hot line, never a hue) ----
    if (on.tension) {
      for (let p = 0; p < 6; p++) {
        if (this.w[p] > 0.5 && this.w[p + 6] > 0.5) {
          const sh = TRITONE_BASE + TRITONE_SWING * Math.sin(t * 2 * Math.PI * TRITONE_HZ);
          const a0 = angOf(p), a1 = angOf(p + 6);
          sp.line(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R, cx + Math.cos(a1) * R, cy + Math.sin(a1) * R, hair * 1.5, 1, 0.92, 0.8, sh, true);
        }
      }
    }

    // ---- nodes ----
    if (on.notes) {
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
        sp.ring(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, 9 * Math.max(1, s), 1.6 * Math.max(1, s), BRIGHT_RGB[c3], BRIGHT_RGB[c3 + 1], BRIGHT_RGB[c3 + 2], 0.9);
      }
    }

    // ---- needle, and the trail of recent roots on its track ----
    if (on.needle) {
      const nr = R * NEEDLE_R;
      let prevAng = chord ? this.needle.x : NaN;
      for (let i = 0; i < TRAIL_LEN; i++) {
        const root = this.trailRoot[i];
        if (root < 0) break;
        const age = t - this.trailT[i];
        const k = 1 - age / TRAIL_FADE;
        if (k <= 0) {
          this.trailRoot[i] = -1;
          break;
        }
        const ang = angOf(root);
        const op = [0.45, 0.25, 0.12][i] ?? 0.1;
        const c3 = root * 3;
        sp.arc(cx, cy, nr, 1.6 * Math.max(1, s), ang, 0.045, 0, BRIGHT_RGB[c3], BRIGHT_RGB[c3 + 1], BRIGHT_RGB[c3 + 2], op * k, true);
        if (!Number.isNaN(prevAng)) {
          // thin arc joining this root to the next-newer one, the short way round
          const near = nearestAngle(prevAng, ang);
          const mid = (prevAng + near) / 2;
          const half = Math.abs(near - prevAng) / 2;
          if (half > 0.01) sp.arc(cx, cy, nr, Math.max(1, R * 0.003), mid, half, 0, RING_GREY[0], RING_GREY[1], RING_GREY[2], 0.3 * k, true);
        }
        prevAng = ang;
      }
      if (chord) {
        const c3 = chord.root * 3;
        sp.arc(cx, cy, nr, 2.5 * Math.max(1, s), this.needle.x, 0.09, 0, BRIGHT_RGB[c3], BRIGHT_RGB[c3 + 1], BRIGHT_RGB[c3 + 2], 0.95, true);
      }
    }

    // ---- ripples ----
    for (let i = 0; i < RIPPLES; i++) {
      const root = this.ripRoot[i];
      if (root < 0) continue;
      const age = t - this.ripT[i];
      const dur = this.ripDur[i];
      if (age > dur || age < 0) {
        this.ripRoot[i] = -1;
        continue;
      }
      if (!on.predictions) continue;
      const ang = angOf(root);
      const c3 = root * 3;
      const k = this.ripK[i];
      sp.ring(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, 8 + (age / dur) * RIPPLE_TIME * 70 * s * (0.6 + 0.6 * k), 2 * Math.max(1, s), BRIGHT_RGB[c3], BRIGHT_RGB[c3 + 1], BRIGHT_RGB[c3 + 2], (1 - age / dur) * k, true);
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
    const chordOp = chord ? (chord.conf < LOW_CONF ? LOW_CONF_OPACITY : 1) : this.chordName ? 0.35 : 0.6;
    this.chordLayer.opacity = on.chord ? chordOp : 0;
    this.keyLayer.opacity = key && on.key ? 0.6 + 0.4 * Math.min(1, key.conf) : 0;
    for (let i = 0; i < 3; i++) this.predLayers[i].opacity = on.predictions ? this.predLabelOp[i] : 0;
    this.thenLayer.opacity = on.predictions ? this.thenOp : 0;
    const bAge = t - this.badgeT;
    if (this.badge && bAge > BADGE_HOLD + BADGE_FADE) {
      // Clear it, so the next badge doesn't crossfade from a stale one.
      this.badge = '';
      this.badgeLayer.changed();
    }
    this.badgeLayer.opacity = on.predictions ? (bAge < BADGE_HOLD ? 1 : clamp01(1 - (bAge - BADGE_HOLD) / BADGE_FADE)) : 0;
    this.historyLayer.opacity = on.history && this.L.view === 'compass' ? 1 : 0;
    this.chordLayer.update(t);
    this.keyLayer.update(t);
    for (const l of this.predLayers) l.update(t);
    this.thenLayer.update(t);
    this.badgeLayer.update(t);
    this.historyLayer.update(t);
  }

  private drawPredictions(sp: SpriteBatch, t: number): void {
    const { cx, cy, R } = this.L;
    const a = this.a;
    const chord = a?.chord ?? null;
    const orbit = R * ORBIT_R;
    sp.ring(cx, cy, orbit, Math.max(1, R * 0.003), RING_GREY[0], RING_GREY[1], RING_GREY[2], 0.05);

    const fromRoot = chord ? chord.root : this.lastRoot;
    if (fromRoot >= 0 && a && a.predictions.length) {
      const fade = clamp01((t - this.predT - PRED_DELAY) / PRED_FADE);
      const phase = ((t - this.predT) % PRED_PULSE_PERIOD) / PRED_PULSE_PERIOD;
      const from = angOf(fromRoot);
      for (let i = 0; i < a.predictions.length && i < 3; i++) {
        const p = a.predictions[i];
        const op = predOpacity(p.p) * fade;
        if (op <= 0.002) continue;
        const c3 = p.root * 3;
        const cr = BRIGHT_RGB[c3], cg = BRIGHT_RGB[c3 + 1], cb = BRIGHT_RGB[c3 + 2];
        const ang = angOf(p.root);
        // satellite on the orbit
        sp.disc(cx + Math.cos(ang) * orbit, cy + Math.sin(ang) * orbit, (0.012 + 0.018 * p.p) * R, cr, cg, cb, op);
        sp.glow(cx + Math.cos(ang) * orbit, cy + Math.sin(ang) * orbit, (0.05 + 0.05 * p.p) * R, cr, cg, cb, op * 0.35);
        if (p.root !== fromRoot) {
          this.spiral(sp, from, R * NEEDLE_R, ang, orbit, (0.004 + 0.006 * p.p) * R, cr, cg, cb, op, phase, 1);
        }
        // the chord after next, chained off the top prediction along the orbit
        if (i === 0 && p.then && p.then.root !== p.root) {
          const tc = p.then.root * 3;
          const tang = angOf(p.then.root);
          const top = op * THEN_DIM;
          sp.disc(cx + Math.cos(tang) * orbit, cy + Math.sin(tang) * orbit, (0.008 + 0.012 * p.then.p) * R, BRIGHT_RGB[tc], BRIGHT_RGB[tc + 1], BRIGHT_RGB[tc + 2], top);
          this.spiral(sp, ang, orbit, tang, orbit, 0.004 * R, BRIGHT_RGB[tc], BRIGHT_RGB[tc + 1], BRIGHT_RGB[tc + 2], top, (phase + 0.5) % 1, 1);
        }
      }
    }

    // landing comet: the arc that was right fills root -> target, then fades
    const age = t - this.cometT;
    if (this.cometTo >= 0 && age < COMET_FILL + COMET_FADE) {
      const u = clamp01(age / COMET_FILL);
      const k = age < COMET_FILL ? 1 : 1 - (age - COMET_FILL) / COMET_FADE;
      const c3 = this.cometTo * 3;
      this.spiral(sp, angOf(this.cometFrom), R * NEEDLE_R, angOf(this.cometTo), orbit, 0.009 * R, BRIGHT_RGB[c3] * 1.3, BRIGHT_RGB[c3 + 1] * 1.3, BRIGHT_RGB[c3 + 2] * 1.3, k, -1, u);
    }
  }

  /**
   * A dotted path from (a0, r0) to (a1, r1) in polar coordinates, the short way
   * round, easing outward. `phase` (0..1, or -1 for none) places a soft
   * brightness pulse along it; `upTo` draws only the first part (0..1).
   */
  private spiral(sp: SpriteBatch, a0: number, r0: number, a1: number, r1: number, dotR: number, cr: number, cg: number, cb: number, op: number, phase: number, upTo: number): void {
    const { cx, cy, R } = this.L;
    let d = a1 - a0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) < 1e-3) return;
    const len = Math.abs(d) * (r0 + r1) * 0.5 + Math.abs(r1 - r0);
    const n = Math.max(4, Math.min(96, Math.floor(len / (0.035 * R))));
    const rr = Math.max(1, dotR);
    for (let k = 1; k < n; k++) {
      const u = k / n;
      if (u > upTo) break;
      const e = u * u * (3 - 2 * u);
      const ang = a0 + d * u;
      const r = r0 + (r1 - r0) * e;
      let b = 1;
      if (phase >= 0) {
        const dp = u - phase;
        b += PRED_PULSE_DEPTH * Math.exp(-(dp * dp) / 0.008);
      }
      sp.disc(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, rr, cr * b, cg * b, cb * b, op);
    }
  }

  // ---------- canvas text ----------

  private drawChord(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const R = this.L.R;
    let size = R * CHORD_SIZE_R;
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
    const fonts = (sz: number) => ({
      rf: `${this.faint ? 400 : 600} ${sz}px ${DISPLAY_FONT}`,
      qf: `${this.faint ? 400 : 500} ${sz * 0.58}px ${DISPLAY_FONT}`,
    });
    const widths = (sz: number) => {
      const f = fonts(sz);
      ctx.font = f.rf;
      const rw = ctx.measureText(root).width;
      const sw = ctx.measureText(slash).width;
      ctx.font = f.qf;
      const qw = ctx.measureText(qual).width;
      return { rw, sw, qw };
    };
    // Shrink long names (C7(♭9♯11)/E) so they never run into the pitch labels.
    let wd = widths(size);
    const maxW = R * CHORD_MAX_W_R;
    const total = wd.rw + wd.qw + wd.sw;
    if (total > maxW) {
      size *= maxW / total;
      wd = widths(size);
    }
    const { rf, qf } = fonts(size);
    const { rw, qw, sw } = wd;
    const x = w / 2 - (rw + qw + sw) / 2;
    const base = h / 2 + size * 0.33;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(242,244,250,1)';
    ctx.font = rf;
    ctx.fillText(root, x, base);
    ctx.font = qf;
    ctx.fillText(qual, x + rw + 1, base - size * 0.42);
    ctx.font = rf;
    ctx.fillText(slash, x + rw + qw + 2, base);

    const ref = R * CHORD_SIZE_R;
    ctx.textAlign = 'center';
    let y = base + ref * 0.62;
    if (this.runner) {
      ctx.font = `400 ${ref * 0.34}px ${DISPLAY_FONT}`;
      ctx.fillStyle = 'rgba(200,206,225,0.5)';
      ctx.fillText('or ' + this.runner, w / 2, y);
      y += ref * 0.5;
    }
    if (this.roman) {
      ctx.font = `500 ${Math.max(10, ref * 0.3)}px ${MONO_FONT}`;
      ctx.fillStyle = cssOklch(this.chordRoot, 0.82, 0.08, 0.9);
      ctx.letterSpacing = '2px';
      ctx.fillText(this.roman, w / 2, y);
      ctx.letterSpacing = '0px';
    }
  }

  private drawKey(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.keyText) return;
    const compassView = this.L.view === 'compass';
    ctx.textBaseline = 'middle';
    ctx.font = `500 ${compassView ? Math.max(12, this.L.R * 0.045) : Math.max(10, this.L.R * 0.085)}px ${MONO_FONT}`;
    ctx.fillStyle = 'rgba(205,212,232,1)';
    ctx.letterSpacing = '2px';
    if (compassView) {
      ctx.textAlign = 'right';
      ctx.fillText(this.keyText, w - 2, h / 2);
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(this.keyText, w / 2, h / 2);
    }
    ctx.letterSpacing = '0px';
  }

  private drawPred(ctx: CanvasRenderingContext2D, w: number, h: number, l: PredLabel | null): void {
    if (!l) return;
    const bh = l.nameSize * 1.05 + (l.sub ? l.subSize * 1.35 : 0);
    let top: number;
    let x: number;
    if (l.align === 'left') {
      ctx.textAlign = 'left';
      x = 2;
      top = h / 2 - bh / 2;
    } else if (l.align === 'right') {
      ctx.textAlign = 'right';
      x = w - 2;
      top = h / 2 - bh / 2;
    } else {
      ctx.textAlign = 'center';
      x = w / 2;
      top = l.align === 'top' ? h - bh : 0;
    }
    ctx.textBaseline = 'top';
    ctx.font = `600 ${l.nameSize}px ${DISPLAY_FONT}`;
    ctx.fillStyle = cssOklch(l.root, 0.88, 0.09, 1);
    ctx.fillText(l.name, x, top);
    if (l.sub) {
      ctx.font = `500 ${l.subSize}px ${MONO_FONT}`;
      ctx.fillStyle = 'rgba(200,206,225,0.62)';
      ctx.letterSpacing = '0.5px';
      ctx.fillText(l.sub, x, top + l.nameSize * 1.08);
      ctx.letterSpacing = '0px';
    }
  }

  private drawBadge(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.badge) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.max(12, this.L.R * 0.058)}px ${MONO_FONT}`;
    ctx.fillStyle = cssOklch(this.badgeRoot, 0.9, 0.1, 1);
    ctx.letterSpacing = '3px';
    ctx.fillText(this.badge.toUpperCase(), w / 2, h / 2);
    ctx.letterSpacing = '0px';
  }

  private drawHistory(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const R = this.L.R;
    const nameSize = Math.max(16, R * 0.075);
    const romanSize = Math.max(10, R * 0.035);
    const gap = nameSize * 0.9;
    const nameFont = `500 ${nameSize}px ${DISPLAY_FONT}`;
    const romanFont = `500 ${romanSize}px ${MONO_FONT}`;
    // Fit as many of the newest as there's room for; oldest on the left.
    const cols: number[] = [];
    let total = 0;
    let first = this.history.length;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const e = this.history[i];
      ctx.font = nameFont;
      let cw = ctx.measureText(e.name).width;
      if (e.roman) {
        ctx.font = romanFont;
        cw = Math.max(cw, ctx.measureText(e.roman).width);
      }
      if (total + cw > w) break;
      cols.unshift(cw);
      total += cw + gap;
      first = i;
    }
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    let x = 0;
    for (let i = first; i < this.history.length; i++) {
      const e = this.history[i];
      const op = HISTORY_OPACITY[this.history.length - 1 - i] ?? 0.15;
      ctx.font = nameFont;
      ctx.fillStyle = `rgba(232,236,246,${op})`;
      ctx.fillText(e.name, x, 2);
      if (e.roman) {
        ctx.font = romanFont;
        ctx.fillStyle = cssOklch(e.root, 0.82, 0.08, op);
        ctx.fillText(e.roman, x, 4 + nameSize * 1.1);
      }
      x += cols[i - first] + gap;
    }
  }
}

/** Ripple strength by the function of the chord we landed on: the tonic gets the biggest. */
function fnStrength(fn: Fn | null): number {
  return fn === 'T' ? 1 : fn === 'SD' ? 0.8 : 0.7;
}

function overlaps(a: PredLabel, b: PredLabel, m: number): boolean {
  return a.x0 - m < b.x1 && b.x0 - m < a.x1 && a.y0 - m < b.y1 && b.y0 - m < a.y1;
}
