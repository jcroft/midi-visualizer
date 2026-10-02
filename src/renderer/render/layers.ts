// Compass layers that can be switched on and off from the Layers menu.
// Everything is on by default except the experiments in OFF_BY_DEFAULT.

export const LAYERS = [
  { id: 'notes', label: 'Notes', title: 'Pitch-class dots and names on the ring' },
  { id: 'shape', label: 'Chord shape', title: 'Polygon between the sounding pitch classes' },
  { id: 'tension', label: 'Tritones', title: 'Shimmering line across each sounding tritone' },
  { id: 'needle', label: 'Root needle', title: 'Needle at the chord root, with a trail of recent roots' },
  { id: 'key', label: 'Key', title: 'Key arc around the ring and the key name' },
  { id: 'chord', label: 'Chord name', title: 'Chord symbol and roman numeral in the center' },
  { id: 'predictions', label: 'Predictions', title: 'Likely next chords on the orbit outside the ring' },
  { id: 'history', label: 'Lead sheet', title: 'Scrolling strip of past, current and predicted chords along the bottom' },
  { id: 'stack', label: 'Voicing stack', title: 'Your voicing as a ladder: each note by pitch, colored by its role, with voice leading' },
  { id: 'register', label: 'Register web', title: 'Each sounding note on its spoke at a radius by octave (low near the center)' },
  { id: 'touch', label: 'Pedal & touch', title: 'Pedal-held notes go hazy and clear when the dampers drop; the stack shows how hard each note was struck' },
  { id: 'tendency', label: 'Tendency tails', title: 'Dotted tails on the ring where each guide tone or tension wants to move in the predicted chord' },
  { id: 'voices', label: 'Hidden voices', title: 'A line for each voice of your voicing under the lead sheet, dotted into the predicted chord' },
  { id: 'scale', label: 'Scale & line', title: 'The chord-scale glows under the ring (color tones and alterations ticked); right-hand notes read as inside, chromatic approach, or enclosure' },
  { id: 'reharm', label: 'Reharm offers', title: 'Hollow diamonds for substitutions you could play instead (tritone sub, backdoor), smoothest first. Possible, not predicted' },
  { id: 'moves', label: 'Move brackets', title: 'Brackets over the lead sheet naming the moves you play (ii–V–I, backdoor, Axis): dotted while forming, solid once complete' },
  { id: 'loopLock', label: 'Loop lock', title: 'When the same few chords come round twice, the lead sheet folds them into a repeat sign and the predictions show ↻' },
  { id: 'moveShape', label: 'Move shape', title: 'The shape of the move you are in, drawn faintly inside the ring, its next step dotted' },
  { id: 'styleLens', label: 'Style lens', title: 'Which style families the last few bars draw from, by the key title; tap one to lean the predictions toward it' },
  { id: 'tensionCurve', label: 'Tension curve', title: 'A ribbon under the lead sheet that rises with harmonic tension and falls as it resolves' },
  { id: 'weather', label: 'Harmonic weather', title: 'A soft glow behind the compass: cool on tonic, warm on dominant' },
  { id: 'tonicUp', label: 'Tonic at top', title: 'Turn the wheel so the key’s tonic sits at 12 o’clock' },
] as const;

/** Layers that start off (the rest start on). */
const OFF_BY_DEFAULT: readonly string[] = ['register', 'tonicUp'];

export type LayerId = (typeof LAYERS)[number]['id'];
export type Layers = Record<LayerId, boolean>;

export function defaultLayers(): Layers {
  return Object.fromEntries(LAYERS.map((l) => [l.id, !OFF_BY_DEFAULT.includes(l.id)])) as Layers;
}
