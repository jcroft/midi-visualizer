// The Stack: the voicing as a vertical ladder in the left wing beside the compass. Each
// sounding note is a disc at its pitch (the scale fits the voicing), colored by its
// role in the chord (guide tones gold, tensions teal, alterations magenta),
// with its function on the left and its name on the right. On a chord change
// the old voicing slides left as a ghost and lines show how each voice moved,
// in semitones; a guide tone resolving by step glows gold.
import type { Scene } from 'three/webgpu';
import { analyzeVoicing, voiceLeading, type VoiceMove, type VoicingReading } from '@theory/voicing';
import { BRIGHT_RGB, cssOklch } from './color';
import type { Layout } from './layout';
import type { SpriteBatch } from './sprites';
import type { Touch } from './compass';
import { TextLayer } from './text';
import { ROLE_CSS, ROLE_RGB } from './taxonomy';
import { DISPLAY_FONT, MONO_FONT, STACK_SEMI_MIN_R, STACK_SEMI_R, STACK_GHOST_FADE, STACK_LINE_GROW, STACK_SLIDE } from './tuning';

const NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MAX_NOTES = 16;
const BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

export class Stack {
  private reading: VoicingReading | null = null;
  private notes: number[] = [];
  private noteKey = '';
  private chordKey = '';
  private root = -1;
  private chordQ = '';
  /** Pitch at the center of the window (MIDI), fixed between re-centers so labels stay put. */
  private center = 60;
  private semi = 1;
  private readonly labels: TextLayer;
  private readonly moveLayer: TextLayer;

  // Recent note sets with when they began, to find the previous chord's voicing (the analysis lags the keys a little).
  private readonly sets: { notes: number[]; key: string; t0: number }[] = [];
  private moves: VoiceMove[] = [];
  private ghost: VoicingReading | null = null;
  private ghostCenter = 60;
  private ghostSemi = 1;
  private changeT = -1e9;

  constructor(
    scene: Scene,
    private readonly L: Layout,
  ) {
    this.labels = new TextLayer(scene, 62, (ctx, w, h) => this.drawLabels(ctx, w, h), { out: 0.1, outRise: 0, in: 0.1, inRise: 0, delay: 0 });
    this.moveLayer = new TextLayer(scene, 62, (ctx, w, h) => this.drawMoves(ctx, w, h), { out: 0.3, outRise: 0, in: 0.2, inRise: 0, delay: 0.15 });
  }

  /** The voicing as read now (null without a chord). */
  get current(): VoicingReading | null {
    return this.reading;
  }

  layout(): void {
    const { stackX: cx, stackTop: top, stackBot: bot, stackU: R, dpr } = this.L;
    this.semi = R * STACK_SEMI_R;
    this.ghostSemi = this.semi;
    this.labels.place(cx, (top + bot) / 2, R * 0.9, top - bot + R * 0.16, dpr);
    this.moveLayer.place(cx, (top + bot) / 2, R * 0.9, top - bot + R * 0.16, dpr);
    this.labels.changed();
    this.moveLayer.changed();
  }

  /** Window capacity in semitones. */
  private get span(): number {
    return (this.L.stackTop - this.L.stackBot) / this.semi;
  }

  /** Semitone height that fits a voicing of `range` semitones: big for one hand, smaller for two. */
  private fitSemi(range: number): number {
    const R = this.L.stackU;
    return Math.min(R * STACK_SEMI_R, Math.max(R * STACK_SEMI_MIN_R, (this.L.stackTop - this.L.stackBot) / (range + 6)));
  }

  /** y of a MIDI note for a given window center and scale. */
  private yOf(note: number, center: number, semi = this.semi): number {
    const mid = (this.L.stackTop + this.L.stackBot) / 2;
    return mid + (note - center) * semi;
  }

  /**
   * Feed the sounding notes (levels per MIDI note) and the current chord every
   * frame; `changed` is true on the frame a new chord event arrived.
   */
  update(levels: Float32Array, root: number, q: string, changed: boolean, t: number): void {
    const notes: number[] = [];
    for (let n = 0; n < 128 && notes.length < MAX_NOTES; n++) if (levels[n] > 0.25) notes.push(n);
    const nk = notes.join(',');
    const ck = root + q;

    if (nk !== this.noteKey && notes.length) {
      this.sets.push({ notes, key: nk, t0: t });
      if (this.sets.length > 12) this.sets.shift();
    }

    if (changed && root >= 0 && notes.length) {
      // Voice leading from the last voicing that held for a moment and isn't this one.
      let prev: number[] | null = null;
      for (let i = this.sets.length - 2; i >= 0; i--) {
        const s = this.sets[i];
        const end = this.sets[i + 1].t0;
        if (s.key !== nk && end - s.t0 >= 0.15) {
          prev = s.notes;
          break;
        }
      }
      if (prev) {
        this.ghost = analyzeVoicing(prev, this.root >= 0 ? this.root : root, this.chordQ || q);
        this.ghostCenter = this.center;
        this.ghostSemi = this.semi;
        this.moves = voiceLeading(prev, notes);
        this.changeT = t;
      }
    }

    if (nk === this.noteKey && ck === this.chordKey) return;
    this.noteKey = nk;
    this.chordKey = ck;
    this.notes = notes;
    this.root = root;
    this.chordQ = q;
    this.reading = root >= 0 && q ? analyzeVoicing(notes, root, q) : null;

    // Re-center only when the voicing leaves the window (or on a chord change), so labels don't jitter.
    if (notes.length) {
      const lo = notes[0];
      const hi = notes[notes.length - 1];
      const margin = 3;
      const half = this.span / 2;
      if (changed || lo < this.center - half + margin || hi > this.center + half - margin || hi - lo > this.span - 2) {
        this.center = Math.round((lo + hi) / 2);
        // Rescale on a chord change, or when the voicing no longer fits.
        if (changed || hi - lo > this.span - 2) this.semi = this.fitSemi(hi - lo);
      }
    }
    this.labels.changed();
    if (changed) this.moveLayer.changed();
  }

  /** Disc radius: follows the scale, so seconds still clear each other. */
  private rad(): number {
    return Math.min(this.L.stackU * 0.018, this.semi * 0.8);
  }

  /**
   * `touch` (the Pedal & touch layer) sizes and brightens each disc by how hard
   * it was struck, marks a top voice quieter than the voices under it, wets the
   * stack with the pedal depth, and cools it under the soft pedal.
   */
  draw(sp: SpriteBatch, t: number, on: boolean, touch: Touch | null = null): void {
    const { stackX: cx, stackU: R } = this.L;
    const opacity = on ? 1 : 0;
    this.labels.opacity = opacity;
    const age = t - this.changeT;
    this.moveLayer.opacity = on && age < STACK_GHOST_FADE ? 1 - Math.max(0, age - STACK_GHOST_FADE * 0.6) / (STACK_GHOST_FADE * 0.4) : 0;
    this.labels.update(t);
    this.moveLayer.update(t);
    if (!on) return;

    const top = this.L.stackTop;
    const bot = this.L.stackBot;
    const gx = cx - R * 0.16;

    // Keyboard spine: the white keys as faint bands up the column (black keys left dark), so the
    // discs sit on their actual keys and register reads as a place on the piano.
    const kw = R * 0.05;
    for (let n = Math.ceil(this.center - this.span / 2); n <= this.center + this.span / 2; n++) {
      const y = this.yOf(n, this.center);
      if (y < bot || y > top || BLACK[n % 12]) continue;
      sp.rect(cx, y, kw, this.semi * 0.42, 0.75, 0.8, 0.95, n % 12 === 0 ? 0.075 : 0.045);
    }

    // Register gauge: a hairline with a tick at every C in the window.
    sp.line(gx, bot, gx, top, Math.max(1, R * 0.002), 0.5, 0.55, 0.7, 0.12);
    for (let c = 24; c <= 108; c += 12) {
      const y = this.yOf(c, this.center);
      if (y < bot || y > top) continue;
      sp.line(gx - R * 0.012, y, gx + R * 0.012, y, 1, 0.5, 0.55, 0.7, 0.3);
    }

    // Ghost of the previous voicing sliding left, and the moves between them.
    if (this.ghost && age < STACK_GHOST_FADE) {
      const slide = 1 - Math.pow(1 - Math.min(1, age / STACK_SLIDE), 3);
      const gxv = cx - R * 0.3 * slide;
      const fade = age < STACK_GHOST_FADE * 0.6 ? 1 : 1 - (age - STACK_GHOST_FADE * 0.6) / (STACK_GHOST_FADE * 0.4);
      for (const v of this.ghost.voices) {
        const y = this.yOf(v.note, this.ghostCenter, this.ghostSemi);
        if (y < bot - 4 || y > top + 4) continue;
        const c = ROLE_RGB[v.cls];
        sp.ring(gxv, y, this.rad() * 0.85, Math.max(1, R * 0.002), c[0], c[1], c[2], 0.5 * fade);
      }
      const grow = Math.min(1, age / STACK_LINE_GROW);
      for (const m of this.moves) {
        if (m.from === null || m.to === null) continue;
        const y0 = this.yOf(m.from, this.ghostCenter, this.ghostSemi);
        const y1 = this.yOf(m.to, this.center);
        const x1 = gxv + (cx - gxv) * grow;
        const yy = y0 + (y1 - y0) * grow;
        const d = m.to - m.from;
        const toGuide = this.reading?.voices.find((v) => v.note === m.to)?.cls === 'guide';
        if (toGuide && d !== 0 && Math.abs(d) <= 2) {
          const g = ROLE_RGB.guide;
          sp.line(gxv, y0, x1, yy, Math.max(2, R * 0.006), g[0] * 1.3, g[1] * 1.3, g[2] * 1.3, 0.85 * fade, true);
        } else {
          sp.line(gxv, y0, x1, yy, Math.max(1, R * 0.0025), 0.7, 0.74, 0.86, (d === 0 ? 0.25 : 0.45) * fade);
        }
      }
    }

    const r = this.reading;
    if (!r) {
      // No chord: still show what's sounding, plainly.
      for (const n of this.notes) {
        const y = this.yOf(n, this.center);
        if (y >= bot - 4 && y <= top + 4) sp.disc(cx, y, R * 0.01, 0.75, 0.78, 0.88, 0.8);
      }
      return;
    }

    // Split between the hands.
    if (r.split !== null) {
      const ya = this.yOf(r.voices[r.split - 1].note, this.center);
      const yb = this.yOf(r.voices[r.split].note, this.center);
      const y = (ya + yb) / 2;
      sp.line(cx - R * 0.05, y, cx + R * 0.05, y, 1, 0.6, 0.64, 0.78, 0.3);
    }

    // Implied root: a hollow dashed ring an octave-or-less below the bass.
    if (r.rootInferred && this.root >= 0) {
      const bass = r.voices[0].note;
      const below = bass - (((bass - this.root) % 12) + 12) % 12 || bass - 12;
      const y = this.yOf(below === bass ? bass - 12 : below, this.center);
      if (y >= bot - 8) {
        const r3 = this.root * 3;
        sp.arc(cx, y, R * 0.013, Math.max(1, R * 0.0025), 0, Math.PI, 8, BRIGHT_RGB[r3], BRIGHT_RGB[r3 + 1], BRIGHT_RGB[r3 + 2], 0.7);
      }
    }

    // Balance: is the top voice (the melody, when two hands play) quieter than the voices under it?
    const nv = r.voices.length;
    let innerVel = 0;
    if (touch && nv >= 3) for (let i = 1; i < nv - 1; i++) innerVel = Math.max(innerVel, touch.vel[r.voices[i].note]);
    const topQuiet = !!touch && nv >= 3 && touch.vel[r.voices[nv - 1].note] < innerVel - 0.08;
    const cool = touch ? touch.soft : 0;
    const wet = touch ? touch.pedal : 0;

    // The voices.
    let prevY = -1e9;
    let side = 1;
    for (let i = 0; i < nv; i++) {
      const v = r.voices[i];
      const y = this.yOf(v.note, this.center);
      if (y < bot - 4 || y > top + 4) continue;
      // Seconds sit side by side, like on a staff.
      side = y - prevY < this.semi * 2.5 ? -side : 1;
      const x = cx + (side < 0 ? this.rad() * 2.2 : 0);
      prevY = y;
      const vel = touch ? touch.vel[v.note] : 1;
      const rad = this.rad() * (v.hand === 'L' ? 1.15 : 1) * (touch ? 0.7 + 0.5 * vel : 1);
      const op = touch ? (0.5 + 0.5 * vel) * (1 - 0.25 * cool) : 1;
      let cr: number, cg: number, cb: number;
      if (v.cls === 'root') {
        const r3 = v.pc * 3;
        [cr, cg, cb] = [BRIGHT_RGB[r3], BRIGHT_RGB[r3 + 1], BRIGHT_RGB[r3 + 2]];
      } else {
        const c = ROLE_RGB[v.cls];
        [cr, cg, cb] = [c[0], c[1], c[2]];
      }
      if (cool > 0) {
        // the soft pedal cools: toward a quiet blue
        const k = 0.4 * cool;
        cr += (0.35 - cr) * k;
        cg += (0.45 - cg) * k;
        cb += (0.8 - cb) * k;
      }
      if (wet > 0.05) sp.glow(x, y, rad * (2.5 + 2.5 * wet), cr, cg, cb, 0.14 * wet * op);
      if (v.cls === 'outside') {
        sp.ring(x, y, rad * 0.85, Math.max(1, R * 0.0025), cr, cg, cb, 0.9 * op);
      } else {
        sp.disc(x, y, rad, cr, cg, cb, op);
        if (v.cls === 'guide') sp.glow(x, y, rad * 3, cr, cg, cb, 0.35 * op);
      }
      if (topQuiet && i === nv - 1) sp.line(x - rad * 1.6, y - rad * 1.9, x + rad * 1.6, y - rad * 1.9, Math.max(1, R * 0.002), 0.85, 0.88, 0.96, 0.45);
    }
  }

  // ---------- text ----------

  private drawLabels(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const r = this.reading;
    const R = this.L.stackU;
    const midY = h / 2; // canvas center = window center (y-down)
    const yc = (note: number) => midY - (note - this.center) * this.semi;
    const fnSize = Math.max(11, R * 0.048);
    const nameSize = Math.max(10, R * 0.036);
    ctx.textBaseline = 'middle';
    if (!r) return;
    let prevY = 1e9;
    let side = 1;
    // Labels too close to the one below them step outward, so close voices read as "3 9", not a smudge.
    let fnY = 1e9, fnX = 0, nmY = 1e9, nmX = 0;
    for (const v of r.voices) {
      const y = yc(v.note);
      if (y < 0 || y > h) continue;
      side = prevY - y < this.semi * 2.5 ? -side : 1;
      prevY = y;
      const off = side < 0 ? this.rad() * 2.2 : 0;
      ctx.font = `600 ${fnSize}px ${MONO_FONT}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = v.cls === 'root' ? cssOklch(v.pc, 0.9, 0.1, 1) : ROLE_CSS[v.cls];
      const fx = fnY - y < fnSize * 0.95 ? fnX - ctx.measureText('♭13').width * 0.9 - 4 : w / 2 - R * 0.045;
      ctx.fillText(v.fn, fx, y);
      fnX = fx;
      fnY = fnY - y < fnSize * 0.95 && fx !== w / 2 - R * 0.045 ? fnY : y;
      ctx.font = `400 ${nameSize}px ${DISPLAY_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(190,196,214,0.6)';
      const label = NAMES[v.pc] + (Math.floor(v.note / 12) - 1);
      const nx = nmY - y < nameSize * 0.95 ? nmX + ctx.measureText('E♭4').width + 6 : w / 2 + R * 0.045 + off;
      ctx.fillText(label, nx, y);
      nmX = nx;
      nmY = nmY - y < nameSize * 0.95 && nx !== w / 2 + R * 0.045 + off ? nmY : y;
    }
    // The kind of voicing, at the top of the column.
    ctx.textAlign = 'center';
    ctx.font = `500 ${Math.max(11, R * 0.04)}px ${MONO_FONT}`;
    ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(205,212,232,0.7)';
    const parts = [r.label.toUpperCase()];
    if (r.type !== 'close' && r.type !== 'open') parts.push(r.position.toUpperCase());
    ctx.fillText(parts.join(' · '), w / 2, Math.max(8, R * 0.03));
    ctx.letterSpacing = '0px';
  }

  private drawMoves(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.ghost) return;
    const R = this.L.stackU;
    const midY = h / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `500 ${Math.max(9, R * 0.03)}px ${MONO_FONT}`;
    for (const m of this.moves) {
      if (m.from === null || m.to === null) continue;
      const d = m.to - m.from;
      const y0 = midY - (m.from - this.ghostCenter) * this.ghostSemi;
      const y1 = midY - (m.to - this.center) * this.semi;
      const x = w / 2 - R * 0.16;
      const y = (y0 + y1) / 2 - 6;
      if (y < 0 || y > h) continue;
      ctx.fillStyle = d === 0 ? 'rgba(170,176,192,0.5)' : Math.abs(d) <= 2 ? ROLE_CSS.guide : 'rgba(205,212,232,0.8)';
      ctx.fillText(d === 0 ? '0' : d > 0 ? `+${d}` : `−${-d}`, x, y);
    }
  }
}
