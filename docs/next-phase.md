# Next phase (after the spike)

*2026-10-01. Electron is settled (Jeff played the spike on the S61). Prioritized by what changes the experience at the keyboard most.*

1. **Key tracking that follows modulations.** The key used to take ~17 s to follow a modulation without a ii–V, passing through wrong keys on the way, and a stale ii–V key could hang on for 16 s. Now a recent-window estimate with hysteresis moves the key in ~6 s, and an unresolved ii–V lapses after two unrelated chords. *(This PR.)*
2. **Ground truth from your own playing.** Record a handful of sessions (the recorder already saves `.mid`), add a small labeling pass (chord + key per segment), and turn them into golden tests. Every theory change after this gets measured against how you actually play.
3. **v1 theory visuals from the proposal:** guide-tone threads (3rds and 7ths moving by half step) and T/SD/D function coloring.
4. **Chord-label polish:** extension-only changes crossfade just the superscript, the "UST II" sub-label, and right-hand filigree merging past ~12 notes/s.
5. **Small fixes:** the PEDAL indicator overlapping the hint text; a reduce-motion and a color-blind setting.
6. **Tuning panel** (Tweakpane over `src/renderer/render/tuning.ts`) so you can adjust feel while playing.
7. **Later, only if needed:** a packaged `.app` so you don't need the terminal, and the formal latency bench when you have time. The apps/ + packages/ monorepo split stays deferred; the flat layout isn't costing anything yet.
