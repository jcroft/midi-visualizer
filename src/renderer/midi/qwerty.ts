// CONTRACT (owned by the MIDI worker). Computer keyboard as a piano for testing without hardware.
//
//   W E   T Y U   O P        black keys
//  A S D F G H J K L ; '     white keys, A = C4 (60) by default
//  Z / X = octave down / up, Space = sustain while held.
import type { EventBus } from '@shared/events';

/** Physical key codes (layout-independent) -> semitone offset from the base C. */
export const QWERTY_CODES: Readonly<Record<string, number>> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8,
  KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};

const SRC = 'qwerty';
const VEL = 0.7;

function isTyping(target: EventTarget | null): boolean {
  const el = (target ?? document.activeElement) as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable) return true;
  return !!el.closest('input, select, textarea');
}

export function attachQwerty(bus: EventBus): void {
  if (typeof window === 'undefined') return;
  let base = 60;
  /** code -> the note it actually sounded (so an octave change mid-hold releases the right note) */
  const down = new Map<string, number>();
  let pedal = false;

  const now = () => performance.now();
  const setPedal = (on: boolean, t: number) => {
    if (pedal === on) return;
    pedal = on;
    bus.emit({ type: 'cc', cc: 64, value: on ? 1 : 0, t, recvT: now(), src: SRC });
  };
  const releaseAll = () => {
    const t = now();
    for (const note of down.values()) bus.emit({ type: 'off', note, vel: 0, t, recvT: t, src: SRC });
    down.clear();
    setPedal(false, t);
  };

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTyping(e.target)) return;
    const code = e.code;
    if (code === 'Space') {
      e.preventDefault(); // don't click the focused button
      if (!e.repeat) setPedal(true, e.timeStamp || now());
      return;
    }
    if (e.repeat) {
      if (code in QWERTY_CODES) e.preventDefault();
      return;
    }
    if (code === 'KeyZ') {
      base = Math.max(24, base - 12);
      return;
    }
    if (code === 'KeyX') {
      base = Math.min(96, base + 12);
      return;
    }
    const off = QWERTY_CODES[code];
    if (off === undefined || down.has(code)) return;
    e.preventDefault();
    const note = base + off;
    if (note > 127) return;
    down.set(code, note);
    const t = e.timeStamp || now();
    bus.emit({ type: 'on', note, vel: VEL, t, recvT: now(), src: SRC });
  });

  window.addEventListener('keyup', (e) => {
    const code = e.code;
    if (code === 'Space') {
      if (pedal) e.preventDefault();
      setPedal(false, e.timeStamp || now());
      return;
    }
    const note = down.get(code);
    if (note === undefined) return;
    down.delete(code);
    bus.emit({ type: 'off', note, vel: 0, t: e.timeStamp || now(), recvT: now(), src: SRC });
  });

  // Keyups are lost when the window loses focus; don't leave stuck notes.
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });
}
