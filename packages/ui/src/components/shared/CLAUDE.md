# Shared Components

## Purpose
Cross-cutting UI components used by both the workspace IDE and the run dashboard. Owns interrupt form rendering, schema-driven forms, artifact viewing, checkpoint handling, and CodeMirror block widget decorations. Does NOT own any page-level layout or context providers.

## Entry Points
- `InterruptFormRouter` — dispatches to the correct interrupt form by `interrupt.type`, handles submission state and error display
- `SchemaForm` — renders labeled form inputs from `ArtifactSchema.fields` definitions; all values stored as strings
- `ArtifactViewer` — format-aware content renderer (JSON as structured tables, markdown as HTML, CSV as tables, PDF via react-pdf, images inline, binary as download)
- `CheckpointPanel` — checkpoint resume UI with presented files (review) and expected files (provide), supports form/textarea/upload modes
- `block-widgets/` — CodeMirror decorations for `forgeflow:input` fenced code blocks in skill editors

## Contracts & Invariants
- All 5 interrupt forms (`ApprovalForm`, `QAForm`, `SelectionForm`, `ReviewForm`, `EscalationForm`) take the same prop shape: `{ interrupt: T, onSubmit: (answer: A) => void, disabled: boolean }`. Never deviate from this contract.
- `InterruptFormRouter` owns the `submitting` state and wraps `onSubmit` with try/catch error handling. Individual forms must NOT manage their own submission state.
- `SchemaForm` stores all values as strings. Use `formValuesToJson()` to serialize to typed JSON and `isFormComplete()` to check required fields. These helpers are exported alongside the component.
- `ArtifactViewer` infers format from file extension when no explicit `format` prop is given. The inference order: json, markdown, csv, pdf, image extensions, then falls back to `text`.
- `CheckpointPanel` determines input mode per file via `pickMode()`: JSON with fields = form mode, JSON/text/markdown = textarea mode, everything else = upload mode. Users can toggle between form and raw JSON modes.
- Shared CSS class constants for interrupt forms live in `interrupt-forms/styles.ts` (`btnPrimary`, `btnSecondary`, `inputClass`). All interrupt forms must use these for visual consistency.

## Anti-Patterns
- Do NOT add interrupt-type-specific logic to `InterruptFormRouter` — each form handles its own UI. The router only dispatches and manages submission lifecycle.
- Do NOT render markdown with `dangerouslySetInnerHTML` outside of `ArtifactViewer` or the dedicated `MarkdownInline` component — use the existing primitives.
- Do NOT create new form field types in `SchemaForm` without also updating `formValuesToJson()` serialization — the two must stay in sync.
- Do NOT add new `forgeflow:*` block types without registering them in `block-decoration.ts`'s `BLOCK_TYPES` set — unregistered types are silently ignored.

## Dependencies
- Consumes: `@forgeflow/types` (Interrupt, InterruptAnswer, ArtifactSchema, CheckpointState types)
- Consumes: `RunContext` (CheckpointPanel uses `resumeFromCheckpoint`), `api-client` (file fetching, validation)
- Consumes: `marked` (markdown rendering), `react-pdf` (PDF viewing), `@codemirror/view` + `@codemirror/state` (block widgets)
- Consumed by: `workspace/RunPanel`, `workspace/InterruptBanner`, `run-dashboard/RunSummary`, `pages/InterruptPage`, `pages/RunDashboardPage`

## Patterns
- Interrupt attachments: `InterruptFormRouter` renders file attachments above the form when `interrupt.attachments` is present. Content is fetched lazily; first attachment auto-expands.
- `SelectionForm` enforces `minSelect`/`maxSelect` constraints and pre-selects `recommended` items by default.
- `MULTILINE_KEYS` regex in SchemaForm: fields named feedback, notes, comments, description, etc. automatically render as textareas instead of single-line inputs.
- Block widget portal pattern: `WidgetPortal` creates a React portal inside a CodeMirror widget decoration, bridging the CM imperative API to React rendering.
