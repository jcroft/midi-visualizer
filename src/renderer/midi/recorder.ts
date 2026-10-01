// CONTRACT (owned by the MIDI worker). Always-on lossless recording.
import type { EventBus } from '@shared/events';
import type { Analysis } from '@shared/analysis';
export class Recorder {
  constructor(_bus: EventBus) {}
  /** Remember chord/key labels for .mid Marker events (only when a.changed). */
  mark(_a: Analysis): void {}
  eventCount(): number { return 0; }
  /** Saves .jsonl + .mid via window.app.saveFile('recordings', ...), returns the .mid path. Starts a fresh take. */
  save(): Promise<string | null> { return Promise.resolve(null); }
}
