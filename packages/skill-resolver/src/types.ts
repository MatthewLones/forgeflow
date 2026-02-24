import type { SkillManifest } from '@forgeflow/types';

/** A fully resolved skill loaded from disk */
export interface ResolvedSkill {
  /** Skill name (directory name) */
  name: string;
  /** Full SKILL.md content */
  skillMdContent: string;
  /** Parsed YAML frontmatter from SKILL.md */
  manifest: SkillManifest;
  /** Reference files: filename → content */
  references: Map<string, Buffer>;
  /** Script files: filename → content */
  scripts: Map<string, Buffer>;
}

/** Options for skill resolution */
export interface ResolveOptions {
  /** Ordered search paths for skill directories */
  searchPaths: string[];
}
