import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [
      // Externalize electron + node builtins, but bundle @forgeflow/* workspace deps
      externalizeDepsPlugin({ exclude: ['@forgeflow/server'] }),
    ],
    build: {
      outDir: 'dist/main',
      lib: {
        entry: resolve(__dirname, 'src/main.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      lib: {
        entry: resolve(__dirname, 'src/preload.ts'),
        formats: ['es'],
      },
    },
  },
  renderer: {},
});
