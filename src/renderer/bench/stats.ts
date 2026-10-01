// CONTRACT (owned by the bench worker). Frame pacing + software-leg latency.
import type { PianoEvent } from '@shared/events';

export class FrameStats {
  frameStart(_rafT: number): void {}
  frameEnd(_now: number): void {}
  reset(): void {}
}

export class LatencyProbe {
  /** A note-on was drained in the frame whose rAF timestamp is frameT. */
  noteSeen(_ev: PianoEvent & { type: 'on' }, _frameT: number): void {}
  /** The frame's GPU work was submitted at `submitT`. */
  frameSubmitted(_frameT: number, _submitT: number): void {}
  reset(): void {}
  /** Saves a JSON+CSV report via window.app.saveFile('bench', ...). */
  save(_stats: FrameStats, _meta: Record<string, unknown>): Promise<string | null> { return Promise.resolve(null); }
}
