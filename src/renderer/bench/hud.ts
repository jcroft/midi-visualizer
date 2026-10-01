// CONTRACT (owned by the bench worker). Text HUD, top-left.
import type { FrameStats, LatencyProbe } from './stats';
import type { MidiController } from '../midi/input';
export class Hud {
  constructor(_el: HTMLElement, _deps: { stats: FrameStats; probe: LatencyProbe; backend: string; midi: MidiController }) {}
  toggle(): void {}
  update(_now: number): void {}
}
