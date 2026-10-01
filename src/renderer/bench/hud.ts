// Text HUD, top-left. Refreshes ~4×/s, not every frame; percentiles are computed only here.
import type { FrameStats, LatencyProbe, Pcts } from './stats';
import type { MidiController } from '../midi/input';

const REFRESH_MS = 250;

export class Hud {
  private visible = false; // Tab shows it
  private last = 0;
  private readonly el: HTMLElement;
  private readonly deps: { stats: FrameStats; probe: LatencyProbe; backend: string; midi: MidiController };

  constructor(el: HTMLElement, deps: { stats: FrameStats; probe: LatencyProbe; backend: string; midi: MidiController }) {
    this.el = el;
    this.deps = deps;
    el.style.display = 'none';
    // The chrome's "Save bench report" doesn't know the backend; record it on the probe.
    deps.probe.setMeta('backend', deps.backend);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? '' : 'none';
    if (this.visible) this.last = 0;
  }

  update(now: number): void {
    if (!this.visible || now - this.last < REFRESH_MS) return;
    this.last = now;
    this.el.textContent = this.render();
  }

  private render(): string {
    const { stats, probe, backend, midi } = this.deps;
    const f = stats.summary();
    const l = probe.summary();
    const lines: string[] = [];

    const hz = Number.isFinite(f.refreshHz) ? `${f.refreshHz.toFixed(0)} Hz (${f.intervalMs.toFixed(2)} ms)` : '— Hz';
    lines.push(`${backend} · ${hz} · mode ${probe.currentTag()}`);

    // Plain numbers: the 120 Hz pass/fail bars from the spike no longer apply (60 Hz display).
    lines.push(`frame       p50 ${ms(f.delta.p50)}  p99 ${ms(f.delta.p99)}`);
    lines.push(
      `            dropped ${f.dropped} (${pct(f.dropped, f.frames)})  cpu p50 ${ms(f.cpu.p50)} p99 ${ms(f.cpu.p99)}  long ${f.longFrames}`,
    );

    lines.push(`midi→frame  ${p3(l.toFrame)}  n=${l.n}`);
    lines.push(`midi→submit ${p3(l.toSubmit)}`);
    lines.push(`driver→js   p50 ${ms(l.transport.p50)}  p99 ${ms(l.transport.p99)}`);

    lines.push(`key→photon  est p95 ${ms(l.keyToPhoton.p95)}  n=${l.keyToPhoton.n}`);

    lines.push(midi.available ? `MIDI: ${midi.status() || 'no port selected'}` : 'MIDI: unavailable (QWERTY only)');
    if (midi.available && midi.bluetoothWarning()) {
      lines.push('WARNING: Bluetooth MIDI adds ~8–20 ms + jitter. Use USB for the test.');
    }
    return lines.join('\n');
  }
}

function ms(v: number): string {
  return Number.isFinite(v) ? v.toFixed(1).padStart(5) : '    —';
}

function p3(p: Pcts): string {
  return `p50 ${ms(p.p50)}  p95 ${ms(p.p95)}  p99 ${ms(p.p99)}`;
}

function pct(a: number, b: number): string {
  return b > 0 ? `${((100 * a) / b).toFixed(1)}%` : '—';
}
