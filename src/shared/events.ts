// The one event shape every module speaks. Live MIDI, the QWERTY keyboard,
// and replay all produce these and push them onto the same bus.

/** Milliseconds in the performance.now() clock domain (Web MIDI timeStamp is already in it). */
export type Ms = number;

export type PianoEvent =
  | { type: 'on'; note: number; vel: number; t: Ms; recvT: Ms; src: string }
  | { type: 'off'; note: number; vel: number; t: Ms; recvT: Ms; src: string }
  /** value is 0..1 (raw/127). cc 64 sustain, 66 sostenuto, 67 soft. */
  | { type: 'cc'; cc: number; value: number; t: Ms; recvT: Ms; src: string }
  /** Polyphonic aftertouch, value 0..1. */
  | { type: 'pat'; note: number; value: number; t: Ms; recvT: Ms; src: string }
  /** All notes off / panic / device lost. */
  | { type: 'panic'; t: Ms; recvT: Ms; src: string };

export type Listener = (ev: PianoEvent) => void;

/** Synchronous fan-out. The render loop does NOT subscribe; it drains a FrameQueue. */
export class EventBus {
  private listeners: Listener[] = [];
  on(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
  emit(ev: PianoEvent): void {
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i](ev);
  }
}

/** Collects events between frames; the render loop drains ALL of them each frame. */
export class FrameQueue {
  private a: PianoEvent[] = [];
  private b: PianoEvent[] = [];
  push(ev: PianoEvent): void {
    this.a.push(ev);
  }
  drain(fn: (ev: PianoEvent) => void): number {
    const q = this.a;
    this.a = this.b;
    this.b = q;
    const n = q.length;
    for (let i = 0; i < n; i++) fn(q[i]);
    q.length = 0;
    return n;
  }
}
