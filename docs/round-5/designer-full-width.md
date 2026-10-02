# Round five: designing for the full width

*Designer's response to Jeff's note about removing the River. All sizes are for the 5K panel in CSS pixels (2560 × 1440), given as fractions of the screen, measured from the top left.*

## 1. What the freed width actually means

A correction first: removing the River does not make the default compass bigger. The ring was already limited by height (R is about 400 px, 31% of the width). What the removal buys is **one geometry instead of two**. Every layer no longer has to survive being squeezed into the River's right third, so we can design for the wings: about 0.22 of the width on each side, nearly empty today.

My take: **the wings should hold the things that are not geometry.** On the compass, position means something by angle. The stack, the key title and the long prediction captions don't, yet they crowd the map: the stack overlaps the polygon and move shape, the key title collides with the 12 o'clock prediction, and reharm captions hang off the left of the ring.

What stays out of the wings while playing: lists, stats, multi-line text, and anything that changes faster than once a beat. The wings are for shape and color caught from the side of the eye.

I'd also give the screen one rule for direction, borrowed from the lead sheet: **past and your hands on the left, now in the center, the future on the right.**

## 2. The voicing stack: move it, but keep it close

Jeff is right that there's no musical reason for it to be in the middle. Pros and cons:

**Keeping it in the center:** zero eye travel. But it is tiny (rungs about 9 px apart for one hand), it sits on the polygon, move shape and tendency tails, and it pushes the chord name below the middle.

**Moving it to a wing:** it can be three times larger, voice leading gets room, and the center goes back to the chord. The cost is a real saccade, about 15° of visual angle at playing distance. That reads peripherally as shape and color, never as text.

**Recommendation: move it to the left wing, and design it to be read as shape first.** It belongs on the left because it is your hands and its voice-leading ghost already slides left into the past. At the larger size it should become a **voicing column on a keyboard spine**: a faint vertical piano keyboard (white and black keys as hairline bands) running up the column, with the role-colored discs sitting on their actual keys. The keyboard gives register a physical meaning, so you see "that's my left hand around middle C" without reading "C4". Function labels stay left of each disc and note names right. The window stays fixed between chord changes so nothing jitters.

I'd keep the ladder rather than switch to a staff. A staff forces spelling decisions (is it G♭ or F♯?) and has to be read; a pianist reads a keyboard shape instantly.

## 3. The other layers

- **Chord name, numeral and scale:** move to the true center of the ring and grow about 25% (from 0.36 R to 0.45 R), now that the stack is out.
- **Key title:** move it off 12 o'clock to the top of the left wing. At the top it fights the predictions and has to clip against the screen edge. The key arc still carries the key at a glance, and the title becomes a calm page heading. The modal frame caption ("= II OF C") and the style lens sit under it as one "where we are" block.
- **Predictions orbit:** keep it on the ring, because the angle is the information. But cut each orbit label down to the chord symbol only. The numeral and reason ("iii–VI–ii–V 1/4") move to the lead sheet's future side. That alone removes most of the collisions.
- **Reharm offers:** the diamonds stay on the ring and the text moves down to the lead sheet as alternate changes (see idea 3).
- **Scale halo and line:** leave it. It's angular and it works.
- **Lead sheet:** keep "now" under the center of the compass. That vertical line from ring center to current chord is the strongest alignment we have. The fix is the right half, which today shows two outlined chords and then nothing.
- **Tension curve:** extend it. It currently stops at "now" and sits only under the left half.
- **Today's moves rail:** keep it as an on-demand panel in the right wing. It no longer covers anything when open.
- **Right wing during play:** deliberately quiet. Prediction labels from the 2 to 4 o'clock side spill into it, and that's enough. Negative space there balances the stack on the left. Filling both wings would turn the compass into the middle of a dashboard.

## 4. Ideas for round five

**1. The voicing column (left wing).** On D–9 with F A C E you see four discs on the keyboard spine, labeled ♭3, 5, ♭7, 9, with "ROOTLESS A" above and a dashed implied D below. On G13 the old discs slide left as grey ghosts, the C falls to B with a gold line marked −1 (7 to 3), and the F holds. On CΔ9 the F falls to E in gold, and the B holds. Across the three chords you watch the guide-tone line. *Rationale:* voice leading is the stack's real value, and it needs room. *Size:* column x 0.08 to 0.22, y 0.16 to 0.70; a one-hand voicing gets about 16 px per semitone and discs of 11 px radius.

**2. The chord comes home to the center.** On the same ii–V–I the ring's interior holds only the chord name at 0.45 R, the numeral and scale beneath it, and the polygon and move shape behind them. *Rationale:* the one thing the pianist brief says you read live is one big calm chord symbol, so it gets the middle of the hero. *Size:* the name is centered at the ring center, about 180 px tall.

**3. The next bar, Real Book style.** On G13, the lead sheet's right half shows the predicted CΔ7 in outline, the chord after it dimmer, and above them, in small violet text and parentheses, the alternate changes: (D♭7) and (B♭7). That's how a Real Book prints alternates. The "ii–V–I 2/3" bracket continues as a dotted line over the predicted CΔ7, and the tension curve continues as a dotted forecast falling into it. When you land on C, the outline fills, the bracket goes solid, and the violet alternates fade. *Rationale:* reasons and options get one home on the timeline instead of scattering around the ring. *Size:* x 0.52 to 0.80 of the bottom band; alternates 0.012 h tall.

**4. Key block top left, and a slightly larger ring.** "C MAJOR" sits top left at about 0.06 h tall, with "jazz · pop" from the style lens under it. With nothing needing room above 12 o'clock but prediction symbols, R can grow from 0.37 to about 0.40 of the region (about 8%) and the center can rise a little. *Rationale:* the key changes slowly and is carried by the arc. The title is a heading, not a glance target. *Size:* block x 0.04 to 0.20, y 0.04 to 0.12.

**5. Experiment, off by default: the keybed.** A full-width 88-key strip between the compass and the lead sheet (x 0.04 to 0.96, about 0.022 h tall, so about 44 px per white key), with sounding keys lit in their role colors and pedal haze over held keys. On the ii–V–I you'd see your left-hand grip shift in place, mirrored exactly. *Rationale:* it's the most literal mirror possible and it sits in the lower peripheral field, near where your eyes already go for the lead sheet. Try it against idea 1 to see which one you actually look at.

## 5. Layout sketch

```
+----------------------------------------------------------------------------------------------+
| C MAJOR                                     ( CΔ7 )                             jazz . pop     |
| = II OF C                       .  ' '  ' ' ' '  ' .                                           |
|                             .'                          '.          A7                       |
|  DROP 2 . ROOTLESS A      .'      . ' ' ' ' ' ' .         '.                                 |
|   |=|  13 ( ) E4         :      '                 '         :                                |
|   |-|                    :     :                   :        :                                |
|   |=|   3 (*) B3        :     :      G 13           :        :                               |
|   |=|                   :     :                     :        :                               |
|   |-|  b7 (*) F3        :     :      V7  G MIXO      :       :                               |
|   |=|                    :     :                   :        :         E-7                    |
|   |=|   R ( ) G2          '.    '  .  ' ' ' '  .  '       .'                                 |
|  voicing column             '.                         .'                                    |
|  on keyboard spine             ' .  ' ' ' ' ' '  . '                                         |
|                                                                                              |
|  [ ii-V-I 2/3 ...........................................]                                   |
|      D-9      G13      CΔ9      A7      D-9     [G13]   (CΔ7)    (A7)                          |
|      ii       V        I        VI7     ii      V         (Db7) (Bb7)  alternates in violet  |
|  ~~~~~~~~ hidden voices ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ . . . . . .                        |
|  ___/\____ tension ___/\__/\__________________/\___________ . . . .                          |
+----------------------------------------------------------------------------------------------+
   left wing: your hands         center: the compass (hero)         right wing: quiet, M rail
```

**Build first:** ideas 1 and 2 together, as one change. Taking the stack out of the ring and putting the chord in the center are the same decision, and Jeff can judge both in one session. Then idea 4 (an easy layout move that removes the worst collision), then idea 3. Build idea 5 only if the column turns out to need too much eye travel.

## 6. Risks

- **Eye travel.** If Jeff finds himself reading the column during a solo, it's too detailed. The fix is to strengthen shape and color and dim the text, not to move it back.
- **Wings becoming a dashboard.** Each new thing that wants a home will pick a wing. Hold the line: one block per wing during play, and nothing that changes faster than a beat.
- **Losing the hero.** Nothing in the wings may be brighter than the lit nodes on the ring. Stack discs get a 150 ms attack flash and then sit under the bloom threshold, or every chord pulls your eye to the left.
- **Breaking the vertical axis.** If "now" on the lead sheet drifts off the ring's center to fill the right half, the screen loses its spine.
- **Testing at the wrong shape.** The screenshots so far are 16:10. Check every change at 2560 × 1440, where the wings are wider and the compass is relatively smaller.
