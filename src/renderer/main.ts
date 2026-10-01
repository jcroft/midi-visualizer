// Wiring only. Every source pushes PianoEvents onto the bus; the render loop
// drains everything that arrived since the last frame, so a fast trill still
// animates every note and MIDI never touches IPC.
import { EventBus, FrameQueue, type PianoEvent } from '@shared/events';
import type { Analysis, ToWorker } from '@shared/analysis';
import { startMidi } from './midi/input';
import { PianoState } from './midi/pianoState';
import { attachQwerty } from './midi/qwerty';
import { Replayer } from './midi/replay';
import { Recorder } from './midi/recorder';
import { createVisualizer, type VisualMode } from './render/visualizer';
import { FrameStats, LatencyProbe } from './bench/stats';
import { Hud } from './bench/hud';
import { buildChrome } from './ui/chrome';

async function boot(): Promise<void> {
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const bus = new EventBus();
  const queue = new FrameQueue();
  const piano = new PianoState();
  const recorder = new Recorder(bus);
  const replay = new Replayer(bus);
  const stats = new FrameStats();
  const probe = new LatencyProbe();

  bus.on((ev) => queue.push(ev));
  attachQwerty(bus);
  const midi = await startMidi(bus);

  const viz = await createVisualizer(canvas);
  const worker = new Worker(new URL('../worker/theory.worker.ts', import.meta.url), { type: 'module' });
  const post = (m: ToWorker) => worker.postMessage(m);
  worker.onmessage = (e: MessageEvent<Analysis>) => {
    viz.setAnalysis(e.data);
    recorder.mark(e.data);
  };

  const hud = new Hud(document.getElementById('hud') as HTMLElement, { stats, probe, backend: viz.backend, midi });

  let mode: VisualMode = 'normal';
  const setMode = (m: VisualMode) => {
    mode = m;
    viz.setMode(m);
  };

  buildChrome(document.getElementById('chrome') as HTMLElement, {
    midi,
    replay,
    recorder,
    probe,
    stats,
    getMode: () => mode,
    setMode,
    panic: () => bus.emit({ type: 'panic', t: performance.now(), recvT: performance.now(), src: 'ui' }),
    toggleHud: () => hud.toggle(),
  });

  const resize = () => viz.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  window.addEventListener('resize', resize);
  resize();

  const onEvent = (ev: PianoEvent, frameT: number) => {
    piano.apply(ev);
    viz.onEvent(ev);
    if (ev.type === 'on') probe.noteSeen(ev, frameT);
  };

  const loop = (frameT: number) => {
    requestAnimationFrame(loop);
    stats.frameStart(frameT);
    queue.drain((ev) => onEvent(ev, frameT));
    const snap = piano.snapshot(frameT);
    if (snap) post(snap);
    viz.render(frameT);
    probe.frameSubmitted(frameT, performance.now());
    stats.frameEnd(performance.now());
    hud.update(frameT);
  };
  requestAnimationFrame(loop);
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('hud')!.textContent = 'Startup failed: ' + (err?.stack ?? err);
});
