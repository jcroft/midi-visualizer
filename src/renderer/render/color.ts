// Pitch-class color: hue walks the circle of fifths in OKLCH, 30 degrees per
// fifth. Everything is converted to *linear* sRGB here, once, into lookup tables.
import { BAND_C, BAND_L, FLARE_C, FLARE_L, HUE_OF_C, NOTE_C, NOTE_L } from './tuning';

/** Position of a pitch class on the circle of fifths (C=0, G=1, D=2, ...). */
export const fifthsPos = (pc: number): number => (pc * 7) % 12;

export const hueOf = (pc: number): number => (fifthsPos(pc) * 30 + HUE_OF_C) % 360;

/** OKLCH -> linear sRGB, clipped to gamut. Writes into out[o..o+2]. */
export function oklchToLinear(L: number, C: number, hDeg: number, out: Float32Array, o = 0): Float32Array {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  out[o] = r < 0 ? 0 : r > 1 ? 1 : r;
  out[o + 1] = g < 0 ? 0 : g > 1 ? 1 : g;
  out[o + 2] = bl < 0 ? 0 : bl > 1 ? 1 : bl;
  return out;
}

function table(L: number, C: number): Float32Array {
  const t = new Float32Array(36);
  for (let pc = 0; pc < 12; pc++) oklchToLinear(L, C, hueOf(pc), t, pc * 3);
  return t;
}

/** 12 x rgb, linear. Index with pc * 3. */
export const NOTE_RGB = table(NOTE_L, NOTE_C);
export const FLARE_RGB = table(FLARE_L, FLARE_C);
export const BAND_RGB = table(BAND_L, BAND_C);
/** Brighter, slightly saturated: needle, ring highlights, inferred root. */
export const BRIGHT_RGB = table(0.9, 0.1);
/** Dim structural (key arc). */
export const DIM_RGB = table(0.5, 0.06);
/** Polygon fill tint. */
export const POLY_RGB = table(0.45, 0.08);

/** CSS string for the 2D canvas text layers (canvas understands oklch). */
export const cssOklch = (pc: number, L: number, C: number, a = 1): string => `oklch(${L} ${C} ${hueOf(pc)} / ${a})`;
