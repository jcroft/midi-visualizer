// A batch of small 2D shapes rewritten from the CPU every frame: keyboard
// keys, guide lines, compass nodes, rings, arcs, dots, and atlas glyphs.
// One instanced draw; the arrays are preallocated and only the used prefix
// is uploaded. Coordinates are CSS pixels, y-up.
import {
  CanvasTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  type Scene,
} from 'three/webgpu';
import { abs, atan, attribute, clamp, cos, exp, float, fract, length, max, mix, positionGeometry, select, sin, step, texture, varying, vec2, vec3, vec4 } from 'three/tsl';
import { premultipliedBlend } from './layout';

/** Shape ids, matched in the fragment shader. */
const Shape = { Rect: 0, Disc: 1, Glow: 2, Ring: 3, Arc: 4, Glyph: 5 } as const;
type Shape = (typeof Shape)[keyof typeof Shape];

/** Atlas cell in texture uv space (flipY: v grows upward) plus its size in CSS px. */
export interface Cell {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  w: number;
  h: number;
}

interface Range {
  start: number;
  count: number;
}

const PAD = 1.5; // px of quad padding for anti-aliased edges

export class SpriteBatch {
  readonly mesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly a0: Float32Array; // cx, cy, hw, hh
  private readonly a1: Float32Array; // rotation, shape, -, -
  private readonly a2: Float32Array; // shape params
  private readonly a3: Float32Array; // premultiplied rgb, alpha (0 = additive)
  private readonly attrs: InstancedBufferAttribute[] = [];
  private readonly ranges: Range[] = [];
  private readonly texNode;
  count = 0;

  constructor(
    scene: Scene,
    readonly capacity: number,
    renderOrder: number,
    atlas: CanvasTexture,
  ) {
    const plane = new PlaneGeometry(2, 2); // [-1, 1]
    const geo = new InstancedBufferGeometry();
    geo.setIndex(plane.getIndex());
    geo.setAttribute('position', plane.getAttribute('position'));
    const arrays: Float32Array[] = [];
    for (const name of ['s0', 's1', 's2', 's3']) {
      const arr = new Float32Array(capacity * 4);
      const a = new InstancedBufferAttribute(arr, 4);
      a.setUsage(DynamicDrawUsage);
      geo.setAttribute(name, a);
      arrays.push(arr);
      this.attrs.push(a);
      this.ranges.push({ start: 0, count: 0 });
    }
    [this.a0, this.a1, this.a2, this.a3] = arrays;
    geo.instanceCount = 0;
    this.geo = geo;

    const S0 = attribute('s0', 'vec4');
    const S1 = attribute('s1', 'vec4');
    const S2 = attribute('s2', 'vec4');
    const S3 = attribute('s3', 'vec4');
    const hw = S0.z;
    const hh = S0.w;
    const rot = S1.x;
    const shape = S1.y;

    // Vertex: padded quad in local px, rotated, then moved to the center.
    const local = positionGeometry.xy.mul(vec2(hw.add(PAD), hh.add(PAD)));
    const c = cos(rot);
    const s = sin(rot);
    const rotated = vec2(local.x.mul(c).sub(local.y.mul(s)), local.x.mul(s).add(local.y.mul(c)));
    const mat = new MeshBasicNodeMaterial();
    mat.positionNode = vec3(S0.xy.add(rotated), 0);

    // Fragment: coverage per shape, in the unrotated local frame.
    const p = varying(local);
    const d = length(p);
    const rectA = clamp(hw.sub(abs(p.x)).add(0.5), 0, 1).mul(clamp(hh.sub(abs(p.y)).add(0.5), 0, 1));
    // Rect param p0 > 0: fade in from the left edge over p0 px (chord bands).
    const leftFade = select(S2.x.greaterThan(0), clamp(p.x.add(hw).div(max(S2.x, 1)), 0, 1), float(1));
    const discA = clamp(hw.sub(d).add(0.5), 0, 1);
    const glowN = d.div(max(hw, 1));
    const glowA = exp(glowN.mul(glowN).mul(-4)).mul(clamp(float(1).sub(glowN), 0, 1).mul(6).min(1));
    // Ring/arc: p0 = radius, p1 = thickness. Arc: p2 = half span (rad), p3 = dash count over the span (0 = solid).
    const ringA = clamp(S2.y.mul(0.5).sub(abs(d.sub(S2.x))).add(0.5), 0, 1);
    const ang = atan(p.y, p.x);
    const spanA = clamp(S2.z.sub(abs(ang)).mul(max(d, 1)).add(0.5), 0, 1);
    const dashPhase = fract(ang.add(S2.z).div(max(S2.z.mul(2), 0.001)).mul(S2.w));
    const dashA = select(S2.w.greaterThan(0.5), step(dashPhase, 0.5), float(1));
    const arcA = ringA.mul(spanA).mul(dashA);
    // Glyph: p0..p3 = u0, v0, u1, v1 into the atlas.
    this.texNode = texture(atlas);
    const guv = vec2(
      mix(S2.x, S2.z, p.x.div(max(hw, 0.001)).mul(0.5).add(0.5)),
      mix(S2.y, S2.w, p.y.div(max(hh, 0.001)).mul(0.5).add(0.5)),
    );
    const glyphA = this.texNode.sample(guv).a.mul(rectA);

    const cov = select(
      shape.lessThan(0.5),
      rectA.mul(leftFade),
      select(
        shape.lessThan(1.5),
        discA,
        select(shape.lessThan(2.5), glowA, select(shape.lessThan(3.5), ringA, select(shape.lessThan(4.5), arcA, glyphA))),
      ),
    );
    mat.fragmentNode = vec4(S3.xyz.mul(cov), S3.w.mul(cov));
    premultipliedBlend(mat);

    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  setAtlas(t: CanvasTexture): void {
    this.texNode.value = t;
  }

  begin(): void {
    this.count = 0;
  }

  /** Upload the used prefix and set the draw count. */
  end(): void {
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    for (let i = 0; i < 4; i++) {
      const a = this.attrs[i];
      const r = this.ranges[i];
      r.start = 0;
      r.count = n * 4;
      a.updateRanges.length = 0;
      a.updateRanges.push(r);
      a.needsUpdate = true;
    }
  }

  /**
   * Core writer. rgb is linear, `opacity` 0..1 (HDR > 1 allowed for rgb gain),
   * `additive` true = glow (adds light), false = paints over.
   */
  private put(
    cx: number, cy: number, hw: number, hh: number, rot: number, shape: Shape,
    p0: number, p1: number, p2: number, p3: number,
    r: number, g: number, b: number, opacity: number, additive: boolean,
  ): void {
    if (this.count >= this.capacity || opacity <= 0.002) return;
    const i = this.count++ * 4;
    const a0 = this.a0, a1 = this.a1, a2 = this.a2, a3 = this.a3;
    a0[i] = cx; a0[i + 1] = cy; a0[i + 2] = hw; a0[i + 3] = hh;
    a1[i] = rot; a1[i + 1] = shape; a1[i + 2] = 0; a1[i + 3] = 0;
    a2[i] = p0; a2[i + 1] = p1; a2[i + 2] = p2; a2[i + 3] = p3;
    a3[i] = r * opacity; a3[i + 1] = g * opacity; a3[i + 2] = b * opacity;
    a3[i + 3] = additive ? 0 : Math.min(1, opacity);
  }

  rect(cx: number, cy: number, hw: number, hh: number, r: number, g: number, b: number, opacity: number, additive = false, fadeLeftPx = 0): void {
    this.put(cx, cy, hw, hh, 0, Shape.Rect, fadeLeftPx, 0, 0, 0, r, g, b, opacity, additive);
  }

  /** A line as a rotated rect. */
  line(x0: number, y0: number, x1: number, y1: number, thick: number, r: number, g: number, b: number, opacity: number, additive = false): void {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    this.put((x0 + x1) / 2, (y0 + y1) / 2, len / 2, thick / 2, Math.atan2(dy, dx), Shape.Rect, 0, 0, 0, 0, r, g, b, opacity, additive);
  }

  disc(cx: number, cy: number, radius: number, r: number, g: number, b: number, opacity: number, additive = false): void {
    this.put(cx, cy, radius, radius, 0, Shape.Disc, 0, 0, 0, 0, r, g, b, opacity, additive);
  }

  glow(cx: number, cy: number, radius: number, r: number, g: number, b: number, opacity: number): void {
    this.put(cx, cy, radius, radius, 0, Shape.Glow, 0, 0, 0, 0, r, g, b, opacity, true);
  }

  ring(cx: number, cy: number, radius: number, thick: number, r: number, g: number, b: number, opacity: number, additive = false): void {
    const e = radius + thick;
    this.put(cx, cy, e, e, 0, Shape.Ring, radius, thick, 0, 0, r, g, b, opacity, additive);
  }

  /** Arc centered on angle `mid` (radians, y-up, CCW), spanning +-halfSpan. dashes = segments across the span (0 = solid). */
  arc(cx: number, cy: number, radius: number, thick: number, mid: number, halfSpan: number, dashes: number, r: number, g: number, b: number, opacity: number, additive = false): void {
    const e = radius + thick;
    this.put(cx, cy, e, e, mid, Shape.Arc, radius, thick, halfSpan, dashes, r, g, b, opacity, additive);
  }

  glyph(cx: number, cy: number, cell: Cell, r: number, g: number, b: number, opacity: number): void {
    this.put(cx, cy, cell.w / 2, cell.h / 2, 0, Shape.Glyph, cell.u0, cell.v0, cell.u1, cell.v1, r, g, b, opacity, false);
  }
}
