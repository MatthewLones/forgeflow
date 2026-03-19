# Skill Resolver

## Purpose
Loads skill directories from disk into `ResolvedSkill` objects and optionally copies them into a workspace. Does NOT own skill editing, creation, or server-side CRUD (that lives in server's ProjectStore). Does NOT own skill validation rules (those are in the validator).

## Entry Points
- `resolveSkill(name, searchPaths)` — resolve a single skill; throws if not found
- `resolveSkills(names, searchPaths)` — resolve multiple skills with deduplication; throws on first missing
- `copySkillsToWorkspace(skills, targetDir)` — write resolved skills to a target directory for sandbox use
- `parseSkillManifest(content)` — parse YAML frontmatter from SKILL.md into `SkillManifest` + body

## Contracts & Invariants
- **First match wins.** Search paths are tried in order; the first directory containing `{skillName}/SKILL.md` is used. Later paths are never checked once a match is found. This is critical for allowing project-local skills to shadow global ones.
- **A valid skill directory MUST contain SKILL.md.** A directory matching the skill name but lacking SKILL.md is treated as not found and skipped.
- **SKILL.md MUST have YAML frontmatter** delimited by `---` lines at the start. Frontmatter MUST contain `name` and `description` fields. Missing or malformed frontmatter throws immediately.
- **`references/` and `scripts/` subdirectories are optional.** Missing subdirectories produce empty Maps, never errors.
- **`resolveSkills` deduplicates** — duplicate skill names in the input array are collapsed before resolution.
- **`resolveSkills` is fail-fast** — it throws on the first skill that cannot be found, not after trying all.
- **Skills are NOT children.** Skills are reusable domain knowledge (SKILL.md + references + scripts). Children are inline sub-agent work units defined in the FlowGraph.

## Anti-Patterns
- Do NOT: assume `manifest.name` matches the directory name — they should match by convention but the resolver keys on directory name, not manifest name
- Do NOT: add nested directory support to `loadSubdirectory` — it intentionally reads only top-level files in `references/` and `scripts/`
- Do NOT: make `resolveSkills` parallel — sequential resolution is intentional so the first missing skill fails fast with a clear error

## Dependencies
- Consumes: `@forgeflow/types` (SkillManifest), `yaml` (YAML parsing)
- Consumed by: `@forgeflow/engine` (orchestrator workspace setup via `copySkillsToWorkspace`)

## Patterns
- **Skill directory structure:** `{name}/SKILL.md`, `{name}/references/*`, `{name}/scripts/*`
- **Frontmatter parsing** uses the `yaml` package, not a regex-based parser. The `law_as_of` YAML key maps to `manifest.lawAsOf` (snake_case to camelCase).
- **`copySkillsToWorkspace` recreates the full skill directory tree** — it writes SKILL.md, references/, and scripts/ but only creates subdirectories when they have content. A minimal skill copy contains only SKILL.md.
- **Buffer-based content** — references and scripts are stored as `Map<string, Buffer>`, not strings. Binary files (images, PDFs) in references/ are preserved as-is.
