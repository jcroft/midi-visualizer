# The Player's Side: what it has to be like to play with this on screen

*Team brief: jazz pianist / improviser.*

## 1. Playing with it running

When I'm improvising, my eyes are mostly closed or unfocused, and I look at a screen the way I look at a bassist: in quick glances to check where we are. Anything that asks me to read while I play pulls me out of the music. The rule for live mode is that **I should be able to take it in from the corner of my eye in about a quarter of a second**, and you can't read text that fast.

**What I can take in at a glance while playing:** the key center as a color or region, not a label. How dense and how loud I'm playing. One big, calm chord symbol that changes only when the harmony actually changes. Whether I'm sitting on the tonal center or drifting away from it.

**What should wait for review:** chord spellings, Roman numerals, voicing analysis, stats, anything with more than one line of text, and predictions. A prediction shown live is a backseat driver. Afterward it's an interesting "here's what was likely, here's what you did instead."

**When it names my chord wrong.** It will, all the time. Is C-E-G-A a C6 or an Am7/C? Is a rootless left hand (E-G-Bb-D) a C9 or Em7b5? A G7alt played over a pedal? Without a bass player, half of jazz piano harmony is ambiguous on purpose. So:
- **Show confidence visually.** A confident chord name is solid. An ambiguous one is softer, maybe with the second reading faint underneath (C6 / Am7). Never show a wrong name in bold.
- **Be slow to commit.** Passing tones, approach notes and grace notes are not chord changes. Hold the name until the notes have sounded for a beat or so, or until there's a bass-register attack. When it's unsure, saying nothing is better than flickering.
- **Lean on context.** If we've been in Bb and I play E-G-Bb-D, it's C9 in a ii-V, not Em7b5. Key center and the last chord should decide between readings.
- **Let me correct it during review** ("that was a C9") and have it learn from that.

A chord label flickering three times a second is the quickest way to make me switch this off.

## 2. What it should respond to besides pitch

- **Velocity and touch:** brightness, size and energy. A ghosted note in a comping figure should barely show. An accent should land.
- **Sustain pedal:** the image should get wetter. Things linger, edges blur, held notes pool together. Lifting the pedal clears it. This is the most satisfying mapping available, so get it right.
- **Soft pedal:** muted, cooler, closer in.
- **Voicing spread:** close clusters and open spread voicings (a tenth in the left hand, a fourth-stack in the right) should look different in shape, not only in position.
- **Register:** low is heavy and grounded, high is airy and thin.
- **Density:** sparse Ahmad Jamal space and a dense Tatum run should feel like different weather.
- **Time feel:** pick up the pulse from my left-hand comping and onset patterns. Swing, straight eighths, and rubato ballads should each move differently. When I'm out of time (a rubato intro), it should float with no grid.
- **Phrasing:** phrases have shape. A line should leave a trail you can read as a gesture with a beginning and an end.
- **Left vs. right hand:** separate them by register plus clustering, with a split point that adapts. LH is usually harmony (shells, rootless voicings, stride), RH is usually line plus upper structure. Showing them as foundation vs. melody is musically true and looks good. It will guess wrong sometimes. That's fine.
- **Silence:** the most important one. When I stop, the screen has to breathe: decay, settle, go dark slowly. Space is a musical choice and the visual should honor it, not fill it with an idle animation.

## 3. Modes

- **Performance/ambient:** projected behind me or under a video. No text, or a chord symbol at most. Beauty matters more than information.
- **Practice:** a tune loaded, specific goals, feedback.
- **Review/replay:** record everything, scrub back, see the harmony laid out over time, fix mislabeled chords.

**V1 should be ambient-first, with review recording quietly from day one.** Ambient mode makes the analysis engine (chord ID, key detection, hand split, pedal handling) earn its keep without having to be right, and it's what I'd actually leave on every time I sit down. If MIDI is recorded from the start, review mode is a v1.5 addition on data I already have. Practice mode needs the most UX care, so it comes third.

## 4. Practice features I'd actually use

1. **Load the changes** (iReal Pro import is the obvious source) and show the form moving along with me, marking where my harmony agreed with the chart and where I substituted. A tritone sub should count as a choice, not a mistake. Don't grade me. Show me.
2. **Guide-tone highlighting:** light up the 3rds and 7ths of the current chord in what I played. Optionally draw the guide-tone line through a ii-V-I so I can see the half-step resolutions, 7 to 3 and back.
3. **Voicing habits during review:** "You used this rootless A-form voicing on 60% of your minor ii chords." Show my top 10 voicings with counts. That's the mirror I don't have.
4. **ii-V drill loop:** pick a ii-V, cycle it through 12 keys (or down in whole steps), check that I actually voiced it in each key, and track which keys I hesitate in by timing.
5. **Comping looper:** record my left hand for a chorus, loop it, and solo over it while the visual shows both layers. Then reverse the roles.
6. **Avoid-note flag, used sparingly:** a quiet mark when I sit on an unresolved natural 11 over a major chord. Off by default.

## 5. Three visual concepts

**A. The River.** A horizontal score that flows left to right. Notes are lit strands at their pitch height, thickness shows velocity, and pedal shows as glow and bleed. Chord regions are soft color bands behind the strands, colored by key center. Legible and honest, and great for review because it's already a timeline. Live, it's the least magical: it looks like a piano roll in a nice suit.

**B. The Harmonic Map.** A tonnetz or circle-of-fifths field where my current harmony is a glowing shape and my path through keys leaves a fading trail. A ii-V-I is a short arc, Coltrane changes draw a triangle, modal vamps hover in place. It shows something I can't otherwise see: the geometry of where I went. The risk is that it's abstract and can feel like a diagram. It needs warmth and motion from touch and pedal to come alive.

**C. Bloom.** Light and particles rising from the keyboard edge. Each note releases a bloom sized by velocity and colored by its function in the current chord (root, 3rd, 7th, tension). Pedal lets blooms hang and merge, silence lets them settle like dust. The most beautiful and the best for performance, and the least informative on its own.

**What I'd want first: C sitting on top of B.** Bloom is the ambient surface. The harmonic map lives faintly in the background as the current key region, so the color field shifts when I modulate. The River is the review view. Same data, three views, mapping neatly onto the three modes.

## 6. Hard opinions

**Must-haves**
1. Latency you can't feel, under about 10ms from key to light. If it lags, I'll play to it, and that ruins my time.
2. Chord labeling that is honest about uncertainty and slow to commit, with context-aware readings.
3. Sustain pedal as a first-class visual input.
4. Silence that reads as silence: real decay, and stillness at rest.
5. Every session recorded automatically as MIDI with no setup, so a great accident is never lost.

**Things to avoid**
1. Flickering text, or any text that changes faster than about once a beat.
2. Grading, scores, red X's, "wrong note." Jazz has no wrong notes, only unresolved ones.
3. Live harmonic prediction shown during performance. Save it for review, or for a very subtle hint if anywhere.
4. An idle screensaver or busy animation that ignores the dynamics I'm playing. Pianissimo must look pianissimo.
5. Classical-theory pedantry: insisting on "Am7/C" when every jazz player would call it C6, or labeling ordinary jazz harmony (sus voicings, quartal voicings, upper structures) as "unknown." Use the names a working player uses: C7alt, Fmaj7#11, Bb7sus, D-6/9.
