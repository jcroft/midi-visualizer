// Compass layers that can be switched on and off from the Layers menu.
// Everything is on by default.

export const LAYERS = [
  { id: 'notes', label: 'Notes', title: 'Pitch-class dots and names on the ring' },
  { id: 'shape', label: 'Chord shape', title: 'Polygon between the sounding pitch classes' },
  { id: 'tension', label: 'Tritones', title: 'Shimmering line across each sounding tritone' },
  { id: 'needle', label: 'Root needle', title: 'Needle at the chord root, with a trail of recent roots' },
  { id: 'key', label: 'Key', title: 'Key arc around the ring and the key name' },
  { id: 'chord', label: 'Chord name', title: 'Chord symbol and roman numeral in the center' },
  { id: 'predictions', label: 'Predictions', title: 'Likely next chords on the orbit outside the ring' },
  { id: 'history', label: 'Chord history', title: 'Lead-sheet line of recent chords (bottom left)' },
] as const;

export type LayerId = (typeof LAYERS)[number]['id'];
export type Layers = Record<LayerId, boolean>;

export function allLayersOn(): Layers {
  return Object.fromEntries(LAYERS.map((l) => [l.id, true])) as Layers;
}
