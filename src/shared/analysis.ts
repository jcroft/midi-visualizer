// Contract between the main renderer thread and the theory worker.

/** What the main thread sends the worker whenever piano state changes (at most once per frame). */
export interface PianoSnapshot {
  type: 'snapshot';
  t: number; // ms, performance.now domain
  /** Physically held keys (MIDI note numbers). */
  held: number[];
  /** Every sounding note (held, sustained, or sostenuto-latched) with a 0..1 decay weight. */
  sounding: { note: number; w: number }[];
  /** Notes whose onset is within the last ~60 ms. */
  onsets: number[];
  /** Sustain pedal 0..1. */
  pedal: number;
  /** True on the snapshot where the pedal was re-caught (up then down). */
  pedalRecatch: boolean;
}

export interface ChordReading {
  name: string; // lead-sheet text, e.g. "D–9", "G7alt", "CΔ7"
  root: number; // pitch class 0..11
  quality: string; // internal template id, e.g. "m7", "7", "maj7"
  conf: number; // 0..1
  /** Root is implied, not played (rootless voicing) — draw it as a hollow ring. */
  rootInferred: boolean;
  bass: number | null; // pitch class of lowest note
}

export interface KeyReading {
  tonic: number; // pitch class
  mode: 'major' | 'minor' | 'dorian' | 'mixolydian';
  label: string; // "E♭", "C minor", "D dorian"
  conf: number;
  /** Set when a ii–V points somewhere the music hasn't landed yet. */
  implied: boolean;
}

export interface Prediction {
  root: number;
  name: string;
  p: number; // 0..1
  why: string; // "ii–V pull", "tritone sub"
}

export interface Analysis {
  type: 'analysis';
  t: number; // snapshot time this answers
  /** 12 pitch-class weights 0..1 currently sounding. */
  pcs: number[];
  chord: ChordReading | null;
  runnerUp: ChordReading | null;
  key: KeyReading | null;
  roman: string | null; // "ii⁷", "V⁷", "IΔ⁷"
  predictions: Prediction[]; // at most 3
  /** True when this analysis is a new chord event (not a refinement). */
  changed: boolean;
}

export type ToWorker = PianoSnapshot | { type: 'reset' };
export type FromWorker = Analysis;
