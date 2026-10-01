import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Personal-use spike: one full-window canvas, MIDI allowed, never throttled.
app.commandLine.appendSwitch('enable-features', 'Vulkan,WebGPU');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const outDir = () => join(app.getPath('documents'), 'MIDI Visualizer');

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#0B0C10',
    title: 'MIDI Visualizer',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      backgroundThrottling: false,
      sandbox: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  const allowed = new Set(['midi', 'midiSysex']);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));

  ipcMain.handle('save-file', async (_e, sub: string, name: string, data: string | Uint8Array) => {
    const dir = join(outDir(), sub.replace(/[^\w-]/g, ''));
    await mkdir(dir, { recursive: true });
    const path = join(dir, name.replace(/[/\\]/g, '_'));
    await writeFile(path, data);
    return path;
  });
  ipcMain.handle('reveal', (_e, path: string) => shell.showItemInFolder(path));
  ipcMain.handle('toggle-fullscreen', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.setFullScreen(!w.isFullScreen());
  });

  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => app.quit());
