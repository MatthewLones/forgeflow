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
      rollupOptions: {
        // Externalize native addons that cause NODE_MODULE_VERSION mismatches.
        // ssh2/cpu-features come from dockerode (Docker sandbox) — not needed at startup.
        external: ['ssh2', 'cpu-features', 'dockerode', 'docker-modem'],
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
