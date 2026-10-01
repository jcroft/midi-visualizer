# MIDI Input Layer

*Team brief: MIDI technician. Facts from working knowledge as of 2026; items marked [verify] should be re-checked before relying on them.*

## 1. Getting MIDI into a Mac

**CoreMIDI** sits under every option. Create a `MIDIClient` (`MIDIClientCreateWithBlock`) and an input port; on macOS 11+ use `MIDIInputPortCreateWithProtocol`, which delivers `MIDIEventList` (UMP) even for MIDI 1.0 devices. Connect to every source.

**Hot-plugging:** handle `kMIDIMsgObjectAdded` / `Removed` / `SetupChanged`. On removal, clear every note held by that source. Identify devices by `kMIDIPropertyUniqueID`, not name.

| Transport | Typical latency | Jitter | Notes |
|---|---|---|---|
| USB class-compliant | ~1–2 ms | <1 ms | Best choice. |
| 5-pin DIN via USB interface | ~1 ms + serial | low | 0.32 ms/byte; a 10-note chord ≈ 6–7 ms to serialize. |
| Bluetooth LE MIDI | ~8–20 ms | ±5–10 ms | Connection interval sets the floor; packet timestamps let CoreMIDI re-space events. |
| IAC Driver | <1 ms | negligible | Loopback for a DAW or .mid player. |
| Network (RTP-MIDI) | 2–10 ms LAN | variable | Not a v1 concern. |

**Virtual ports:** a native app can publish its own destination; Web MIDI cannot, so web builds route through IAC.

**MIDI 2.0 / UMP:** low priority. Almost no pianos send it. Normalize velocity to a 0–1 float internally so a later upgrade costs nothing.

## 2. Messages that matter for piano

- **Note On / Note Off.** Note On velocity 0 = Note Off. Store release velocity but don't depend on it.
- **Running status:** raw byte streams (midir, SMF parsing) need a parser that tracks it; one callback may carry several messages.
- **CC64 sustain** — continuous (half-pedal) on most Roland/Kawai/Yamaha. **CC66 sostenuto** latches notes held at pedal-down. **CC67 soft** is visual only.
- **Poly aftertouch / MPE:** ignore, but don't crash.
- **Filter** Active Sensing (also usable as a disconnect detector), Clock, SysEx. **Honor** CC123/120/121.

**Held keys vs sounding notes** — the most important model for chord detection. Per-pitch state: `held`, `sustained` (released while CC64 down), `sostenutoLatched`. Sounding = union. Pedal-up hysteresis (on ≥64, off <40). Half-pedal scales a per-note damping weight. Attach a decay weight (velocity, time since onset, register) so pedaled Dm7 notes don't pollute G7. Feed the recognizer the held set, the weighted sounding set, and the last ~50–80 ms onset set. A re-strike of a sustained note is a new onset.

## 3. Latency budget

Target <20 ms key → photons; 20–30 ms acceptable; visual lag becomes noticeable around 30–45 ms.

| Stage | Native (Swift + Metal) | Electron (Web MIDI) | Tauri (midir → IPC) |
|---|---|---|---|
| Key → MIDI | 1–3 ms | same | same |
| Transport | USB ~1 / BLE 8–20 ms | same | same |
| CoreMIDI → app | <0.5 ms | +1–3 ms | +0.5–2 ms |
| Main-thread wait | n/a | 0–N ms (GC) | same risk |
| Wait for frame | ½ frame (4 ms @120 Hz) | same | same |
| Compositor → scanout | ~1 frame | ~1–2 frames | ~1–2 frames |
| Panel | 2–5 ms | same | same |
| **Typical total (USB, 120 Hz)** | **~12–18 ms** | **~18–28 ms** | **~18–28 ms** |

- Electron: Web MIDI works (grant `midi` via `setPermissionRequestHandler`).
- Tauri: **WebKit does not implement Web MIDI** [verify still true], so it needs a Rust bridge (midir / `coremidi` crate) batching events per frame over an IPC Channel.
- Hidden latency is mostly frame scheduling and main-thread stalls, not MIDI. Keep analysis in a Web Worker (forward events via `postMessage`; Web MIDI isn't available in workers).

## 4. Timestamping

Use the **driver timestamp**, not callback time: CoreMIDI host ticks, Web MIDI `timeStamp` (performance.now ms), midir µs. It matters for chord grouping (rolled vs separate within 30–60 ms), swing/tempo tracking, and faithful recordings. Keep one monotonic clock domain; fall back to arrival time only when a stamp is 0.

## 5. Recording, replay, testing

- **Session log:** every raw message as JSONL (host-ns time, source ID, bytes). Lossless.
- **SMF export:** Type 0, PPQ 1000 at 60 BPM (1 tick = 1 ms). Write chord/key labels as Marker events.
- **Regression corpus:** `.mid` + sidecar ground-truth labels. Sources: Jeff's own hand-labeled playing, **PiJAMA** (200+ h jazz piano MIDI) for stress, MAESTRO for sanity. Run the recognizer headless in CI.
- **Without a keyboard:** in-app replay engine on the same event bus (deterministic, faster than real time); IAC + Logic/GarageBand or `sendmidi`; a QWERTY virtual keyboard in dev builds; **MIDI Monitor** (Snoize) to inspect what the piano sends.

## 6. Recommendations

```
CoreMIDI/WebMIDI/midir ─► Source Manager (hot-plug, device select, dedupe)
   ─► Normalizer (parse, vel0→off, filter, float vel, host-ns time)
   ─► Event Bus ─┬─► Recorder (JSONL + SMF)
                 ├─► Piano State Model (held / sustained / sostenuto / decay)
                 │      └─► Analysis worker (chord, key, prediction)
                 └─► Lock-free ring buffer ─► Render loop (drains ALL events per frame)
Replay engine / virtual keyboard ─► Event Bus
```

Never render from the MIDI callback; drain the whole queue each frame so a fast trill still animates every note.

**Libraries:** Native — MIDIKit (orchetect). Electron — Web MIDI; `@julusian/midi` only for virtual ports; `@tonejs/midi` or `midi-file` for SMF. Tauri — midir (or `coremidi`) + midly.

**Pitfalls:** stuck notes (clear on disconnect / Active Sensing loss; Panic button); a piano on **both USB and Bluetooth duplicates every note** (detect identical messages within 3 ms); layer/split modes sending on channels 1 and 2 (merge by default); duplicate note-ons (ref-count per pitch); DAW thru loops (document); warn when the source is Bluetooth; Electron `midi` permission; `NSBluetoothAlwaysUsageDescription` for in-app BLE pairing.

**Bottom line:** MIDI isn't the deciding factor between stacks. All reach the piano in ~1 ms; frame scheduling and the render pipeline dominate. Native gives the tightest budget (~12–18 ms); Electron is the simplest web option (~18–28 ms); Tauri needs a Rust MIDI bridge.
