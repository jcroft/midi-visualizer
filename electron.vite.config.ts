import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@theory': resolve(__dirname, 'packages/theory/src'),
};

export default defineConfig({
  main: { resolve: { alias }, build: { outDir: 'out/main' } },
  preload: { resolve: { alias }, build: { outDir: 'out/preload' } },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    build: { outDir: 'out/renderer', target: 'esnext' },
    worker: { format: 'es' },
  },
});
