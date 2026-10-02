// The Compass: 12 pitch classes in circle-of-fifths order, lit by what's
// sounding, with a polygon between them, a needle (and trail) at the chord
// root, a key arc, an orbit of predicted next chords, and the chord / key /
// roman text. Every part is a layer that can be switched off (layers.ts).
//
// Radius stack (multiples of R): pitch names 0.84, ring 1, needle track 1.06,
// key arc 1.14, prediction orbit 1.30, prediction labels from 1.40 outward.
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, MeshBasicNodeMaterial, type Scene, Vector3 } from 'three/webgpu';
import { uniform, vec4 } from 'three/tsl';
import type { Analysis, Fn, MoveMark, Prediction } from '@shared/analysis';
import { BRIGHT_RGB, DIM_RGB, NOTE_RGB, POLY_RGB, cssOklch, fifthsPos } from './color';
import { type Layers, defaultLayers } from './layers';
import { type Layout, premultipliedBlend } from './layout';
import { type Spring, nearestAngle, stepSpring } from './spring';
import type { Cell, SpriteBatch } from './sprites';
import { TextLayer } from './text';
import { HistoryStrip } from './history';
import { Stack } from './stack';
import { FN_RGB, OFFER_CSS, OFFER_RGB, ROLE_RGB, fnFromRoman } from './taxonomy';
import { chordTones, tendencies, type Tendency } from '@theory/voicing';
import { readLineNote, scaleFor, type LineNote, type ScaleReading } from '@theory/scales';
import { reharmsFor, type Reharm } from '@theory/reharm';
import { tensionOf } from '@theory/tension';
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
  KEY_TITLE_R,
  KEY_TITLE_SIZE,
  WEATHER_ALPHA,
  WEATHER_R,
  WEATHER_TAU,
  WHEEL_OMEGA,
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
/** Wheel rotation (radians, CCW). 0 = C at the top; tonic-up turns it so the key's tonic is there. */
let wheel = 0;
/** Angle of a pitch class on the unturned ring: C at the top, fifths clockwise (y-up radians). */
const baseAng = (pc: number): number => Math.PI / 2 - fifthsPos(pc) * STEP;
/** Angle of a pitch class on the ring as drawn. */
export const angOf = (pc: number): number => baseAng(pc) + wheel;
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

/** What the hands and feet are doing, beyond which notes sound (the Pedal & touch layer). */
export interface Touch {
  /** Per pitch class, level of keys held down under the fingers. */
  held: Float32Array;
  /** Per pitch class, level of notes held only by the sustain pedal. */
  pedalOnly: Float32Array;
  /** Per MIDI note, velocity 0..1 of its latest strike (0 when silent). */
  vel: Float32Array;
  /** Sustain pedal depth 0..1 (half-pedal reads as a thinner wash). */
  pedal: number;
  /** Soft pedal 0..1. */
  soft: number;
}

/** How long a landed tendency tail stays lit, s. */
const TAIL_LAND = 0.9;
/** Damper sweep on pedal lift, s. */
const DAMPER_SWEEP = 0.28;

/** Scale halo radius and thickness (× R): a band just inside the ring, outside the pitch names. */
const HALO_R = 0.93;
const HALO_THICK = 0.03;
/** A right-hand note counts as a line note when no other key went down within this long (s). */
const LINE_SETTLE = 0.04;
/** How long a line note's mark stays, and an enclosure's bracket, s. */
const LINE_FADE = 1.2;
const ENC_FADE = 1.6;
/** Reharm diamonds sit between the key arc and the prediction orbit (× R). */
const OFFER_R = 1.22;
/** Tension follows the analysis with this time constant, s. */
const TENSION_TAU = 0.2;

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
  layers: Layers = defaultLayers();

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
  /** The rest of the badge, drawn lower case after the name: "gospel · 3rd today", "×4". */
  private badgeRest = '';
  private badgeRoot = 0;
  /** The move in force, for its shape inside the ring. */
  private shape: MoveMark | null = null;
  private shapeT = -1e9;
  private badgeT = -1e9;
  private keyTonicName = '';
  private keyModeName = '';
  private keyImplied = false;
  private keyParent = '';
  private histKey = '';
  // Tendency tails toward the top prediction, and the ones that just landed.
  private tails: Tendency[] = [];
  private tailKey = '';
  private landed: Tendency[] = [];
  private landT = -1e9;
  // Scale halo: the chord-scale, faded in per pitch class, and the marks on it (0 none, 1 color tone, 2 alteration).
  private scale: ScaleReading | null = null;
  private scaleKey = '';
  private scaleName = '';
  private readonly haloW = new Float32Array(12);
  // Line reading: right-hand single notes against the scale.
  private line: LineNote[] = [];
  private lineNote = -1;
  private lineT = 0;
  private lastOnT = -1e9;
  private encPc = -1;
  private encT = -1e9;
  private readonly encLayer: TextLayer;
  // Reharm offers: diamonds for what you could play instead.
  private offers: Reharm[] = [];
  private offerKey = '';
  private offerSig = '';
  private offerT = -1e9;
  private readonly offerLayers: TextLayer[] = [];
  private readonly offerLabels: (PredLabel | null)[] = [null, null, null];
  private readonly offerLabelKeys = ['', '', ''];
  private readonly offerWhy = ['', '', ''];
  // Tension, smoothed, for the curve under the lead sheet.
  private tension = 0;
  // Damper sweep on pedal lift.
  private wasPedal = false;
  private damperT = -1e9;
  private wheelTarget = 0;
  private readonly wheelSpring: Spring = { x: 0, v: 0 };
  private readonly weather = new Float32Array(3);
  private weatherK = 0;
  private curFn: Fn | null = null;
  /** A new chord event arrived since the last frame (for the Stack's voice leading). */
  private chordEvent = false;

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
  readonly history: HistoryStrip;
  readonly stack: Stack;
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
      out: 0.35,
      outRise: 0,
      in: KEY_FADE,
      inRise: LABEL_RISE_PX,
      delay: 0.15,
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
    this.encLayer = new TextLayer(scene, 60, (ctx, w, h) => this.drawEnc(ctx, w, h), { out: 0.4, outRise: 0, in: 0.12, inRise: LABEL_RISE_PX, delay: 0 });
    for (let i = 0; i < 3; i++) {
      this.offerLayers.push(new TextLayer(scene, 45, (ctx, w, h) => this.drawOffer(ctx, w, h, i), { ...predFade, delay: PRED_DELAY + 0.3 }));
    }
    this.history = new HistoryStrip(scene, L);
    this.stack = new Stack(scene, L);
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
    const stackChanged = layers.stack !== this.layers.stack;
    const voicesChanged =
      layers.voices !== this.layers.voices || layers.tensionCurve !== this.layers.tensionCurve || layers.moves !== this.layers.moves || layers.loopLock !== this.layers.loopLock;
    const scaleChanged = layers.scale !== this.layers.scale;
    this.layers = { ...layers };
    if (voicesChanged) {
      this.history.voicesOn = layers.voices;
      this.history.tensionOn = layers.tensionCurve;
      this.history.bracketsOn = layers.moves;
      this.history.loopOn = layers.loopLock;
      this.history.layout();
    }
    if (scaleChanged) this.chordLayer.changed();
    if (stackChanged) this.chordLayer.place(this.L.cx, this.L.cy - this.L.R * this.chordDrop(), this.L.R * 2.0, this.L.R * 1.3, this.L.dpr);
    this.layoutPreds(true);
  }

  layout(): void {
    const { cx, cy, R, dpr, w, h } = this.L;
    const compassView = this.L.view === 'compass';
    void w;
    this.chordLayer.place(cx, cy - R * this.chordDrop(), R * 2.0, R * 1.3, dpr);
    if (compassView) {
      // The key is a title above the ring.
      const size = R * KEY_TITLE_SIZE;
      const ky = Math.min(cy + R * KEY_TITLE_R, h - 0.75 * size - 16);
      this.keyLayer.place(cx, ky, R * 1.6, size * 1.9, dpr);
    } else {
      this.keyLayer.place(cx, cy + R * 1.62, R * 3.6, Math.max(18, R * 0.2), dpr);
    }
    for (const l of this.predLayers) l.place(cx, cy, R * PRED_W, R * PRED_H, dpr);
    this.thenLayer.place(cx, cy, R * PRED_W, R * PRED_H, dpr);
    this.badgeLayer.place(cx, cy - R * 0.74, R * 1.6, Math.max(18, R * 0.12), dpr);
    this.encLayer.place(cx, cy, R * 0.6, Math.max(16, R * 0.08), dpr);
    for (const l of this.offerLayers) l.place(cx, cy, R * PRED_W, R * PRED_H, dpr);
    this.offerKey = '';
    this.history.layout();
    this.stack.layout();
    this.layoutPreds(true);
    this.keyLayer.changed();
  }

  /** The chord name sits lower when the Stack is using the top of the interior. */
  private chordDrop(): number {
    // The stack stands beside the ring now, so the chord keeps the center (the River view still holds it inside).
    return this.layers.stack && this.L.view === 'river' ? 0.3 : 0.06;
  }

  /** Bounding box of the key title (compass view), so prediction labels keep clear of it. */
  private keyTitleBox(): PredLabel | null {
    if (this.L.view !== 'compass' || !this.keyTonicName || !this.layers.key) return null;
    const { cx, cy, R, h } = this.L;
    const size = R * KEY_TITLE_SIZE;
    const ky = Math.min(cy + R * KEY_TITLE_R, h - 0.75 * size - 16);
    const hw = R * 0.42;
    return { root: 0, name: '', sub: '', nameSize: 0, subSize: 0, align: 'top', ax: cx, ay: ky, x0: cx - hw, x1: cx + hw, y0: ky - size * 0.75, y1: ky + size * 0.75, opacity: 0 };
  }

  noteOn(note: number, vel: number, t: number): void {
    const pc = note % 12;
    if (vel > this.flare[pc]) this.flare[pc] = vel;
    this.noteFlag = true;
    // A line note is a single key above middle C; anything struck with it is part of a chord.
    // A settled note still waiting (several arrived in one frame) is read before the next one.
    if (this.lineNote >= 0 && t - this.lineT >= LINE_SETTLE) this.commitLine(t, this.a?.chord ?? null);
    if (t - this.lastOnT < LINE_SETTLE) this.lineNote = -1;
    else if (note >= 60) {
      this.lineNote = note;
      this.lineT = t;
    }
    this.lastOnT = t;
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
      this.updateScale(a);
      if (key + '|' + this.scaleName !== this.chordKey) {
        this.chordKey = key + '|' + this.scaleName;
        this.chordName = c.name;
        this.chordRoot = c.root;
        this.runner = runner;
        this.roman = roman;
        this.faint = faint;
        this.chordLayer.changed();
      }

      // Hindsight: the chord before this one may read differently now (B°7 → G7(♭9), vi → ii at a pivot).
      if (a.changed && a.reread) this.history.reread(a.reread);
      // Tendency tails whose target is now sounding fill in.
      if (a.changed) {
        this.landed = this.tails.filter((x) => (a.pcs[x.to] ?? 0) >= 0.25);
        this.landT = t;
      }
      // Lead sheet: a new event appends (with a key-change mark if the key moved), a refinement rewrites it.
      if (a.changed || !this.history.hasCurrent) {
        const kl = a.key ? a.key.label : '';
        const keyChange = kl && kl !== this.histKey && this.histKey ? kl : '';
        if (kl) this.histKey = kl;
        this.curFn = a.landing?.fn ?? fnFromRoman(roman);
        this.history.push(c.name, roman, c.root, this.curFn, keyChange, t, a.seq);
        this.chordEvent = true;
      } else {
        this.history.refine(c.name, roman, c.root);
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
        const mv = land.move;
        if (mv) {
          this.badge = mv.name;
          this.badgeRest = mv.loop ? `×${Math.max(1, mv.laps)}` : [mv.style, `${ordinal(mv.count)} today`].filter(Boolean).join(' · ');
          this.badgeRoot = c.root;
          this.badgeT = t;
          this.badgeLayer.changed();
        } else if (land.label) {
          this.badge = land.label;
          this.badgeRest = '';
          this.badgeRoot = c.root;
          this.badgeT = t;
          this.badgeLayer.changed();
        }
      }
      if (a.changed) this.lastRoot = c.root;
    }

    // Moves: brackets on the lead sheet, the shape inside the ring, loop lock.
    if (a.changed && a.moves) {
      this.history.setMarks(a.moves);
      const main = a.moves.find((m) => m.level === 0 && m.to === a.seq && m.state !== 'left') ?? null;
      if (main || (this.shape && a.moves.some((m) => m.key === this.shape!.key))) {
        this.shape = main;
        this.shapeT = t;
      }
    }
    this.history.setLoop(a.loop);

    if (!c) {
      this.history.end(t);
      this.curFn = null;
      this.scale = null;
      this.scaleKey = '';
    }

    const k = a.key;
    let kt = '';
    if (k) {
      let label = k.label.toUpperCase();
      if (k.mode === 'major' && !/MAJOR/.test(label)) label += ' MAJOR';
      kt = 'KEY · ' + label + (k.implied ? ' (IMPLIED)' : '') + (k.parent ? ' · ' + k.parent.toUpperCase() : '');
      this.keyTonicName = k.label.split(' ')[0];
      this.keyModeName = k.mode.toUpperCase();
      this.keyImplied = k.implied;
      this.keyParent = k.parent ?? '';
      if (k.tonic !== this.lastKeyTonic) {
        this.keyChangeT = t;
        this.lastKeyTonic = k.tonic;
      }
      // Tonic-up turns the wheel only for a confirmed key.
      if (!k.implied) this.wheelTarget = Math.PI / 2 - baseAng(k.tonic);
    }
    if (kt !== this.keyText) {
      this.keyText = kt;
      this.keyLayer.changed();
    }

    // The lead sheet's future: the top prediction and the chord after it.
    const top = a.predictions[0];
    this.history.setFuture(
      top
        ? [{ name: top.name, roman: top.roman ?? '', root: top.root, q: top.q }, ...(top.then ? [{ name: top.then.name, roman: top.then.roman ?? '', root: top.then.root, q: top.then.q }] : [])]
        : [],
    );

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
    const obstacles: PredLabel[] = [];
    const kb = this.keyTitleBox();
    if (kb) obstacles.push(kb);
    const placed: PredLabel[] = [...obstacles];
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
        if (host && !obstacles.includes(host)) host.name += ' · ' + p.name;
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
    }    // Reharm labels yield to the prediction labels.
    this.layoutOffers();
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
    // The reason; every label says which move it would continue ("completes ii–V–I", "Axis 3/4").
    if (top || p.move) parts.push((p.loop ? '↻ ' : '') + p.why);
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

    // Laid out where the wheel is heading, so labels don't reflow while it turns.
    const ang = baseAng(p.root) + (this.layers.tonicUp ? this.wheelTarget : 0);
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
    // Keep clear of the lead sheet (and its hidden voices) along the bottom.
    if (this.layers.history && this.L.view === 'compass') {
      const floor = this.history.top + R * 0.02;
      if (y0 < floor) {
        const dy = floor - y0;
        y0 += dy;
        y1 += dy;
        ay += dy;
      }
    }
    // And below the top edge of the window.
    const ceil = this.L.h - R * 0.03;
    if (y1 > ceil) {
      const dy = y1 - ceil;
      y0 -= dy;
      y1 -= dy;
      ay -= dy;
    }
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
   * the local note state (so nodes light on the same frame as the key press);
   * `levels` = the same per MIDI note, for the voicing stack and register web.
   */
  draw(sp: SpriteBatch, t: number, dt: number, instant: Float32Array, levels: Float32Array, pedalDown: boolean, touch: Touch): void {
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
    if (this.wasPedal && !pedalDown) this.damperT = t;
    this.wasPedal = pedalDown;
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

    // ---- springs (in unturned angles; the wheel is added when drawn) ----
    stepSpring(this.wheelSpring, nearestAngle(this.wheelSpring.x, on.tonicUp ? this.wheelTarget : 0), WHEEL_OMEGA, dt);
    wheel = this.wheelSpring.x;
    const turning = Math.abs(this.wheelSpring.v) > 0.4;
    if (chord) stepSpring(this.needle, nearestAngle(this.needle.x, baseAng(chord.root)), NEEDLE_OMEGA, dt);
    const key = a?.key ?? null;
    if (key) {
      stepSpring(this.keyArc, nearestAngle(this.keyArc.x, baseAng(parentMajor(key.tonic, key.mode))), KEY_OMEGA, dt);
      stepSpring(this.keyTick, nearestAngle(this.keyTick.x, baseAng(key.tonic)), KEY_OMEGA, dt);
    }

    // ---- harmonic weather: a faint wash tinted by the current chord's function ----
    {
      const k = 1 - Math.exp(-dt / WEATHER_TAU);
      const tgt = this.curFn ? FN_RGB[this.curFn] : null;
      if (tgt) for (let i = 0; i < 3; i++) this.weather[i] += (tgt[i] - this.weather[i]) * k;
      this.weatherK += ((tgt ? 1 : 0) - this.weatherK) * k;
      if (on.weather && this.weatherK > 0.01) {
        sp.glow(cx, cy, R * WEATHER_R, this.weather[0], this.weather[1], this.weather[2], WEATHER_ALPHA * this.weatherK * breath);
      }
    }

    // ---- ring (structure: a quiet hairline) ----
    sp.ring(cx, cy, R, hair, RING_GREY[0], RING_GREY[1], RING_GREY[2], 0.1 * breath);

    // ---- key arc (covers the 7 diatonic pcs: IV .. VII of the parent major) ----
    if (key && on.key) {
      const pm = parentMajor(key.tonic, key.mode) * 3;
      const conf = 0.45 + 0.55 * Math.min(1, key.conf);
      const thick = Math.max(6, R * KEY_ARC_THICK);
      const kr = R * KEY_ARC_R;
      sp.arc(cx, cy, kr, thick, this.keyArc.x + wheel - 2 * STEP, 3.4 * STEP, key.implied ? 14 : 0, DIM_RGB[pm], DIM_RGB[pm + 1], DIM_RGB[pm + 2], (key.implied ? 0.35 : 0.55) * conf * breath);
      const flash = Math.exp(-(t - this.keyChangeT) / 0.6);
      const tk = key.tonic * 3;
      const tickAng = this.keyTick.x + wheel;
      sp.arc(cx, cy, kr, thick, tickAng, 0.13 + 0.07 * flash, 0, BRIGHT_RGB[tk], BRIGHT_RGB[tk + 1], BRIGHT_RGB[tk + 2], (0.5 + 0.5 * flash) * conf, true);
      // Tether: a hairline from the tonic tick up to the key title, when the tick is on the upper half.
      const kb = this.keyTitleBox();
      if (kb && Math.sin(tickAng) > 0.6) {
        const x0 = cx + Math.cos(tickAng) * (kr + thick);
        const y0 = cy + Math.sin(tickAng) * (kr + thick);
        sp.line(x0, y0, cx, kb.y0 - 4, Math.max(1, hair * 0.8), BRIGHT_RGB[tk], BRIGHT_RGB[tk + 1], BRIGHT_RGB[tk + 2], (0.12 + 0.3 * flash) * conf);
      }
    }

    // ---- the move in force: its shape inside the ring ----
    if (on.moveShape) this.drawMoveShape(sp, t);

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
        // Pedal & touch: a note held only by the pedal loses its crisp dot and pools into a haze on its spoke.
        const pedalOnly = on.touch && touch.pedalOnly[pc] > 0.02 && touch.held[pc] < 0.02;
        if ((w > 0.05 || f > 0.02) && pedalOnly) {
          const wet = 0.55 + 0.45 * touch.pedal;
          // pedal tails are faint by nature; the haze follows them on a gentler curve so it stays legible
          const k = Math.max(0.45, Math.sqrt(Math.max(w, touch.pedalOnly[pc])));
          sp.glow(x, y, R * (0.16 + 0.16 * wet) * Math.max(0.5, k), NOTE_RGB[c3], NOTE_RGB[c3 + 1], NOTE_RGB[c3 + 2], 0.7 * k * wet);
          sp.glow(x, y, R * 0.06 + 4, NOTE_RGB[c3], NOTE_RGB[c3 + 1], NOTE_RGB[c3 + 2], 0.8 * k);
        } else if (w > 0.05 || f > 0.02) {
          // Saturation flares only on attack: blend toward the flare color.
          sp.glow(x, y, R * 0.2 * w + 6 + f * 14 * s, NOTE_RGB[c3] + f, NOTE_RGB[c3 + 1] + f, NOTE_RGB[c3 + 2] + f, 0.85 * w + f * 0.8);
          sp.disc(x, y, (3 + 4 * w) * Math.max(1, s), NOTE_RGB[c3] * (0.8 + w) + f * 0.5, NOTE_RGB[c3 + 1] * (0.8 + w) + f * 0.5, NOTE_RGB[c3 + 2] * (0.8 + w) + f * 0.5, 1);
        } else {
          sp.disc(x, y, 3 * Math.max(1, s), 0.3, 0.33, 0.45, 0.3);
        }
        const cell = this.pcCells[pc];
        if (cell) {
          const lc = w > LIT_THRESHOLD ? LABEL_LIT : LABEL_DIM;
          sp.glyph(cx + Math.cos(ang) * R * 0.84, cy + Math.sin(ang) * R * 0.84, cell, lc[0], lc[1], lc[2], w > LIT_THRESHOLD ? 0.9 : 0.6);
        }
      }

      // ---- inferred root (implied tier): a dashed circle where the played root would be ----
      if (chord && chord.rootInferred) {
        const ang = angOf(chord.root);
        const c3 = chord.root * 3;
        sp.arc(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, R * 0.05, 1.4 * Math.max(1, s), 0, Math.PI, 8, BRIGHT_RGB[c3], BRIGHT_RGB[c3 + 1], BRIGHT_RGB[c3 + 2], 0.85);
      }
    }

    // ---- damper sweep: on pedal lift, a quick ring closes over the ring as the haze clears ----
    if (on.touch) {
      const age = t - this.damperT;
      if (age >= 0 && age < DAMPER_SWEEP) {
        const u = age / DAMPER_SWEEP;
        const e = 1 - (1 - u) * (1 - u);
        sp.ring(cx, cy, R * (1.08 - 0.3 * e), Math.max(1, R * 0.006), 0.8, 0.84, 0.95, 0.2 * (1 - u));
      }
    }

    // ---- scale halo under the ring, and the right hand's line read against it ----
    this.stepLine(t, chord);
    this.drawHalo(sp, t, dt, on.scale, breath);

    // ---- reharm offers: hollow diamonds for what you could play instead ----
    this.updateOffers(chord, t);
    if (on.reharm && chord) this.drawOffers(sp, t, chord.root);

    // ---- tendency tails: where each guide tone or tension wants to go in the predicted chord ----
    this.updateTails(chord);
    if (on.tendency && chord) this.drawTails(sp, t);

    // ---- needle, and the trail of recent roots on its track ----
    if (on.needle) {
      const nr = R * NEEDLE_R;
      let prevAng = chord ? this.needle.x + wheel : NaN;
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
        // Heard tier: grey with a hint of the root's hue, no glow.
        const op = [0.5, 0.3, 0.15][i] ?? 0.1;
        const c3 = root * 3;
        const hr = 0.25 * BRIGHT_RGB[c3] + 0.75 * RING_GREY[0], hg = 0.25 * BRIGHT_RGB[c3 + 1] + 0.75 * RING_GREY[1], hb = 0.25 * BRIGHT_RGB[c3 + 2] + 0.75 * RING_GREY[2];
        sp.arc(cx, cy, nr, 1.6 * Math.max(1, s), ang, 0.045, 0, hr, hg, hb, op * k);
        if (!Number.isNaN(prevAng)) {
          // thin arc joining this root to the next-newer one, the short way round
          const near = nearestAngle(prevAng, ang);
          const mid = (prevAng + near) / 2;
          const half = Math.abs(near - prevAng) / 2;
          if (half > 0.01) sp.arc(cx, cy, nr, Math.max(1, R * 0.003), mid, half, 0, RING_GREY[0], RING_GREY[1], RING_GREY[2], 0.2 * k);
        }
        prevAng = ang;
      }
      if (chord) {
        const c3 = chord.root * 3;
        sp.arc(cx, cy, nr, 2.5 * Math.max(1, s), this.needle.x + wheel, 0.09, 0, BRIGHT_RGB[c3], BRIGHT_RGB[c3 + 1], BRIGHT_RGB[c3 + 2], 0.95, true);
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

    // ---- register web: each sounding note at its pitch-class angle, out by its register, joined low to high ----
    if (on.register) {
      let px = NaN, py = NaN;
      for (let n = 21; n <= 108; n++) {
        const lv = levels[n];
        if (lv <= 0.25) continue;
        const ang = angOf(n % 12);
        const r = R * (0.22 + (0.68 * (n - 21)) / 87);
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        const c3 = (n % 12) * 3;
        if (!Number.isNaN(px)) sp.line(px, py, x, y, Math.max(1, R * 0.004), NOTE_RGB[c3], NOTE_RGB[c3 + 1], NOTE_RGB[c3 + 2], 0.35);
        sp.disc(x, y, R * 0.012, NOTE_RGB[c3], NOTE_RGB[c3 + 1], NOTE_RGB[c3 + 2], 0.8 * Math.min(1, lv));
        px = x;
        py = y;
      }
    }

    // ---- voicing stack (inside the ring) and the lead-sheet strip (below it) ----
    this.stack.update(levels, chord ? chord.root : -1, chord ? chord.quality : '', this.chordEvent, t);
    this.chordEvent = false;
    this.stack.draw(sp, t, on.stack, on.touch ? touch : null);
    if (chord) this.history.setVoices(this.stack.current);
    {
      const target = a ? tensionOf(chord ? { root: chord.root, q: chord.quality } : null, a.pcs, a.key) : 0;
      this.tension += (target - this.tension) * (1 - Math.exp(-dt / TENSION_TAU));
      this.history.pushTension(t, this.tension);
    }
    this.history.draw(sp, t, on.history && this.L.view === 'compass', on.predictions, on.voices);

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
    for (let i = 0; i < 3; i++) this.predLayers[i].opacity = on.predictions && !turning ? this.predLabelOp[i] : 0;
    this.thenLayer.opacity = on.predictions && !turning ? this.thenOp : 0;
    const bAge = t - this.badgeT;
    if (this.badge && bAge > BADGE_HOLD + BADGE_FADE) {
      // Clear it, so the next badge doesn't crossfade from a stale one.
      this.badge = '';
      this.badgeLayer.changed();
    }
    this.badgeLayer.opacity = on.predictions ? (bAge < BADGE_HOLD ? 1 : clamp01(1 - (bAge - BADGE_HOLD) / BADGE_FADE)) : 0;
    const eAge = t - this.encT;
    this.encLayer.opacity = on.scale && eAge < ENC_FADE ? clamp01(1.4 * (1 - eAge / ENC_FADE)) : 0;
    for (let i = 0; i < 3; i++) this.offerLayers[i].opacity = on.reharm && chord && !turning && this.offerLabels[i] ? this.offerLabels[i]!.opacity : 0;
    this.chordLayer.update(t);
    this.keyLayer.update(t);
    for (const l of this.predLayers) l.update(t);
    this.thenLayer.update(t);
    this.badgeLayer.update(t);
    this.encLayer.update(t);
    for (const l of this.offerLayers) l.update(t);
  }

  // ---------- scale halo and line reading ----------

  /** Re-pick the chord-scale when the chord's name or the key changes (not on every passing note). */
  private updateScale(a: Analysis): void {
    const c = a.chord;
    if (!c) return;
    const k = `${c.name}|${c.root}${c.quality}|${a.key ? a.key.tonic + a.key.mode : ''}`;
    if (k === this.scaleKey) return;
    this.scaleKey = k;
    this.scale = scaleFor(c.root, c.quality, a.pcs, a.key);
    this.scaleName = this.scale ? this.scale.name.toUpperCase() : '';
  }

  /** A single right-hand note that has settled (nothing struck with it) is read against the scale. */
  private stepLine(t: number, chord: Analysis['chord']): void {
    if (this.lineNote >= 0 && t - this.lineT >= LINE_SETTLE) this.commitLine(t, chord);
  }

  private commitLine(t: number, chord: Analysis['chord']): void {
    const tones = chord ? chordTones(chord.root, chord.quality) : [];
    const ln = readLineNote(this.lineNote, this.lineT, this.line, this.scale, tones);
    this.lineNote = -1;
    this.line.push(ln);
    if (this.line.length > 8) this.line.shift();
    if (ln.enclosure) {
      const pc = ln.note % 12;
      this.encPc = pc;
      this.encT = t;
      const ang = angOf(pc);
      const { cx, cy, R } = this.L;
      this.encLayer.at(cx + Math.cos(ang) * R * 0.68, cy + Math.sin(ang) * R * 0.68);
      this.encLayer.changed();
    }
  }

  /**
   * The scale as a faint band just inside the ring (a diatonic mode is a
   * seven-note sector in fifths order), its color tone ticked teal and its
   * alterations magenta. Line notes inside the scale light their segment;
   * chromatic approaches get a hollow ring on their node; an enclosure gets a
   * dashed gold bracket around its target.
   */
  private drawHalo(sp: SpriteBatch, t: number, dt: number, on: boolean, breath: number): void {
    const { cx, cy, R } = this.L;
    const sc = this.scale;
    const k = 1 - Math.exp(-dt / 0.25);
    for (let pc = 0; pc < 12; pc++) this.haloW[pc] += ((sc && sc.pcs.includes(pc) ? 1 : 0) - this.haloW[pc]) * k;
    if (!on) return;
    const hr = R * HALO_R;
    const th = Math.max(2, R * HALO_THICK);
    for (let pc = 0; pc < 12; pc++) {
      const w = this.haloW[pc];
      if (w < 0.01) continue;
      sp.arc(cx, cy, hr, th, angOf(pc), STEP * 0.47, 0, RING_GREY[0], RING_GREY[1], RING_GREY[2], 0.14 * w * breath);
    }
    if (sc) {
      for (const m of sc.marks) {
        const c = m.kind === 'alt' ? ROLE_RGB.alt : ROLE_RGB.tension;
        sp.arc(cx, cy, hr, th * 1.25, angOf(m.pc), 0.05, 0, c[0], c[1], c[2], 0.75 * this.haloW[m.pc]);
      }
    }
    const dot = Math.max(1, R * 0.004);
    for (const ln of this.line) {
      const age = t - ln.t;
      if (age > LINE_FADE || age < 0) continue;
      const f = 1 - age / LINE_FADE;
      const pc = ln.note % 12;
      const ang = angOf(pc);
      if (ln.kind === 'in') {
        const c3 = pc * 3;
        sp.arc(cx, cy, hr, th * 1.3, ang, STEP * 0.47, 0, NOTE_RGB[c3], NOTE_RGB[c3 + 1], NOTE_RGB[c3 + 2], 0.85 * f);
      } else {
        // outside the scale the band is empty: a hollow ring there reads as a deliberate approach note
        sp.ring(cx + Math.cos(ang) * hr, cy + Math.sin(ang) * hr, th * 0.9, dot * 1.2, LABEL_LIT[0], LABEL_LIT[1], LABEL_LIT[2], 0.95 * f);
      }
    }
    const eAge = t - this.encT;
    if (this.encPc >= 0 && eAge < ENC_FADE) {
      const f = 1 - eAge / ENC_FADE;
      const ang = angOf(this.encPc);
      const g = ROLE_RGB.guide;
      const x = cx + Math.cos(ang) * R, y = cy + Math.sin(ang) * R;
      // two brackets, one on each side of the target along the ring
      sp.arc(x, y, R * 0.09, dot * 1.6, ang + Math.PI / 2, 0.6, 0, g[0], g[1], g[2], 0.9 * f);
      sp.arc(x, y, R * 0.09, dot * 1.6, ang - Math.PI / 2, 0.6, 0, g[0], g[1], g[2], 0.9 * f);
    }
  }

  private drawEnc(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.max(10, this.L.R * 0.034)}px ${MONO_FONT}`;
    ctx.fillStyle = 'oklch(0.86 0.13 85)';
    ctx.letterSpacing = '3px';
    ctx.fillText('ENCLOSURE', w / 2, h / 2);
    ctx.letterSpacing = '0px';
  }

  // ---------- reharm offers ----------

  /** Recompute the offers when the chord, the likely next chord, or the voicing changes. */
  private updateOffers(chord: Analysis['chord'], t: number): void {
    const a = this.a;
    const notes = this.stack.current ? this.stack.current.voices.map((v) => v.note) : [];
    const key = !chord || !a ? '' : `${chord.root}${chord.quality}|${a.predictions.map((p) => `${p.root}${p.q}${p.p >= 0.3 ? 1 : 0}`).join(',')}|${notes.join(',')}|${a.key ? a.key.tonic : ''}`;
    if (key === this.offerKey) return;
    this.offerKey = key;
    this.offers = chord && a ? reharmsFor({ root: chord.root, q: chord.quality }, a.predictions, notes, a.key) : [];
    const sig = this.offers.map((o) => o.why).join('|') + (chord ? chord.root : '');
    if (sig !== this.offerSig) {
      this.offerSig = sig;
      this.offerT = t;
    }
    this.layoutOffers();
  }

  /** Each offer's label hangs off its first diamond; one that would collide with a prediction is left as a bare diamond. */
  private layoutOffers(): void {
    const { cx, cy, R } = this.L;
    const placed: PredLabel[] = [...this.predLabels.filter((l): l is PredLabel => !!l)];
    if (this.thenLabel) placed.push(this.thenLabel);
    const kb = this.keyTitleBox();
    if (kb) placed.push(kb);
    for (let i = 0; i < 3; i++) {
      const o = this.offers[i];
      let lab: PredLabel | null = null;
      if (o) {
        const name = o.path.map((s) => s.name).join(' → ');
        const nameSize = Math.max(12, R * 0.05);
        const subSize = Math.max(10, R * 0.034);
        this.measure.font = `500 ${nameSize}px ${DISPLAY_FONT}`;
        let bw = this.measure.measureText(name).width;
        this.measure.font = `500 ${subSize}px ${MONO_FONT}`;
        bw = Math.min(R * PRED_W, Math.max(bw, this.measure.measureText(o.why).width + o.why.length));
        const bh = nameSize * 1.05 + subSize * 1.35;
        const ang = baseAng(o.path[0].root) + (this.layers.tonicUp ? this.wheelTarget : 0);
        const c = Math.cos(ang), s = Math.sin(ang);
        const align: Align = Math.abs(c) < 0.42 ? (s > 0 ? 'top' : 'bottom') : c > 0 ? 'left' : 'right';
        const ax = cx + c * R * (OFFER_R + 0.04), ay = cy + s * R * (OFFER_R + 0.04);
        let x0: number, x1: number, y0: number, y1: number;
        if (align === 'left') [x0, x1, y0, y1] = [ax, ax + bw, ay - bh / 2, ay + bh / 2];
        else if (align === 'right') [x0, x1, y0, y1] = [ax - bw, ax, ay - bh / 2, ay + bh / 2];
        else if (align === 'top') [x0, x1, y0, y1] = [ax - bw / 2, ax + bw / 2, ay, ay + bh];
        else [x0, x1, y0, y1] = [ax - bw / 2, ax + bw / 2, ay - bh, ay];
        const cand: PredLabel = { root: o.path[0].root, name, sub: o.why, nameSize, subSize, align, ax, ay, x0, y0, x1, y1, opacity: i === 0 ? 0.95 : 0.75 };
        const floor = this.layers.history && this.L.view === 'compass' ? this.history.top + R * 0.02 : -1e9;
        if (y0 >= floor && !placed.some((q) => overlaps(q, cand, R * 0.02))) {
          lab = cand;
          placed.push(cand);
        }
      }
      this.offerLabels[i] = lab;
      const k = lab ? `${lab.name}|${lab.sub}|${lab.align}|${Math.round(lab.ax)}|${Math.round(lab.ay)}` : '';
      if (k !== this.offerLabelKeys[i]) {
        this.offerLabelKeys[i] = k;
        this.offerWhy[i] = lab ? lab.sub : '';
        if (lab) this.offerLayers[i].at(...this.canvasCenter(lab));
        this.offerLayers[i].changed();
      }
    }
  }

  /**
   * Possible, not probable: each offer is a hollow diamond per chord on its own
   * track between the key arc and the orbit, joined by a fine dotted path from
   * the chord now sounding into the chord it lands on. Drawn under the
   * predicted tier: no glow, no fill, one neutral violet.
   */
  private drawOffers(sp: SpriteBatch, t: number, fromRoot: number): void {
    const { cx, cy, R } = this.L;
    const fade = clamp01((t - this.offerT - PRED_DELAY - 0.3) / PRED_FADE);
    if (fade <= 0) return;
    const c = OFFER_RGB;
    const rd = R * OFFER_R;
    const thick = Math.max(1, R * 0.003);
    for (let i = 0; i < this.offers.length; i++) {
      const o = this.offers[i];
      const op = (i === 0 ? 0.7 : 0.45) * fade;
      let pa = angOf(fromRoot), pr = R * NEEDLE_R;
      for (let j = 0; j < o.path.length; j++) {
        const ang = angOf(o.path[j].root);
        this.spiral(sp, pa, pr, ang, rd, R * 0.003, c[0], c[1], c[2], op * 0.6, -1, 1);
        const d = R * (j === 0 ? 0.022 : 0.016);
        const x = cx + Math.cos(ang) * rd, y = cy + Math.sin(ang) * rd;
        sp.line(x, y + d, x + d, y, thick, c[0], c[1], c[2], op);
        sp.line(x + d, y, x, y - d, thick, c[0], c[1], c[2], op);
        sp.line(x, y - d, x - d, y, thick, c[0], c[1], c[2], op);
        sp.line(x - d, y, x, y + d, thick, c[0], c[1], c[2], op);
        pa = ang;
        pr = rd;
      }
      this.spiral(sp, pa, pr, angOf(o.target), R * ORBIT_R, R * 0.0025, c[0], c[1], c[2], op * 0.4, -1, 1);
    }
  }

  private drawOffer(ctx: CanvasRenderingContext2D, w: number, h: number, i: number): void {
    const l = this.offerLabels[i];
    if (!l) return;
    const bh = l.nameSize * 1.05 + l.subSize * 1.35;
    let top: number, x: number;
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
    // Possible, not predicted: one violet with a diamond, never a root's hue like a prediction.
    ctx.font = `500 ${l.nameSize}px ${DISPLAY_FONT}`;
    ctx.fillStyle = OFFER_CSS;
    ctx.fillText('◇ ' + l.name, x, top);
    ctx.font = `500 ${l.subSize}px ${MONO_FONT}`;
    ctx.fillStyle = 'rgba(200,196,225,0.6)';
    ctx.letterSpacing = '0.5px';
    ctx.fillText(l.sub, x, top + l.nameSize * 1.08);
    ctx.letterSpacing = '0px';
  }

  /** Recompute the tendency tails when the voicing or the top prediction changes. */
  private updateTails(chord: Analysis['chord']): void {
    const r = this.stack.current;
    const top = this.a?.predictions[0];
    if (!chord || !r || !top) {
      this.tails = [];
      this.tailKey = '';
      return;
    }
    const key = r.voices.map((v) => v.note).join(',') + '|' + chord.root + chord.quality + '|' + top.root + top.q;
    if (key === this.tailKey) return;
    this.tailKey = key;
    this.tails = tendencies(r.voices, top.root, top.q);
  }

  /**
   * Each tail is a short dotted comet leaving a sounding node toward the note it
   * wants to become (predicted tier: dotted, no glow), with a hollow mark on the
   * target. When the next chord lands on it, the whole path fills and glows.
   */
  private drawTails(sp: SpriteBatch, t: number): void {
    const { cx, cy, R } = this.L;
    const fade = clamp01((t - this.predT - PRED_DELAY) / PRED_FADE);
    const dot = Math.max(1.2, R * 0.0055);
    for (const tail of this.tails) {
      const a0 = angOf(tail.from), a1 = angOf(tail.to);
      const x0 = cx + Math.cos(a0) * R, y0 = cy + Math.sin(a0) * R;
      const x1 = cx + Math.cos(a1) * R, y1 = cy + Math.sin(a1) * R;
      const c = ROLE_RGB[tail.cls];
      const lean = 0.3;
      const n = 11;
      for (let k = 1; k <= n; k++) {
        const u = (k / n) * lean;
        const q = 1 - k / (n + 2);
        sp.disc(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, dot * (0.8 + 0.9 * q), c[0], c[1], c[2], 0.95 * q * fade);
      }
      if (this.w[tail.to] <= LIT_THRESHOLD) sp.ring(x1, y1, R * 0.028, Math.max(1, R * 0.0025), c[0], c[1], c[2], 0.4 * fade);
    }
    const age = t - this.landT;
    if (age < TAIL_LAND) {
      const k = 1 - age / TAIL_LAND;
      const g = ROLE_RGB.guide;
      for (const tail of this.landed) {
        const a0 = angOf(tail.from), a1 = angOf(tail.to);
        const x0 = cx + Math.cos(a0) * R, y0 = cy + Math.sin(a0) * R;
        const x1 = cx + Math.cos(a1) * R, y1 = cy + Math.sin(a1) * R;
        const n = Math.max(6, Math.floor(Math.hypot(x1 - x0, y1 - y0) / (R * 0.03)));
        for (let j = 1; j < n; j++) {
          const u = j / n;
          sp.disc(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, dot * 1.2, g[0] * 1.3, g[1] * 1.3, g[2] * 1.3, 0.8 * k, true);
        }
      }
    }
  }

  private drawPredictions(sp: SpriteBatch, t: number): void {
    const { cx, cy, R } = this.L;
    const a = this.a;
    const chord = a?.chord ?? null;
    const orbit = R * ORBIT_R;

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
        // satellite: hollow, no glow (predicted tier never blooms)
        sp.ring(cx + Math.cos(ang) * orbit, cy + Math.sin(ang) * orbit, (0.012 + 0.018 * p.p) * R, Math.max(1, R * 0.004), cr, cg, cb, op);
        if (p.root !== fromRoot) {
          // a locked loop has earned its confidence: tighter dots
          this.spiral(sp, from, R * NEEDLE_R, ang, orbit, (0.004 + 0.006 * p.p) * R, cr, cg, cb, op, phase, 1, p.loop ? 0.02 : 0.035);
        }
        // the chord after next, chained off the top prediction along the orbit
        if (i === 0 && p.then && p.then.root !== p.root) {
          const tc = p.then.root * 3;
          const tang = angOf(p.then.root);
          const top = op * THEN_DIM;
          sp.ring(cx + Math.cos(tang) * orbit, cy + Math.sin(tang) * orbit, (0.008 + 0.012 * p.then.p) * R, Math.max(1, R * 0.003), BRIGHT_RGB[tc], BRIGHT_RGB[tc + 1], BRIGHT_RGB[tc + 2], top);
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
  private spiral(sp: SpriteBatch, a0: number, r0: number, a1: number, r1: number, dotR: number, cr: number, cg: number, cb: number, op: number, phase: number, upTo: number, spacing = 0.035): void {
    const { cx, cy, R } = this.L;
    let d = a1 - a0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) < 1e-3) return;
    const len = Math.abs(d) * (r0 + r1) * 0.5 + Math.abs(r1 - r0);
    const n = Math.max(4, Math.min(160, Math.floor(len / (spacing * R))));
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
    // A slash is a bass note only when a note name follows it: C6/9 is one chord, C/E is over E.
    const m = this.chordName.match(/^([A-G][♭♯b#]?)(.*?)(\/[A-G][♭♯b#]?)?$/);
    const root = m ? m[1] : this.chordName;
    const qual = m ? m[2] : '';
    const slash = m && m[3] ? m[3] : '';
    // 6/9 is written stacked, 6 over 9, so it can't be mistaken for a slash chord.
    const six9 = qual.indexOf('6/9');
    const qa = six9 >= 0 ? qual.slice(0, six9) : qual;
    const qb = six9 >= 0 ? qual.slice(six9 + 3) : '';
    const fonts = (sz: number) => ({
      rf: `${this.faint ? 400 : 600} ${sz}px ${DISPLAY_FONT}`,
      qf: `${this.faint ? 400 : 500} ${sz * 0.58}px ${DISPLAY_FONT}`,
      ff: `${this.faint ? 400 : 500} ${sz * 0.4}px ${DISPLAY_FONT}`,
    });
    const widths = (sz: number) => {
      const f = fonts(sz);
      ctx.font = f.rf;
      const rw = ctx.measureText(root).width;
      const sw = ctx.measureText(slash).width;
      ctx.font = f.qf;
      const aw = ctx.measureText(qa).width;
      const bw = ctx.measureText(qb).width;
      ctx.font = f.ff;
      const fw = six9 >= 0 ? ctx.measureText('6').width + sz * 0.06 : 0;
      return { rw, sw, aw, fw, bw, qw: aw + fw + bw };
    };
    // Shrink long names (C7(♭9♯11)/E) so they never run into the pitch labels.
    let wd = widths(size);
    const maxW = R * CHORD_MAX_W_R;
    const total = wd.rw + wd.qw + wd.sw;
    if (total > maxW) {
      size *= maxW / total;
      wd = widths(size);
    }
    const { rf, qf, ff } = fonts(size);
    const { rw, qw, sw, aw, fw } = wd;
    const x = w / 2 - (rw + qw + sw) / 2;
    const base = h / 2 + size * 0.33;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(242,244,250,1)';
    ctx.font = rf;
    ctx.fillText(root, x, base);
    ctx.font = qf;
    let qx = x + rw + 1;
    ctx.fillText(qa, qx, base - size * 0.42);
    qx += aw;
    if (six9 >= 0) {
      ctx.font = ff;
      ctx.textAlign = 'center';
      const fx = qx + fw / 2;
      ctx.fillText('6', fx, base - size * 0.62);
      ctx.fillText('9', fx, base - size * 0.2);
      ctx.fillRect(qx + size * 0.01, base - size * 0.53, fw - size * 0.02, Math.max(1, size * 0.018));
      ctx.textAlign = 'left';
      ctx.font = qf;
      qx += fw;
      ctx.fillText(qb, qx, base - size * 0.42);
    }
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
    // The numeral, and the scale beside it in small caps ("i⁷  D DORIAN"), centered as one line.
    const scale = this.layers.scale ? this.scaleName : '';
    if (this.roman || scale) {
      const rFont = `500 ${Math.max(10, ref * 0.3)}px ${MONO_FONT}`;
      const sFont = `500 ${Math.max(9, ref * 0.17)}px ${MONO_FONT}`;
      ctx.letterSpacing = '2px';
      ctx.font = rFont;
      const rw = this.roman ? ctx.measureText(this.roman).width : 0;
      ctx.font = sFont;
      const sw = scale ? ctx.measureText(scale).width : 0;
      const gap = this.roman && scale ? ref * 0.22 : 0;
      let x = w / 2 - (rw + gap + sw) / 2;
      ctx.textAlign = 'left';
      if (this.roman) {
        ctx.font = rFont;
        ctx.fillStyle = cssOklch(this.chordRoot, 0.82, 0.08, 0.9);
        ctx.fillText(this.roman, x, y);
        x += rw + gap;
      }
      if (scale) {
        ctx.font = sFont;
        ctx.fillStyle = 'rgba(200,206,225,0.55)';
        ctx.fillText(scale, x, y);
      }
      ctx.letterSpacing = '0px';
    }
  }

  private drawKey(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.keyText) return;
    if (this.L.view !== 'compass') {
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.font = `500 ${Math.max(10, this.L.R * 0.085)}px ${MONO_FONT}`;
      ctx.fillStyle = 'rgba(205,212,232,1)';
      ctx.letterSpacing = '2px';
      ctx.fillText(this.keyText, w / 2, h / 2);
      ctx.letterSpacing = '0px';
      return;
    }
    // The hero title: the tonic big, the mode in small caps to its upper right.
    // An implied key is drawn hollow, with a caption saying so.
    const R = this.L.R;
    const size = R * KEY_TITLE_SIZE;
    const modeSize = Math.max(11, R * 0.055);
    const tonicFont = `600 ${size}px ${DISPLAY_FONT}`;
    const modeFont = `500 ${modeSize}px ${MONO_FONT}`;
    ctx.font = tonicFont;
    const tw = ctx.measureText(this.keyTonicName).width;
    ctx.font = modeFont;
    ctx.letterSpacing = '3px';
    const mw = ctx.measureText(this.keyModeName).width;
    const gap = size * 0.12;
    const x = w / 2 - (tw + gap + mw) / 2;
    const base = h / 2 + size * 0.36;
    const color = cssOklch(this.lastKeyTonic, 0.8, 0.08, 1); // under the bloom threshold: structure never blooms
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = '0px';
    ctx.font = tonicFont;
    if (this.keyImplied) {
      ctx.lineWidth = Math.max(1, size * 0.02);
      ctx.strokeStyle = color;
      ctx.strokeText(this.keyTonicName, x, base);
    } else {
      ctx.fillStyle = color;
      ctx.fillText(this.keyTonicName, x, base);
    }
    ctx.font = modeFont;
    ctx.letterSpacing = '3px';
    ctx.fillStyle = 'rgba(205,212,232,0.85)';
    ctx.fillText(this.keyModeName, x + tw + gap, base - size * 0.42);
    if (this.keyImplied) {
      ctx.font = `500 ${modeSize * 0.75}px ${MONO_FONT}`;
      ctx.fillStyle = 'rgba(205,212,232,0.55)';
      ctx.fillText('IMPLIED', x + tw + gap, base - size * 0.42 + modeSize * 1.3);
    }
    // A mode's place in its parent major ("= II OF C"), hollow: the functional reading, implied.
    if (this.keyParent) {
      ctx.font = `500 ${modeSize * 0.8}px ${MONO_FONT}`;
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = 'rgba(205,212,232,0.7)';
      ctx.strokeText('= ' + this.keyParent.toUpperCase(), x + tw + gap, base - size * 0.42 + modeSize * 1.3);
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
    ctx.textBaseline = 'middle';
    const size = Math.max(12, this.L.R * 0.058);
    ctx.font = `600 ${size}px ${MONO_FONT}`;
    ctx.letterSpacing = '3px';
    const main = this.badge.toUpperCase();
    const mw = ctx.measureText(main).width;
    const rest = this.badgeRest ? `  ·  ${this.badgeRest}` : '';
    ctx.font = `500 ${size * 0.8}px ${MONO_FONT}`;
    ctx.letterSpacing = '1px';
    const rw = rest ? ctx.measureText(rest).width : 0;
    let x = w / 2 - (mw + rw) / 2;
    // a dark pill under it, so the pitch names it crosses on the ring don't tangle with it
    const padX = size * 0.8;
    const ph = size * 1.7;
    ctx.fillStyle = 'rgba(16,17,22,0.82)';
    ctx.beginPath();
    ctx.roundRect(x - padX, h / 2 - ph / 2, mw + rw + 2 * padX, ph, ph / 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = `600 ${size}px ${MONO_FONT}`;
    ctx.letterSpacing = '3px';
    ctx.fillStyle = cssOklch(this.badgeRoot, 0.9, 0.1, 1);
    ctx.fillText(main, x, h / 2);
    x += mw;
    if (rest) {
      ctx.font = `500 ${size * 0.8}px ${MONO_FONT}`;
      ctx.letterSpacing = '1px';
      ctx.fillStyle = 'rgba(200,206,225,0.75)';
      ctx.fillText(rest, x, h / 2);
    }
    ctx.letterSpacing = '0px';
  }

  /**
   * The move in force as a shape inside the ring: each step's root on the circle
   * of fifths, joined in order. What has sounded is a faint solid line, the next
   * step dotted, the rest a whisper. ii–V–I is a short two-step hook, a tritone
   * sub cuts across, I–V–vi–IV is a small zig-zag. A finished move fades out.
   */
  private drawMoveShape(sp: SpriteBatch, t: number): void {
    const m = this.shape;
    if (!m || m.path.length < 2) return;
    const age = t - this.shapeT;
    const fade = m.state === 'done' ? clamp01(1 - (age - 1.2) / 0.8) : 1;
    if (fade <= 0) return;
    const { cx, cy, R } = this.L;
    const r = R * 0.86;
    const pt = (pc: number): [number, number] => [cx + Math.cos(angOf(pc)) * r, cy + Math.sin(angOf(pc)) * r];
    const n = m.path.length;
    const segs = m.loop ? n : n - 1;
    const th = Math.max(1, R * 0.0045);
    const col = [0.72, 0.78, 0.95];
    for (let i = 0; i < segs; i++) {
      const a = m.path[i], b = m.path[(i + 1) % n];
      if (a === b) continue;
      const [x0, y0] = pt(a);
      const [x1, y1] = pt(b);
      // Bowed toward the center, so the move reads apart from the chord's straight-edged shape:
      // neighbours on the circle make a shallow hook, a tritone sub a deep swoop across.
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const qx = mx + (cx - mx) * 0.55, qy = my + (cy - my) * 0.55;
      // steps behind the newest chord have sounded (in a loop, the whole lap has once it ran)
      const played = m.loop ? m.laps >= 1 || i < m.at : i < m.at;
      const next = i === m.at && (m.loop || m.at < n - 1);
      const len = Math.hypot(x1 - x0, y1 - y0) * 1.15;
      const k = Math.max(3, Math.floor(len / (R * (played ? 0.012 : next ? 0.03 : 0.05))));
      for (let j = 1; j < k; j++) {
        const u = j / k, v = 1 - u;
        const x = v * v * x0 + 2 * v * u * qx + u * u * x1;
        const y = v * v * y0 + 2 * v * u * qy + u * u * y1;
        if (played) sp.disc(x, y, th * 0.7, col[0], col[1], col[2], 0.28 * fade);
        else sp.disc(x, y, th * (next ? 1.1 : 0.8), col[0], col[1], col[2], (next ? 0.55 : 0.15) * fade);
      }
    }
    // the step you're on
    const [hx, hy] = pt(m.path[m.at]);
    sp.ring(hx, hy, R * 0.022, th, col[0], col[1], col[2], 0.5 * fade);
  }
}

/** 1st, 2nd, 3rd, 4th ... */
function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** Ripple strength by the function of the chord we landed on: the tonic gets the biggest. */
function fnStrength(fn: Fn | null): number {
  return fn === 'T' ? 1 : fn === 'SD' ? 0.8 : 0.7;
}

function overlaps(a: PredLabel, b: PredLabel, m: number): boolean {
  return a.x0 - m < b.x1 && b.x0 - m < a.x1 && a.y0 - m < b.y1 && b.y0 - m < a.y1;
}
