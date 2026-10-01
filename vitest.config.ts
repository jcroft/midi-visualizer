import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@theory': resolve(__dirname, 'packages/theory/src'),
    },
  },
  test: { include: ['packages/**/*.test.ts', 'src/**/*.test.ts'] },
});
