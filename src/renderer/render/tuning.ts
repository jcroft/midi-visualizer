// Every visual knob in one place. Times are in seconds, sizes in CSS pixels
// unless noted. Change these freely; nothing else needs to know.

// ---------- canvas ----------
export const BACKGROUND = 0x0b0c10;
export const MAX_PIXEL_RATIO = 2;

// ---------- river layout ----------
/** "Now" line (the light keyboard) as a fraction of the width. */
export const NOW_X_FRAC = 0.66;
/** River vertical margins as a fraction of the height. */
export const RIVER_MARGIN_FRAC = 0.04;
/** How fast the river flows: px per second = max(PPS_MIN, width * PPS_FRAC). */
export const PPS_MIN = 70;
export const PPS_FRAC = 0.085;
/** Piano range drawn on the keyboard (88 keys: A0..C8). Low notes at the bottom. */
export const LOWEST_NOTE = 21;
export const KEY_COUNT = 88;

// ---------- ribbons ----------
/** Fixed GPU pool of ribbon segments. Oldest is recycled when full. */
export const RIBBON_POOL = 4096;
/** Ribbon thickness as a fraction of one semitone row: base + velocity * extra. */
export const RIBBON_THICK_BASE = 0.3;
export const RIBBON_THICK_VEL = 0.55;
/** Brightness at velocity 0 (velocity 1 is full). */
export const RIBBON_BRIGHT_MIN = 0.45;
/** Released-but-sustained tail: relative brightness and thickness. */
export const TAIL_GAIN = 0.5;
export const TAIL_WIDTH = 0.5;
/** Attack flare on the ribbon head (saturation + lightness spike) decay. */
export const FLARE_TAU = 0.09;
/** Extra HDR push on the flare so it catches the bloom. */
export const FLARE_HDR = 1.4;
/** Poly-aftertouch brightening of a held note (1 = double brightness at full pressure). */
export const AFTERTOUCH_GAIN = 0.9;

// ---------- release physics ----------
/** Key released, pedal up. */
export const TAU_RELEASE_UP = 0.22;
/** Key released, pedal fully down. Half pedal interpolates. */
export const TAU_RELEASE_PEDAL = 2.5;
/** Pedal lifted: everything sustained drops together (you "see the damper"). */
export const TAU_DAMPER = 0.12;
/** Re-striking a sounding note cuts the old ribbon this fast. */
export const TAU_RESTRIKE = 0.05;
/** CC64 hysteresis (values 0..1): down at >= ON, up at < OFF. */
export const PEDAL_ON = 0.5;
export const PEDAL_OFF = 0.31;

// ---------- attack bloom at the keyboard ----------
export const BLOOM_POOL = 256;
/** Radius in px at reference size: base + velocity * extra. */
export const BLOOM_R_BASE = 12;
export const BLOOM_R_VEL = 42;
/** Brightness decay and outward growth of the attack bloom. */
export const BLOOM_TAU = 0.28;
export const BLOOM_GROW = 1.5;
/** HDR peak brightness of the bloom core. > 1 feeds the post bloom. */
export const BLOOM_GAIN = 2.2;
/** Dense passages shrink blooms by 1/sqrt(onsets in this window). */
export const DENSITY_WINDOW = 0.25;

// ---------- color (OKLCH) ----------
/** Hue of C; each step along the circle of fifths adds 30 degrees. */
export const HUE_OF_C = 250;
export const NOTE_L = 0.74;
export const NOTE_C = 0.11;
/** Attack: chroma and lightness flare, then relax. */
export const FLARE_L = 0.93;
export const FLARE_C = 0.16;
/** Chord band tint in the river. */
export const BAND_L = 0.26;
export const BAND_C = 0.06;
export const BAND_ALPHA = 0.28;

// ---------- compass ----------
/** River view: compass radius = min(region width * this, height * COMPASS_R_H). */
export const COMPASS_R_W = 0.27;
export const COMPASS_R_H = 0.27;
/** Compass-only view (default): radius = min(width * this, height * COMPASS_ONLY_R_H), center at height * CY. */
export const COMPASS_ONLY_R_W = 0.24;
export const COMPASS_ONLY_R_H = 0.29;
export const COMPASS_ONLY_CY = 0.5;
/** Radius stack, as multiples of R: needle track, key arc, prediction orbit, prediction labels. */
export const NEEDLE_R = 1.06;
export const KEY_ARC_R = 1.14;
export const KEY_ARC_THICK = 0.05;
export const ORBIT_R = 1.3;
export const PRED_LABEL_R = 1.4;
/** Hairline thickness (ring, polygon edges) as a fraction of R. */
export const HAIRLINE = 0.004;
export const POLY_ALPHA = 0.2;
/** Chord-root trail on the needle track: how many past roots, and how long each lingers. */
export const TRAIL_LEN = 3;
export const TRAIL_FADE = 4;
/** Tritone shimmer: opacity base +- swing, at this rate (Hz). Slow, so it doesn't pull the eye. */
export const TRITONE_BASE = 0.3;
export const TRITONE_SWING = 0.1;
export const TRITONE_HZ = 1.2;
/** Idle breathing: after this many seconds without a note, the ring breathes +-8% at 0.08 Hz. */
export const IDLE_AFTER = 6;
export const BREATH_DEPTH = 0.08;
export const BREATH_HZ = 0.08;
/** Spring natural frequencies (rad/s). Critically damped; settle ~ 4.7 / omega. */
export const NEEDLE_OMEGA = 13; // ~0.35 s
export const KEY_OMEGA = 5.2; // ~0.9 s
/** Pitch-class node display smoothing toward the analysis weights. */
export const PC_SMOOTH_TAU = 0.08;
/** Node flare decay after a note-on. */
export const NODE_FLARE_TAU = 0.25;
/** A pitch class counts as lit (polygon vertex) above this weight. */
export const LIT_THRESHOLD = 0.25;
/** Prediction ghosts: fade-in delay (after the chord label lands) and duration after the set changes. */
export const PRED_DELAY = 0.35;
export const PRED_FADE = 0.2;
/** Prediction opacity = base + gain * p; label size = (base + gain * sqrt(p)) * R. */
export const PRED_OPACITY_BASE = 0.25;
export const PRED_OPACITY_GAIN = 0.6;
export const PRED_SIZE_BASE = 0.1;
export const PRED_SIZE_GAIN = 0.08;
/** A slow brightness pulse travels along each prediction arc, root to target. */
export const PRED_PULSE_PERIOD = 2.4;
export const PRED_PULSE_DEPTH = 0.15;
/** The second step (chord after next): opacity relative to its parent. */
export const THEN_DIM = 0.5;
/** Ripple when the played chord lands on a prediction. */
export const RIPPLE_TIME = 0.6;
/** Landing: the ghost arc fills as a comet, then fades. */
export const COMET_FILL = 0.18;
export const COMET_FADE = 0.3;
/** Landing badge ("ii–V–I"): hold, then fade. */
export const BADGE_HOLD = 1.4;
export const BADGE_FADE = 0.5;
/** Chord history (lead-sheet line) in compass view. */
export const HISTORY_LEN = 6;
export const HISTORY_OPACITY = [0.9, 0.6, 0.45, 0.32, 0.22, 0.15];

// ---------- text ----------
export const DISPLAY_FONT = '"SF Pro Display", -apple-system, "Helvetica Neue", Inter, Arial, sans-serif';
export const MONO_FONT = '"SF Mono", ui-monospace, Menlo, monospace';
/** Chord name height as a fraction of the compass radius (shrinks to fit 1.6 R wide). */
export const CHORD_SIZE_R = 0.36;
export const CHORD_MAX_W_R = 1.6;
/** Below this confidence the chord dims and the runner-up shows. */
export const LOW_CONF = 0.5;
export const LOW_CONF_OPACITY = 0.45;
/** Chord label crossfade (design brief: out 120 ms rising, in 160 ms from below). */
export const CHORD_FADE_OUT = 0.12;
export const CHORD_FADE_IN = 0.16;
export const LABEL_RISE_PX = 6;
/** Key label crossfade. */
export const KEY_FADE = 0.6;

// ---------- post ----------
export const BLOOM_STRENGTH = 0.9;
export const BLOOM_RADIUS = 0.45;
export const BLOOM_THRESHOLD = 0.55;
export const BLOOM_STRENGTH_STRESS = 1.1;
/** Edge darkening 0..1. */
export const VIGNETTE = 0.35;

// ---------- stress mode ----------
export const PARTICLE_COUNT = 200_000;
export const PARTICLE_SPEED = 0.18;
export const PARTICLE_GAIN = 0.11;
export const PARTICLE_SIZE_MIN = 0.7;
export const PARTICLE_SIZE_MAX = 2.0;
