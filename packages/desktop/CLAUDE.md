# Desktop (Electron Wrapper)

## Purpose
Electron 35 shell that embeds `@forgeflow/server` in-process and loads `@forgeflow/ui` as the renderer. Owns native OS integration (file dialogs, `.forge` file association, window chrome). Does NOT own any business logic, API routes, or UI components.

## Entry Points
- `src/main.ts` — Main process: starts embedded Express server via `startServer()`, creates BrowserWindow, registers IPC handlers, handles `.forge` file open events
- `src/preload.ts` — Preload script: exposes `window.forgeflow` API to renderer via `contextBridge`. The UI detects Electron by checking `window.forgeflow?.isElectron`
- `src/renderer/index.html` — Placeholder HTML to satisfy electron-vite; real renderer is `@forgeflow/ui`

## Contracts & Invariants
- The preload script MUST expose `window.forgeflow` with shape matching `ForgeFlowElectronAPI` defined in `packages/ui/src/lib/electron.ts`. The UI relies on `window.forgeflow?.isElectron` as the sole detection mechanism.
- `contextIsolation: true` and `nodeIntegration: false` are required. All renderer-to-main communication goes through IPC handlers, never direct Node access.
- `sandbox: false` on webPreferences is intentional — the preload script needs Node APIs for `ipcRenderer`.
- The server MUST start before `createWindow()` since the UI immediately makes API calls to `localhost:3001` on load.
- Production builds load UI from `process.resourcesPath/ui/index.html` (electron-builder `extraResources` copies `../ui/dist` to `ui/`). The UI must be built before packaging.
- `.forge` file opens arrive differently per OS: macOS via `app.on('open-file')`, Windows/Linux via `process.argv`. Both funnel into `forge:open-file` IPC event to renderer.
- Queued `.forge` file path (`pendingForgeFile`) is sent only after `did-finish-load` to avoid race conditions with renderer initialization.

## Anti-Patterns
- Do NOT statically import `dockerode`, `ssh2`, `cpu-features`, or `docker-modem` — they contain native addons compiled against a different `NODE_MODULE_VERSION` than Electron's Node. These are externalized in `electron-vite.config.ts` via `rollupOptions.external`. The server lazy-imports `DockerAgentRunner` to avoid loading them at startup.
- Do NOT enable `nodeIntegration` — it breaks context isolation and exposes full Node to the renderer.
- Do NOT bundle `@forgeflow/server` as external — `externalizeDepsPlugin` explicitly excludes it so it gets bundled into the main process. Only `electron` and Node builtins are externalized.
- Do NOT add IPC handlers without corresponding entries in the preload bridge — unmatched channels are silently ignored and impossible to debug.

## Dependencies
- Consumes: `@forgeflow/server` (embedded, bundled into main process), `@forgeflow/ui` (loaded as static files in production via `extraResources`)
- Consumed by: nothing (top-level application)

## Patterns
- **Dev vs Prod loading:** Dev mode loads `http://localhost:5173` (Vite dev server for UI hot reload) and opens DevTools. Production loads from `extraResources/ui/index.html`.
- **macOS title bar:** Uses `hiddenInset` title bar style with custom traffic light positioning (`{ x: 12, y: 12 }`) for a frameless look.
- **IPC channel naming:** `namespace:action` convention — `dialog:openFile`, `fs:readFile`, `app:isPackaged`, `forge:open-file`.
- **Icon generation:** `scripts/generate-icons.py` (Pillow) renders the `.forge` file type icon at all platform sizes. Run `iconutil -c icns` on the output iconset for macOS `.icns`.
- **Build commands:** `pnpm build` compiles main+preload via electron-vite. `pnpm dist:mac` / `dist:win` / `dist:linux` produces distributable installers via electron-builder.
- **Port configuration:** Default `3001`, overridable via `FORGEFLOW_PORT` env var. Dev UI URL overridable via `FORGEFLOW_UI_URL`.
