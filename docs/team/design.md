# Visual & Motion Design

*Team brief: visual/motion designer. Each concept is followed through a ii-V-I in C with rootless voicings (Dm9 → G13 → CΔ9; LH F-A-C-E → F-B-E-A → E-G-B-D), then a fast right-hand bebop line.*

## 1. Three concepts

### A. Harmonic Compass
A dark field with a thin ring of 12 nodes in circle-of-fifths order. On Dm9, nodes F, A, C, E light and a soft polygon forms between them. The unplayed root D shows as a **hollow ring** — the app shows the root it inferred, which teaches what "rootless" means. A needle of light swings to the chord root; a broad dim arc under the ring marks the key, centered on C. On G13 the polygon reshapes, the needle moves one step clockwise, and the tritone F–B glows hotter and pulses. On CΔ9 the needle settles on the key center and the arc brightens: arrival. The fast RH line shows as small sparks travelling around the ring.

**Encoding:** pitch class = angle; octave = distance from ring (low inside, high outside); velocity = node size/brightness; duration = glow length; chord = polygon + center label; function = position relative to the key arc (tonic center, subdominant CCW, dominant CW); key = arc; tension = shimmer on tritones and ♭9/♯9; prediction = faint dotted ghost chords.

### B. Tonnetz Constellation
A wrapping hexagonal lattice of pitch classes, like a star map. Triads light triangles; 7th and 9th chords light clusters of two or three. Dm9 and G13 are neighbouring patches sharing an edge (F and A); CΔ9 slides in beside. Voice leading is visible as **shared edges**, and progressions leave comet trails, so a ii-V-I always looks like the same short walk. RH notes drift across as dust. Best at showing why chords are related; abstract for first-time viewers.

### C. Score River (after Malinowski's Music Animation Machine)
Time flows right to left. A "now" line at ~70% width carries a vertical keyboard drawn in light. Each note **blooms** from its key, then becomes a ribbon flowing away: height = pitch, length = duration. Rootless voicings make stacked, chord-tinted bands in the low-middle register; a chord change washes a vertical gradient between voicings. The RH line becomes a thin bright filigree above. Chord symbols drift left like a lead sheet.

**Encoding:** pitch = height, pitch class = hue, velocity = brightness/thickness, sustain = ribbon length plus a dim tail under pedal, chord/function = band color, key = faint staff tint on the key's 7 notes, tension = grain in the band, prediction = ghost bands and outlined symbols to the right of "now".

## 2. Recommendation: River below, Compass on top

C as the canvas, A as the instrument: the river gives motion and memory, the compass gives harmonic meaning.

**Layout (16:10 full-screen):** river full bleed, "now" at ~68% x; compass in the space to the right of "now", ~38% of screen height, with the **chord name** large in its center; key in small caps above ("KEY · C MAJOR") plus the arc, crossfading over 600 ms on modulation; one Roman numeral below in tracked monospace (ii⁷ / V⁷ / IΔ).

**Layers (keys 1–6):** 1 notes; 2 chord bands/symbols in the river; 3 compass; 4 function/Roman numerals; 5 predictions; 6 theory annotations (off by default).

**Review mode:** pause and the river becomes scrubbable; hover a band for its voicing on a small keyboard, alternate names, and voice leading to the next chord.

**Presets:** Perform = layers 1–3. Study = all six.

## 3. Color

- **Pitch-class hue follows the circle of fifths** in OKLCH, 30° per fifth; related keys get neighbouring hues, and a ii-V-I becomes a recognizable three-step gradient.
- Notes at L≈0.74, C≈0.11, so all 12 hues look equally bright. Chord bands use the root hue at C≈0.05, L≈0.22 — tints, not paint. Saturation comes **only** from activity: an attack pushes chroma to 0.16 and lightness toward white, then relaxes.
- Background ~#0B0C10 with a subtle vignette, no textures.
- **Tension** is a white-hot core plus fine grain over the hue, never a hue itself.
- **Accessibility:** color never the only carrier; color-blind mode maps function to luminance steps; text ≥7:1 contrast; reduce-motion turns off particles and bloom.

## 4. Chord typography

- Crisp grotesk (Inter Display, Söhne, SF Pro Display) Semibold for roots; same family Regular at ~58% for qualities/extensions as superscripts at +0.42em. True ♭/♯ from a SMuFL text font (Bravura Text) at ~80%, kerned tight. Alterations stacked in thin parentheses.
- Δ for maj7 ("maj7" as a preference), ø, °, "−" or "m" for minor. Slash chords with a thin diagonal at baseline.
- **Anti-jitter:** a new name must stay best for 90 ms or beat the current one by ≥0.15 confidence. Root letter pinned at a fixed x; extension-only changes crossfade the superscript. Old label fades out rising 6 px over 120 ms (ease-in), new fades in from 6 px below over 160 ms (ease-out), overlapping. Tabular numerals. Low confidence → 40% opacity, lighter weight.

## 5. Motion

- **Attack is instant:** drawn the next frame, no ease-in; bloom peaks at t=0.
- **Release is physical:** exponential decay, τ ≈ 220 ms pedal up, ≈ 2.5 s pedal down; on pedal lift, everything held drops together (τ ≈ 120 ms) so you **see the damper**. Half-pedal scales τ.
- **Springs, not tweens,** for needle and key arc: critically damped, ~0.35 s settle, never overshoot. Key changes slower (~0.9 s).
- **Fast passages:** scale bloom by 1/√(onsets in last 250 ms); above ~12 notes/s, RH draws as one thread with beads per onset; fixed particle cap.
- **Hierarchy of speed:** notes fast, chords medium, key slow.
- **Idle (≥6 s):** river drifts, compass breathes (~0.08 Hz, ±8% opacity), last chord stays; after 30 s a faint "▸ replay last phrase". First note-on snaps back instantly.

## 6. Prediction display

- **Compass:** at most 3 candidates as dotted lines from the current root to each candidate root, with a stroke-only chord symbol; opacity 0.12–0.45 from probability; thickest stroke for the most likely. From G13: CΔ (0.55), C−7 (0.15), D♭7 (0.12, tritone sub).
- **River:** ghost bands to the right of "now", outlined symbols at 30%.
- **Discipline:** update only on chord change; fade in 200 ms after the chord settles.
- **Payoff:** landing on a predicted chord fills its ghost with a 300 ms ripple; going elsewhere just dissolves the ghosts. Never a "wrong" signal.
- **Study-mode stat:** "followed: 7/10 · surprised: 3" — reflective, not a grade.
