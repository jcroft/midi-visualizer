// Text drawn with the 2D canvas API and shown as textures. A canvas is redrawn
// (and re-uploaded) only when its content changes, never per frame.
import { CanvasTexture, LinearFilter, Mesh, MeshBasicNodeMaterial, PlaneGeometry, SRGBColorSpace, type Scene } from 'three/webgpu';
import { texture, uniform, uv, vec4 } from 'three/tsl';
import { premultipliedBlend } from './layout';
import type { Cell } from './sprites';

function makeTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  return t;
}

// ---------------------------------------------------------------------------
// Atlas: a fixed set of short labels (pitch-class names, "PEDAL") for the sprite batch.

export interface Atlas {
  texture: CanvasTexture;
  cells: Cell[];
}

export interface AtlasLabel {
  text: string;
  /** CSS font shorthand, size in CSS px. */
  font: string;
}

/** Lays labels out in one row. Cell sizes are in CSS px; the canvas is drawn at `dpr`. */
export function buildAtlas(labels: AtlasLabel[], dpr: number): Atlas {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const pad = 3;
  const sizes = labels.map((l) => {
    ctx.font = l.font;
    const m = ctx.measureText(l.text + 'Mg');
    const h = Math.ceil((m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || 12) + (m.fontBoundingBoxDescent || m.actualBoundingBoxDescent || 4)) + pad * 2;
    return { w: Math.ceil(ctx.measureText(l.text).width) + pad * 2, h };
  });
  const totalW = sizes.reduce((a, s) => a + s.w, 0);
  const maxH = sizes.reduce((a, s) => Math.max(a, s.h), 1);
  canvas.width = Math.max(1, Math.ceil(totalW * dpr));
  canvas.height = Math.max(1, Math.ceil(maxH * dpr));
  ctx.scale(dpr, dpr);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  const cells: Cell[] = [];
  const W = canvas.width / dpr;
  const H = canvas.height / dpr;
  let x = 0;
  for (let i = 0; i < labels.length; i++) {
    const { w, h } = sizes[i];
    ctx.font = labels[i].font;
    ctx.fillText(labels[i].text, x + w / 2, h / 2);
    // flipY texture: v = 1 at the canvas top.
    cells.push({ u0: x / W, v0: 1 - h / H, u1: (x + w) / W, v1: 1, w, h });
    x += w;
  }
  return { texture: makeTexture(canvas), cells };
}

// ---------------------------------------------------------------------------
// TextLayer: a quad of canvas text that crossfades (two canvases, ping-pong) when its content changes.

export interface FadeTiming {
  /** Seconds for the old text to fade out, and px it rises while doing so. */
  out: number;
  outRise: number;
  /** Seconds for the new text to fade in (after `delay`), and px it rises into place from. */
  in: number;
  inRise: number;
  delay: number;
}

type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

interface Slot {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  node: ReturnType<typeof texture>;
  tex: CanvasTexture;
  opacity: { value: number };
  mesh: Mesh;
  /** Where this slot's content was placed (center, CSS px, y-up). */
  x: number;
  y: number;
}

export class TextLayer {
  private readonly slots: Slot[] = [];
  private cur = 0;
  private changeT = -1e9;
  private dirty = false;
  private w = 0;
  private h = 0;
  private cx = 0;
  private cy = 0;
  private dpr = 1;
  /** Master opacity (e.g. chord confidence). */
  opacity = 1;

  constructor(
    scene: Scene,
    renderOrder: number,
    private readonly draw: DrawFn,
    private readonly timing: FadeTiming,
  ) {
    const geo = new PlaneGeometry(1, 1);
    for (let i = 0; i < 2; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      const ctx = canvas.getContext('2d')!;
      const tex = makeTexture(canvas);
      const node = texture(tex);
      const opacity = uniform(0);
      const s = node.sample(uv());
      const mat = new MeshBasicNodeMaterial();
      const a = s.a.mul(opacity);
      mat.fragmentNode = vec4(s.rgb.mul(a), a);
      premultipliedBlend(mat);
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
      mesh.visible = false;
      scene.add(mesh);
      this.slots.push({ canvas, ctx, node, tex, opacity, mesh, x: 0, y: 0 });
    }
  }

  /** Ask for a redraw with a crossfade on the next update(). */
  changed(): void {
    this.dirty = true;
  }

  /**
   * Where the next content goes (center, CSS px, y-up). The outgoing text keeps
   * its own position, so a label that moves fades out in place and fades in at
   * the new spot.
   */
  at(cx: number, cy: number): void {
    this.cx = cx;
    this.cy = cy;
  }

  /** Move the text that is showing now (and anything painted next) without a crossfade. */
  moveTo(cx: number, cy: number): void {
    this.cx = cx;
    this.cy = cy;
    const s = this.slots[this.cur];
    s.x = cx;
    s.y = cy;
  }

  /** Position (center, CSS px, y-up) and size. Re-allocates canvases only when the size changes. */
  place(cx: number, cy: number, w: number, h: number, dpr: number): void {
    this.cx = cx;
    this.cy = cy;
    for (const s of this.slots) {
      s.x = cx;
      s.y = cy;
    }
    w = Math.ceil(w);
    h = Math.ceil(h);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    for (const s of this.slots) {
      s.canvas.width = Math.max(2, Math.ceil(w * dpr));
      s.canvas.height = Math.max(2, Math.ceil(h * dpr));
      // A GPU texture can't change size in place: replace it.
      s.tex.dispose();
      s.tex = makeTexture(s.canvas);
      s.node.value = s.tex;
      s.mesh.scale.set(w, h, 1);
    }
    // Redraw the current content at the new size without a crossfade.
    this.paint(this.slots[this.cur]);
    this.slots[1 - this.cur].opacity.value = 0;
    this.slots[1 - this.cur].mesh.visible = false;
  }

  update(t: number): void {
    if (this.dirty) {
      this.dirty = false;
      this.cur = 1 - this.cur;
      const s = this.slots[this.cur];
      s.x = this.cx;
      s.y = this.cy;
      this.paint(s);
      this.changeT = t;
    }
    const k = t - this.changeT;
    const T = this.timing;
    const kin = Math.min(1, Math.max(0, (k - T.delay) / T.in));
    const ein = 1 - (1 - kin) ** 3; // ease-out
    const kout = Math.min(1, k / T.out);
    const eout = kout * kout; // ease-in

    const n = this.slots[this.cur];
    n.opacity.value = ein * this.opacity;
    n.mesh.visible = n.opacity.value > 0.001;
    n.mesh.position.set(n.x, n.y - (1 - ein) * T.inRise, 0);

    const o = this.slots[1 - this.cur];
    const oo = (1 - eout) * this.opacity;
    o.opacity.value = oo;
    o.mesh.visible = oo > 0.001;
    o.mesh.position.set(o.x, o.y + eout * T.outRise, 0);
  }

  private paint(s: Slot): void {
    const { ctx, canvas } = s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw(ctx, this.w, this.h);
    s.tex.needsUpdate = true;
  }
}
