// Bottom-left controls; fade out after 3 s without mouse movement.
//
// Keyboard shortcuts avoid the QWERTY piano keys (A W S E D F T G Y H U J K O L P ; ' Z X Space):
//   Tab = HUD · M = today's moves · V = River on/off · 1/2/3 = Normal/Stress/Flash · Esc = panic · Cmd/Ctrl+F = fullscreen
import type { MidiController } from '../midi/input';
import type { Replayer } from '../midi/replay';
import type { Recorder } from '../midi/recorder';
import type { FrameStats, LatencyProbe } from '../bench/stats';
import type { LayerId, Layers, View, VisualMode } from '../render/visualizer';
import { LAYERS } from '../render/layers';

export interface ChromeDeps {
  midi: MidiController;
  replay: Replayer;
  recorder: Recorder;
  probe: LatencyProbe;
  stats: FrameStats;
  getMode(): VisualMode;
  setMode(m: VisualMode): void;
  getView(): View;
  setView(v: View): void;
  getLayers(): Layers;
  setLayer(id: LayerId, on: boolean): void;
  panic(): void;
  toggleHud(): void;
  /** Open or close today's moves; returns whether it is now open. */
  toggleMoves(): boolean;
}

const IDLE_MS = 3000;
const MODES: { mode: VisualMode; label: string; key: string }[] = [
  { mode: 'normal', label: 'Normal', key: 'Digit1' },
  { mode: 'stress', label: 'Stress', key: 'Digit2' },
  { mode: 'flash', label: 'Flash test', key: 'Digit3' },
];

export function buildChrome(el: HTMLElement, deps: ChromeDeps): void {
  const { midi, replay, recorder, probe, stats } = deps;
  el.textContent = '';

  // --- helpers -------------------------------------------------------------
  const button = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    // Never take focus: Space is the sustain pedal and must not "click" the last button.
    b.tabIndex = -1;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      onClick();
      b.blur();
    });
    el.appendChild(b);
    return b;
  };

  let flashTimer = 0;
  const status = document.createElement('span');
  status.className = 'note';
  const say = (msg: string, path?: string | null) => {
    status.textContent = msg;
    status.style.cursor = path && window.app ? 'pointer' : '';
    status.title = path && window.app ? 'Show in Finder' : '';
    status.onclick = path && window.app ? () => void window.app?.reveal(path) : null;
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      status.textContent = '';
      status.onclick = null;
    }, 6000);
  };

  // --- MIDI port picker ----------------------------------------------------
  const portWrap = document.createElement('span');
  portWrap.style.position = 'relative';
  el.appendChild(portWrap);
  const portBtn = document.createElement('button');
  portBtn.type = 'button';
  portBtn.tabIndex = -1;
  portBtn.addEventListener('mousedown', (e) => e.preventDefault());
  portWrap.appendChild(portBtn);
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'absolute',
    bottom: 'calc(100% + 6px)',
    left: '0',
    minWidth: '260px',
    padding: '8px 10px',
    background: 'rgba(11,12,16,0.94)',
    border: '1px solid var(--line)',
    borderRadius: '8px',
    display: 'none',
    flexDirection: 'column',
    gap: '6px',
    whiteSpace: 'nowrap',
  } satisfies Partial<CSSStyleDeclaration>);
  portWrap.appendChild(panel);
  let panelOpen = false;
  portBtn.addEventListener('click', () => {
    panelOpen = !panelOpen;
    panel.style.display = panelOpen ? 'flex' : 'none';
    portBtn.classList.toggle('on', panelOpen);
    portBtn.blur();
  });

  const renderPorts = () => {
    const ports = midi.available ? midi.ports() : [];
    const sel = ports.filter((p) => p.selected);
    portBtn.textContent = !midi.available
      ? 'MIDI: unavailable'
      : sel.length === 0
        ? 'MIDI: none ▾'
        : sel.length === 1
          ? `MIDI: ${sel[0].name} ▾`
          : `MIDI: ${sel.length} ports ▾`;
    panel.textContent = '';
    if (!midi.available) {
      panel.appendChild(noteLine('Web MIDI is unavailable. QWERTY still plays notes.'));
      return;
    }
    if (ports.length === 0) {
      panel.appendChild(noteLine('No MIDI inputs found. Plug in the keyboard over USB.'));
      return;
    }
    panel.appendChild(noteLine('Listen to (pick the keyboard port, not the DAW port):'));
    for (const p of ports) {
      const row = document.createElement('label');
      Object.assign(row.style, { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' });
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = p.selected;
      cb.tabIndex = -1;
      cb.addEventListener('change', () => {
        const ids = midi
          .ports()
          .filter((q) => (q.id === p.id ? cb.checked : q.selected))
          .map((q) => q.id);
        midi.select(ids);
        cb.blur();
        renderPorts();
      });
      const text = document.createElement('span');
      text.textContent =
        p.name + (p.manufacturer ? ` (${p.manufacturer})` : '') + (p.state === 'disconnected' ? ' (disconnected)' : '');
      if (p.state === 'disconnected') text.style.opacity = '0.5';
      row.append(cb, text);
      panel.appendChild(row);
    }
  };
  if (midi.available) midi.onPortsChanged(renderPorts);
  renderPorts();

  // --- transport, modes, bench --------------------------------------------
  const demoBtn = button('▶ Demo', 'Loop the built-in jazz demo', () => {
    if (replay.playing) replay.stop();
    else replay.playDemo();
    syncDemo();
  });
  const syncDemo = () => {
    demoBtn.textContent = replay.playing ? '■ Stop demo' : '▶ Demo';
    demoBtn.classList.toggle('on', replay.playing);
  };

  const movesBtn = button("Moves", "Today's moves: what you've played, in which keys, and what's left to try (M)", () => toggleMoves());
  const toggleMoves = () => movesBtn.classList.toggle('on', deps.toggleMoves());
  const riverBtn = button('River', 'Show the River piano roll beside the compass (V)', () => toggleView());
  const toggleView = () => {
    deps.setView(deps.getView() === 'river' ? 'compass' : 'river');
    riverBtn.classList.toggle('on', deps.getView() === 'river');
  };
  riverBtn.classList.toggle('on', deps.getView() === 'river');

  // --- compass layers ----------------------------------------------------
  const layerWrap = document.createElement('span');
  layerWrap.style.position = 'relative';
  el.appendChild(layerWrap);
  const layerBtn = document.createElement('button');
  layerBtn.type = 'button';
  layerBtn.tabIndex = -1;
  layerBtn.textContent = 'Layers ▾';
  layerBtn.title = 'Turn parts of the compass on and off';
  layerBtn.addEventListener('mousedown', (e) => e.preventDefault());
  layerWrap.appendChild(layerBtn);
  const layerPanel = document.createElement('div');
  Object.assign(layerPanel.style, {
    position: 'absolute',
    bottom: 'calc(100% + 6px)',
    left: '0',
    minWidth: '200px',
    padding: '8px 10px',
    background: 'rgba(11,12,16,0.94)',
    border: '1px solid var(--line)',
    borderRadius: '8px',
    display: 'none',
    flexDirection: 'column',
    gap: '6px',
    whiteSpace: 'nowrap',
  } satisfies Partial<CSSStyleDeclaration>);
  layerWrap.appendChild(layerPanel);
  for (const l of LAYERS) {
    const row = document.createElement('label');
    Object.assign(row.style, { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' });
    row.title = l.title;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = deps.getLayers()[l.id];
    cb.tabIndex = -1;
    cb.addEventListener('change', () => {
      deps.setLayer(l.id, cb.checked);
      cb.blur();
    });
    const text = document.createElement('span');
    text.textContent = l.label;
    row.append(cb, text);
    layerPanel.appendChild(row);
  }
  let layersOpen = false;
  layerBtn.addEventListener('click', () => {
    layersOpen = !layersOpen;
    layerPanel.style.display = layersOpen ? 'flex' : 'none';
    layerBtn.classList.toggle('on', layersOpen);
    layerBtn.blur();
  });

  const modeBtns = new Map<VisualMode, HTMLButtonElement>();
  const setMode = (m: VisualMode) => {
    deps.setMode(m);
    probe.setTag(m);
    for (const [k, b] of modeBtns) b.classList.toggle('on', k === m);
  };
  MODES.forEach((m, i) => {
    modeBtns.set(m.mode, button(m.label, `${m.label} mode (key ${i + 1})`, () => setMode(m.mode)));
  });
  setMode(deps.getMode());

  button('Save recording', 'Save this take as .mid + .jsonl and start a new one', async () => {
    try {
      const path = await recorder.save();
      say(path ? `Saved ${basename(path)}` : 'Nothing to save yet', path);
    } catch (err) {
      say(`Save failed: ${String(err)}`);
    }
  });
  button('Save bench report', 'Save latency + frame stats as JSON + CSV', async () => {
    try {
      const path = await probe.save(stats, {
        mode: deps.getMode(),
        midiStatus: midi.available ? midi.status() : 'unavailable',
        midiPorts: midi.available ? midi.ports().filter((p) => p.selected).map((p) => p.name) : [],
        bluetooth: midi.available ? midi.bluetoothWarning() : false,
      });
      say(path ? `Saved ${basename(path)}` : 'Could not save report', path);
    } catch (err) {
      say(`Save failed: ${String(err)}`);
    }
  });
  button('Reset stats', 'Clear frame and latency samples', () => {
    stats.reset();
    probe.reset();
    say('Stats reset');
  });
  button('Panic', 'All notes off (Esc)', () => deps.panic());
  button('Fullscreen', 'Toggle fullscreen (Cmd/Ctrl+F)', toggleFullscreen);

  const hint = document.createElement('span');
  hint.className = 'note';
  hint.textContent = 'QWERTY plays notes · Space = pedal · Tab = HUD · M = moves · V = River · 1/2/3 = modes · Esc = panic · ⌘F = fullscreen';
  el.append(hint, status);

  // --- keyboard ------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') {
      e.preventDefault();
      if (!e.repeat) deps.toggleHud();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyF') {
      e.preventDefault();
      if (!e.repeat) toggleFullscreen();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.code === 'Escape') {
      deps.panic();
      return;
    }
    if (e.code === 'KeyV') {
      toggleView();
      return;
    }
    if (e.code === 'KeyM') {
      toggleMoves();
      return;
    }
    const m = MODES.find((x) => x.key === e.code);
    if (m) setMode(m.mode);
  });

  // --- idle fade -----------------------------------------------------------
  let idleTimer = 0;
  let hovering = false;
  const wake = () => {
    el.classList.remove('idle');
    document.body.style.cursor = '';
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (hovering || panelOpen || layersOpen) return;
      el.classList.add('idle');
      document.body.style.cursor = 'none';
    }, IDLE_MS);
    syncDemo();
  };
  el.addEventListener('mouseenter', () => (hovering = true));
  el.addEventListener('mouseleave', () => {
    hovering = false;
    wake();
  });
  window.addEventListener('mousemove', wake, { passive: true });
  wake();
}

function toggleFullscreen(): void {
  if (window.app?.toggleFullscreen) {
    void window.app.toggleFullscreen();
    return;
  }
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.();
}

function noteLine(text: string): HTMLElement {
  const s = document.createElement('span');
  s.className = 'note';
  s.textContent = text;
  return s;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}
