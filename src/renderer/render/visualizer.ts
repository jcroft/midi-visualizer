// CONTRACT (owned by the renderer worker). three.js River + Compass.
//
// Frame flow: main.ts drains the event queue into onEvent() (which only parks
// the events), then calls render(nowMs). render() applies the parked events at
// this frame's time, so a note-on's bloom/flash is drawn on the very frame it
// was drained, then draws the scene through the bloom post pass.
//
// Files: tuning.ts (all knobs), color.ts (OKLCH palette), river.ts (ribbons +
// attack blooms, GPU pools), compass.ts, sprites.ts (2D shape batch),
// text.ts (canvas text), particles.ts (stress mode), layout.ts.
import type { PianoEvent } from '@shared/events';
import type { Analysis } from '@shared/analysis';
import { Color, OrthographicCamera, RenderPipeline, Scene, WebGPURenderer } from 'three/webgpu';
import { float, pass, screenUV, smoothstep, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { BAND_RGB, NOTE_RGB } from './color';
import { Compass } from './compass';
import { Layout, type View } from './layout';
import type { Layers } from './layers';
import { Particles } from './particles';
import { River } from './river';
import { SpriteBatch } from './sprites';
import { type Atlas, buildAtlas } from './text';
import {
  BACKGROUND,
  BAND_ALPHA,
  BLOOM_RADIUS,
  BLOOM_STRENGTH,
  BLOOM_STRENGTH_STRESS,
  BLOOM_THRESHOLD,
  DISPLAY_FONT,
  KEY_COUNT,
  LOWEST_NOTE,
  MAX_PIXEL_RATIO,
  MONO_FONT,
  VIGNETTE,
} from './tuning';

/** normal: River + Compass. stress: + 200k GPU particles. flash: latency test (screen flashes on note-on). */
export type VisualMode = 'normal' | 'stress' | 'flash';
export type { View } from './layout';
export type { Layers, LayerId } from './layers';

export interface Visualizer {
  readonly backend: 'webgpu' | 'webgl2';
  onEvent(ev: PianoEvent): void;
  setAnalysis(a: Analysis): void;
  setMode(m: VisualMode): void;
  setView(v: View): void;
  setLayers(l: Layers): void;
  resize(w: number, h: number, dpr: number): void;
  render(nowMs: number): void;
}

const PC_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const BLACK_KEY = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const PENDING_CAP = 2048;
const BAND_CAP = 32;

export async function createVisualizer(canvas: HTMLCanvasElement): Promise<Visualizer> {
  const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL: false });
  await renderer.init();
  const backend: 'webgpu' | 'webgl2' = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';

  const bgColor = new Color(BACKGROUND);
  const white = new Color(1, 1, 1);
  const black = new Color(0, 0, 0);
  renderer.setClearColor(bgColor, 1);

  const scene = new Scene();
  const flashScene = new Scene(); // empty: flash mode is just the clear color
  const camera = new OrthographicCamera(0, 1, 1, 0, -10, 10); // pixel space, y-up
  camera.position.z = 5;

  const L = new Layout();
  let atlas: Atlas = buildAtlas(atlasLabels(100), 1);
  const under = new SpriteBatch(scene, 512, 10, atlas.texture); // bands, guides, keyboard
  const river = new River(scene, L); // ribbons (20), attack blooms (30)
  const compass = new Compass(scene, L); // polygon (40), text (45, 60)
  const over = new SpriteBatch(scene, 2048, 50, atlas.texture); // compass shapes
  const particles = new Particles(scene, L); // stress mode (0)
  compass.setCells(atlas.cells.slice(0, 12), atlas.cells[12]);
  river.ribbonMesh.visible = river.bloomMesh.visible = false; // compass view by default

  // ---- post: bloom over the whole scene, then a soft vignette ----
  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');
  const bloomNode = bloom(sceneColor, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
  const vignette = float(1).sub(smoothstep(0.35, 0.85, screenUV.sub(0.5).length()).mul(VIGNETTE));
  pipeline.outputNode = vec4(sceneColor.rgb.add(bloomNode.rgb).mul(vignette), 1);

  // ---- state ----
  let mode: VisualMode = 'normal';
  let view: View = 'compass';
  const epochMs = performance.now();
  let lastMs = -1;
  let lastT = 0;
  const pending: (PianoEvent | null)[] = new Array(PENDING_CAP).fill(null);
  let pHead = 0;
  let pCount = 0;
  let sawNoteOn = false;
  const instant = new Float32Array(12);
  const noteLvl = new Float32Array(128);

  // Chord bands in the river (ring buffer, preallocated).
  const bandRoot = new Int8Array(BAND_CAP).fill(-1);
  const bandT0 = new Float64Array(BAND_CAP);
  const bandT1 = new Float64Array(BAND_CAP);
  let bandHead = 0;
  let bandOpen = -1;

  function apply(ev: PianoEvent, t: number): void {
    switch (ev.type) {
      case 'on':
        if (ev.vel > 0) {
          river.noteOn(ev.note, ev.vel, t);
          compass.noteOn(ev.note, ev.vel);
          sawNoteOn = true;
        } else river.noteOff(ev.note, t);
        break;
      case 'off':
        river.noteOff(ev.note, t);
        break;
      case 'cc':
        if (ev.cc === 64) river.sustain(ev.value, t);
        break;
      case 'pat':
        river.aftertouch(ev.note, ev.value);
        break;
      case 'panic':
        river.panic(t);
        break;
    }
  }

  function rebuildAtlas(): void {
    const next = buildAtlas(atlasLabels(L.R), L.dpr);
    under.setAtlas(next.texture);
    over.setAtlas(next.texture);
    atlas.texture.dispose();
    atlas = next;
    compass.setCells(atlas.cells.slice(0, 12), atlas.cells[12]);
  }

  function drawRiverDecor(t: number): void {
    const { nowX, h, step } = L;
    under.begin();

    // Chord bands: root-tinted washes behind the ribbons.
    for (let i = 0; i < BAND_CAP; i++) {
      const root = bandRoot[i];
      if (root < 0) continue;
      const x0 = nowX - (t - bandT0[i]) * L.pps;
      const x1 = i === bandOpen ? nowX : nowX - (t - bandT1[i]) * L.pps;
      if (x1 <= 0) {
        bandRoot[i] = -1;
        continue;
      }
      const l = Math.max(0, x0);
      const r3 = root * 3;
      under.rect((l + x1) / 2, h / 2, (x1 - l) / 2, h / 2, BAND_RGB[r3], BAND_RGB[r3 + 1], BAND_RGB[r3 + 2], BAND_ALPHA, false, x0 >= 0 ? 30 : 0);
    }

    // Octave guides at each C.
    for (let n = 24; n <= 108; n += 12) under.rect(nowX / 2, L.yOf(n) - step / 2, nowX / 2, 0.5, 0.36, 0.4, 0.58, 0.06);

    // The light keyboard standing on the now line.
    const riverH = KEY_COUNT * step;
    under.rect(nowX, L.y0 + riverH / 2, 6, riverH / 2, 0.58, 0.64, 0.87, 0.05, true);
    under.rect(nowX, L.y0 + riverH / 2, 0.5, riverH / 2, 0.58, 0.64, 0.87, 0.25, true);
    for (let n = LOWEST_NOTE; n < LOWEST_NOTE + KEY_COUNT; n++) {
      const pc = n % 12;
      const y = L.yOf(n);
      const lvl = river.level(n, t);
      if (lvl > 0.02) {
        const held = river.held[n] === 1;
        const fl = Math.exp(-river.sinceOnset(n, t) / 0.1); // attack flash toward white
        const g = held ? 1.3 : 0.8;
        const c3 = pc * 3;
        under.rect(nowX, y, 7, Math.max(1.5, step * 0.42), NOTE_RGB[c3] * g + fl, NOTE_RGB[c3 + 1] * g + fl, NOTE_RGB[c3 + 2] * g + fl, Math.min(1, lvl), true);
      } else if (BLACK_KEY[pc]) {
        under.rect(nowX, y, 2, 0.5, 0.58, 0.64, 0.87, 0.1);
      } else {
        under.rect(nowX, y, 4, 0.5, 0.58, 0.64, 0.87, 0.22);
      }
    }
    under.end();
  }

  /** 12 immediate pitch-class levels from the local note state, so compass nodes light on the key-press frame. */
  function computeInstant(t: number): void {
    instant.fill(0);
    noteLvl.fill(0);
    for (let n = LOWEST_NOTE; n < LOWEST_NOTE + KEY_COUNT; n++) {
      const lvl = river.level(n, t);
      if (lvl <= 0.02) continue;
      // The hand shape: held keys count fully, pedal-sustained ones only while fresh, release tails not at all.
      noteLvl[n] = river.held[n] ? lvl : river.sustained[n] ? lvl * 0.5 : 0;
      const pc = n % 12;
      const k = Math.min(1, lvl);
      if (k > instant[pc]) instant[pc] = k;
    }
  }

  function applyView(): void {
    river.ribbonMesh.visible = view === 'river';
    river.bloomMesh.visible = view === 'river';
    if (view !== 'river') {
      under.begin();
      under.end();
    }
  }

  const viz: Visualizer = {
    backend,

    onEvent(ev) {
      if (pCount >= PENDING_CAP) {
        // Queue overflow (pathological): apply now at the last frame's time.
        apply(ev, lastT);
        return;
      }
      pending[(pHead + pCount) % PENDING_CAP] = ev;
      pCount++;
    },

    setAnalysis(a) {
      compass.setAnalysis(a, lastT);
      if (a.changed && a.chord) {
        if (bandOpen >= 0) bandT1[bandOpen] = lastT;
        const i = bandHead;
        bandHead = (bandHead + 1) % BAND_CAP;
        bandRoot[i] = a.chord.root;
        bandT0[i] = lastT;
        bandOpen = i;
      } else if (!a.chord && bandOpen >= 0) {
        bandT1[bandOpen] = lastT;
        bandOpen = -1;
      }
    },

    setMode(m) {
      mode = m;
      particles.mesh.visible = m === 'stress';
      bloomNode.strength.value = m === 'stress' ? BLOOM_STRENGTH_STRESS : BLOOM_STRENGTH;
      if (m !== 'flash') renderer.setClearColor(bgColor, 1);
    },

    setLayers(l) {
      compass.setLayers(l);
    },

    setView(v) {
      if (v === view) return;
      view = v;
      L.view = v;
      applyView();
      viz.resize(L.w, L.h, L.dpr);
    },

    resize(w, h, dpr) {
      const pr = Math.min(dpr || 1, MAX_PIXEL_RATIO);
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
      const oldR = L.R;
      const oldDpr = L.dpr;
      L.update(w, h, pr);
      camera.left = 0;
      camera.right = w;
      camera.top = h;
      camera.bottom = 0;
      camera.updateProjectionMatrix();
      if (Math.abs(oldR - L.R) > 0.5 || oldDpr !== pr) rebuildAtlas();
      compass.layout();
    },

    render(nowMs) {
      const t = (nowMs - epochMs) / 1000;
      const dt = lastMs < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, (nowMs - lastMs) / 1000));
      lastMs = nowMs;
      lastT = t;
      L.uNow.value = t;

      // Apply everything drained this frame at this frame's time.
      sawNoteOn = false;
      while (pCount > 0) {
        const ev = pending[pHead]!;
        pending[pHead] = null;
        pHead = (pHead + 1) % PENDING_CAP;
        pCount--;
        apply(ev, t);
      }
      river.flush();

      if (mode === 'flash') {
        // Latency test: full white on a frame that drained a note-on, black otherwise. Nothing else.
        renderer.setClearColor(sawNoteOn ? white : black, 1);
        renderer.render(flashScene, camera);
        return;
      }

      particles.uTime.value = t;
      computeInstant(t);
      if (view === 'river') drawRiverDecor(t);
      over.begin();
      compass.draw(over, t, dt, instant, noteLvl, river.pedalDown);
      over.end();
      pipeline.render();
    },
  };
  return viz;
}

/** Short labels drawn into the sprite atlas: 12 pitch-class names, then "PEDAL". */
function atlasLabels(R: number) {
  const pcFont = `500 ${Math.max(9, R * 0.07).toFixed(1)}px ${DISPLAY_FONT}`;
  return [...PC_NAMES.map((text) => ({ text, font: pcFont })), { text: 'PEDAL', font: `500 11px ${MONO_FONT}` }];
}
