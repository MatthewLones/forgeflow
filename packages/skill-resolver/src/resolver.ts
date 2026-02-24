import { readFile, readdir, mkdir, writeFile, access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSkillManifest } from './manifest.js';
import type { ResolvedSkill } from './types.js';

/**
 * Find a skill directory across search paths.
 * Returns the first matching path, or null if not found.
 */
async function findSkillDir(
  skillName: string,
  searchPaths: string[],
): Promise<string | null> {
  for (const searchPath of searchPaths) {
    const candidate = join(searchPath, skillName);
    try {
      const s = await stat(candidate);
      if (s.isDirectory()) {
        // Verify SKILL.md exists
        await access(join(candidate, 'SKILL.md'));
        return candidate;
      }
    } catch {
      // Not found at this path, continue
    }
  }
  return null;
}

/**
 * Load all files from a subdirectory of a skill.
 * Returns a Map of filename → content (Buffer).
 */
async function loadSubdirectory(
  skillDir: string,
  subdir: string,
): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const dirPath = join(skillDir, subdir);

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    // Directory doesn't exist — that's fine
    return files;
  }

  for (const entry of entries) {
    const filePath = join(dirPath, entry);
    try {
      const s = await stat(filePath);
      if (s.isFile()) {
        const content = await readFile(filePath);
        files.set(entry, content);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return files;
}

/**
 * Resolve a single skill by name from the given search paths.
 * Throws if the skill is not found.
 */
export async function resolveSkill(
  skillName: string,
  searchPaths: string[],
): Promise<ResolvedSkill> {
  const skillDir = await findSkillDir(skillName, searchPaths);

  if (!skillDir) {
    throw new Error(
      `Skill "${skillName}" not found in search paths: ${searchPaths.join(', ')}`,
    );
  }

  // Read SKILL.md
  const skillMdContent = await readFile(join(skillDir, 'SKILL.md'), 'utf-8');

  // Parse frontmatter
  const { manifest } = parseSkillManifest(skillMdContent);

  // Load references and scripts
  const references = await loadSubdirectory(skillDir, 'references');
  const scripts = await loadSubdirectory(skillDir, 'scripts');

  return {
    name: skillName,
    skillMdContent,
    manifest,
    references,
    scripts,
  };
}

/**
 * Resolve multiple skills by name, deduplicating.
 * Throws on the first skill that is not found.
 */
export async function resolveSkills(
  skillNames: string[],
  searchPaths: string[],
): Promise<ResolvedSkill[]> {
  const unique = [...new Set(skillNames)];
  const results: ResolvedSkill[] = [];

  for (const name of unique) {
    results.push(await resolveSkill(name, searchPaths));
  }

  return results;
}

/**
 * Copy resolved skills into a workspace skills/ directory.
 * Creates the directory structure:
 *   targetDir/{skillName}/SKILL.md
 *   targetDir/{skillName}/references/*
 *   targetDir/{skillName}/scripts/*
 */
export async function copySkillsToWorkspace(
  skills: ResolvedSkill[],
  targetDir: string,
): Promise<void> {
  await mkdir(targetDir, { recursive: true });

  for (const skill of skills) {
    const skillDir = join(targetDir, skill.name);
    await mkdir(skillDir, { recursive: true });

    // Write SKILL.md
    await writeFile(join(skillDir, 'SKILL.md'), skill.skillMdContent);

    // Write references
    if (skill.references.size > 0) {
      const refsDir = join(skillDir, 'references');
      await mkdir(refsDir, { recursive: true });
      for (const [name, content] of skill.references) {
        await writeFile(join(refsDir, name), content);
      }
    }

    // Write scripts
    if (skill.scripts.size > 0) {
      const scriptsDir = join(skillDir, 'scripts');
      await mkdir(scriptsDir, { recursive: true });
      for (const [name, content] of skill.scripts) {
        await writeFile(join(scriptsDir, name), content);
      }
    }
  }
}
