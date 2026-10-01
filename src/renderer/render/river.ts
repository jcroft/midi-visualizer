// The River: note ribbons flowing left from the "now" line, plus the attack
// bloom at the keyboard. All per-note data lives in fixed GPU pools (typed
// arrays uploaded in place); the shaders derive every ribbon's position and
// brightness from a time uniform, so steady-state frames upload nothing.
//
// Ribbon brightness at a point is the note's brightness *at the moment that
// point passed the now line*: 1 while held, then exp(-dt / tauKey) while the
// pedal sustains it, then exp(-dt / tauEnd) after the damper. Sustained tails
// therefore fade along their length exactly like the sound does.
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  type Scene,
} from 'three/webgpu';
import { abs, attribute, clamp, exp, float, length, max, min, mix, positionGeometry, select, varying, vec3, vec4 } from 'three/tsl';
import { FLARE_RGB, NOTE_RGB } from './color';
import { type Layout, premultipliedBlend } from './layout';
import {
  AFTERTOUCH_GAIN,
  BLOOM_GAIN,
  BLOOM_GROW,
  BLOOM_POOL,
  BLOOM_R_BASE,
  BLOOM_R_VEL,
  BLOOM_TAU,
  DENSITY_WINDOW,
  FLARE_HDR,
  FLARE_TAU,
  LOWEST_NOTE,
  PEDAL_OFF,
  PEDAL_ON,
  RIBBON_BRIGHT_MIN,
  RIBBON_POOL,
  RIBBON_THICK_BASE,
  RIBBON_THICK_VEL,
  TAIL_GAIN,
  TAIL_WIDTH,
  TAU_DAMPER,
  TAU_RELEASE_PEDAL,
  TAU_RELEASE_UP,
  TAU_RESTRIKE,
} from './tuning';

/** "Hasn't happened yet." Large but safe in float32 arithmetic. */
const NEVER = 1e9;
const HALF_NEVER = NEVER / 2;

interface Range {
  start: number;
  count: number;
}

/** A fixed pool of instanced vec4 attributes with one dirty range per frame (no allocations). */
class Pool {
  readonly attrs: InstancedBufferAttribute[] = [];
  readonly arrays: Float32Array[] = [];
  private ranges: Range[] = [];
  private lo = Infinity;
  private hi = -1;
  next = 0;

  constructor(
    readonly geo: InstancedBufferGeometry,
    readonly size: number,
    names: string[],
  ) {
    for (const name of names) {
      const arr = new Float32Array(size * 4);
      const a = new InstancedBufferAttribute(arr, 4);
      a.setUsage(DynamicDrawUsage);
      geo.setAttribute(name, a);
      this.attrs.push(a);
      this.arrays.push(arr);
      this.ranges.push({ start: 0, count: 0 });
    }
    geo.instanceCount = size;
  }

  alloc(): number {
    const s = this.next;
    this.next = (s + 1) % this.size;
    return s;
  }

  dirty(slot: number): void {
    if (slot < this.lo) this.lo = slot;
    if (slot > this.hi) this.hi = slot;
  }

  /** Push this frame's dirty slots to the GPU. */
  flush(): void {
    if (this.hi < 0) return;
    for (let i = 0; i < this.attrs.length; i++) {
      const a = this.attrs[i];
      const r = this.ranges[i];
      r.start = this.lo * 4;
      r.count = (this.hi - this.lo + 1) * 4;
      a.updateRanges.length = 0;
      a.updateRanges.push(r);
      a.needsUpdate = true;
    }
    this.lo = Infinity;
    this.hi = -1;
  }
}

function quadGeometry(): InstancedBufferGeometry {
  const plane = new PlaneGeometry(1, 1); // positions in [-0.5, 0.5]
  const geo = new InstancedBufferGeometry();
  geo.setIndex(plane.getIndex());
  geo.setAttribute('position', plane.getAttribute('position'));
  geo.setAttribute('uv', plane.getAttribute('uv'));
  return geo;
}

export class River {
  // ---- note state (CPU) ----
  readonly held = new Uint8Array(128);
  readonly sustained = new Uint8Array(128);
  private readonly slotOf = new Int32Array(128).fill(-1);
  pedal = 0;
  pedalDown = false;
  private readonly onsets = new Float64Array(64);
  private onsetHead = 0;

  // ---- GPU pools ----
  private readonly rib: Pool;
  private readonly rT: Float32Array; // t0, tKey, tEnd, tauKey
  private readonly rN: Float32Array; // note, vel, tauEnd, pressure
  private readonly rC: Float32Array; // base rgb
  private readonly rF: Float32Array; // flare rgb
  private readonly blm: Pool;
  private readonly bA: Float32Array; // t0, note, vel, scale
  private readonly bC: Float32Array; // flare rgb

  readonly ribbonMesh: Mesh;
  readonly bloomMesh: Mesh;

  constructor(
    scene: Scene,
    L: Layout,
  ) {
    // ---------- ribbons ----------
    const rgeo = quadGeometry();
    this.rib = new Pool(rgeo, RIBBON_POOL, ['rT', 'rN', 'rC', 'rF']);
    [this.rT, this.rN, this.rC, this.rF] = this.rib.arrays;
    for (let i = 0; i < RIBBON_POOL; i++) this.rN[i * 4] = -1; // all slots dead

    {
      const T = attribute('rT', 'vec4');
      const N = attribute('rN', 'vec4');
      const C = attribute('rC', 'vec4');
      const F = attribute('rF', 'vec4');
      const { uNow, uNowX, uPps, uY0, uStep } = L;
      const t0 = T.x;
      const tKey = T.y;
      const tEnd = T.z;
      const tauKey = T.w;
      const note = N.x;
      const vel = N.y;
      const tauEnd = N.z;
      const pressure = N.w;

      // Vertex: stretch the unit quad from the onset to wherever the light has faded.
      const tStop = min(uNow, tKey.add(tauKey.mul(6)), tEnd.add(tauEnd.mul(4)));
      const x0 = uNowX.sub(uNow.sub(t0).mul(uPps));
      const x1 = max(uNowX.sub(uNow.sub(tStop).mul(uPps)), x0.add(2));
      const thick = uStep.mul(float(RIBBON_THICK_BASE).add(vel.mul(RIBBON_THICK_VEL)));
      const halfH = thick.mul(0.5).add(1); // +1 px for the soft edge
      const y = uY0.add(note.sub(LOWEST_NOTE - 0.5).mul(uStep));
      const fx = positionGeometry.x.add(0.5);
      const alive = note.greaterThanEqual(0).and(x1.greaterThan(-4));
      const pos = vec3(mix(x0, x1, fx), y.add(positionGeometry.y.mul(2).mul(halfH)), 0);
      const mat = new MeshBasicNodeMaterial();
      mat.positionNode = select(alive, pos, vec3(-1e5, -1e5, 0));

      // Fragment: brightness of the note at the time this pixel left the now line.
      const tf = varying(mix(t0, tStop, fx));
      const vy = varying(positionGeometry.y.mul(2).mul(halfH)); // px from the ribbon's center
      const vThick = varying(thick);
      const isHeld = tf.lessThan(tKey);
      const exK = exp(min(0, tKey.sub(tf).div(tauKey)));
      const exEndAtKey = exp(min(0, tKey.sub(tEnd).div(tauKey)));
      const exEnd = exp(min(0, tEnd.sub(tf).div(tauEnd)));
      const released = select(tf.lessThan(tEnd), exK, exEndAtKey.mul(exEnd));
      const level = select(isHeld, pressure.mul(AFTERTOUCH_GAIN).add(1), released.mul(TAIL_GAIN));
      const widthF = select(isHeld, float(1), float(TAIL_WIDTH));
      const halfT = vThick.mul(0.5).mul(widthF);
      const edge = clamp(halfT.sub(abs(vy)).add(0.5), 0, 1);
      const core = float(0.7).add(clamp(float(1).sub(abs(vy).div(max(halfT, 0.5))), 0, 1).mul(0.3));
      const flare = exp(min(0, t0.sub(tf).div(FLARE_TAU)));
      const velB = float(RIBBON_BRIGHT_MIN).add(vel.mul(1 - RIBBON_BRIGHT_MIN));
      const rgb = mix(C.xyz, F.xyz.mul(FLARE_HDR), flare).mul(level).mul(velB).mul(edge).mul(core);
      mat.fragmentNode = vec4(rgb, 0); // additive
      premultipliedBlend(mat);

      this.ribbonMesh = new Mesh(rgeo, mat);
      this.ribbonMesh.frustumCulled = false;
      this.ribbonMesh.renderOrder = 20;
      scene.add(this.ribbonMesh);
    }

    // ---------- attack blooms ----------
    const bgeo = quadGeometry();
    this.blm = new Pool(bgeo, BLOOM_POOL, ['bA', 'bC']);
    [this.bA, this.bC] = this.blm.arrays;
    for (let i = 0; i < BLOOM_POOL; i++) this.bA[i * 4 + 1] = -1;
    {
      const A = attribute('bA', 'vec4');
      const C = attribute('bC', 'vec4');
      const { uNow, uNowX, uY0, uStep, uScale } = L;
      const age = max(uNow.sub(A.x), 0);
      const fade = exp(age.div(-BLOOM_TAU));
      const rad = float(BLOOM_R_BASE)
        .add(A.z.mul(BLOOM_R_VEL))
        .mul(uScale)
        .mul(A.w)
        .mul(age.mul(BLOOM_GROW).add(1));
      const y = uY0.add(A.y.sub(LOWEST_NOTE - 0.5).mul(uStep));
      const alive = A.y.greaterThanEqual(0).and(age.lessThan(BLOOM_TAU * 6));
      const mat = new MeshBasicNodeMaterial();
      const pos = vec3(uNowX.add(positionGeometry.x.mul(2).mul(rad)), y.add(positionGeometry.y.mul(2).mul(rad)), 0);
      mat.positionNode = select(alive, pos, vec3(-1e5, -1e5, 0));
      const d = length(positionGeometry.xy.mul(2)); // 0 center .. 1 edge
      const halo = exp(d.mul(d).mul(-4.5));
      const hot = exp(d.mul(d).mul(-40));
      const rgb = mix(C.xyz, vec3(1, 1, 1), hot.mul(0.8))
        .mul(halo.add(hot))
        .mul(fade)
        .mul(A.z.mul(0.6).add(0.4))
        .mul(BLOOM_GAIN)
        .mul(clamp(float(1).sub(d), 0, 1).mul(4).min(1));
      mat.fragmentNode = vec4(rgb, 0);
      premultipliedBlend(mat);
      this.bloomMesh = new Mesh(bgeo, mat);
      this.bloomMesh.frustumCulled = false;
      this.bloomMesh.renderOrder = 30;
      scene.add(this.bloomMesh);
    }
  }

  // ---------- events (t = seconds in the visualizer clock) ----------

  noteOn(note: number, vel: number, t: number): void {
    if (note < 0 || note > 127) return;
    if (vel <= 0) return this.noteOff(note, t);
    this.endSlot(this.slotOf[note], note, t, TAU_RESTRIKE);

    const s = this.rib.alloc();
    const prevNote = this.rN[s * 4];
    if (prevNote >= 0 && this.slotOf[prevNote] === s) this.slotOf[prevNote] = -1;
    const pc = note % 12;
    const i = s * 4;
    this.rT[i] = t;
    this.rT[i + 1] = NEVER;
    this.rT[i + 2] = NEVER;
    this.rT[i + 3] = TAU_RELEASE_UP;
    this.rN[i] = note;
    this.rN[i + 1] = vel;
    this.rN[i + 2] = TAU_RELEASE_UP;
    this.rN[i + 3] = 0;
    this.rC[i] = NOTE_RGB[pc * 3];
    this.rC[i + 1] = NOTE_RGB[pc * 3 + 1];
    this.rC[i + 2] = NOTE_RGB[pc * 3 + 2];
    this.rF[i] = FLARE_RGB[pc * 3];
    this.rF[i + 1] = FLARE_RGB[pc * 3 + 1];
    this.rF[i + 2] = FLARE_RGB[pc * 3 + 2];
    this.rib.dirty(s);
    this.slotOf[note] = s;
    this.held[note] = 1;
    this.sustained[note] = 0;

    // Density: shrink blooms during fast passages.
    this.onsets[this.onsetHead] = t;
    this.onsetHead = (this.onsetHead + 1) % this.onsets.length;
    let n = 0;
    for (let k = 0; k < this.onsets.length; k++) if (t - this.onsets[k] < DENSITY_WINDOW) n++;

    const b = this.blm.alloc();
    const j = b * 4;
    this.bA[j] = t;
    this.bA[j + 1] = note;
    this.bA[j + 2] = vel;
    this.bA[j + 3] = 1 / Math.sqrt(Math.max(1, n));
    this.bC[j] = FLARE_RGB[pc * 3];
    this.bC[j + 1] = FLARE_RGB[pc * 3 + 1];
    this.bC[j + 2] = FLARE_RGB[pc * 3 + 2];
    this.blm.dirty(b);
  }

  noteOff(note: number, t: number): void {
    if (note < 0 || note > 127 || !this.held[note]) return;
    this.held[note] = 0;
    const s = this.slotOf[note];
    if (s < 0) return;
    const i = s * 4;
    this.rT[i + 1] = t;
    if (this.pedalDown) {
      this.rT[i + 3] = this.releaseTau();
      this.sustained[note] = 1;
    } else {
      this.rT[i + 2] = t;
      this.rT[i + 3] = TAU_RELEASE_UP;
      this.rN[i + 2] = TAU_RELEASE_UP;
    }
    this.rib.dirty(s);
  }

  sustain(value: number, t: number): void {
    this.pedal = value;
    const was = this.pedalDown;
    if (!was && value >= PEDAL_ON) this.pedalDown = true;
    else if (was && value < PEDAL_OFF) this.pedalDown = false;
    if (was && !this.pedalDown) {
      // Damper: everything only the pedal was holding drops together.
      for (let n = 0; n < 128; n++) {
        if (!this.sustained[n]) continue;
        this.sustained[n] = 0;
        this.endSlot(this.slotOf[n], n, t, TAU_DAMPER);
      }
    }
  }

  aftertouch(note: number, value: number): void {
    if (note < 0 || note > 127 || !this.held[note]) return;
    const s = this.slotOf[note];
    if (s < 0) return;
    this.rN[s * 4 + 3] = value;
    this.rib.dirty(s);
  }

  panic(t: number): void {
    for (let n = 0; n < 128; n++) {
      this.endSlot(this.slotOf[n], n, t, TAU_DAMPER);
      this.held[n] = 0;
      this.sustained[n] = 0;
    }
    this.pedal = 0;
    this.pedalDown = false;
  }

  /** Current brightness 0..~2 of a note's latest ribbon at its now-line end (for the keyboard and compass). */
  level(note: number, t: number): number {
    const s = this.slotOf[note];
    if (s < 0) return 0;
    const i = s * 4;
    const tKey = this.rT[i + 1];
    const tEnd = this.rT[i + 2];
    if (t < tKey) return 1 + this.rN[i + 3] * AFTERTOUCH_GAIN;
    const tauKey = this.rT[i + 3];
    if (t < tEnd) return Math.exp((tKey - t) / tauKey) * TAIL_GAIN;
    return Math.exp((tKey - tEnd) / tauKey) * Math.exp((tEnd - t) / this.rN[i + 2]) * TAIL_GAIN;
  }

  /** Velocity of the note's latest strike. */
  velocity(note: number): number {
    const s = this.slotOf[note];
    return s < 0 ? 0 : this.rN[s * 4 + 1];
  }

  /** Seconds since the note's latest onset (large if none). */
  sinceOnset(note: number, t: number): number {
    const s = this.slotOf[note];
    return s < 0 ? NEVER : t - this.rT[s * 4];
  }

  flush(): void {
    this.rib.flush();
    this.blm.flush();
  }

  // ---------- internals ----------

  private releaseTau(): number {
    // Half pedal scales between pedal-up and full-pedal release.
    const k = Math.min(1, Math.max(0, (this.pedal - 0.15) / 0.55));
    return TAU_RELEASE_UP + (TAU_RELEASE_PEDAL - TAU_RELEASE_UP) * k;
  }

  /** Stop a ribbon that is still sounding: it fades from now with time constant tau. */
  private endSlot(s: number, note: number, t: number, tau: number): void {
    if (s < 0 || this.rN[s * 4] !== note) return;
    const i = s * 4;
    if (this.rT[i + 2] < HALF_NEVER) return; // already ended
    if (this.rT[i + 1] > t) this.rT[i + 1] = t;
    this.rT[i + 2] = t;
    this.rN[i + 2] = tau;
    this.rib.dirty(s);
  }
}
