# The latency spike

## What this is

Before we build the real visualizer, we need to know whether Electron (a web app wrapped as a Mac app) is fast enough. It has to feel instant when you play. This spike is a small, rough version of the app built to answer that question with numbers.

It answers two questions:

1. **Does the light keep up with your hands?** This is the time from a key going down to the screen changing, which we call key-to-photon.
2. **Is the animation smooth?** At 120 Hz the Mac draws a new frame every 8.3 ms. We want almost every frame to arrive on time.

## The go/no-go bar

| | Bar | How we measure it |
|---|---|---|
| Key → photon | **p95 under 25 ms** | Filmed with an iPhone at 240 fps (the real number); estimated live in the HUD |
| Frame time | **p99 under 10 ms at 120 Hz** | Measured live in the HUD |

"p95 under 25 ms" means 95 out of 100 key presses show up on screen within 25 ms. "p99 frame time" means 99 out of 100 frames arrive within 10 ms. At 120 Hz a frame is due every 8.3 ms, so any frame that misses its slot takes 16.7 ms and counts against the bar.

**If either bar is missed**, the app moves to native Swift + Metal. The music-theory code is pure TypeScript and comes along either way. For context, the research put native at roughly 12–18 ms key-to-photon and Electron at roughly 18–28 ms. The spike tells us where your Mac actually lands.

## Running it

_(The lead will fill this in.)_

## What you'll see

**Top left: the HUD.** It's a block of small grey numbers, updated four times a second. Press **Tab** to hide or show it.

```
webgpu · 120 Hz (8.33 ms) · mode normal
frame       p50   8.3  p99   9.1  PASS (<10)
            dropped 3 (0.2%)  cpu p50   1.9 p99   3.4  long 0
midi→frame  p50   4.1  p95   7.6  p99   8.4  n=212
midi→submit p50   6.0  p95   9.9  p99  11.0
driver→js   p50   0.2  p99   0.6
key→photon  est p95  22.4 vs <25 ms  PASS
MIDI: midi:Komplete Kontrol S61 MK3
```

What the lines mean:

- **webgpu / webgl2** shows which graphics engine started up. WebGPU is the one we want.
- **120 Hz** is the refresh rate the app is actually getting. If it says 60 on the MacBook's own screen, something is throttling it, for example Low Power Mode.
- **frame p50 / p99** is the time between frames. You want p50 near 8.3 and p99 under 10. **dropped** counts frames that missed their slot. **cpu** is how long the app's own work took inside each frame. **long** counts frames where that work alone took longer than a whole frame.
- **midi→frame** is the time from when macOS received the note to the start of the frame that draws it. **midi→submit** is the time until that frame's drawing was handed to the graphics card. Both are measured exactly.
- **driver→js** is how long the note took to travel from macOS's MIDI system into the app. It should be well under 1 ms.
- **key→photon est** is an *estimate* of the whole trip, compared with the 25 ms bar. It shows PASS or FAIL once you've played 50 notes. The estimate works like this: take the moment the frame is handed to the graphics card, round up to the next screen refresh, add one more refresh for Chromium's compositor (the layer that assembles the window), add about 3 ms for the panel to physically change, and add 2 ms for the keyboard to scan and send over USB. It's a sanity check. **The video test below is the real answer.**
- **MIDI:** shows which port the app is listening to. If you ever see a Bluetooth warning, switch to the USB cable; Bluetooth adds 8–20 ms all by itself.

The demo and replayed files are left out of the latency numbers because they aren't real key presses. The QWERTY keyboard counts.

**Bottom left: the controls.** They fade out after 3 seconds without mouse movement, and wiggling the mouse brings them back.

- **MIDI: …** opens the port picker. The S61 shows up as more than one port. Tick the keyboard port, not the DAW port.
- **▶ Demo** loops a built-in jazz progression, so you can watch it without playing.
- **Normal / Stress / Flash test** switch the picture. Normal is the River + Compass. Stress adds 200,000 particles to see whether frame pacing holds under load. Flash test is a black screen that flashes white for one frame on every note, for the camera test.
- **Save recording** saves what you've played as a `.mid` file. **Save bench report** saves all the numbers. **Reset stats** clears the numbers, which is handy when you switch modes. **Panic** silences stuck notes. **Fullscreen** fills the screen.

Keyboard shortcuts (the letter keys and Space play notes, so the shortcuts stay off them):

| Key | Does |
|---|---|
| Tab | Show/hide HUD |
| 1 / 2 / 3 | Normal / Stress / Flash test |
| Esc | Panic (all notes off) |
| Cmd+F | Fullscreen |
| A W S E D F T G Y H U J K O L P ; ' | Play notes (no keyboard needed) |
| Z / X | Octave down / up |
| Space | Sustain pedal |

## Step by step

Plan on about an hour. Plug the MacBook into power. Turn off Low Power Mode for now; step 5 turns it on deliberately.

### 1. Run the app

Follow **Running it** above. Plug the S61 in by USB, open the MIDI picker, and tick the keyboard port. The HUD's MIDI line should name it. Play a few notes and the picture should respond.

### 2. Read the HUD while you play

Stay in **Normal** mode, press **Reset stats**, and play for a couple of minutes: comping, runs, big pedalled voicings, whatever's natural. Then read the HUD:

- Does it say **webgpu** and **120 Hz**?
- Is **frame p99** under 10 with PASS?
- Is **key→photon est p95** under 25 with PASS?
- Does it *feel* instant? Your impression counts too. Write it down.

Click **Save bench report** before moving on (see step 6).

### 3. The real test: film it

This is the measurement that decides the spike. The camera sees the key go down and the screen change in the same shot, so nothing is hidden.

1. Press **3** (Flash test) and **Reset stats**. The screen goes black.
2. Put the MacBook right next to the S61, so that one key and the screen both fit in the iPhone's frame. Pick a key near the laptop. Dim the room a little so the flash is obvious.
3. On the iPhone, open Camera and choose **Slo-Mo**. Make sure it's set to **240 fps**: Settings → Camera → Record Slo-mo → 1080p at 240 fps. Prop the phone up so it doesn't move.
4. Start recording. Press the key about **20 times**, firmly, with about a second between presses. Don't play fast, because each flash needs to be clearly separate. Stop recording.
5. Go through the video frame by frame. In Photos, tap Edit and drag the timeline slowly, or use any app that steps one frame at a time. For each press:
   - find the frame where the key **bottoms out** (it stops moving down),
   - find the first frame where the screen is **visibly brighter**,
   - count the frames in between.
6. Each frame is **4.17 ms** (1000 ÷ 240). Multiply. For example, 5 frames × 4.17 = 20.8 ms.
7. Write the 20 numbers in a list or spreadsheet and sort them. The second-highest of 20 is roughly your p95. **Under 25 ms passes.**

Tips: key-bottom is a judgement call, so pick a rule and stick with it for every press. Each reading is accurate to about ±4 ms, which is why we take 20 of them. Keep the app's HUD visible during this test, so you can compare your filmed numbers with its estimate afterwards.

Save a bench report again at the end. Flash-test notes are labelled separately in the report.

### 4. Same test with the native Metal app

This tiny native Mac app does exactly the same thing: a black window that flashes white for one frame on every note. It shows what the best case looks like on your Mac.

1. Quit the Electron app, so that only one app is listening to the keyboard.
2. In Terminal:
   ```sh
   cd tools/bench/metal-baseline
   ./build.sh
   ```
   The first time, macOS may ask you to install the Command Line Tools; say yes, then run it again. A black window opens, and the Terminal lists the MIDI ports it's listening to (all of them).
3. Press **Cmd+F** for fullscreen. To match conditions, make it the same size as the Electron app was during your test.
4. Repeat the filming from step 3 exactly: same key, same camera spot, about 20 presses.
5. The Terminal also prints a number for each flash: **MIDI→present**. That's the time from macOS receiving the note to the frame actually reaching the display, measured by macOS itself. Add about 3 ms for the panel and about 2 ms for the keyboard and USB. Press Cmd+Q to quit.

The **difference** between the Electron and native videos is what Electron costs us. If Electron passes the bar, we stay. If it fails, but native would pass, that's the case for switching.

### 5. Frame pacing under load

Here we only care about the **frame** lines in the HUD.

1. Press **2** (Stress), press **Reset stats**, start **▶ Demo**, and let it run for a full minute (the HUD covers the last ~10 seconds). Play along too, with dense two-handed voicings and pedal.
2. Note **frame p99**, **dropped** and **long**, then save a bench report.
3. **On a 60 Hz external display:** drag the window to the external monitor, make it fullscreen, then Reset stats and run the demo again. The HUD should now say 60 Hz. The 10 ms bar can't be met at 60 Hz, because every frame takes 16.7 ms there, and the HUD notes this. What we're checking is that dropped stays near zero and p99 stays near 16.7. Save a report.
4. **In Low Power Mode:** turn it on in System Settings → Battery → Low Power Mode, go back to the MacBook screen, Reset stats, and repeat. macOS may cap the app at 60 Hz in this mode, and that's worth knowing. Save a report. Turn Low Power Mode back off.

### 6. Save everything and send it back

Everything lands in **~/Documents/MIDI Visualizer/**:

- **bench/** contains `bench-YYYYMMDD-HHMMSS.json`, the full report: summary numbers, every frame time, every note's timing, and details about your Mac (screen, refresh rate, graphics engine, mode). Next to it is `…-notes.csv`, one row per note, which opens in Numbers or Excel.
- **recordings/** contains your playing as `.mid` (opens in any DAW, with chord names as markers) and `.jsonl` (lossless, for our test fixtures). **Save recording** starts a fresh take each time.

After saving, the file name appears briefly next to the controls; click it to show the file in Finder. Please send back:

- the bench reports from steps 2, 3, 5 (and the 60 Hz and Low Power ones),
- your two lists of ~20 filmed numbers (Electron and native), plus the Metal app's Terminal output,
- one recording of you playing normally (it becomes our first test fixture),
- a sentence or two on how it *felt*.

## Notes on the numbers

- All software timings use one clock: macOS's MIDI timestamp, which marks when the note arrived from USB, through to the moment the frame is handed off. The keyboard's own scan and the USB trip happen before that timestamp and are invisible to software. The camera sees them; the HUD estimate adds 2 ms for them.
- **midi→frame** can occasionally read slightly negative. Chrome stamps a frame with the time it *started*, and a note that arrives a moment later can still squeeze into that same frame. That's the best case, not a bug. **midi→submit** is always positive.
- The HUD estimate assumes Chromium adds one compositor frame. If the filmed numbers come out consistently higher or lower than the estimate, that tells us the model is off. That's useful to know too.
