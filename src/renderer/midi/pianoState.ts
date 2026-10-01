// CONTRACT (owned by the MIDI worker). held / sustained / sostenuto per note.
//
// Model per pitch: held ref-count (duplicate note-ons from layered channels
// don't leave stuck notes), `sustained` (released while CC64 down),
// `sostLatched` (held when CC66 went down). A note is physically sounding if
// any of those is true. Every sounding note also carries a decay weight so a
// pedaled D–7 fades out of the recognizer's view under the following G7;
// released notes keep a short tail (tau ~220 ms) in the snapshot.
//
// apply() is on the per-frame drain path: allocation-free, typed arrays only.
import type { PianoEvent } from '@shared/events';
import type { PianoSnapshot } from '@shared/analysis';

const N = 128;
/** Pedal logically goes down at >= 64/127 and up below 40/127. */
export const PEDAL_DOWN = 64 / 127;
export const PEDAL_UP = 40 / 127;
/** Release tau with dampers on the string (pedal up). */
export const TAU_DAMPED = 220;
/** Release tau with the pedal fully down (or sostenuto latched). */
export const TAU_PEDAL = 2500;
/** Held-key tau, and the floor a held key never decays below (fraction of its strike level). */
const TAU_HELD = 4000;
const HELD_FLOOR = 0.35;
/** Below this a note leaves the sounding set. */
export const W_MIN = 0.03;
export const ONSET_WINDOW = 60;
/** Weight change that counts as "moved meaningfully". */
const W_EPS = 0.04;
/** Decay-only snapshots are throttled to this interval (60 Hz). */
const DECAY_INTERVAL = 1000 / 60;

export class PianoState {
  /** Sustain 0..1 (raw, half-pedal preserved) */
  pedal = 0;
  /** Sostenuto 0..1 raw */
  sostenuto = 0;
  /** Soft pedal 0..1 (visual only) */
  soft = 0;
  /** Logical (hysteresis-applied) pedal states */
  sustainDown = false;
  sostenutoDown = false;

  private readonly heldCount = new Uint8Array(N);
  private readonly sustained = new Uint8Array(N);
  private readonly sostLatched = new Uint8Array(N);
  /** Note is in the sounding set (physically sounding, or a release tail above W_MIN). */
  private readonly active = new Uint8Array(N);
  private readonly vel = new Float32Array(N);
  private readonly onsetT = new Float64Array(N).fill(-Infinity);
  // weight = segLevel * exp(-(now - segT) / segTau), floored at segFloor
  private readonly segLevel = new Float32Array(N);
  private readonly segT = new Float64Array(N);
  private readonly segTau = new Float32Array(N);
  private readonly segFloor = new Float32Array(N);
  private readonly lastW = new Float32Array(N);
  private readonly lastOnset = new Uint8Array(N);

  private dirty = false;
  private recatch = false;
  private lastSnapT = -Infinity;
  private activeCount = 0;

  apply(ev: PianoEvent): void {
    switch (ev.type) {
      case 'on':
        this.noteOn(ev.note, ev.vel, ev.t);
        break;
      case 'off':
        this.noteOff(ev.note, ev.t);
        break;
      case 'cc':
        this.cc(ev.cc, ev.value, ev.t);
        break;
      case 'panic':
        this.panic();
        break;
      default:
        break; // poly aftertouch: not part of harmony state
    }
  }

  isHeld(note: number): boolean {
    return this.heldCount[note] > 0;
  }
  /** Physically sounding: held, sustained by CC64, or latched by sostenuto. (Release tails excluded.) */
  isSounding(note: number): boolean {
    return this.heldCount[note] > 0 || this.sustained[note] === 1 || this.sostLatched[note] === 1;
  }

  /** Returns a snapshot if anything changed since the last call (or decay weights moved enough), else null. */
  snapshot(now: number): PianoSnapshot | null {
    let changed = this.dirty;
    let moved = false;
    if (!changed && this.activeCount === 0) return null;
    // Expire tails and onsets; detect weight movement.
    for (let n = 0; n < N; n++) {
      const onset = now - this.onsetT[n] <= ONSET_WINDOW ? 1 : 0;
      if (onset !== this.lastOnset[n]) changed = true;
      if (!this.active[n]) continue;
      const w = this.weight(n, now);
      if (w < W_MIN && !this.heldCount[n]) {
        this.active[n] = 0;
        this.sustained[n] = 0;
        this.sostLatched[n] = 0;
        this.activeCount--;
        moved = true;
      } else if (Math.abs(w - this.lastW[n]) > W_EPS) moved = true;
    }
    if (!changed && !(moved && now - this.lastSnapT >= DECAY_INTERVAL)) return null;

    const held: number[] = [];
    const sounding: { note: number; w: number }[] = [];
    const onsets: number[] = [];
    for (let n = 0; n < N; n++) {
      if (this.heldCount[n]) held.push(n);
      const onset = now - this.onsetT[n] <= ONSET_WINDOW ? 1 : 0;
      this.lastOnset[n] = onset;
      if (onset) onsets.push(n);
      if (this.active[n]) {
        const w = this.weight(n, now);
        this.lastW[n] = w;
        sounding.push({ note: n, w: Math.round(w * 1000) / 1000 });
      } else this.lastW[n] = 0;
    }
    const snap: PianoSnapshot = {
      type: 'snapshot',
      t: now,
      held,
      sounding,
      onsets,
      pedal: this.pedal,
      pedalRecatch: this.recatch,
    };
    this.dirty = false;
    this.recatch = false;
    this.lastSnapT = now;
    return snap;
  }

  /** Current decay weight 0..1 of a note (0 if not in the sounding set). */
  weight(note: number, now: number): number {
    if (!this.active[note]) return 0;
    const dt = now - this.segT[note];
    const w = this.segLevel[note] * Math.exp(-(dt > 0 ? dt : 0) / this.segTau[note]);
    const f = this.segFloor[note];
    return w > f ? w : f;
  }

  // ---------------------------------------------------------------------------

  private noteOn(n: number, vel: number, t: number): void {
    if (n < 0 || n >= N) return;
    if (this.heldCount[n] < 255) this.heldCount[n]++;
    // Every note-on is an onset, including a re-strike of a sustained/held note.
    this.onsetT[n] = t;
    this.vel[n] = vel;
    this.sustained[n] = 0;
    if (!this.active[n]) {
      this.active[n] = 1;
      this.activeCount++;
    }
    const level = 0.45 + 0.55 * (vel < 0 ? 0 : vel > 1 ? 1 : vel);
    this.segLevel[n] = level;
    this.segT[n] = t;
    this.segTau[n] = TAU_HELD;
    this.segFloor[n] = level * HELD_FLOOR;
    this.dirty = true;
  }

  private noteOff(n: number, t: number): void {
    if (n < 0 || n >= N || this.heldCount[n] === 0) return;
    if (--this.heldCount[n] > 0) return; // still held via another source/channel
    if (this.sustainDown) this.sustained[n] = 1;
    this.resegment(n, t);
    this.dirty = true;
  }

  /** Re-anchor a note's decay at time t with the tau implied by the current pedal state. */
  private resegment(n: number, t: number): void {
    if (!this.active[n]) return;
    const w = this.weight(n, t);
    this.segLevel[n] = w;
    this.segT[n] = t;
    if (this.heldCount[n]) {
      this.segTau[n] = TAU_HELD;
      this.segFloor[n] = Math.min(this.segFloor[n], w);
    } else {
      this.segFloor[n] = 0;
      this.segTau[n] = this.sostLatched[n] ? TAU_PEDAL : this.sustained[n] ? this.pedalTau() : TAU_DAMPED;
    }
  }

  /** Half-pedal: tau scales from damped to full between the up threshold and ~3/4 pedal. */
  private pedalTau(): number {
    let x = (this.pedal - PEDAL_UP) / (0.75 - PEDAL_UP);
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    return TAU_DAMPED + (TAU_PEDAL - TAU_DAMPED) * x;
  }

  private cc(cc: number, v: number, t: number): void {
    if (cc === 64) this.setSustain(v, t);
    else if (cc === 66) this.setSostenuto(v, t);
    else if (cc === 67) this.soft = v;
    else if (cc === 121) {
      // reset all controllers
      this.setSustain(0, t);
      this.setSostenuto(0, t);
      this.soft = 0;
    }
  }

  private setSustain(v: number, t: number): void {
    const prev = this.pedal;
    this.pedal = v;
    if (!this.sustainDown && v >= PEDAL_DOWN) {
      this.sustainDown = true;
      this.recatch = true;
      this.dirty = true;
      // Release tails are NOT re-caught: with legato pedaling the old chord's
      // dampers have already landed, and catching them would smear D–7 into G7.
    } else if (this.sustainDown && v < PEDAL_UP) {
      this.sustainDown = false;
      this.dirty = true;
      for (let n = 0; n < N; n++) {
        if (this.sustained[n]) {
          this.sustained[n] = 0;
          this.resegment(n, t);
        }
      }
    } else if (this.sustainDown && prev !== v) {
      // half-pedal movement while down: re-scale sustained notes' damping (decay-only change)
      for (let n = 0; n < N; n++) if (this.sustained[n] && !this.sostLatched[n]) this.resegment(n, t);
    }
  }

  private setSostenuto(v: number, t: number): void {
    this.sostenuto = v;
    if (!this.sostenutoDown && v >= PEDAL_DOWN) {
      this.sostenutoDown = true;
      for (let n = 0; n < N; n++) if (this.heldCount[n]) this.sostLatched[n] = 1;
      this.dirty = true;
    } else if (this.sostenutoDown && v < PEDAL_UP) {
      this.sostenutoDown = false;
      for (let n = 0; n < N; n++) {
        if (this.sostLatched[n]) {
          this.sostLatched[n] = 0;
          this.resegment(n, t);
        }
      }
      this.dirty = true;
    }
  }

  /** All notes off, pedals up. */
  panic(): void {
    this.heldCount.fill(0);
    this.sustained.fill(0);
    this.sostLatched.fill(0);
    this.active.fill(0);
    this.onsetT.fill(-Infinity);
    this.activeCount = 0;
    this.pedal = 0;
    this.sostenuto = 0;
    this.sustainDown = false;
    this.sostenutoDown = false;
    this.recatch = false;
    this.dirty = true;
  }
}
