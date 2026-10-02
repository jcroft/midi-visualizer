# midi-visualizer

A standalone Mac app that visualizes live MIDI from a jazz pianist: a living picture of your playing that names chords, tracks the key center, and suggests where the harmony might go next.

**Status: latency spike.** `bash run.sh` builds and launches it. What to measure and how is in [docs/spike.md](docs/spike.md). The concept is in [docs/proposal.md](docs/proposal.md), with the team briefs in [docs/team/](docs/team/).

## Layout

```
src/main/            Electron main process (window, MIDI permission, file saving)
src/preload/         tiny bridge for saving files
src/renderer/
  midi/              Web MIDI input, piano state (held/sustain/sostenuto), QWERTY, demo, recorder
  render/            three.js Compass (the River in river.ts is kept but not in the UI); WebGPU, WebGL2 fallback; knobs in tuning.ts
  bench/             frame-pacing and latency stats, HUD
  ui/                bottom-left controls
src/worker/          theory worker (chords, key, predictions off the main thread)
packages/theory/     pure-TS theory engine + golden tests
tools/bench/metal-baseline/  minimal Swift + Metal flash app for comparison
prototype/           the original browser mockup
```
