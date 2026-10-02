// Two small DOM panels for the move library:
//   StyleLens: the style families the last few bars draw from, top right. Tap a
//     family to lean the predictions toward it; tap it again to let go.
//   MovesRail: today's moves down the right side (M), each with its shape on the
//     circle of fifths, how often it landed and in which keys; the moves not
//     played yet sit greyed underneath.
import type { Analysis } from '@shared/analysis';
import { ALL_MOVES, moveById, type Move } from '@theory/moves';

const NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const SVG = 'http://www.w3.org/2000/svg';

function panel(id: string, css: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const el = document.createElement('div');
  el.id = id;
  Object.assign(el.style, css);
  document.body.appendChild(el);
  return el;
}

export class StyleLens {
  private readonly el: HTMLDivElement;
  private on = true;
  private key = '';

  constructor(private readonly lean: (style: string | null) => void) {
    this.el = panel('lens', {
      position: 'fixed',
      top: '14px',
      right: '16px',
      display: 'flex',
      gap: '4px',
      alignItems: 'baseline',
      font: '11px var(--mono)',
      letterSpacing: '0.08em',
      color: 'var(--dim)',
      transition: 'opacity 0.6s',
      opacity: '0',
    });
  }

  setOn(on: boolean): void {
    this.on = on;
    this.el.style.display = on ? 'flex' : 'none';
  }

  update(a: Analysis): void {
    const s = a.style;
    if (!this.on) return;
    const key = s ? `${s.lean}|${s.shares.map((x) => `${x.style}${Math.round(x.share * 20)}`).join(',')}` : '';
    if (key === this.key) return;
    this.key = key;
    this.el.textContent = '';
    this.el.style.opacity = s ? '1' : '0';
    if (!s) return;
    const shown = s.shares.map((x) => x.style);
    if (s.lean && !shown.includes(s.lean)) shown.push(s.lean);
    shown.forEach((style, i) => {
      if (i) {
        const dot = document.createElement('span');
        dot.textContent = '·';
        dot.style.opacity = '0.5';
        this.el.appendChild(dot);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      const lead = style === s.lead;
      const leaning = style === s.lean;
      b.textContent = lead ? style.toUpperCase() : style;
      b.title = leaning ? `Leaning toward ${style}: tap to let go` : `Lean the predictions toward ${style}`;
      Object.assign(b.style, {
        background: leaning ? 'rgba(255,255,255,0.12)' : 'transparent',
        border: leaning ? '1px solid rgba(255,255,255,0.35)' : '1px solid transparent',
        borderRadius: '5px',
        padding: '2px 6px',
        font: 'inherit',
        letterSpacing: 'inherit',
        fontWeight: lead ? '700' : '400',
        color: lead || leaning ? 'var(--fg)' : 'var(--dim)',
        cursor: 'pointer',
      } satisfies Partial<CSSStyleDeclaration>);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => this.lean(leaning ? null : style));
      this.el.appendChild(b);
    });
  }
}

interface Tally {
  move: Move;
  name: string;
  count: number;
  keys: Map<number, number>;
  rot: number;
  last: number;
}

/** The move's steps on the circle of fifths, its tonic at the top. */
function glyph(m: Move, size = 30, rot = 0): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '-1.2 -1.2 2.4 2.4');
  const ring = document.createElementNS(SVG, 'circle');
  ring.setAttribute('r', '1');
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', 'rgba(255,255,255,0.15)');
  ring.setAttribute('stroke-width', '0.05');
  svg.appendChild(ring);
  const pt = (deg: number): [number, number] => {
    const a = ((((((deg - rot) * 7) % 12) + 12) % 12) / 12) * Math.PI * 2;
    return [Math.sin(a) * 0.9, -Math.cos(a) * 0.9];
  };
  const steps = m.steps.filter((s) => !s.opt);
  const pts = steps.map((s) => pt(s.deg));
  if (m.kind === 'loop') pts.push(pts[0]);
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'rgba(200,210,240,0.85)');
  line.setAttribute('stroke-width', '0.13');
  line.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(line);
  steps.forEach((st, i) => {
    const [x, y] = pt(st.deg);
    const d = document.createElementNS(SVG, 'circle');
    d.setAttribute('cx', String(x));
    d.setAttribute('cy', String(y));
    d.setAttribute('r', i === steps.length - 1 && m.kind === 'cadence' ? '0.2' : '0.12');
    d.setAttribute('fill', 'rgba(200,210,240,0.95)');
    svg.appendChild(d);
  });
  return svg;
}

export class MovesRail {
  private readonly el: HTMLDivElement;
  private readonly tally = new Map<string, Tally>();
  private open = false;
  private dirty = true;
  private n = 0;

  constructor() {
    this.el = panel('rail', {
      position: 'fixed',
      top: '44px',
      right: '12px',
      bottom: '56px',
      width: '250px',
      overflowY: 'auto',
      padding: '12px 14px',
      background: 'rgba(11,12,16,0.9)',
      border: '1px solid var(--line)',
      borderRadius: '10px',
      font: '12px var(--sans)',
      color: 'var(--fg)',
      display: 'none',
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(open = !this.open): void {
    this.open = open;
    this.el.style.display = open ? 'block' : 'none';
    if (open) this.render();
  }

  update(a: Analysis): void {
    const mv = a.landing?.move;
    if (!mv || mv.id === 'loop') return;
    const move = moveById(mv.id);
    if (!move) return;
    const t = this.tally.get(mv.id) ?? { move, name: mv.name, count: 0, keys: new Map(), rot: 0, last: 0 };
    t.count++;
    t.name = mv.name;
    t.rot = mv.rot;
    t.keys.set(mv.home, (t.keys.get(mv.home) ?? 0) + 1);
    t.last = ++this.n;
    this.tally.set(mv.id, t);
    this.dirty = true;
    if (this.open) this.render();
  }

  private render(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.el.textContent = '';
    const head = document.createElement('div');
    head.textContent = "TODAY'S MOVES";
    Object.assign(head.style, { font: '11px var(--mono)', letterSpacing: '0.12em', color: 'var(--dim)', marginBottom: '10px' });
    this.el.appendChild(head);
    if (!this.tally.size) {
      const none = document.createElement('div');
      none.textContent = 'Nothing yet. Play a ii–V–I, a backdoor, a four-chord loop…';
      none.style.color = 'var(--dim)';
      this.el.appendChild(none);
    }
    // grouped by each move's home style, the busiest family first
    const fam = new Map<string, Tally[]>();
    for (const t of this.tally.values()) {
      const f = t.move.styles[0] ?? 'mine';
      fam.set(f, [...(fam.get(f) ?? []), t]);
    }
    const fams = [...fam.entries()].sort((a, b) => b[1].reduce((s, t) => s + t.count, 0) - a[1].reduce((s, t) => s + t.count, 0));
    for (const [f, list] of fams) {
      const h = document.createElement('div');
      h.textContent = f;
      Object.assign(h.style, { font: '10px var(--mono)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--dim)', margin: '10px 0 4px' });
      this.el.appendChild(h);
      for (const t of list.sort((a, b) => b.count - a.count || b.last - a.last)) {
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', gap: '10px', alignItems: 'center', padding: '3px 0' });
        row.title = `${t.move.roman} · ${t.move.styles.join(', ')}`;
        row.appendChild(glyph(t.move, 30, t.rot));
        const txt = document.createElement('div');
        const name = document.createElement('div');
        name.textContent = `${t.name}  ×${t.count}`;
        name.style.whiteSpace = 'pre';
        const keys = document.createElement('div');
        keys.textContent = [...t.keys.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => (n > 1 ? `${NAMES[k]} ×${n}` : NAMES[k]))
          .join(' · ');
        Object.assign(keys.style, { font: '10px var(--mono)', color: 'var(--dim)' });
        txt.append(name, keys);
        row.appendChild(txt);
        this.el.appendChild(row);
      }
    }
    // the rest of the library, for ideas
    const rest = ALL_MOVES.filter((m) => !this.tally.has(m.id));
    if (rest.length) {
      const d = document.createElement('details');
      d.style.marginTop = '14px';
      const s = document.createElement('summary');
      s.textContent = `Not yet today (${rest.length})`;
      Object.assign(s.style, { cursor: 'pointer', color: 'var(--dim)', font: '11px var(--mono)' });
      d.appendChild(s);
      for (const m of rest) {
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', gap: '8px', alignItems: 'center', padding: '2px 0', opacity: '0.45' });
        row.title = m.styles.join(', ');
        row.appendChild(glyph(m, 20));
        const txt = document.createElement('span');
        txt.textContent = `${m.name}  ${m.roman}`;
        Object.assign(txt.style, { whiteSpace: 'pre', fontSize: '11px' });
        row.appendChild(txt);
        d.appendChild(row);
      }
      this.el.appendChild(d);
    }
  }
}
