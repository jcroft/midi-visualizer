# Stack Recommendation

*Team brief: platform engineer. Facts checked October 2026.*

**Pick: Electron + TypeScript + three.js (WebGPU renderer, WebGL2 fallback) + Web MIDI + Tonal.js.**
**Runner-up: native Swift/SwiftUI + Metal + CoreMIDI.**

## Facts checked

- **Electron:** 45.0.0 (Chromium M156) scheduled stable Oct 20, 2026; 44.x is current stable. New major every 8 weeks.
- **WebGPU in Chromium:** on by default on macOS since Chrome 113 (Dawn on Metal).
- **WebGPU in Safari:** on by default in Safari 26 / macOS 26. Whether WKWebView gets it is unverified; older Apple forum threads report it missing.
- **Web MIDI in WebKit:** still not implemented.
- **ProMotion:** WebKit has a long history of capping `requestAnimationFrame` at 60 fps or half refresh on high-refresh Macs (WebKit bug 173434). Chromium follows display refresh. This weighs heavily against Tauri.
- Tauri core 2.11.x; three.js ~r186 with WebGPURenderer + TSL as the recommended path.

## Options

**Electron + Web MIDI + three.js / WebGPU** — Animation ceiling high (100k–1M GPU particles, bloom). Limits: GC pauses and ~1 frame of compositor latency. MIDI <2 ms to JS with high-res timestamps. Best DX for a web developer and best AI-agent fit. electron-builder/Forge handle signing and notarization (Apple Developer ID, $99/yr). Risk low–medium; pin Electron.

**Tauri 2 + midir** — Medium-high ceiling; rAF may be held at 60 Hz on ProMotion; WebGPU in WKWebView unverified. MIDI via Rust → IPC (~0.1–1 ms). Rust lands on the AI. Small bundle. Risk medium-high: engine tied to the user's macOS, no frame-rate control.

**Swift + SwiftUI + Metal + CoreMIDI** — Highest ceiling (`CAMetalDisplayLink`, true 120 Hz, no GC). Best MIDI path. Poor DX for Jeff; medium AI fit (Metal/SwiftUI interop and Xcode project files trip agents). Smoothest packaging. Main risk: Jeff can't review or tweak the visuals himself.

**Creative coding** — openFrameworks/Cinder: huge ceiling, C++ build friction, weak AI support. p5.js: lower ceiling than three.js. TouchDesigner: best-in-class live visuals but node-based (AI can barely help) and licensed. Nannou: slowed, small community. Godot 4: credible backup (built-in `InputEventMIDI`), awkward UI chrome. Unity: heavy, licensing.

| Stack | Animation ceiling | MIDI path | Web-dev DX | AI-agent fit | Mac packaging | Risk |
|---|---|---|---|---|---|---|
| **Electron + three.js WebGPU** | High | CoreMIDI→Chromium, <2ms | Excellent | Excellent | Good | Low–Med |
| Tauri 2 + midir | Med-High | midir→IPC, ~1ms | Good (+Rust) | Good | Excellent | Med-High |
| Swift + Metal | Highest | Direct, <1ms | Poor | Medium | Excellent | High (skills) |
| openFrameworks/Cinder | Very high | RtMidi | Poor | Low-Med | Manual | High |
| TouchDesigner | Very high | Native | Node-based | Very low | Licensing | High |
| Nannou | High | midir | Poor | Low | Manual | High |
| Godot 4 | High | Built-in | Medium | Medium | OK | Medium |
| Unity | Very high | Plugin | Medium | Medium | OK | Med |

## Recommendation

Electron with three.js WebGPURenderer, auto-falling back to WebGL2. It's the only option where Jeff can read and tweak everything, agents are strongest, frame rate follows ProMotion, MIDI needs no native code, and the theory engine shares one language with the app. Costs: ~1 extra frame of compositor latency (~8 ms at 120 Hz) and possible GC hitches, both manageable with allocation-free render loops. Target <25 ms end to end.

Fall back to Swift + Metal only if the spike shows Chromium can't hold frame pacing or latency; the TS theory engine survives (JavaScriptCore, or port with fixtures as the spec). Don't pick Tauri.

## Architecture

- **Main (Node):** windows, menus, settings (`electron-store`), recording file I/O, auto-update. Does not touch MIDI.
- **Renderer:** `midi-input` (Web MIDI → typed ring buffer), `renderer` (full-window canvas, three.js), UI chrome overlay (lightweight Svelte or React, Tweakpane).
- **Web Worker:** `theory-engine`, posting results back. MIDI → visual never crosses IPC.

**Modules:** midi-input (enumeration, hot-plug, normalize `{t, type, note, vel, ch}`, CC64, sounding-notes state); theory-engine (pure TS, deterministic `(events, state) → (state, annotations)`); renderer (scene, GPU compute particles, bloom, visual-language mapping, all params tweakable); ui-chrome (device picker, presets, fullscreen, FPS/latency HUD); recording (JSONL + SMF via `@tonejs/midi`; playback feeds the same bus — demo mode, debugging, and test fixtures in one).

```
apps/desktop/          electron main + preload + renderer (electron-vite)
  src/main/  src/renderer/{midi,render,ui,recording}/  src/worker/theory.worker.ts
packages/theory/       pure TS: chords.ts key.ts predict.ts + __tests__/
packages/midi-schema/  event types, (de)serializers for .jsonl / .mid
fixtures/              recorded sessions + expected annotations
tools/bench/           latency + frame-timing harness
```

| Library | Version |
|---|---|
| electron | 44.x (pin; 45 after Oct 20) |
| electron-vite | latest |
| electron-builder | 26.x |
| typescript | 5.x |
| vite | 7.x |
| three | ~r186 (`three/webgpu`, TSL) |
| tonal | 6.x |
| @tonejs/midi | latest |
| tweakpane | 4.x |
| vitest | 3.x |
| zod | latest |

PixiJS 8 is a lighter 2D alternative if the art direction goes flat. Confirm exact versions at scaffold time.

**Testability:** `packages/theory` has zero DOM/Electron/clock dependencies. Golden tests replay `fixtures/*.mid` and snapshot the annotation stream. Property tests (transposition invariance). Also runs as a Node CLI (`theory analyze session.mid`).

## First spike (days 1–4)

1. **Day 1:** scaffold electron-vite; Web MIDI logs; a three.js WebGPU canvas with one glowing sprite per note-on (check `renderer.backend.isWebGPUBackend`). Package a signed, notarized build.
2. **Day 2, frame timing:** 200k GPU particles + bloom fullscreen on ProMotion. Log rAF deltas (expect ~8.3 ms), DevTools trace for long tasks/GC, p50/p99 + dropped frames in a HUD. Test on 60 Hz external and Low Power Mode.
3. **Day 3, latency:** software leg (event timeStamp → rendering frame). End to end: 240 fps iPhone slow-mo of keys + screen (4.2 ms resolution), or photodiode. Target p95 <25 ms. Compare against a 30-line Swift/Metal app.
4. **Day 4:** dense comping + pedal clusters (~30 sounding notes) with the theory worker live; record to `.mid`; first golden test.

**Go/no-go:** p99 frame time <10 ms at 120 Hz and end-to-end <25 ms; otherwise fall back to Swift/Metal and keep `packages/theory`.

## Sources

- [Electron release schedule](https://releases.electronjs.org/schedule)
- [gpuweb Implementation Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
- [WebGPU supported in major browsers (web.dev)](https://web.dev/blog/webgpu-supported-major-browsers)
- [Apple forums: WebGPU and WKWebView](https://developer.apple.com/forums/thread/770862)
- [Safari-WebMIDI extension (no native WebKit Web MIDI)](https://github.com/triglav-modular/Safari-WebMIDI)
- [WebKit bug 173434 (rAF frame rate)](https://bugs.webkit.org/show_bug.cgi?id=173434)
- [docs.rs tauri](https://docs.rs/crate/tauri/latest)
- [three.js releases](https://github.com/mrdoob/three.js/releases)
- [three.js WebGPURenderer manual](https://threejs.org/manual/en/webgpurenderer.html)
