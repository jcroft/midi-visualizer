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

/** Harmonic function: tonic, subdominant, dominant. */
export type Fn = 'T' | 'SD' | 'D';

/**
 * diatonic: in the key. secondary: a dominant of a diatonic chord (V⁷/ii).
 * sub: a substitution (tritone sub, backdoor). modulating: a tonic outside the key.
 * chromatic: anything else.
 */
export type PredictionKind = 'diatonic' | 'secondary' | 'sub' | 'chromatic' | 'modulating';

export interface PredictionStep {
  root: number;
  name: string;
  q: string;
  roman: string | null;
  p: number;
}

export interface Prediction {
  root: number;
  name: string;
  p: number; // 0..1
  why: string; // "ii–V pull", "tritone sub"
  /** Template id ("7", "m7", "maj7"), so a landing can match on chord family. */
  q: string;
  /** Roman numeral in the current key: "V⁷", "V⁷/ii", "♭II⁷". */
  roman: string | null;
  fn: Fn | null;
  kind: PredictionKind;
  /** Key label this chord would tonicize when kind is 'modulating'. */
  tonicizes?: string;
  /** The likely chord after this one (top prediction only), e.g. CΔ7 after D–7 → G7. */
  then?: PredictionStep;
}

/** How a new chord event relates to what was predicted for it. */
export interface Landing {
  /** Root of the chord we came from (where the ghosts started). */
  from: number;
  /** Index into the previous analysis's predictions; -1 = none matched. */
  hit: number;
  /** Root and chord family both matched (a root-only match is a partial landing). */
  exact: boolean;
  /** Short name for the moment: "ii–V–I", "turnaround", "tritone sub!", "backdoor", "modal interchange". */
  label: string | null;
  fn: Fn | null;
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
  /** Set only on the analysis that carries a new chord event. */
  landing: Landing | null;
  /** True when this analysis is a new chord event (not a refinement). */
  changed: boolean;
}

export type ToWorker = PianoSnapshot | { type: 'reset' };
export type FromWorker = Analysis;
