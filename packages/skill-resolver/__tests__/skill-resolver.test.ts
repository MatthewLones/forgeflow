import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  resolveSkill,
  resolveSkills,
  copySkillsToWorkspace,
  parseSkillManifest,
} from '../src/index.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const PRIMARY_PATH = FIXTURES;
const ALT_PATH = join(FIXTURES, 'alt-path');

// --- parseSkillManifest ---

describe('parseSkillManifest', () => {
  it('parses valid frontmatter', () => {
    const content = `---
name: my-skill
description: A test skill
version: "1.0.0"
source: tests
authority: Test Suite
law_as_of: "2025-01-01"
---

# Body content here`;

    const { manifest, body } = parseSkillManifest(content);

    expect(manifest.name).toBe('my-skill');
    expect(manifest.description).toBe('A test skill');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.source).toBe('tests');
    expect(manifest.authority).toBe('Test Suite');
    expect(manifest.lawAsOf).toBe('2025-01-01');
    expect(body).toBe('# Body content here');
  });

  it('handles minimal frontmatter (name + description only)', () => {
    const content = `---
name: minimal
description: Just the basics
---

Some body.`;

    const { manifest } = parseSkillManifest(content);

    expect(manifest.name).toBe('minimal');
    expect(manifest.description).toBe('Just the basics');
    expect(manifest.version).toBeUndefined();
    expect(manifest.source).toBeUndefined();
  });

  it('throws on missing frontmatter', () => {
    expect(() => parseSkillManifest('# No frontmatter')).toThrow(
      'missing YAML frontmatter',
    );
  });

  it('throws on unterminated frontmatter', () => {
    expect(() => parseSkillManifest('---\nname: broken\n')).toThrow(
      'unterminated frontmatter',
    );
  });

  it('throws on missing name field', () => {
    const content = `---
description: No name
---
Body`;

    expect(() => parseSkillManifest(content)).toThrow('missing required "name"');
  });

  it('throws on missing description field', () => {
    const content = `---
name: no-desc
---
Body`;

    expect(() => parseSkillManifest(content)).toThrow('missing required "description"');
  });
});

// --- resolveSkill ---

describe('resolveSkill', () => {
  it('resolves a skill with references and scripts', async () => {
    const skill = await resolveSkill('test-skill', [PRIMARY_PATH]);

    expect(skill.name).toBe('test-skill');
    expect(skill.manifest.name).toBe('test-skill');
    expect(skill.manifest.description).toBe('A test skill for unit testing');
    expect(skill.manifest.version).toBe('1.0.0');
    expect(skill.skillMdContent).toContain('# Test Skill');

    // References
    expect(skill.references.size).toBe(2);
    expect(skill.references.has('parsing.md')).toBe(true);
    expect(skill.references.has('validation.md')).toBe(true);
    expect(skill.references.get('parsing.md')!.toString()).toContain('Parsing Reference');

    // Scripts
    expect(skill.scripts.size).toBe(1);
    expect(skill.scripts.has('extract.py')).toBe(true);
    expect(skill.scripts.get('extract.py')!.toString()).toContain('def extract');
  });

  it('resolves a minimal skill (no references or scripts)', async () => {
    const skill = await resolveSkill('minimal-skill', [PRIMARY_PATH]);

    expect(skill.name).toBe('minimal-skill');
    expect(skill.manifest.name).toBe('minimal-skill');
    expect(skill.references.size).toBe(0);
    expect(skill.scripts.size).toBe(0);
  });

  it('throws on missing skill', async () => {
    await expect(resolveSkill('nonexistent', [PRIMARY_PATH])).rejects.toThrow(
      'not found in search paths',
    );
  });

  it('throws on skill without SKILL.md', async () => {
    // The 'alt-path' directory exists but is not a skill itself
    await expect(resolveSkill('alt-path', [PRIMARY_PATH])).rejects.toThrow(
      'not found in search paths',
    );
  });

  it('uses first matching search path', async () => {
    // PRIMARY_PATH has test-skill v1.0.0, ALT_PATH has v2.0.0
    const skill = await resolveSkill('test-skill', [PRIMARY_PATH, ALT_PATH]);
    expect(skill.manifest.version).toBe('1.0.0');
  });

  it('falls back to later search paths', async () => {
    // ALT_PATH has test-skill, FIXTURES/nonexistent doesn't exist
    const skill = await resolveSkill('test-skill', ['/nonexistent/path', ALT_PATH]);
    expect(skill.manifest.version).toBe('2.0.0');
    expect(skill.references.size).toBe(1);
    expect(skill.references.has('alt-ref.md')).toBe(true);
  });
});

// --- resolveSkills ---

describe('resolveSkills', () => {
  it('resolves multiple skills', async () => {
    const skills = await resolveSkills(['test-skill', 'minimal-skill'], [PRIMARY_PATH]);

    expect(skills).toHaveLength(2);
    expect(skills[0].name).toBe('test-skill');
    expect(skills[1].name).toBe('minimal-skill');
  });

  it('deduplicates skill names', async () => {
    const skills = await resolveSkills(
      ['test-skill', 'minimal-skill', 'test-skill'],
      [PRIMARY_PATH],
    );

    expect(skills).toHaveLength(2);
  });

  it('returns empty array for empty input', async () => {
    const skills = await resolveSkills([], [PRIMARY_PATH]);
    expect(skills).toHaveLength(0);
  });

  it('throws on first missing skill', async () => {
    await expect(
      resolveSkills(['test-skill', 'nonexistent'], [PRIMARY_PATH]),
    ).rejects.toThrow('nonexistent');
  });
});

// --- copySkillsToWorkspace ---

describe('copySkillsToWorkspace', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `forgeflow-test-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('copies a full skill to the workspace', async () => {
    const skill = await resolveSkill('test-skill', [PRIMARY_PATH]);
    await copySkillsToWorkspace([skill], tempDir);

    // Verify SKILL.md
    const skillMd = await readFile(join(tempDir, 'test-skill', 'SKILL.md'), 'utf-8');
    expect(skillMd).toContain('# Test Skill');

    // Verify references
    const refs = await readdir(join(tempDir, 'test-skill', 'references'));
    expect(refs.sort()).toEqual(['parsing.md', 'validation.md']);

    // Verify scripts
    const scripts = await readdir(join(tempDir, 'test-skill', 'scripts'));
    expect(scripts).toEqual(['extract.py']);
  });

  it('copies a minimal skill (no references/scripts dirs)', async () => {
    const skill = await resolveSkill('minimal-skill', [PRIMARY_PATH]);
    await copySkillsToWorkspace([skill], tempDir);

    const skillMd = await readFile(join(tempDir, 'minimal-skill', 'SKILL.md'), 'utf-8');
    expect(skillMd).toContain('# Minimal Skill');

    // No references or scripts directories should exist
    const entries = await readdir(join(tempDir, 'minimal-skill'));
    expect(entries).toEqual(['SKILL.md']);
  });

  it('copies multiple skills', async () => {
    const skills = await resolveSkills(['test-skill', 'minimal-skill'], [PRIMARY_PATH]);
    await copySkillsToWorkspace(skills, tempDir);

    const entries = await readdir(tempDir);
    expect(entries.sort()).toEqual(['minimal-skill', 'test-skill']);
  });

  it('creates target directory if it does not exist', async () => {
    const nested = join(tempDir, 'deep', 'nested', 'skills');
    const skill = await resolveSkill('minimal-skill', [PRIMARY_PATH]);
    await copySkillsToWorkspace([skill], nested);

    const skillMd = await readFile(join(nested, 'minimal-skill', 'SKILL.md'), 'utf-8');
    expect(skillMd).toContain('# Minimal Skill');
  });
});
