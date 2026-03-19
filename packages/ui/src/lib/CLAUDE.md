# UI Library Functions

## Purpose
Owns pure utility functions, data transforms, and the typed API client. Does NOT own React state or components -- everything here is importable without React context.

## Entry Points
- `api` (api-client.ts) -- the sole gateway to the server; typed fetch wrapper with `get`, `post`, `put`, `patch`, `del`, `postFormData` helpers
- `autoLayout()` / `flowToReactFlow()` (flow-to-reactflow.ts) -- ELK.js async auto-layout and FlowDefinition-to-ReactFlow conversion
- `parseInstructions()` (parse-instructions.ts) -- extracts `/skill:`, `//agent:`, `/interrupt:`, `/merge` chips from instruction text
- `extractConfigFromInstructions()` (sync-blocks-to-config.ts) -- derives node config (inputs/outputs/skills/interrupts) from instruction text with `@artifact` and `\artifact` patterns
- `initTooltip()` (tooltip.ts) -- global tooltip system for `[data-tooltip]` attributes, called once at startup

## Contracts & Invariants
- `api-client.ts` uses `API_BASE` from `VITE_API_URL` env var, defaulting to `http://localhost:3001/api`. All API paths are relative to this base.
- `ApiError` includes the HTTP status code -- consumers can check `err.status` for 404/409/etc handling
- `api.runs.streamProgress()` and `api.copilot.streamProgress()` return raw `EventSource` objects -- the caller (RunContext/CopilotContext) owns the lifecycle
- `autoLayout()` is async (ELK uses WASM worker). Falls back to a simple grid if ELK fails. Always returns positions for all input nodes.
- `flow-to-reactflow.ts` functions are pure transforms: `FlowNode[]` -> `ReactFlow Node[]`, `FlowEdge[]` -> `ReactFlow Edge[]`. Node dimensions are hardcoded at `240x80`.
- `parseSkillBlocks()` only recognizes block types in the `BLOCK_TYPES` set (`'output'`, `'input'`) -- adding a new block type requires updating this set
- `compileSkillContent()` replaces `forgeflow:*` fenced blocks with their markdown equivalents (e.g., input tables). Invalid JSON blocks are left as-is.
- `detectConvertibleSections()` skips content that already contains `forgeflow:` blocks to avoid double-conversion
- `keyboard-shortcuts.ts` is platform-aware (`isMac`): Cmd on Mac, Ctrl on Windows. Remaps persist in localStorage under `forgeflow:shortcut-remaps`.
- `isElectron()` checks `window.forgeflow?.isElectron` -- the Electron preload script sets this

## Anti-Patterns
- Do NOT use raw `fetch()` to call the server -- always go through `api.*` for consistent error handling and base URL resolution
- Do NOT add React hooks or state to lib files -- they must remain importable without React context
- Do NOT hardcode `localhost:3001` in lib files -- use `API_BASE` from api-client.ts
- Do NOT call `autoLayout()` synchronously or assume it resolves instantly -- it is async and may take noticeable time for large graphs

## Dependencies
- Consumes: `@forgeflow/types` (type imports), `elkjs` (layout engine), `react-pdf` (worker setup)
- Consumed by: context providers, pages, and components throughout the UI

## Patterns
- **Chip extraction pipeline**: instruction text flows through `parseInstructions()` -> `extractConfigFromInstructions()` -> FlowReducer dispatch. The `@name` pattern means "input artifact", `\name` means "output artifact", `/skill:name` means "skill reference", `/interrupt:type` means "interrupt declaration".
- **Folder expansion**: `extractConfigFromInstructions` expands folder references (e.g., `@reports`) to all individual artifacts under that folder in the artifact registry.
- **Skill block lifecycle**: `parseSkillBlocks()` extracts structured blocks from markdown -> `compileSkillContent()` renders them to plain markdown for preview -> `extractSkillOutputs()` pulls artifact schemas from output blocks for config inheritance.
- **Tooltip system**: uses global `mouseover`/`mousemove`/`mouseout` event delegation on `document`. Any element with `data-tooltip` or `data-tooltip-html` attributes gets a tooltip. No React component needed.
