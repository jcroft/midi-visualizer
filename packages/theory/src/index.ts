// Public API of the theory engine. Pure TypeScript, no DOM/Electron/clock deps.
export { createAnalyzer, type Analyzer } from './analyzer';
export { TEMPLATES, qualityText, scoreAll, makeCands, type Cand, type Template } from './chords';
export { GlobalKey, KeyTracker, roman, diatonic } from './key';
export { predict, type ChordEvent } from './predict';
export { spell, keyLabel, mod12, type Mode, type KeyLike } from './pitch';
