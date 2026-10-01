// The visual taxonomy ("ink = certainty"). Five tiers, one grammar:
//
//   PLAYED     sounding now: solid fill, glow, the only tier allowed to bloom.   inside the ring
//   HEARD      the recent past: solid, grey, no glow, drifts away.               needle track, history strip
//   STRUCTURE  key, numerals, function: tinted bands and hairlines, mono caps.   the rim (1.10–1.20 R), key title
//   IMPLIED    inferred root, implied key, runner-up: the confirmed form, hollow  where its confirmed form would be
//              (outline text, dashed strokes).
//   PREDICTED  the future: dotted or hollow only, stays under the bloom.          floating outside, 1.25 R and out
//
// Colors that encode function (T/SD/D) and voice role (guide tone, tension...) live here.
import type { Fn } from '@shared/analysis';
import type { FnClass } from '@theory/voicing';
import { BRIGHT_RGB, oklchToLinear } from './color';

const lin = (L: number, C: number, h: number) => oklchToLinear(L, C, h, new Float32Array(3));

/** Function colors (structure tier): tonic cool, subdominant green, dominant warm. */
export const FN_RGB: Record<Fn, Float32Array> = {
  T: lin(0.68, 0.08, 230),
  SD: lin(0.68, 0.08, 150),
  D: lin(0.72, 0.12, 60),
};
const HEARD_GREY = lin(0.6, 0.02, 260);

/** Function color, falling back to a quiet tint of the root's hue. */
export function fnRgb(fn: Fn | null, root: number): Float32Array {
  if (fn) return FN_RGB[fn];
  const out = new Float32Array(3);
  const r3 = root * 3;
  for (let i = 0; i < 3; i++) out[i] = BRIGHT_RGB[r3 + i] * 0.5 + HEARD_GREY[i] * 0.5;
  return out;
}

/** Voice-role colors for the Stack: guide tones gold, tensions teal, alterations magenta. */
export const ROLE_RGB: Record<FnClass, Float32Array> = {
  root: lin(0.9, 0.04, 260), // replaced by the root's hue when drawn
  guide: lin(0.86, 0.13, 85),
  fifth: lin(0.62, 0.01, 260),
  tension: lin(0.8, 0.1, 195),
  alt: lin(0.74, 0.15, 340),
  outside: lin(0.55, 0.01, 260),
};
export const ROLE_CSS: Record<FnClass, string> = {
  root: 'oklch(0.9 0.04 260)',
  guide: 'oklch(0.86 0.13 85)',
  fifth: 'oklch(0.62 0.01 260)',
  tension: 'oklch(0.8 0.1 195)',
  alt: 'oklch(0.74 0.15 340)',
  outside: 'oklch(0.55 0.01 260)',
};

/** Reharm offers (possible, not predicted): one neutral violet, apart from every root hue. */
export const OFFER_RGB = lin(0.78, 0.06, 300);
export const OFFER_CSS = 'oklch(0.78 0.06 300)';

/** Harmonic function from a roman numeral ("ii⁷", "V⁷/ii", "♭VIIΔ⁷"). */
export function fnFromRoman(roman: string): Fn | null {
  if (!roman) return null;
  if (roman.includes('/')) return 'D'; // secondary dominant
  const deg = roman.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹Δø°+]|sus/g, '');
  if (/^(V|vii|♭II)$/.test(deg)) return 'D';
  if (/^(ii|IV|iv|♭VI)$/.test(deg)) return 'SD';
  if (/^(I|i|iii|vi|♭III)$/.test(deg)) return 'T';
  return null;
}
