// CONTRACT (owned by the MIDI worker). Demo progression + .mid/.jsonl replay through the same bus.
import type { EventBus } from '@shared/events';
export class Replayer {
  playing = false;
  constructor(_bus: EventBus) {}
  /** Loops a built-in jazz demo (ii–V–Is, rootless voicings, pedal) until stop(). */
  playDemo(): void {}
  /** Plays a Standard MIDI File or a recorded .jsonl session. */
  playFile(_name: string, _data: ArrayBuffer): Promise<void> { return Promise.resolve(); }
  stop(): void {}
}
