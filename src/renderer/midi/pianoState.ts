// CONTRACT (owned by the MIDI worker). held / sustained / sostenuto per note.
import type { PianoEvent } from '@shared/events';
import type { PianoSnapshot } from '@shared/analysis';

export class PianoState {
  /** Sustain 0..1 */
  pedal = 0;
  apply(_ev: PianoEvent): void {}
  isHeld(_note: number): boolean { return false; }
  isSounding(_note: number): boolean { return false; }
  /** Returns a snapshot if anything changed since the last call (or decay weights moved enough), else null. */
  snapshot(_now: number): PianoSnapshot | null { return null; }
}
