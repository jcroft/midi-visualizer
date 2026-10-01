// CONTRACT (owned by the MIDI worker). Always-on lossless recording.
//
// Keeps references to every bus event (no copying on the hot path). save()
// writes <ISO-date>.jsonl (lossless) and <ISO-date>.mid (Type 0, 1 tick = 1 ms,
// chord/key Marker events) and starts a fresh take.
import type { EventBus, PianoEvent } from '@shared/events';
import type { Analysis } from '@shared/analysis';
import { toJsonl, toSmf, type Marker } from './fileFormats';

/** ~4–6 hours of dense playing with aftertouch; beyond this the take is auto-saved (or trimmed). */
export const MAX_EVENTS = 400_000;
const MAX_MARKERS = 50_000;

export function sessionFileStem(d: Date = new Date()): string {
  // 2026-10-01T19-04-33  (no colons: Finder shows them as slashes)
  return d.toISOString().slice(0, 19).replace(/:/g, '-');
}

export class Recorder {
  private events: PianoEvent[] = [];
  private markers: Marker[] = [];
  private lastChord = '';
  private lastKey = '';
  private takeStart = new Date();
  private autosaving = false;

  constructor(bus: EventBus) {
    bus.on((ev) => {
      this.events.push(ev);
      if (this.events.length >= MAX_EVENTS) this.overflow();
    });
  }

  /** Remember chord/key labels for .mid Marker events (only when a.changed). */
  mark(a: Analysis): void {
    if (!a.changed) return;
    if (this.markers.length >= MAX_MARKERS) return;
    const chord = a.chord?.name ?? '';
    if (chord && chord !== this.lastChord) this.markers.push({ t: a.t, text: chord });
    this.lastChord = chord;
    const key = a.key && !a.key.implied ? a.key.label : '';
    if (key && key !== this.lastKey) this.markers.push({ t: a.t, text: 'Key: ' + key });
    if (key) this.lastKey = key;
  }

  eventCount(): number {
    return this.events.length;
  }

  /** Saves .jsonl + .mid via window.app.saveFile('recordings', ...), returns the .mid path. Starts a fresh take. */
  async save(): Promise<string | null> {
    const app = typeof window !== 'undefined' ? window.app : undefined;
    if (!app || this.events.length === 0) return null;
    const events = this.events;
    const markers = this.markers.sort((a, b) => a.t - b.t);
    const started = this.takeStart;
    this.reset();

    const stem = sessionFileStem(started);
    const t0 = events[0].t;
    const jsonl = toJsonl(events, markers, {
      started: started.toISOString(),
      saved: new Date().toISOString(),
      t0,
      clock: 'performance.now ms',
    });
    const mid = toSmf(events, markers, { name: 'MIDI Visualizer ' + stem, t0 });
    await app.saveFile('recordings', stem + '.jsonl', jsonl);
    return app.saveFile('recordings', stem + '.mid', mid);
  }

  private reset(): void {
    this.events = [];
    this.markers = [];
    this.lastChord = '';
    this.lastKey = '';
    this.takeStart = new Date();
  }

  private overflow(): void {
    const app = typeof window !== 'undefined' ? window.app : undefined;
    if (app && !this.autosaving) {
      this.autosaving = true;
      this.save()
        .catch((err) => console.error('Recorder autosave failed', err))
        .finally(() => (this.autosaving = false));
    } else if (!app) {
      // nowhere to save: keep the most recent half
      const cut = this.events.length >> 1;
      const cutT = this.events[cut].t;
      this.events = this.events.slice(cut);
      this.markers = this.markers.filter((m) => m.t >= cutT);
    }
  }
}
