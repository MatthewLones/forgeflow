/** Parsed YAML frontmatter from SKILL.md */
export interface SkillManifest {
  name: string;
  description: string;
  version?: string;
  source?: string;
  authority?: string;
  lawAsOf?: string;
}

/** A reference to a skill used in a flow or node config */
export interface SkillReference {
  name: string;
  path?: string;
}
