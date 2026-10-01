/// <reference types="vite/client" />
import type { AppApi } from '../preload/index';

declare global {
  interface Window {
    /** Undefined when running in a plain browser (vite dev without Electron). */
    app?: AppApi;
  }
}
export {};
