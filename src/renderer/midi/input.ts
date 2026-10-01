// CONTRACT (owned by the MIDI worker). Web MIDI -> normalized PianoEvents on the bus.
import type { EventBus, PianoEvent } from '@shared/events';
import {
  Deduper,
  looksBluetooth,
  looksLikeDawPort,
  parseMidi,
  parsePersisted,
  portKey,
  shouldSelect,
  type PersistedSelection,
} from './normalize';

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

const STORAGE_KEY = 'midi.ports.v1';

function loadPersisted(): PersistedSelection | null {
  try {
    return parsePersisted(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function savePersisted(p: PersistedSelection): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* private mode / blocked storage: selection just won't persist */
  }
}

function unavailable(reason: string): MidiController {
  return {
    available: false,
    ports: () => [],
    select: () => {},
    onPortsChanged: () => {},
    status: () => reason,
    bluetoothWarning: () => false,
  };
}

interface PortRec {
  input: MIDIInput;
  idx: number; // numeric id for the deduper
  src: string; // PianoEvent.src, "midi:<name>"
  selected: boolean;
  attached: boolean;
  handler: (e: MIDIMessageEvent) => void;
}

export async function startMidi(bus: EventBus): Promise<MidiController> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (!nav || typeof nav.requestMIDIAccess !== 'function') return unavailable('Web MIDI unavailable');
  let access: MIDIAccess;
  try {
    access = await nav.requestMIDIAccess({ sysex: false });
  } catch (err) {
    console.warn('MIDI access denied', err);
    return unavailable('MIDI permission denied');
  }

  const recs = new Map<string, PortRec>();
  const dedupe = new Deduper(3);
  const listeners: (() => void)[] = [];
  let nextIdx = 0;
  let persisted = loadPersisted();
  const emit = (ev: PianoEvent) => bus.emit(ev);

  const makeRec = (input: MIDIInput): PortRec => {
    const name = input.name || input.id;
    const rec: PortRec = {
      input,
      idx: nextIdx++,
      src: 'midi:' + name,
      selected: shouldSelect(name, input.manufacturer ?? '', persisted),
      attached: false,
      handler: (e: MIDIMessageEvent) => {
        const recvT = performance.now();
        const data = e.data;
        if (!data || data.length === 0) return;
        const s = data[0];
        if (s >= 0xf0) return; // sysex/system/realtime: never interesting, skip the dedupe cost
        const ts = e.timeStamp;
        const t = ts > 0 && Number.isFinite(ts) ? ts : recvT;
        if (dedupe.isDuplicate(Deduper.key(data), rec.idx, t)) return;
        parseMidi(data, t, recvT, rec.src, emit);
      },
    };
    return rec;
  };

  const panicFor = (rec: PortRec) => {
    const now = performance.now();
    bus.emit({ type: 'panic', t: now, recvT: now, src: rec.src });
  };

  const sync = () => {
    access.inputs.forEach((input) => {
      if (!recs.has(input.id)) recs.set(input.id, makeRec(input));
    });
    for (const rec of recs.values()) {
      const want = rec.selected && rec.input.state === 'connected';
      if (want && !rec.attached) {
        rec.input.onmidimessage = rec.handler;
        rec.attached = true;
      } else if (!want && rec.attached) {
        rec.input.onmidimessage = null;
        rec.attached = false;
        try {
          void rec.input.close();
        } catch {
          /* ignore */
        }
        panicFor(rec); // device lost or deselected: release anything it was holding
      }
    }
  };

  const notify = () => {
    for (const cb of listeners) {
      try {
        cb();
      } catch (err) {
        console.error(err);
      }
    }
  };

  access.onstatechange = (e: MIDIConnectionEvent) => {
    const p = e.port;
    if (p && p.type !== 'input') return;
    sync();
    notify();
  };
  sync();

  const visible = () => {
    const out: PortRec[] = [];
    for (const r of recs.values()) if (r.input.state === 'connected' || r.selected) out.push(r);
    return out;
  };

  return {
    available: true,
    ports: () =>
      visible().map((r) => ({
        id: r.input.id,
        name: r.input.name || r.input.id,
        manufacturer: r.input.manufacturer ?? '',
        state: r.input.state === 'connected' ? 'connected' : 'disconnected',
        selected: r.selected,
      })),
    select: (ids: string[]) => {
      const want = new Set(ids);
      const selected = new Set(persisted?.selected ?? []);
      const known = new Set(persisted?.known ?? []);
      for (const r of recs.values()) {
        r.selected = want.has(r.input.id);
        const k = portKey(r.input.name || r.input.id, r.input.manufacturer ?? '');
        known.add(k);
        if (r.selected) selected.add(k);
        else selected.delete(k);
      }
      persisted = { selected: [...selected], known: [...known] };
      savePersisted(persisted);
      dedupe.reset();
      sync();
      notify();
    },
    onPortsChanged: (cb: () => void) => {
      listeners.push(cb);
    },
    status: () => {
      const names: string[] = [];
      for (const r of recs.values()) {
        if (!r.attached) continue;
        const name = r.input.name || r.input.id;
        const kind = looksBluetooth(name) ? 'Bluetooth' : looksLikeDawPort(name) ? 'virtual' : 'USB';
        names.push(`${name} (${kind})`);
      }
      if (names.length) return names.join(', ');
      return recs.size ? 'No MIDI input selected' : 'No MIDI device';
    },
    bluetoothWarning: () => {
      for (const r of recs.values()) if (r.attached && looksBluetooth(r.input.name || '')) return true;
      return false;
    },
  };
}
