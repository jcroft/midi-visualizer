// CONTRACT (owned by the renderer worker). three.js River + Compass.
import type { PianoEvent } from '@shared/events';
import type { Analysis } from '@shared/analysis';

/** normal: River + Compass. stress: + 200k GPU particles. flash: latency test (screen flashes on note-on). */
export type VisualMode = 'normal' | 'stress' | 'flash';

export interface Visualizer {
  readonly backend: 'webgpu' | 'webgl2';
  onEvent(ev: PianoEvent): void;
  setAnalysis(a: Analysis): void;
  setMode(m: VisualMode): void;
  resize(w: number, h: number, dpr: number): void;
  render(nowMs: number): void;
}

export async function createVisualizer(_canvas: HTMLCanvasElement): Promise<Visualizer> {
  throw new Error('TODO');
}
