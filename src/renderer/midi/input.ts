// CONTRACT (owned by the MIDI worker). Web MIDI -> normalized PianoEvents on the bus.
import type { EventBus } from '@shared/events';

export interface MidiPort {
  id: string;
  name: string;
  manufacturer: string;
  state: 'connected' | 'disconnected';
  selected: boolean;
}

export interface MidiController {
  readonly available: boolean; // false if Web MIDI is missing or permission denied
  ports(): MidiPort[];
  /** Listen only to these port ids (persisted to localStorage by name+manufacturer). */
  select(ids: string[]): void;
  onPortsChanged(cb: () => void): void;
  /** Human status line for the HUD, e.g. "Komplete Kontrol S61 MK3 (USB)". */
  status(): string;
  /** True if any selected source looks like Bluetooth (warn in HUD). */
  bluetoothWarning(): boolean;
}

export async function startMidi(_bus: EventBus): Promise<MidiController> {
  throw new Error('TODO');
}
