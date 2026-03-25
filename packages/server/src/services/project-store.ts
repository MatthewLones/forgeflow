import { mkdir, readFile, writeFile, readdir, rm, stat, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { lookup } from 'mime-types';
import type { FlowDefinition } from '@forgeflow/types';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** .forge file magic header: "FORGE" + version byte + reserved byte */
const FORGE_MAGIC = Buffer.from([0x46, 0x4F, 0x52, 0x47, 0x45, 0x01, 0x00]);

/** Binary file extensions that should be base64-encoded in the bundle */
const BINARY_EXTENSIONS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico',
  'zip', 'tar', 'gz', 'mp3', 'mp4', 'wav', 'ogg', 'woff', 'woff2',
  'ttf', 'otf', 'eot', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);

function isBinaryFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

interface ForgeBundle {
  v: 1;
  flow: FlowDefinition;
  skills: Record<string, Record<string, string | { $b64: string }>>;
  references: Record<string, string | { $b64: string }>;
}

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  version: string;
  updatedAt: string;
}

export interface ProjectSummary extends ProjectMeta {
  nodeCount: number;
  skillCount: number;
  hasCheckpoints: boolean;
}

export interface SkillFile {
  path: string;
  content: string;
}

export interface SkillSummary {
  name: string;
  description: string;
  referenceCount: number;
  subSkills: string[];
}

export interface SkillState {
  skillName: string;
  files: SkillFile[];
}

export type ReferenceFileType = 'folder' | 'pdf' | 'md' | 'json' | 'txt' | 'image' | 'other';

export interface ReferenceEntry {
  name: string;
  type: ReferenceFileType;
  path: string;
  size?: number;
  modifiedAt?: string;
  children?: ReferenceEntry[];
}

/**
 * Filesystem-backed project store.
 *
 * Layout:
 *   {basePath}/{projectId}/
 *   ├── project.json    ← ProjectMeta
 *   ├── FLOW.json       ← FlowDefinition (graph shell: edges, skills, budget — no nodes)
 *   ├── nodes/          ← Individual node files for per-agent git tracking
 *   │   └── {nodeId}.json
 *   ├── references/     ← Project-level reference files
 *   └── skills/         ← Skill directories
 *       └── {skillName}/
 *           ├── SKILL.md
 *           └── references/
 */
export class ProjectStore {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath ?? join(homedir(), '.forgeflow', 'projects');
  }

  private projectDir(id: string): string {
    return join(this.basePath, id);
  }

  public skillsDir(projectId: string): string {
    return join(this.projectDir(projectId), 'skills');
  }

  private refsDir(projectId: string): string {
    return join(this.projectDir(projectId), 'references');
  }

  private nodesDir(projectId: string): string {
    return join(this.projectDir(projectId), 'nodes');
  }

  async ensureBaseDir(): Promise<void> {
    await mkdir(this.basePath, { recursive: true });
  }

  async listProjects(): Promise<ProjectSummary[]> {
    await this.ensureBaseDir();
    const entries = await readdir(this.basePath, { withFileTypes: true });
    const projects: ProjectSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const summary = await this.getProjectSummary(entry.name);
        if (summary) projects.push(summary);
      } catch {
        // Skip invalid project directories
      }
    }

    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getProjectSummary(id: string): Promise<ProjectSummary | null> {
    const dir = this.projectDir(id);
    try {
      const metaRaw = await readFile(join(dir, 'project.json'), 'utf-8');
      const meta: ProjectMeta = JSON.parse(metaRaw);

      let nodeCount = 0;
      let skillCount = 0;
      let hasCheckpoints = false;

      try {
        const flow = await this.getFlow(id);
        if (flow) {
          nodeCount = flow.nodes.length;
          skillCount = flow.skills.length;
          hasCheckpoints = flow.nodes.some((n) => n.type === 'checkpoint');
        }
      } catch {
        // No flow yet
      }

      return { ...meta, nodeCount, skillCount, hasCheckpoints };
    } catch {
      return null;
    }
  }

  async getProject(id: string): Promise<{ meta: ProjectMeta; flow: FlowDefinition | null } | null> {
    const dir = this.projectDir(id);
    try {
      const metaRaw = await readFile(join(dir, 'project.json'), 'utf-8');
      const meta: ProjectMeta = JSON.parse(metaRaw);
      const flow = await this.getFlow(id);
      return { meta, flow };
    } catch {
      return null;
    }
  }

  async createProject(name: string, description: string): Promise<ProjectMeta> {
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .replace(/^[^a-z]/, 'p');

    const dir = this.projectDir(id);
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, 'skills'), { recursive: true });
    await mkdir(join(dir, 'references'), { recursive: true });

    const meta: ProjectMeta = {
      id,
      name,
      description,
      version: '0.1',
      updatedAt: new Date().toISOString(),
    };
    await writeFile(join(dir, 'project.json'), JSON.stringify(meta, null, 2));

    // Create a default empty flow
    const flow: FlowDefinition = {
      id,
      name,
      version: '0.1',
      description,
      skills: [],
      budget: { maxTurns: 100, maxBudgetUsd: 10.0, timeoutMs: 600000 },
      nodes: [
        {
          id: 'start',
          type: 'agent',
          name: 'Start',
          instructions: 'Describe what this agent should do.',
          config: {
            inputs: [],
            outputs: [],
            skills: [],
            budget: { maxTurns: 25, maxBudgetUsd: 3.0 },
          },
          children: [],
        },
      ],
      edges: [],
    };
    await writeFile(join(dir, 'FLOW.json'), JSON.stringify(flow, null, 2));

    return meta;
  }

  async updateProject(id: string, updates: Partial<ProjectMeta>): Promise<ProjectMeta | null> {
    const dir = this.projectDir(id);
    try {
      const metaRaw = await readFile(join(dir, 'project.json'), 'utf-8');
      const meta: ProjectMeta = JSON.parse(metaRaw);

      const updated = {
        ...meta,
        ...updates,
        id, // never allow changing ID
        updatedAt: new Date().toISOString(),
      };

      await writeFile(join(dir, 'project.json'), JSON.stringify(updated, null, 2));
      return updated;
    } catch {
      return null;
    }
  }

  async deleteProject(id: string): Promise<boolean> {
    const dir = this.projectDir(id);
    try {
      await rm(dir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  async saveFlow(projectId: string, flow: FlowDefinition): Promise<boolean> {
    const dir = this.projectDir(projectId);
    const nodesDir = this.nodesDir(projectId);
    try {
      // Ensure nodes/ directory exists
      await mkdir(nodesDir, { recursive: true });

      // Write each node as a separate file
      const currentNodeIds = new Set<string>();
      for (const node of flow.nodes) {
        currentNodeIds.add(node.id);
        await writeFile(
          join(nodesDir, `${node.id}.json`),
          JSON.stringify(node, null, 2),
        );
      }

      // Remove node files that no longer exist in the flow
      try {
        const existing = await readdir(nodesDir);
        for (const file of existing) {
          if (!file.endsWith('.json')) continue;
          const nodeId = file.replace(/\.json$/, '');
          if (!currentNodeIds.has(nodeId)) {
            await rm(join(nodesDir, file), { force: true });
          }
        }
      } catch { /* nodesDir might not exist yet */ }

      // Write FLOW.json without nodes (graph shell only)
      const shell = { ...flow, nodes: [] };
      await writeFile(join(dir, 'FLOW.json'), JSON.stringify(shell, null, 2));

      // Update the project meta timestamp
      await this.updateProject(projectId, {});
      return true;
    } catch {
      return false;
    }
  }

  async getFlow(projectId: string): Promise<FlowDefinition | null> {
    try {
      const raw = await readFile(join(this.projectDir(projectId), 'FLOW.json'), 'utf-8');
      const flow: FlowDefinition = JSON.parse(raw);

      // If FLOW.json already has nodes (old format), return as-is
      if (flow.nodes.length > 0) return flow;

      // Load nodes from individual files
      const nodesDir = this.nodesDir(projectId);
      try {
        const files = await readdir(nodesDir);
        const nodes = [];
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const nodeRaw = await readFile(join(nodesDir, file), 'utf-8');
          nodes.push(JSON.parse(nodeRaw));
        }
        flow.nodes = nodes;
      } catch {
        // No nodes/ directory — project has no nodes yet
      }

      return flow;
    } catch {
      return null;
    }
  }

  // --- Skills ---

  async listSkills(projectId: string): Promise<SkillSummary[]> {
    const dir = this.skillsDir(projectId);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const skills: SkillSummary[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const summary = await this.getSkillSummary(projectId, entry.name);
          if (summary) skills.push(summary);
        } catch {
          // Skip invalid skill directories
        }
      }

      return skills;
    } catch {
      return [];
    }
  }

  private async getSkillSummary(projectId: string, skillName: string): Promise<SkillSummary | null> {
    const skillDir = join(this.skillsDir(projectId), skillName);
    try {
      const skillMd = await readFile(join(skillDir, 'SKILL.md'), 'utf-8');

      // Parse YAML frontmatter for description
      let description = '';
      const fmMatch = skillMd.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const descMatch = fmMatch[1].match(/description:\s*"?([^"\n]+)"?/);
        if (descMatch) description = descMatch[1].trim();
      }

      // Count references
      let referenceCount = 0;
      try {
        const refs = await readdir(join(skillDir, 'references'));
        referenceCount = refs.length;
      } catch {
        // No references dir
      }

      // Find sub-skill references (/skill:NAME patterns)
      const subSkills: string[] = [];
      const skillRefs = skillMd.matchAll(/\/skill:([a-z][a-z0-9_-]*)/g);
      for (const match of skillRefs) {
        if (!subSkills.includes(match[1])) subSkills.push(match[1]);
      }

      return { name: skillName, description, referenceCount, subSkills };
    } catch {
      return null;
    }
  }

  async getSkill(projectId: string, skillName: string): Promise<SkillState | null> {
    const skillDir = join(this.skillsDir(projectId), skillName);
    try {
      await stat(skillDir);
    } catch {
      return null;
    }

    const files: SkillFile[] = [];
    await this.readSkillFiles(skillDir, '', files);

    return { skillName, files };
  }

  private async readSkillFiles(dir: string, prefix: string, files: SkillFile[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile()) {
        const content = await readFile(join(dir, entry.name), 'utf-8');
        files.push({ path: relativePath, content });
      } else if (entry.isDirectory()) {
        await this.readSkillFiles(join(dir, entry.name), relativePath, files);
      }
    }
  }

  async saveSkill(projectId: string, skillName: string, files: SkillFile[]): Promise<boolean> {
    const skillDir = join(this.skillsDir(projectId), skillName);
    try {
      // Recreate skill directory
      await rm(skillDir, { recursive: true, force: true });
      await mkdir(skillDir, { recursive: true });

      for (const file of files) {
        const filePath = join(skillDir, file.path);
        const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
        if (fileDir !== skillDir) {
          await mkdir(fileDir, { recursive: true });
        }
        await writeFile(filePath, file.content);
      }

      return true;
    } catch {
      return false;
    }
  }

  async createSkill(projectId: string, skillName: string): Promise<boolean> {
    const skillDir = join(this.skillsDir(projectId), skillName);
    try {
      await mkdir(skillDir, { recursive: true });
      await mkdir(join(skillDir, 'references'), { recursive: true });
      const defaultSkillMd = `---
name: ${skillName}
description: ""
version: "1.0.0"
---

# ${skillName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}

Describe this skill's purpose and how it should be used.
`;
      await writeFile(join(skillDir, 'SKILL.md'), defaultSkillMd);
      return true;
    } catch {
      return false;
    }
  }

  async deleteSkill(projectId: string, skillName: string): Promise<boolean> {
    const skillDir = join(this.skillsDir(projectId), skillName);
    try {
      await rm(skillDir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  async renameSkill(projectId: string, oldName: string, newName: string): Promise<boolean> {
    const oldDir = join(this.skillsDir(projectId), oldName);
    const newDir = join(this.skillsDir(projectId), newName);
    try {
      const { rename } = await import('node:fs/promises');
      await rename(oldDir, newDir);
      return true;
    } catch {
      return false;
    }
  }

  async duplicateSkill(projectId: string, skillName: string, newName: string): Promise<boolean> {
    const existing = await this.getSkill(projectId, skillName);
    if (!existing) return false;

    // Update the name in SKILL.md frontmatter
    const files = existing.files.map((f) => {
      if (f.path === 'SKILL.md') {
        const content = f.content.replace(
          /^(---\n[\s\S]*?name:\s*)"?[^"\n]+"?/m,
          `$1"${newName}"`,
        );
        return { ...f, content };
      }
      return f;
    });

    return this.saveSkill(projectId, newName, files);
  }

  // --- References ---

  private getFileType(filename: string): ReferenceFileType {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'pdf') return 'pdf';
    if (ext === 'md' || ext === 'markdown') return 'md';
    if (ext === 'json') return 'json';
    if (ext === 'txt') return 'txt';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) return 'image';
    return 'other';
  }

  private isPathSafe(basePath: string, relativePath: string): boolean {
    const resolved = resolve(basePath, relativePath);
    return resolved.startsWith(basePath);
  }

  async listReferences(projectId: string): Promise<ReferenceEntry[]> {
    const dir = this.refsDir(projectId);
    try {
      await stat(dir);
    } catch {
      return [];
    }
    return this.walkReferencesDir(dir, '');
  }

  private async walkReferencesDir(dir: string, prefix: string): Promise<ReferenceEntry[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const results: ReferenceEntry[] = [];

    // Folders first, then files, both alphabetical
    const folders = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));

    for (const folder of folders) {
      const relPath = prefix ? `${prefix}/${folder.name}` : folder.name;
      const children = await this.walkReferencesDir(join(dir, folder.name), relPath);
      results.push({
        name: folder.name,
        type: 'folder',
        path: relPath,
        children,
      });
    }

    for (const file of files) {
      const relPath = prefix ? `${prefix}/${file.name}` : file.name;
      const fileStat = await stat(join(dir, file.name));
      results.push({
        name: file.name,
        type: this.getFileType(file.name),
        path: relPath,
        size: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
      });
    }

    return results;
  }

  async uploadReference(projectId: string, relativePath: string, buffer: Buffer): Promise<boolean> {
    const baseDir = this.refsDir(projectId);
    if (!this.isPathSafe(baseDir, relativePath)) return false;

    const fullPath = join(baseDir, relativePath);
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await mkdir(parentDir, { recursive: true });
    await writeFile(fullPath, buffer);
    return true;
  }

  async readReference(projectId: string, relativePath: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const baseDir = this.refsDir(projectId);
    if (!this.isPathSafe(baseDir, relativePath)) return null;

    const fullPath = join(baseDir, relativePath);
    try {
      const buffer = await readFile(fullPath);
      const mimeType = lookup(relativePath) || 'application/octet-stream';
      return { buffer, mimeType };
    } catch {
      return null;
    }
  }

  async deleteReference(projectId: string, relativePath: string): Promise<boolean> {
    const baseDir = this.refsDir(projectId);
    if (!this.isPathSafe(baseDir, relativePath)) return false;

    const fullPath = join(baseDir, relativePath);
    try {
      await rm(fullPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  async renameReference(projectId: string, oldPath: string, newPath: string): Promise<boolean> {
    const baseDir = this.refsDir(projectId);
    if (!this.isPathSafe(baseDir, oldPath) || !this.isPathSafe(baseDir, newPath)) return false;

    try {
      const newFullPath = join(baseDir, newPath);
      const newParentDir = newFullPath.substring(0, newFullPath.lastIndexOf('/'));
      await mkdir(newParentDir, { recursive: true });
      await rename(join(baseDir, oldPath), newFullPath);
      return true;
    } catch {
      return false;
    }
  }

  async createReferenceFolder(projectId: string, folderPath: string): Promise<boolean> {
    const baseDir = this.refsDir(projectId);
    if (!this.isPathSafe(baseDir, folderPath)) return false;

    try {
      await mkdir(join(baseDir, folderPath), { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  // --- Export / Import (.forge bundles) ---

  /**
   * Export a project as a .forge bundle (gzip-compressed JSON with magic header).
   * Returns the raw Buffer ready to send as a download.
   */
  async exportProject(projectId: string): Promise<Buffer | null> {
    const flow = await this.getFlow(projectId);
    if (!flow) return null;

    // Collect skills
    const skills: ForgeBundle['skills'] = {};
    const skillNames = await this.listSkills(projectId);
    for (const { name } of skillNames) {
      const skillState = await this.getSkill(projectId, name);
      if (!skillState) continue;
      const files: Record<string, string | { $b64: string }> = {};
      for (const file of skillState.files) {
        files[file.path] = file.content;
      }
      // Also check for binary files in skill references
      const skillRefDir = join(this.skillsDir(projectId), name, 'references');
      try {
        await this.collectBinaryFiles(skillRefDir, 'references', files);
      } catch {
        // No binary refs
      }
      skills[name] = files;
    }

    // Collect project-level references
    const references: ForgeBundle['references'] = {};
    await this.collectAllFiles(this.refsDir(projectId), '', references);

    const bundle: ForgeBundle = { v: 1, flow, skills, references };

    // Minified JSON → gzip (maximum compression level 9)
    const json = JSON.stringify(bundle);
    const compressed = await gzipAsync(Buffer.from(json), { level: 9 });
    return Buffer.concat([FORGE_MAGIC, compressed]);
  }

  /**
   * Import a .forge bundle, creating a new project.
   * Returns the new project's metadata, or throws on invalid bundle.
   */
  async importProject(buffer: Buffer): Promise<ProjectMeta> {
    // Validate magic header
    if (buffer.length < FORGE_MAGIC.length || !buffer.subarray(0, FORGE_MAGIC.length).equals(FORGE_MAGIC)) {
      throw new Error('Invalid .forge file: missing magic header');
    }

    const version = buffer[5];
    if (version !== 1) {
      throw new Error(`Unsupported .forge version: ${version}`);
    }

    // Decompress
    const compressed = buffer.subarray(FORGE_MAGIC.length);
    const json = (await gunzipAsync(compressed)).toString('utf-8');
    const bundle: ForgeBundle = JSON.parse(json);

    if (!bundle.flow || !bundle.v) {
      throw new Error('Invalid .forge file: missing flow data');
    }

    // Derive project ID from flow name (with dedup suffix if needed)
    let baseId = bundle.flow.name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .replace(/^[^a-z]/, 'p');

    let projectId = baseId;
    let attempt = 0;
    while (true) {
      try {
        await stat(this.projectDir(projectId));
        // Directory exists, try with suffix
        attempt++;
        projectId = `${baseId}_${attempt}`;
      } catch {
        break; // Directory doesn't exist, use this ID
      }
    }

    // Update flow ID to match new project ID
    bundle.flow.id = projectId;

    // Create project directory
    const dir = this.projectDir(projectId);
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, 'skills'), { recursive: true });
    await mkdir(join(dir, 'references'), { recursive: true });

    // Write project metadata (derived from flow)
    const meta: ProjectMeta = {
      id: projectId,
      name: bundle.flow.name,
      description: bundle.flow.description ?? '',
      version: bundle.flow.version ?? '0.1',
      updatedAt: new Date().toISOString(),
    };
    await writeFile(join(dir, 'project.json'), JSON.stringify(meta, null, 2));

    // Write flow
    await writeFile(join(dir, 'FLOW.json'), JSON.stringify(bundle.flow, null, 2));

    // Write skills
    for (const [skillName, files] of Object.entries(bundle.skills ?? {})) {
      const skillDir = join(this.skillsDir(projectId), skillName);
      await mkdir(skillDir, { recursive: true });
      for (const [filePath, content] of Object.entries(files)) {
        const fullPath = join(skillDir, filePath);
        const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
        await mkdir(parentDir, { recursive: true });
        if (typeof content === 'string') {
          await writeFile(fullPath, content);
        } else if (content && typeof content === 'object' && '$b64' in content) {
          await writeFile(fullPath, Buffer.from(content.$b64, 'base64'));
        }
      }
    }

    // Write project-level references
    for (const [filePath, content] of Object.entries(bundle.references ?? {})) {
      const fullPath = join(this.refsDir(projectId), filePath);
      const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      await mkdir(parentDir, { recursive: true });
      if (typeof content === 'string') {
        await writeFile(fullPath, content);
      } else if (content && typeof content === 'object' && '$b64' in content) {
        await writeFile(fullPath, Buffer.from(content.$b64, 'base64'));
      }
    }

    return meta;
  }

  /** Recursively collect all files (text as string, binary as {$b64}) */
  private async collectAllFiles(
    dir: string,
    prefix: string,
    out: Record<string, string | { $b64: string }>,
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile()) {
        if (isBinaryFile(entry.name)) {
          const buf = await readFile(join(dir, entry.name));
          out[relPath] = { $b64: buf.toString('base64') };
        } else {
          out[relPath] = await readFile(join(dir, entry.name), 'utf-8');
        }
      } else if (entry.isDirectory()) {
        await this.collectAllFiles(join(dir, entry.name), relPath, out);
      }
    }
  }

  /** Collect only binary files that weren't already captured by readSkillFiles */
  private async collectBinaryFiles(
    dir: string,
    prefix: string,
    out: Record<string, string | { $b64: string }>,
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile() && isBinaryFile(entry.name) && !(relPath in out)) {
        const buf = await readFile(join(dir, entry.name));
        out[relPath] = { $b64: buf.toString('base64') };
      } else if (entry.isDirectory()) {
        await this.collectBinaryFiles(join(dir, entry.name), relPath, out);
      }
    }
  }

  // --- Seed default data ---

  async seedIfEmpty(): Promise<void> {
    const projects = await this.listProjects();
    if (projects.length > 0) return;

    // Create the startup due diligence example project
    const meta = await this.createProject(
      'Startup Due Diligence Report',
      'VC analyst workflow: research a startup, assess risks across financial/legal/team dimensions, and produce an investment memo',
    );
    const flow: FlowDefinition = {
      id: meta.id,
      name: 'Startup Due Diligence Report',
      version: '1.0',
      description: 'VC analyst workflow: research a startup, assess risks across financial/legal/team dimensions, and produce an investment memo',
      skills: ['venture-analysis', 'startup-legal'],
      budget: { maxTurns: 800, maxBudgetUsd: 50.0, timeoutMs: 1200000 },
      nodes: [
        {
          id: 'ingest_materials',
          type: 'agent',
          name: 'Ingest Materials',
          instructions: [
            'Collect and structure all available information about the target startup.',
            '',
            'Read the pitch deck, financial statements, and any provided documents. Extract key data into a structured company profile covering:',
            '- Company overview (name, stage, sector, founded date)',
            '- Founding team bios and backgrounds',
            '- Product description and current traction metrics',
            '- Market category and initial competitive landscape',
            '- Current funding history and cap table summary',
            '',
            'Output: \\company_profile',
          ].join('\n'),
          config: {
            inputs: ['startup_materials'],
            outputs: ['company_profile'],
            skills: [],
            budget: { maxTurns: 60, maxBudgetUsd: 3.0 },
          },
          children: [],
        },
        {
          id: 'market_research',
          type: 'agent',
          name: 'Market Research',
          instructions: [
            'Conduct deep market analysis using the company profile as a starting point.',
            '',
            'Using @company_profile, research and analyze:',
            '',
            '1. **Market sizing** — Calculate TAM, SAM, and SOM with cited sources',
            '2. **Competitive landscape** — Map direct and indirect competitors, positioning',
            '3. **Market dynamics** — Growth trends, regulatory tailwinds/headwinds',
            '4. **Differentiation** — Evaluate moat strength and defensibility',
            '',
            'Apply /skill:venture-analysis frameworks for market sizing methodology.',
            '',
            'Before finalizing, pause for /interrupt:review so a human can verify the market sizing methodology, validate competitive mapping accuracy, and confirm the TAM/SAM/SOM estimates are grounded in cited sources.',
            '',
            'Output: \\market_analysis',
          ].join('\n'),
          config: {
            inputs: ['company_profile'],
            outputs: ['market_analysis'],
            skills: ['venture-analysis'],
            budget: { maxTurns: 80, maxBudgetUsd: 5.0 },
            interrupts: [{ type: 'review' as const }],
          },
          children: [],
        },
        {
          id: 'risk_assessment',
          type: 'agent',
          name: 'Risk Assessment',
          instructions: [
            'Coordinate three parallel research subagents to assess risk across financial, legal, and team dimensions.',
            '',
            'Each subagent receives the @company_profile and @market_analysis to inform their analysis.',
            '',
            'Subagents:',
            '- //agent:analyze_financials — deep-dive into unit economics, burn rate, and runway',
            '- //agent:analyze_legal — cap table, IP ownership, and regulatory exposure',
            '- //agent:analyze_team — founding team strength, gaps, and key person risk',
            '',
            'After all subagents complete, aggregate their findings into a unified risk matrix scoring each dimension (1-5) with supporting evidence.',
            '',
            'Once the risk matrix is assembled, trigger /interrupt:qa to let a human review the aggregated scores. Key questions: Are any risk dimensions under-weighted? Do the financial and legal findings contradict each other? Are there sector-specific risks the subagents may have missed?',
            '',
            'Inputs: @financial_findings, @legal_findings, @team_assessment',
            'Output: \\risk_matrix',
          ].join('\n'),
          config: {
            inputs: ['company_profile', 'market_analysis', 'financial_findings', 'legal_findings', 'team_assessment'],
            outputs: ['risk_matrix'],
            skills: [],
            budget: { maxTurns: 240, maxBudgetUsd: 15.0 },
            interrupts: [{ type: 'qa' as const }],
          },
          children: [
            {
              id: 'analyze_financials',
              type: 'agent',
              name: 'Financial Analyst',
              instructions: [
                'Analyze the startup\'s financial health and trajectory.',
                '',
                'Using @company_profile and @market_analysis, evaluate:',
                '- Revenue model and current MRR/ARR',
                '- Unit economics (CAC, LTV, LTV:CAC ratio)',
                '- Burn rate and runway at current spend',
                '- Path to profitability assumptions',
                '- Comparison to sector benchmarks',
                '',
                'Apply /skill:venture-analysis financial modeling frameworks.',
                '',
                'Output: \\financial_findings',
              ].join('\n'),
              config: {
                inputs: ['company_profile', 'market_analysis'],
                outputs: ['financial_findings'],
                skills: ['venture-analysis'],
                budget: { maxTurns: 70, maxBudgetUsd: 4.0 },
              },
              children: [],
            },
            {
              id: 'analyze_legal',
              type: 'agent',
              name: 'Legal Analyst',
              instructions: [
                'Assess legal structure and regulatory risk.',
                '',
                'Using @company_profile, review:',
                '- Cap table structure and any red flags (excessive dilution, unusual terms)',
                '- IP assignment — verify all founder and employee IP is assigned to company',
                '- Regulatory exposure in their market vertical',
                '- Pending or potential litigation risks',
                '- Corporate structure and jurisdiction',
                '',
                'Apply /skill:startup-legal for cap table and IP analysis frameworks.',
                '',
                'Output: \\legal_findings',
              ].join('\n'),
              config: {
                inputs: ['company_profile'],
                outputs: ['legal_findings'],
                skills: ['startup-legal'],
                budget: { maxTurns: 70, maxBudgetUsd: 4.0 },
              },
              children: [],
            },
            {
              id: 'analyze_team',
              type: 'agent',
              name: 'Team Analyst',
              instructions: [
                'Evaluate the founding team and organizational readiness.',
                '',
                'Using @company_profile, assess:',
                '- Founder-market fit and relevant domain experience',
                '- Technical co-founder strength and engineering capability',
                '- Key person risk — single points of failure',
                '- Current team gaps and hiring plan',
                '- Advisory board strength and relevance',
                '- Culture signals from interviews and references',
                '',
                'Output: \\team_assessment',
              ].join('\n'),
              config: {
                inputs: ['company_profile'],
                outputs: ['team_assessment'],
                skills: [],
                budget: { maxTurns: 70, maxBudgetUsd: 4.0 },
              },
              children: [],
            },
          ],
        },
        {
          id: 'partner_review',
          type: 'checkpoint',
          name: 'Partner Review',
          instructions: [
            'The risk assessment phase is complete. Review the risk matrix below and provide your investment decision.',
            '',
            'You will see the aggregated risk scores across financial, legal, team, and market dimensions. Each score is rated 1-5 (1 = critical risk, 5 = exceptional strength).',
            '',
            'Please provide your decision as a JSON file with:',
            '- **decision**: "go", "no_go", or "conditional"',
            '- **conditions**: any terms or follow-up items required before proceeding',
            '- **notes**: your reasoning and any concerns',
            '',
            'If conditional, specify what must be resolved before the final report is generated.',
          ].join('\n'),
          config: {
            inputs: ['risk_matrix'],
            outputs: ['partner_decisions'],
            skills: [],
            presentation: {
              title: 'Investment Risk Assessment Complete — Review Required',
              sections: [],
            },
          },
          children: [],
        },
        {
          id: 'final_report',
          type: 'agent',
          name: 'Final Report',
          instructions: [
            'Generate the final investment deliverables based on all research and the partner\'s decision.',
            '',
            'Using @market_analysis, @risk_matrix, and @partner_decisions, produce:',
            '',
            '1. **Investment Memo** — Executive summary, thesis, risks, recommendation, and proposed terms. Apply /skill:venture-analysis for valuation frameworks.',
            '',
            '2. **Term Sheet Draft** — If the partner decision is "go" or "conditional", draft a term sheet with proposed valuation, investment amount, and key terms. Address any conditions noted in @partner_decisions.',
            '',
            'Before delivering the final documents, require /interrupt:approval from a senior partner. They should confirm the investment thesis holds, the proposed valuation is defensible, and the term sheet terms are within fund guidelines.',
            '',
            'Outputs: \\investment_memo \\term_sheet_draft',
          ].join('\n'),
          config: {
            inputs: ['market_analysis', 'risk_matrix', 'partner_decisions'],
            outputs: ['investment_memo', 'term_sheet_draft'],
            skills: ['venture-analysis'],
            budget: { maxTurns: 120, maxBudgetUsd: 8.0 },
            interrupts: [{ type: 'approval' as const }],
          },
          children: [],
        },
      ],
      artifacts: {
        startup_materials: { name: 'startup_materials', format: 'text' as const, description: 'Pitch deck text, financial statements, and/or company overview to analyze' },
        company_profile: {
          name: 'company_profile', format: 'json' as const, description: 'Company overview: founders, product, traction, funding history',
          fields: [
            { key: 'company_name', type: 'string' as const, description: 'Company legal name' },
            { key: 'sector', type: 'string' as const, description: 'Industry sector' },
            { key: 'stage', type: 'string' as const, description: 'Funding stage (seed, series-a, etc.)' },
            { key: 'founded_year', type: 'number' as const, description: 'Year founded' },
            { key: 'team', type: 'array' as const, description: 'Founding team members' },
            { key: 'traction', type: 'object' as const, description: 'Traction metrics (MRR, users, etc.)' },
          ],
        },
        market_analysis: {
          name: 'market_analysis', format: 'json' as const, description: 'TAM/SAM/SOM sizing, competitive landscape, market dynamics',
          fields: [
            { key: 'tam', type: 'object' as const, description: 'Total Addressable Market sizing' },
            { key: 'sam', type: 'object' as const, description: 'Serviceable Available Market' },
            { key: 'competitors', type: 'array' as const, description: 'Competitive landscape entries' },
            { key: 'growth_trends', type: 'string' as const, description: 'Market growth trend summary' },
          ],
        },
        financial_findings: { name: 'financial_findings', format: 'json' as const, description: 'Unit economics, burn rate, runway, and financial health assessment' },
        legal_findings: { name: 'legal_findings', format: 'json' as const, description: 'Cap table review, IP assignment status, regulatory exposure' },
        team_assessment: { name: 'team_assessment', format: 'json' as const, description: 'Team strength, key person risk, gaps, and hiring plan' },
        risk_matrix: {
          name: 'risk_matrix', format: 'json' as const, description: 'Aggregated risk scores (1-5) across financial, legal, team, and market dimensions',
          fields: [
            { key: 'financial_risk', type: 'number' as const, description: 'Financial risk score (1-5)' },
            { key: 'legal_risk', type: 'number' as const, description: 'Legal risk score (1-5)' },
            { key: 'team_risk', type: 'number' as const, description: 'Team risk score (1-5)' },
            { key: 'market_risk', type: 'number' as const, description: 'Market risk score (1-5)' },
            { key: 'overall_risk', type: 'number' as const, description: 'Overall risk score (1-5)' },
          ],
        },
        partner_decisions: {
          name: 'partner_decisions', format: 'json' as const, description: 'Investment partner review decision with conditions',
          fields: [
            { key: 'decision', type: 'string' as const, description: 'go, no_go, or conditional' },
            { key: 'conditions', type: 'array' as const, description: 'Required conditions before proceeding (if conditional)', required: false },
            { key: 'notes', type: 'string' as const, description: 'Partner reasoning and concerns' },
          ],
        },
        investment_memo: { name: 'investment_memo', format: 'markdown' as const, description: 'Final investment recommendation with thesis, risks, and proposed terms' },
        term_sheet_draft: { name: 'term_sheet_draft', format: 'markdown' as const, description: 'Draft term sheet with valuation and key terms' },
      },
      edges: [
        { from: 'ingest_materials', to: 'market_research' },
        { from: 'ingest_materials', to: 'risk_assessment' },
        { from: 'market_research', to: 'risk_assessment' },
        { from: 'risk_assessment', to: 'partner_review' },
        { from: 'partner_review', to: 'final_report' },
        { from: 'market_research', to: 'final_report' },
      ],
    };
    await this.saveFlow(meta.id, flow);

    // Create the venture-analysis skill
    await this.saveSkill(meta.id, 'venture-analysis', [
      {
        path: 'SKILL.md',
        content: [
          '---',
          'name: venture-analysis',
          'description: "VC analysis frameworks for market sizing, financial modeling, and risk scoring"',
          'version: "1.0.0"',
          '---',
          '',
          '# Venture Analysis',
          '',
          'Core frameworks for evaluating early-stage startup investments.',
          '',
          '## Market Sizing',
          '',
          'Always calculate market size using a **bottom-up** approach:',
          '',
          '- **TAM** (Total Addressable Market) — Total revenue opportunity if 100% market share',
          '- **SAM** (Serviceable Available Market) — Segment the company can realistically reach',
          '- **SOM** (Serviceable Obtainable Market) — Near-term capture based on current go-to-market',
          '',
          'Cite sources for all market size estimates. Cross-reference at least two independent sources.',
          '',
          '## Financial Analysis Framework',
          '',
          'Evaluate unit economics using these metrics:',
          '',
          '- **CAC** — Customer Acquisition Cost (total sales+marketing / new customers)',
          '- **LTV** — Lifetime Value (ARPU x gross margin x avg lifespan)',
          '- **LTV:CAC ratio** — Target >3x for healthy SaaS, >2x for marketplace',
          '- **Burn multiple** — Net burn / net new ARR (lower is better, <2x is good)',
          '- **Runway** — Cash / monthly burn rate',
          '',
          '## Risk Scoring Rubric',
          '',
          'Score each dimension 1-5:',
          '',
          '| Score | Meaning |',
          '|-------|---------|',
          '| 1 | Critical risk — likely dealbreaker |',
          '| 2 | Significant concern — needs mitigation plan |',
          '| 3 | Moderate — typical for stage |',
          '| 4 | Low risk — better than average |',
          '| 5 | Exceptional — clear strength |',
          '',
          '## Valuation Frameworks',
          '',
          'For early-stage (pre-Series B), use:',
          '1. **Revenue multiple** — Compare to public comps at similar growth rates',
          '2. **Scorecard method** — Weight team, market, product, traction',
          '3. **Risk-adjusted DCF** — Only if 2+ years of revenue data available',
          '',
          '> **DO** Use bottom-up market sizing with cited sources *Top-down estimates are unreliable for early-stage*',
          '>',
          '> **DO** Compare metrics to stage-appropriate benchmarks *Series A metrics differ from Series C*',
          '>',
          '> **DO NOT** Project hockey-stick growth without evidence *Optimistic projections mislead investment decisions*',
          '>',
          '> **DO NOT** Ignore burn rate when evaluating unit economics *Profitable unit economics mean nothing if the company runs out of cash*',
        ].join('\n'),
      },
    ]);

    // Create the startup-legal skill
    await this.saveSkill(meta.id, 'startup-legal', [
      {
        path: 'SKILL.md',
        content: [
          '---',
          'name: startup-legal',
          'description: "Startup legal analysis: cap tables, IP assignment, regulatory exposure"',
          'version: "1.0.0"',
          '---',
          '',
          '# Startup Legal Analysis',
          '',
          'Framework for evaluating the legal health of an early-stage startup.',
          '',
          '## Cap Table Review',
          '',
          'Check for these common red flags:',
          '',
          '- **Excessive founder dilution** — Founders should retain >50% through Series A',
          '- **Dead equity** — Departed co-founders holding unvested or fully vested large blocks',
          '- **Non-standard preferences** — Participating preferred, >1x liquidation preference',
          '- **Missing option pool** — No ESOP or pool <10% pre-money',
          '- **SAFEs/convertibles** — Outstanding notes that will dilute at conversion',
          '',
          '## IP Assignment Checklist',
          '',
          '- All founders signed CIIA (Confidential Information and Inventions Assignment)',
          '- All employees and contractors signed IP assignment agreements',
          '- No prior art claims from previous employers',
          '- Core technology developed after incorporation (not brought in from university/employer)',
          '- Patent applications filed for key innovations (if applicable)',
          '',
          '## Regulatory Risk Patterns',
          '',
          '| Sector | Common Risks |',
          '|--------|-------------|',
          '| FinTech | Money transmitter licenses, SEC registration, state-by-state compliance |',
          '| HealthTech | HIPAA compliance, FDA clearance, state medical regulations |',
          '| EdTech | FERPA/COPPA compliance, state education regulations |',
          '| AI/ML | Data privacy (GDPR/CCPA), algorithmic bias liability, IP training data |',
          '| Marketplace | 1099 vs W-2 classification, platform liability, consumer protection |',
          '',
          '> **DO** Verify IP assignment for every team member *Unassigned IP is a dealbreaker for most investors*',
          '>',
          '> **DO** Flag any liquidation preferences above 1x non-participating *Stacked preferences can wipe out common shareholders*',
          '>',
          '> **DO NOT** Assume standard Delaware C-corp structure without verifying *Some startups use LLCs or non-US entities which complicate investment*',
          '>',
          '> **DO NOT** Overlook outstanding SAFEs and convertible notes *They dilute significantly at conversion and affect valuation*',
        ].join('\n'),
      },
    ]);

    // --- Seed project 2: Interrupt Test Kitchen ---
    await this.seedInterruptTestKitchen();
  }

  /**
   * Simple 4-node linear flow that exercises all 5 interrupt types + 1 checkpoint.
   * Designed for fast dev testing with MockRunner (minimal tokens).
   */
  private async seedInterruptTestKitchen(): Promise<void> {
    const meta = await this.createProject(
      'Interrupt Test Kitchen',
      'Simple flow that exercises all 5 interrupt types, a checkpoint, and child agents — for dev testing',
    );

    const flow: FlowDefinition = {
      id: meta.id,
      name: 'Interrupt Test Kitchen',
      version: '1.0',
      description: 'Simple flow that exercises all 5 interrupt types, a checkpoint, and child agents — for dev testing',
      skills: ['writing-guide'],
      budget: { maxTurns: 200, maxBudgetUsd: 10.0, timeoutMs: 600000 },
      nodes: [
        {
          id: 'draft_content',
          type: 'agent',
          name: 'Draft Content',
          instructions: [
            'Write a short blog post draft based on the provided topic.',
            '',
            'Read the @topic input and produce a 3-paragraph blog post draft.',
            'Apply /skill:writing-guide for tone and structure.',
            '',
            'Use two subagents to help:',
            '- //agent:research_facts — gather 3-5 supporting facts',
            '- //agent:write_outline — create a structured outline',
            '',
            'Then assemble the final draft using their outputs.',
            '',
            'Before finalizing, trigger /interrupt:qa to ask the user:',
            '- Preferred tone (formal, casual, technical)',
            '- Target audience',
            '- Any specific points to include',
            '',
            'Output: \\blog_draft',
          ].join('\n'),
          config: {
            inputs: ['topic'],
            outputs: ['blog_draft'],
            skills: ['writing-guide'],
            budget: { maxTurns: 60, maxBudgetUsd: 3.0 },
            interrupts: [{ type: 'qa' as const }],
          },
          children: [
            {
              id: 'research_facts',
              type: 'agent',
              name: 'Fact Researcher',
              instructions: [
                'Research 3-5 supporting facts for the blog topic.',
                '',
                'Using @topic, find relevant statistics, quotes, or data points.',
                'Output them as a structured list.',
                '',
                'Output: \\research_notes',
              ].join('\n'),
              config: {
                inputs: ['topic'],
                outputs: ['research_notes'],
                skills: [],
                budget: { maxTurns: 20, maxBudgetUsd: 1.0 },
              },
              children: [],
            },
            {
              id: 'write_outline',
              type: 'agent',
              name: 'Outline Writer',
              instructions: [
                'Create a structured outline for the blog post.',
                '',
                'Using @topic, produce a 3-section outline with key points for each section.',
                '',
                'Output: \\outline',
              ].join('\n'),
              config: {
                inputs: ['topic'],
                outputs: ['outline'],
                skills: [],
                budget: { maxTurns: 20, maxBudgetUsd: 1.0 },
              },
              children: [],
            },
          ],
        },
        {
          id: 'review_draft',
          type: 'agent',
          name: 'Review Draft',
          instructions: [
            'Review the blog draft for quality and accuracy.',
            '',
            'Read @blog_draft and evaluate:',
            '- Grammar and clarity',
            '- Factual accuracy',
            '- Tone consistency',
            '- Structure and flow',
            '',
            'First, trigger /interrupt:review so the user can read and edit the draft directly.',
            '',
            'Then trigger /interrupt:selection to let the user pick which sections need more work:',
            '- Introduction',
            '- Body paragraphs',
            '- Conclusion',
            '- Sources/citations',
            '',
            'Produce a review summary with recommendations.',
            '',
            'Output: \\review_notes',
          ].join('\n'),
          config: {
            inputs: ['blog_draft'],
            outputs: ['review_notes'],
            skills: [],
            budget: { maxTurns: 40, maxBudgetUsd: 2.0 },
            interrupts: [
              { type: 'review' as const },
              { type: 'selection' as const },
            ],
          },
          children: [],
        },
        {
          id: 'editor_checkpoint',
          type: 'checkpoint',
          name: 'Editor Sign-off',
          instructions: [
            'The draft has been written and reviewed.',
            '',
            'Review the blog draft and the review notes below.',
            'Provide your editorial decision as a JSON file with:',
            '- **decision**: "publish", "revise", or "reject"',
            '- **feedback**: your notes on what to change (if revise)',
            '- **priority**: "low", "medium", or "high"',
          ].join('\n'),
          config: {
            inputs: ['blog_draft', 'review_notes'],
            outputs: ['editor_decision'],
            skills: [],
            presentation: {
              title: 'Blog Post Review — Editor Sign-off Required',
              sections: [],
            },
          },
          children: [],
        },
        {
          id: 'finalize',
          type: 'agent',
          name: 'Finalize & Publish',
          instructions: [
            'Finalize the blog post based on the editor decision.',
            '',
            'Using @blog_draft, @review_notes, and @editor_decision:',
            '',
            '- If decision is "publish", format the final version',
            '- If decision is "revise", apply the feedback and rewrite',
            '- If decision is "reject", produce a rejection summary',
            '',
            'Before publishing, trigger /interrupt:approval — the editor must approve the final version.',
            '',
            'If any critical issues are found during finalization, trigger /interrupt:escalation to flag them.',
            '',
            'Outputs: \\final_post \\publish_metadata',
          ].join('\n'),
          config: {
            inputs: ['blog_draft', 'review_notes', 'editor_decision'],
            outputs: ['final_post', 'publish_metadata'],
            skills: ['writing-guide'],
            budget: { maxTurns: 60, maxBudgetUsd: 3.0 },
            interrupts: [
              { type: 'approval' as const },
              { type: 'escalation' as const },
            ],
          },
          children: [],
        },
      ],
      artifacts: {
        topic: {
          name: 'topic', format: 'text' as const,
          description: 'Blog post topic or brief to write about',
        },
        blog_draft: {
          name: 'blog_draft', format: 'markdown' as const,
          description: 'The initial blog post draft',
        },
        research_notes: {
          name: 'research_notes', format: 'json' as const,
          description: 'Supporting facts and data points',
          fields: [
            { key: 'facts', type: 'array' as const, description: 'List of supporting facts' },
            { key: 'sources', type: 'array' as const, description: 'Source URLs or references' },
          ],
        },
        outline: {
          name: 'outline', format: 'json' as const,
          description: 'Blog post outline with sections and key points',
          fields: [
            { key: 'sections', type: 'array' as const, description: 'Outline sections' },
          ],
        },
        review_notes: {
          name: 'review_notes', format: 'json' as const,
          description: 'Review findings and recommendations',
          fields: [
            { key: 'grammar_score', type: 'number' as const, description: 'Grammar quality (1-10)' },
            { key: 'clarity_score', type: 'number' as const, description: 'Clarity score (1-10)' },
            { key: 'issues', type: 'array' as const, description: 'List of issues found' },
            { key: 'recommendations', type: 'array' as const, description: 'Improvement suggestions' },
          ],
        },
        editor_decision: {
          name: 'editor_decision', format: 'json' as const,
          description: 'Editor sign-off decision',
          fields: [
            { key: 'decision', type: 'string' as const, description: 'publish, revise, or reject' },
            { key: 'feedback', type: 'string' as const, description: 'Editor notes and feedback', required: false },
            { key: 'priority', type: 'string' as const, description: 'low, medium, or high' },
          ],
        },
        final_post: {
          name: 'final_post', format: 'markdown' as const,
          description: 'The finalized blog post ready for publishing',
        },
        publish_metadata: {
          name: 'publish_metadata', format: 'json' as const,
          description: 'Publishing metadata (title, tags, slug)',
          fields: [
            { key: 'title', type: 'string' as const, description: 'Post title' },
            { key: 'slug', type: 'string' as const, description: 'URL slug' },
            { key: 'tags', type: 'array' as const, description: 'Content tags' },
            { key: 'published_at', type: 'string' as const, description: 'ISO timestamp' },
          ],
        },
      },
      edges: [
        { from: 'draft_content', to: 'review_draft' },
        { from: 'review_draft', to: 'editor_checkpoint' },
        { from: 'editor_checkpoint', to: 'finalize' },
      ],
    };
    await this.saveFlow(meta.id, flow);

    // Create the writing-guide skill
    await this.saveSkill(meta.id, 'writing-guide', [
      {
        path: 'SKILL.md',
        content: [
          '---',
          'name: writing-guide',
          'description: "Blog post writing style and structure guidelines"',
          'version: "1.0.0"',
          '---',
          '',
          '# Writing Guide',
          '',
          'Guidelines for producing high-quality blog content.',
          '',
          '## Structure',
          '',
          '- **Hook** — Open with a compelling question, stat, or anecdote',
          '- **Body** — 2-3 paragraphs, each with a clear point and supporting evidence',
          '- **Conclusion** — Summarize key takeaway and call to action',
          '',
          '## Tone',
          '',
          '- Conversational but authoritative',
          '- Use active voice',
          '- Keep sentences under 25 words',
          '- One idea per paragraph',
          '',
          '## Formatting',
          '',
          '- Use H2 headers for main sections',
          '- Bold key terms on first use',
          '- Include bullet lists for 3+ related items',
          '- Add a pull quote for emphasis',
          '',
          '> **DO** Write for a general audience first, add technical depth in later sections',
          '>',
          '> **DO** Include at least one data point or citation per section',
          '>',
          '> **DO NOT** Use jargon without defining it',
          '>',
          '> **DO NOT** Write paragraphs longer than 5 sentences',
        ].join('\n'),
      },
    ]);

    // --- Seed project 3: Interrupt Smoke Test ---
    await this.seedInterruptSmokeTest();
  }

  /**
   * Ultra-minimal flow for testing interrupt/checkpoint UI plumbing.
   * Each node does the absolute minimum work and immediately triggers its interrupt.
   * Designed to be run with the local runner at minimal token cost.
   */
  private async seedInterruptSmokeTest(): Promise<void> {
    const meta = await this.createProject(
      'Interrupt Smoke Test',
      'Minimal flow: 3 interrupts (review, qa, selection) + 1 checkpoint. Each node does almost no thinking — just triggers the interrupt immediately.',
    );

    const flow: FlowDefinition = {
      id: meta.id,
      name: 'Interrupt Smoke Test',
      version: '1.0',
      description: 'Minimal flow: 3 interrupts + 1 checkpoint for UI smoke testing',
      skills: [],
      budget: { maxTurns: 100, maxBudgetUsd: 5.0, timeoutMs: 300000 },
      nodes: [
        {
          id: 'write_draft',
          type: 'agent',
          name: 'Write Draft',
          instructions: [
            'IMPORTANT: Do NOT research or analyze. Keep this minimal.',
            '',
            'Write exactly ONE short paragraph (3-4 sentences) about the @topic. Do not elaborate.',
            '',
            'Save it as output/draft then IMMEDIATELY trigger /interrupt:review so the user can read it.',
            '',
            'After the user responds, save the final version.',
            '',
            'Output: \\draft',
          ].join('\n'),
          config: {
            inputs: ['topic'],
            outputs: [{ name: 'draft', format: 'markdown' as const, description: 'A short paragraph draft' }],
            skills: [],
            budget: { maxTurns: 20, maxBudgetUsd: 1.0 },
            interrupts: [{ type: 'review' as const }],
          },
          children: [],
        },
        {
          id: 'ask_preferences',
          type: 'agent',
          name: 'Ask Preferences',
          instructions: [
            'IMPORTANT: Do NOT analyze the draft. Just ask questions immediately.',
            '',
            'Trigger /interrupt:qa with exactly these 2 questions:',
            '1. "What tone do you prefer?" (choice: casual, formal, technical)',
            '2. "Any topics to avoid?" (free text)',
            '',
            'After receiving answers, write a simple JSON summary of the preferences.',
            '',
            'Output: \\preferences',
          ].join('\n'),
          config: {
            inputs: ['draft'],
            outputs: [{
              name: 'preferences', format: 'json' as const, description: 'User preferences',
              fields: [
                { key: 'tone', type: 'string' as const, description: 'Preferred tone' },
                { key: 'avoid', type: 'string' as const, description: 'Topics to avoid' },
              ],
            }],
            skills: [],
            budget: { maxTurns: 20, maxBudgetUsd: 1.0 },
            interrupts: [{ type: 'qa' as const }],
          },
          children: [],
        },
        {
          id: 'pick_sections',
          type: 'agent',
          name: 'Pick Sections',
          instructions: [
            'IMPORTANT: Do NOT rewrite anything. Just present choices and produce outputs.',
            '',
            'Trigger /interrupt:selection with these 4 items for the user to choose which sections to keep:',
            '- "introduction" — Opening hook',
            '- "body" — Main argument',
            '- "conclusion" — Closing summary',
            '- "citations" — Sources and references',
            '',
            'After the user selects, produce TWO outputs:',
            '1. \\selected_sections — a CSV listing the kept sections',
            '2. \\summary_report — a one-page PDF summarizing the draft and selections',
          ].join('\n'),
          config: {
            inputs: ['draft', 'preferences'],
            outputs: [
              { name: 'selected_sections', format: 'csv' as const, description: 'CSV of section IDs the user chose to keep' },
              { name: 'summary_report', format: 'pdf' as const, description: 'One-page PDF summary of the draft and selected sections' },
            ],
            skills: [],
            budget: { maxTurns: 30, maxBudgetUsd: 2.0 },
            interrupts: [{ type: 'selection' as const }],
          },
          children: [],
        },
        {
          id: 'final_review',
          type: 'checkpoint',
          name: 'Final Review',
          instructions: [
            'Review all artifacts and approve or reject.',
          ].join('\n'),
          config: {
            inputs: ['draft', 'preferences', 'selected_sections', 'summary_report'],
            outputs: [{
              name: 'approval', format: 'json' as const, description: 'Final approval decision',
              fields: [
                { key: 'approved', type: 'boolean' as const, description: 'Whether to approve' },
                { key: 'notes', type: 'string' as const, description: 'Final comments', required: false },
              ],
            }],
            skills: [],
            presentation: {
              title: 'Final Review — Approve or Reject',
              sections: [],
            },
          },
          children: [],
        },
      ],
      artifacts: {
        topic: { name: 'topic', format: 'text' as const, description: 'A one-line topic to write about' },
        draft: { name: 'draft', format: 'markdown' as const, description: 'Short paragraph draft' },
        preferences: {
          name: 'preferences', format: 'json' as const, description: 'User preferences from QA',
          fields: [
            { key: 'tone', type: 'string' as const, description: 'Preferred tone' },
            { key: 'avoid', type: 'string' as const, description: 'Topics to avoid' },
          ],
        },
        selected_sections: { name: 'selected_sections', format: 'csv' as const, description: 'CSV of section IDs the user chose to keep' },
        summary_report: { name: 'summary_report', format: 'pdf' as const, description: 'One-page PDF summary of the draft and selections' },
        approval: {
          name: 'approval', format: 'json' as const, description: 'Final approval',
          fields: [
            { key: 'approved', type: 'boolean' as const, description: 'Approved or not' },
            { key: 'notes', type: 'string' as const, description: 'Comments', required: false },
          ],
        },
      },
      edges: [
        { from: 'write_draft', to: 'ask_preferences' },
        { from: 'ask_preferences', to: 'pick_sections' },
        { from: 'pick_sections', to: 'final_review' },
      ],
    };
    await this.saveFlow(meta.id, flow);
  }
}
