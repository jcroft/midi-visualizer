# Music Theory: Hearing what Jeff plays

*Team brief: jazz music theorist.*

## 1. Chord identification: report a ranked list of readings

Jazz voicings often leave out the root, and the notes alone can't settle the name. Take {E G B D}: Em7, rootless Cmaj9, G6/9-ish, or rootless A7sus. The recognizer should produce a **ranked candidate list with confidence scores**. The UI shows the top candidate in large type and the runners-up as smaller "ghost" names.

**Recognizer:** template matching over pitch-class sets plus weighted evidence, not a pure lookup table. Score each (root, quality) hypothesis:

- **Template fit.** Required tones are 3rd and 7th (6th for 6 chords). The 5th is optional and costs almost nothing when missing. The root is optional but rewarded when present. Extensions (9, 11, 13) and alterations (♭9, ♯9, ♯11, ♭13) are allowed but each costs a little. An unexplained note costs a lot.
- **Bass evidence.** The lowest sounding note gets a strong root prior (~+30%). A left-hand note held by the sustain pedal counts as bass until a new low note replaces it. If the bass doesn't fit the upper structure, output a slash chord (Ab/C, D/C).
- **Hand split.** Estimate the split from register and a gap of more than a 5th. Left-hand notes carry the harmony. Right-hand notes may be melody or tensions, so they get lower weight unless held.
- **Context prior.** Use the current key estimate and the previous chord. In C, after Dm7, {B D F A} reads as G9 (rootless) more than Bm7♭5. After G7, {E G B D} reads as Cmaj9 more than Em7.

**Voicing families to model explicitly:**
- **Rootless A/B forms** (Bill Evans, Levine ch. 4): 3-5-7-9 / 7-9-3-5 on ii, 3-13-7-9 / 7-9-3-13 on V. On a lone rootless voicing, the A/B template should beat the literal reading unless the bass contradicts it.
- **Shells** (1-3-7, 1-7-3): unambiguous.
- **Upper-structure triads** (D/C7 = C13♯11, E♭/C7 = C7♯9, A♭/C7 = C7♯5♯9, triad-over-tritone family). Detect a RH triad over a LH tritone or shell and name it as the altered dominant, with "UST II" as a secondary label.
- **Quartal / So What** (E-A-D-G-B): deliberately ambiguous. Name modally (Em11, or "E dorian sound"), lean on context, show low confidence on purpose.
- **Clusters.** 3+ adjacent semitones with no clear template → "cluster on X". Don't force a name.

**Ambiguity defaults:** C6 vs Am7 goes to the bass, then context. Rootless Dm9 (F A C E) vs Fmaj7: with no bass or context, the literal reading (Fmaj7) wins ties; with Dm or G7 nearby, Dm9.

**Naming style:** Real Book / Levine lead-sheet style. Cmaj7; C–7 or Cm7 (a setting); C7alt when ≥2 altered tensions and no natural 5th; C7(♭9♯11) for specific alterations; Cø7 by default with Cm7♭5 as an option; C7sus4. Real ♭/♯ glyphs. Spell enharmonics by key (D♭7, not C♯7, in A♭).

**Libraries:** Tonal.js `Chord.detect` and music21 `commonName` are good dictionary references, but both are context-free, single-answer, and don't understand rootless voicings. Expect to write our own scorer. Pardo & Birmingham's template-based segmentation/labeling (2002) is the academic starting point.

## 2. Segmentation: deciding when a chord changes

Treat harmony as a **slow-moving state** that the notes adjust, not "the notes down right now".

- **Harmonic pool.** A decaying weight per pitch class. Held and pedaled notes keep full weight; released notes fade over ~1–1.5 s. Quick RH notes (<~150 ms, upper register, stepwise) count as melody/passing tones at ~0.3 weight.
- **Onset triggers.** A new chord is likely when (a) 3+ notes start within ~60 ms, (b) a new bass note arrives, or (c) the sustain pedal is released and re-pressed — the strongest signal a pianist gives.
- **Hysteresis.** Change the label only when a new candidate beats the current one by a margin and holds that lead ~120 ms.
- **Refinement vs change.** Same root and function (Cmaj7 → Cmaj9) updates the label in place. Only root/function changes are chord events; only chord events feed key tracking and prediction.
- **Arpeggios** accumulate in the pool within the decay window.

## 3. Key centers: show a local and a global key

- **Global (tune key):** Krumhansl–Schmuckler or (better) Temperley key profiles over a long-decay histogram (~30–60 s), weighting chord roots and guide tones over surface notes.
- **Local (tonicization):** functional pattern parsing. A ii–V, V–I, or ii–V–I sets the local key to the target, even if the target never arrives (an "implied" key, shown dashed). Tritone subs (D♭7 → C) and backdoor ii–Vs (Fm7–B♭7 → C) map to the same target.
- **Modal mode:** slow harmonic rhythm (one chord ≥4 s) with dorian/mixolydian content → show a mode label ("D dorian").

**Display it honestly:** a region on a circle-of-fifths ring sized by confidence; sharp when confident, a smeared arc when torn, dotted for implied. Show both levels: "in E♭ → tonicizing A♭".

## 4. Predicting the next chord

Show **3–4 options with probabilities** ("→ Cmaj7 55% · D♭7 20% · Am7 15%").

**v1: rule-based functional grammar.** ii → V; V → I, V → vi, V → tritone sub; dominant → down a 5th or its tritone sub; m7 → dom7 a 4th up; iv–♭VII backdoor; I → VI7 or vi; I → I7 (to IV); chromatic approach from a half step above; Coltrane cycle after two major-3rd jumps. Each prediction carries its *reason*, so it teaches whether or not it comes true.

**v2: statistical.** Variable-order Markov/n-gram (order 2–3 with backoff) on key-relative chord sequences from **iReal Pro** (~1,300 standards), the **Jazz Harmony Treebank**, the **Weimar Jazz Database**, and **JAAH**. Blend with the rule prior; add an online layer learning Jeff's habits. Then **standard-matching**: fuzzy, transposition-invariant alignment against the corpus ("this looks like *Autumn Leaves*, bar 9") — the strongest predictor available.

## 5. Other theory ideas worth visualizing

- **Function coloring (T/SD/D)** with tension as saturation. Best low-cost, high-value visual.
- **Tension meter:** dissonance (roughness/interval vector; ♭9s and tritones), alterations, distance from local tonic.
- **Voice-leading lines:** connect each note to its nearest note in the next chord. Guide tones moving by half step (7→3 in ii–V–I) become glowing threads.
- **Chord-scale suggestion:** C7alt → altered; C7♯11 → lydian dominant; Dm7 in C → dorian; G7♭9 → half-whole. One or two, faint.
- **Root motion on the circle of fifths:** ii–V–I chains spiral, Coltrane changes draw a triangle, tritone subs jump across.
- **Progression badges:** ii–V–I, turnaround, rhythm-changes bridge, Bird blues, Coltrane cycle, backdoor, minor ii–V; sparingly, "sounds like *All the Things You Are*".

## 6. Priorities

**Essential for v1:** (1) decaying pitch-class pool with pedal awareness and hysteresis; (2) candidate scoring with rootless/shell/UST templates plus bass/hand weighting, top candidate + 2 ghosts; (3) lead-sheet naming with correct enharmonics; (4) local key from ii–V parsing plus global key from profiles, with confidence; (5) T/SD/D coloring; (6) rule-based predictions with probabilities and reasons; (7) guide-tone voice-leading lines.

**v1.5:** root-motion trail; progression badges; tension meter.

**Later:** n-gram model blended with rules; learning Jeff's habits; standard-matching; chord-scale overlays; modal/quartal display mode.

**Main tradeoff:** for an improviser, how stable the display is matters more than how clever the recognizer is. "Probably Dm9, maybe F6", shown calmly and confirmed as context arrives, keeps the player's trust.
