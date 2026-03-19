# @forgeflow/parser

## Purpose
Owns Zod-based runtime validation of FLOW.json files. Does NOT own type definitions (those live in `@forgeflow/types`) or semantic validation (that lives in `@forgeflow/validator`).

## Entry Points
- `parseFlowFile(path)` -- reads a FLOW.json from disk and validates it; returns `ParseResult`
- `parseFlowJSON(jsonString)` -- parses a JSON string and validates; returns `ParseResult`
- `parseFlowObject(obj)` -- validates an already-parsed JS object; returns `ParseResult`

## Contracts & Invariants
- Zod schemas mirror the TypeScript types in `@forgeflow/types` exactly. If a field is added/changed in types, the corresponding Zod schema in `schema.ts` MUST be updated to match, and vice versa.
- `ParseResult.flow` is typed as `FlowDefinition | null`. It is `null` if and only if `success === false`. Callers must null-check or assert after checking `success`.
- All Zod validation errors are mapped to `FlowDiagnostic` objects with `code: 'SCHEMA_ERROR'` and `severity: 'error'`. The `location.field` is the dot-joined Zod issue path (e.g., `"nodes.0.config.inputs"`).
- File read failures produce `code: 'FILE_NOT_FOUND'`; malformed JSON produces `code: 'INVALID_JSON'`. These are distinct from schema errors.
- Node IDs and flow IDs are validated against `^[a-z][a-z0-9_]*$` at this layer. The validator does not re-check the regex.
- `flowDefinitionSchema` requires at least one node (`z.array().min(1)`). An empty `nodes` array is a parse error.
- `FlowNode.children` uses `z.lazy()` for recursive self-reference. The type annotation on `flowNodeSchema` is `z.ZodType<unknown>` because Zod cannot infer recursive types -- the actual runtime shape is still fully validated.

## Anti-Patterns
- Do NOT add semantic validation here (cycle detection, dependency resolution, output uniqueness). That belongs in `@forgeflow/validator` which operates on `FlowGraph`.
- Do NOT define canonical TypeScript types in this package. Zod schemas exist purely for runtime validation; the source-of-truth types are in `@forgeflow/types`.
- Do NOT use `z.infer<>` to derive types from the Zod schemas. The canonical types come from `@forgeflow/types` and the parser casts `result.data as FlowDefinition`.
- Do NOT forget to handle the `ArtifactRef` union (`string | ArtifactSchema`) when modifying artifact-related schemas. Both forms must remain valid.

## Dependencies
- Consumes: `@forgeflow/types` (for `FlowDefinition`, `FlowDiagnostic` type imports)
- Consumed by: `@forgeflow/validator`, `@forgeflow/engine`, `@forgeflow/cli`, `@forgeflow/server`

## Patterns
- Three-tier entry: `parseFlowFile` -> `parseFlowJSON` -> `parseFlowObject`. Each lower tier is independently callable. The server uses `parseFlowObject` directly since it already has parsed JSON.
- The `flowNodeSchema` is defined as a `z.lazy()` wrapper to support recursive `children` arrays. This is the only place in the codebase where Zod lazy evaluation is used.
- `artifactRefSchema` is a `z.union([z.string(), artifactSchemaSchema])` matching the `ArtifactRef` type. This means inputs/outputs accept both `"filename.json"` and `{ name, format, description, fields? }`.
- `flowDefinitionSchema` is exported from `schema.ts` for direct use by any code that needs raw Zod validation without the `ParseResult` wrapper (currently unused externally but available).
