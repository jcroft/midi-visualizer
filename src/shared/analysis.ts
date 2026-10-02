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
  /** For a modal frame, where it sits in its parent major: "ii of C" (D dorian), "V of F" (C mixolydian). */
  parent?: string;
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

/** The library move a predicted chord would continue: "completes ii–V–I", "Axis 3/4". */
export interface MoveRef {
  id: string;
  /** "ii–V–I", "Axis", "backdoor". */
  name: string;
  /** Which step of the move the predicted chord is (1-based), and how many steps it has. */
  step: number;
  of: number;
  loop: boolean;
  /** Loops: laps heard so far. */
  laps: number;
  /** The chord would finish a cadence. */
  completes: boolean;
  styles: string[];
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
  /** The library move this chord would continue, when the library had a hand in predicting it. */
  move?: MoveRef;
  /** The loop in force (loop lock) predicts this chord. */
  loop?: boolean;
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
  /** A library move this chord completed (a cadence landing, or a loop coming round). */
  move?: {
    id: string;
    name: string;
    style: string | null;
    count: number;
    laps: number;
    loop: boolean;
    /** The key it was played in (the alias's home when it goes by another name). */
    home: number;
    /** Semitones from the move's written tonic to that home. */
    rot: number;
  };
}

/** Hindsight on the previous chord, carried by the next chord event. */
export interface Reread {
  /** New name when the chord was reread (B°7 → G7(♭9)); null when only the numeral changes. */
  name: string | null;
  /** The name it had. */
  was: string | null;
  /** "rootless 7♭9", "rootless ii", "pivot", "new key". */
  why: string;
  /** Its numeral in the key now in force. */
  roman: string | null;
  /** At a key change, its numeral in the old key when it belongs to both (the pivot chord). */
  pivot: string | null;
}

/**
 * A move bracket on the lead sheet, spanning chord events `from`..`to` (seq numbers).
 * forming: dotted and open on the right ("Axis 2/4"). running: a loop with a lap
 * behind it, solid and still open. done: closed and solid. left: the music went
 * elsewhere; greyed, kept as a record.
 */
export interface MoveMark {
  /** Stable per instance: the renderer upserts by it. */
  key: string;
  id: string;
  name: string;
  loop: boolean;
  styles: string[];
  from: number;
  to: number;
  /** Step of the newest chord (1-based) and the move's length. */
  step: number;
  of: number;
  laps: number;
  state: 'forming' | 'running' | 'done' | 'left';
  /** 0 = the main bracket, 1 = a second one nested in or around it. */
  level: number;
  /** The move as numerals ("I V vi IV"), its home pitch class, and the root of every step (its shape on the circle). */
  roman: string;
  tonic: number;
  path: number[];
  /** Index into path of the newest chord. */
  at: number;
}

/** Loop lock: the same few chords have come round twice. */
export interface LoopLock {
  /** Chords per lap. */
  period: number;
  laps: number;
  /** Seq of the first chord of the repeating stretch, and of the newest chord. */
  from: number;
  to: number;
  /** The library's name for it, when it has one ("Axis"). */
  name: string | null;
  /** Set on the chord that broke a loop: the strip unfolds and marks it. */
  broke: boolean;
}

/** Which style families the last few bars draw from, strongest first. */
export interface StyleReading {
  /** Shares 0..1 per family (sum 1), only those worth showing. */
  shares: { style: string; share: number }[];
  lead: string | null;
  /** The family the player leaned toward by tapping it, if any. */
  lean: string | null;
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
  /** Set only on a new chord event: what that event says about the chord before it. */
  reread: Reread | null;
  /** True when this analysis is a new chord event (not a refinement). */
  changed: boolean;
  /** Sequence number of the newest chord event (lead-sheet entries carry it). */
  seq: number;
  /** Set only on a new chord event: move brackets that started, grew, closed or were left. */
  moves: MoveMark[] | null;
  /** The loop in force, if any (or the one this chord just broke). */
  loop: LoopLock | null;
  style: StyleReading | null;
}

export type ToWorker = PianoSnapshot | { type: 'reset' } | { type: 'lean'; style: string | null };
export type FromWorker = Analysis;
