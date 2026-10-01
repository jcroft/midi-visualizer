// CONTRACT (owned by the bench worker). Bottom-left controls; fade out when idle.
import type { MidiController } from '../midi/input';
import type { Replayer } from '../midi/replay';
import type { Recorder } from '../midi/recorder';
import type { FrameStats, LatencyProbe } from '../bench/stats';
import type { VisualMode } from '../render/visualizer';

export interface ChromeDeps {
  midi: MidiController;
  replay: Replayer;
  recorder: Recorder;
  probe: LatencyProbe;
  stats: FrameStats;
  getMode(): VisualMode;
  setMode(m: VisualMode): void;
  panic(): void;
  toggleHud(): void;
}
export function buildChrome(_el: HTMLElement, _deps: ChromeDeps): void {}
