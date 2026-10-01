import { contextBridge, ipcRenderer } from 'electron';

const api = {
  /** Writes to ~/Documents/MIDI Visualizer/<sub>/<name>; resolves to the full path. */
  saveFile: (sub: string, name: string, data: string | Uint8Array): Promise<string> =>
    ipcRenderer.invoke('save-file', sub, name, data),
  reveal: (path: string): Promise<void> => ipcRenderer.invoke('reveal', path),
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke('toggle-fullscreen'),
};

contextBridge.exposeInMainWorld('app', api);
export type AppApi = typeof api;
