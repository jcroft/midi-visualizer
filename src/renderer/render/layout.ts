// Screen layout in CSS pixels, y-up (origin bottom-left), plus the shared
// shader uniforms that mirror it. The orthographic camera maps these pixels 1:1.
import { CustomBlending, OneFactor, OneMinusSrcAlphaFactor, type Material } from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
  COMPASS_R_H,
  COMPASS_R_W,
  KEY_COUNT,
  LOWEST_NOTE,
  NOW_X_FRAC,
  PPS_FRAC,
  PPS_MIN,
  RIVER_MARGIN_FRAC,
} from './tuning';

export class Layout {
  w = 1;
  h = 1;
  dpr = 1;
  nowX = 0;
  /** River flow speed, px per second. */
  pps = 100;
  /** y of the bottom edge of the lowest key row, and the height of one semitone row. */
  y0 = 0;
  step = 1;
  /** Size reference for things that should scale with the window. */
  scale = 1;
  cx = 0;
  cy = 0;
  R = 100;

  // Shader mirrors (seconds and px).
  readonly uNow = uniform(0);
  readonly uNowX = uniform(0);
  readonly uPps = uniform(100);
  readonly uY0 = uniform(0);
  readonly uStep = uniform(1);
  readonly uScale = uniform(1);
  readonly uW = uniform(1);
  readonly uH = uniform(1);

  update(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.nowX = Math.round(w * NOW_X_FRAC);
    this.pps = Math.max(PPS_MIN, w * PPS_FRAC);
    const m = h * RIVER_MARGIN_FRAC;
    this.y0 = m;
    this.step = (h - 2 * m) / KEY_COUNT;
    this.scale = Math.max(0.5, h / 900);
    const left = this.nowX + 24;
    const cw = w - left;
    this.cx = left + cw * 0.5;
    this.cy = h * 0.48;
    this.R = Math.max(40, Math.min(cw * COMPASS_R_W, h * COMPASS_R_H));

    this.uNowX.value = this.nowX;
    this.uPps.value = this.pps;
    this.uY0.value = this.y0;
    this.uStep.value = this.step;
    this.uScale.value = this.scale;
    this.uW.value = w;
    this.uH.value = h;
  }

  /** Center y of a MIDI note's row. */
  yOf(note: number): number {
    return this.y0 + (note - LOWEST_NOTE + 0.5) * this.step;
  }
}

/**
 * Premultiplied "over" blending for every material here. A fragment that
 * outputs alpha 0 is purely additive (glows); alpha 1 fully covers.
 */
export function premultipliedBlend<M extends Material>(m: M): M {
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneMinusSrcAlphaFactor;
  return m;
}
