# MIDI Visualizer: Concept & Stack Proposal

*v0.1, October 2026. Synthesized from five team briefs: jazz theorist, jazz pianist, MIDI technician, platform engineer, visual/motion designer. The full briefs are in [`docs/team/`](team/).*

## TL;DR

- **What it is:** a full-screen, living picture of what you're playing. Notes flow as a river of light from a glowing keyboard. A circle-of-fifths "compass" names the chord, shows the key center, and (in Study mode) sketches where the harmony might go next.
- **What it's built on:** **Electron + TypeScript + three.js (WebGPU, WebGL2 fallback) + Web MIDI**, with the music theory in a pure-TypeScript package that has golden tests. This is your web toolkit, it's where AI agents are strongest, and it runs at 120 Hz on ProMotion. **Native Swift + Metal is the fallback** if a 4-day spike can't hit the latency and frame-rate bar.
- **Principle the whole team agreed on:** *being stable beats being clever.* The display should be honest when it's uncertain, slow to change its mind, and quiet when you're quiet. A chord label that flickers or confidently names the wrong chord gets switched off.

## 1. What it looks like

### The picture: River below, Compass on top

**The River (canvas).** Time flows right to left. A "now" line sits about two-thirds of the way across, with a keyboard drawn in light standing vertically on it. Each note **blooms** from its key: an instant flash sized by velocity, then a ribbon of light whose height is pitch and whose length is duration. The ribbon flows away into the past.
- Rootless left-hand voicings form stacked bands in the low-middle register, tinted by the chord.
- A fast right-hand line becomes fine filigree above them. Past about 12 notes per second it merges into one continuous thread with small beads at each onset, so density reads as texture instead of strobe.
- The sustain pedal makes the image wetter: tails linger. Lifting the pedal drops them all together, so **you see the damper**.

**The Compass (instrument).** To the right of "now" is a ring of 12 nodes in circle-of-fifths order.
- The sounding pitch classes light up and a soft polygon forms between them.
- An **inferred but unplayed root shows as a hollow ring**. For a rootless Dm9, the D node is hollow, and that one detail teaches what "rootless" means.
- A needle of light points to the chord root. A broad dim arc under the ring marks the key center.
- A ii–V–I reads as the needle stepping around the ring and settling into the arc, which brightens briefly on arrival.
- The **chord name** sits large in the center of the ring. Above it, in small caps, is the key ("KEY · E♭ → tonicizing A♭"). Below it is a single Roman numeral for function (ii⁷ / V⁷ / IΔ).

**Why this combination.** The river gives motion and memory, and it is already a timeline, which makes it the review view. The compass gives harmonic meaning in one glance. The pianist's favorite live concept, **Bloom** (light rising from the keys), is already in the river as its attack. The designer's **Tonnetz constellation** is a strong later view: it shows shared tones as shared edges. All three are renderings of the same analysis stream, so adding views later is cheap.

### Modes (presets over toggleable layers)

| Layer | Perform | Study | Review |
|---|---|---|---|
| 1. Notes (river) | ● | ● | ● (scrubbable) |
| 2. Chord bands in river | ● | ● | ● |
| 3. Compass + chord name + key | ● (name only, no text clutter) | ● | ● |
| 4. Roman numerals / function | | ● | ● |
| 5. Next-chord predictions | | ● | ● ("likely vs. what you did") |
| 6. Theory annotations ("tritone F–B resolves inward") | | optional | ● |

**v1 focus: Perform first, with recording running quietly from day one.** Perform mode puts the analysis engine to work without needing it to be perfect. It is also what you'd leave on every time you sit down. Since every session is recorded, Review is a v1.5 feature on data you already have. Practice features (load iReal changes, guide-tone highlighting, ii–V drills in 12 keys, voicing-habit stats) come after that.

### Color, type, and motion

- **Color:** pitch-class hue walks the circle of fifths in OKLCH (30° per fifth), so related keys get related hues.
  - Lightness and chroma stay fixed and calm. Saturation comes **only from activity**: an attack flares, then everything relaxes.
  - The background is a blue-black around `#0B0C10`.
  - Tension is never a hue. It shows as a white-hot core plus fine grain.
  - Color never carries meaning alone. There's a color-blind mode and a reduce-motion mode.
- **Chord typography:** use real lead-sheet notation in a crisp grotesk with raised superscripts, true ♭/♯ glyphs (a SMuFL text font), and stacked alterations. Defaults are Cmaj7 (Δ optional), C–7 / Cm7 (a setting), Cø7, C7alt, and C7(♭9♯11). Enharmonics follow the key (D♭7 in A♭, not C♯7). Names follow what a working player says: C6, not Am7/C, when context says C.
- **Anti-jitter:**
  - A new label must stay the best reading for about 100 ms or beat the current one by a clear margin.
  - Extension-only changes (Dm7 → Dm9) crossfade only the superscript.
  - A low-confidence chord renders at 40% opacity in a lighter weight, with the runner-up shown faintly ("Dm9 / F6").
  - Silence beats flicker.
- **Motion:**
  - **Attack is instant:** the next frame, with no ease-in.
  - **Release follows physics:** exponential decay of about 220 ms with the pedal up and about 2.5 s with it down, and half-pedal scales between the two.
  - **Structural motion** (needle, key arc) uses critically damped springs with no overshoot. Key changes are slower than chord changes, so you learn three timescales: notes are fast, chords medium, key slow.
- **Silence is a first-class input.** When you stop, things decay and go still. There is no screensaver.

### Predictions

At most three candidates, drawn as dotted chords from the current root on the compass. Opacity encodes probability, and **each candidate carries its reason** ("ii–V pull", "tritone sub"). Predictions update only on chord changes, never on single notes, and they fade in after the new chord settles. If you land on one, its ghost fills in with a soft ripple. If you go somewhere else, the ghosts dissolve. There is no "wrong" signal.

## 2. How it hears

### MIDI → piano state

- **Input:** Web MIDI in the Electron renderer, which is CoreMIDI underneath and adds under 2 ms. Recommend USB; the app warns when Bluetooth MIDI is in use, since it adds 8–20 ms and jitter.
- **Normalization:** treat a note-on with velocity 0 as a note-off. Filter Active Sensing and Clock messages. Use **driver timestamps**, not arrival time.
- **Per-note state:** `held` / `sustained` (CC64, including half-pedal) / `sostenutoLatched` (CC66). The analysis sees the held set (strong evidence), the sounding set (weighted by decay), and a ~60 ms onset window (the "new chord" signal).
- **Robustness:**
  - De-duplicate a piano connected over both USB and Bluetooth.
  - Merge channels, to handle the doubled notes from layer/split modes.
  - Clear stuck notes on disconnect.
  - Provide a Panic button.
  - Support device selection by unique ID, so it survives replugging.

### Chord recognition

Produce a **ranked list with confidence**, not a lookup-table answer. Each (root, quality) hypothesis is scored on:
- **Template fit:** 3rd and 7th are required, the 5th is nearly free to omit, the root is optional but rewarded, extensions cost a little, unexplained notes cost a lot.
- **Bass evidence:** the lowest sounding note gets a strong root prior. A mismatched bass produces a slash chord.
- **Hand split:** left-hand notes carry the harmony, and quick right-hand stepwise notes are down-weighted as melody or passing tones.
- **Context:** the key and previous chord break ties. After Dm7 in C, {B D F A} reads as G9, not Bm7♭5.
- **Voicing families modeled explicitly:** rootless A/B forms, shells, upper-structure triads (named as the altered dominant, e.g. "UST II" as a sub-label), quartal/So What (intentionally lower confidence, named modally), and clusters ("cluster on X", never forced).

**Segmentation** treats harmony as a slowly moving state, built from a decaying pitch-class pool. A chord changes when one of these happens:
- 3+ near-simultaneous onsets
- a new bass note
- a **pedal re-catch**, the strongest signal a pianist gives

Hysteresis does the rest. Changes that keep the same root and function are *refinements* of the label, not new chord events.

Tonal.js and music21 are fine as dictionaries, but neither understands rootless voicings, so we write our own scorer.

### Key center

Track two levels:
- **Global key:** a long-window Temperley/Krumhansl key-profile estimate.
- **Local key:** set by **ii–V pattern parsing**, including tritone subs and backdoor ii–Vs. A ii–V sets the local key to its target even when the target never arrives; that implied key is shown dashed.

When harmonic rhythm is slow and the pitch content is dorian or mixolydian, it shows a **modal label** ("D dorian") instead. When two keys are plausible, the arc smears between them rather than showing one confident key.

### Next-chord prediction

- **v1:** a weighted functional grammar. Rules include ii→V, V→I/vi, tritone sub, backdoor, I→VI7 turnaround, chromatic approach, and "complete the Coltrane cycle". It's transparent, needs no data, and teaches.
- **Later:**
  - A variable-order Markov model trained on chord sequences normalized to the key: iReal Pro charts, Jazz Harmony Treebank, Weimar Jazz Database.
  - A model of *your* habits.
  - **Standard matching** ("this looks like *Autumn Leaves*, bar 9"). Once it locks on to a tune, it is the strongest predictor of all.

### Other theory features, prioritized

- **v1:** function coloring (T/SD/D) and **guide-tone voice-leading threads** (3rds and 7ths moving by half step).
- **v1.5:** a root-motion trail on the ring, progression badges (ii–V–I, turnaround, backdoor, rhythm-changes bridge), and a tension meter.
- **Later:** chord-scale hints, the Tonnetz view, and iReal chart import for practice.

## 3. Stack recommendation

**Electron (pinned, 44.x → 45) + electron-vite + TypeScript + three.js r18x `WebGPURenderer` with TSL (auto-fallback to WebGL2) + Web MIDI + Tweakpane + Vitest, packaged with electron-builder.**

| | Electron + three.js | Tauri 2 | Swift + Metal |
|---|---|---|---|
| Animation ceiling | High (WebGPU compute particles, bloom) | Med-high: WebKit has historically capped rAF at 60 Hz on ProMotion, and WebGPU in WKWebView is unverified | Highest |
| MIDI path | Web MIDI built in | **No Web MIDI in WebKit**, so a Rust bridge is needed | CoreMIDI, best |
| Typical key→photon | ~18–28 ms | ~18–28 ms | ~12–18 ms |
| You can read/tweak it | Yes | Mostly (plus Rust) | No |
| AI-agent fit | Excellent | Good | Medium (Xcode/Metal friction) |

**Why Electron:** it's the only option where you can read and tweak everything yourself, agents are strongest, the frame rate follows ProMotion, MIDI needs no native code, and the theory engine shares one language with the rest of the app. Bundle size and RAM don't matter for this app. Tauri combines the costs of the web approach with WebKit's unknowns. Creative-coding tools such as TouchDesigner and openFrameworks fall short on agent support or on productization. Godot is the only credible wildcard.

**A note on latency.** The pianist asked for under 10 ms from key to light. No stack reliably hits that end to end, because display scanout alone eats several milliseconds. Native gets about 12–18 ms and Electron about 18–28 ms. The spike will measure this honestly against a 30-line native Metal baseline. **Go/no-go bar:** p95 under 25 ms end to end, and p99 frame time under 10 ms at 120 Hz.

### Architecture

```
Web MIDI ─► midi-input (normalize, timestamps, dedupe)
          ─► event bus ─┬─► recorder (.jsonl lossless + .mid with chord markers)
                        ├─► piano-state (held / sustained / sostenuto / decay)
                        │      └─► theory worker (chords, key, prediction) ──┐
                        └─► per-frame ring buffer ─► renderer (three.js) ◄──┘
replay / virtual keyboard ─► same event bus
```

- MIDI enters **directly in the renderer**, and note→pixel never crosses IPC.
- Theory runs in a **Web Worker** so it can never cost a frame.
- The render loop drains all events since the last frame and doesn't allocate, which avoids GC hitches.

```
apps/desktop/        electron main + preload + renderer (midi, render, ui, recording)
packages/theory/     pure TS, zero DOM/Electron deps: chords, key, predict + tests
packages/midi-schema/ event types, .jsonl / .mid (de)serializers
fixtures/            recorded sessions + hand-labeled chord/key ground truth
tools/bench/         latency + frame-timing harness
```

**Testing:**
- **Golden tests:** replay `fixtures/*.mid` through `packages/theory` and snapshot the chord and key stream.
- **Property tests:** every transposition of a voicing gets the same quality.
- **Corpus:** your own hand-labeled playing, plus PiJAMA (jazz piano MIDI) for stress.
- This spec-plus-fixtures loop is where AI agents do their best work. The theory package also survives a switch to native.

### First spike (about 4 days)

1. **Scaffold:** electron-vite, Web MIDI logging, and one glowing three.js WebGPU sprite per note. Ship a **signed and notarized** build on day 1 so distribution pain shows up early.
2. **Frame timing:** 200k GPU particles plus bloom at full screen on ProMotion. Show p50/p99 frame time and dropped frames in a HUD. Also test on a 60 Hz external display and in Low Power Mode.
3. **Latency:** log the software leg (MIDI timestamp → the frame that draws it). For end to end, film the keys and screen at 240 fps slow-mo. Compare against a minimal Swift/Metal app.
4. **Stress test:** dense comping plus pedal clusters (about 30 sounding notes) with the theory worker live. Record to `.mid` and write the first golden test.

## 4. Decisions (Jeff, 2026-10-01)

1. **Stack:** Electron + three.js for the spike, gated by the latency/frame-rate bar; Swift/Metal is the fallback.
2. **First visual:** River + Compass. A working mockup is in [`prototype/river-compass.html`](../prototype/river-compass.html).
3. **Modes:** none. One view with everything on, predictions included (this overrides the Perform/Study/Review split in section 1). Recording still runs from day one so a review timeline can come later.
4. **Chord symbols:** triangle and minus by default (CΔ7, C–7).
5. **Hardware:** Native Instruments Kontrol S61 MK3 over USB, on a ProMotion Mac. The S61 has no internal sounds, so the app listens alongside whatever plays the sound. It exposes more than one MIDI port, so pick the keyboard port and ignore the DAW port. Its octave and transpose buttons shift note numbers. Its polyphonic aftertouch is a bonus visual input.
6. **Distribution:** personal use only for now; no Developer ID needed yet.

Still open: recording and hand-labeling a small set of sessions as ground truth for chord naming.
