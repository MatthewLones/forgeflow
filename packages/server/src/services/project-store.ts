import { mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { FlowDefinition } from '@forgeflow/types';

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

/**
 * Filesystem-backed project store.
 *
 * Layout:
 *   {basePath}/{projectId}/
 *   ├── project.json    ← ProjectMeta
 *   ├── FLOW.json       ← FlowDefinition
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

  private skillsDir(projectId: string): string {
    return join(this.projectDir(projectId), 'skills');
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
        const flowRaw = await readFile(join(dir, 'FLOW.json'), 'utf-8');
        const flow: FlowDefinition = JSON.parse(flowRaw);
        nodeCount = flow.nodes.length;
        skillCount = flow.skills.length;
        hasCheckpoints = flow.nodes.some((n) => n.type === 'checkpoint');
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

      let flow: FlowDefinition | null = null;
      try {
        const flowRaw = await readFile(join(dir, 'FLOW.json'), 'utf-8');
        flow = JSON.parse(flowRaw);
      } catch {
        // No flow yet
      }

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
    try {
      await writeFile(join(dir, 'FLOW.json'), JSON.stringify(flow, null, 2));
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
      return JSON.parse(raw);
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

      // Find sub-skill references (//skill:NAME patterns)
      const subSkills: string[] = [];
      const skillRefs = skillMd.matchAll(/\/\/skill:([a-z][a-z0-9_-]*)/g);
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

  // --- Seed default data ---

  async seedIfEmpty(): Promise<void> {
    const projects = await this.listProjects();
    if (projects.length > 0) return;

    // Create the contract review example project
    const meta = await this.createProject('Legal Contract Review', 'Reviews a contract, flags risks, and generates a redlined version with negotiation memo');
    const flow: FlowDefinition = {
      id: meta.id,
      name: 'Legal Contract Review',
      version: '1.0',
      description: 'Reviews a contract, flags risks, and generates a redlined version with negotiation memo',
      skills: ['contract-law-basics'],
      budget: { maxTurns: 400, maxBudgetUsd: 40.0, timeoutMs: 1200000 },
      nodes: [
        {
          id: 'parse_contract',
          type: 'agent',
          name: 'Parse Contract',
          instructions: 'Read the contract PDF. Extract every clause as a structured object.',
          config: {
            inputs: ['contract.pdf'],
            outputs: ['clauses_parsed.json'],
            skills: [],
            budget: { maxTurns: 25, maxBudgetUsd: 3.0 },
            estimatedDuration: '45s',
          },
          children: [],
        },
        {
          id: 'risk_analysis',
          type: 'agent',
          name: 'Risk Analysis',
          instructions: 'Coordinate 3 parallel research subagents analyzing different aspects of the contract.',
          config: {
            inputs: ['clauses_parsed.json'],
            outputs: ['liability_findings.json', 'ip_findings.json', 'termination_findings.json'],
            skills: ['contract-law-basics'],
            budget: { maxTurns: 120, maxBudgetUsd: 15.0 },
            estimatedDuration: '2min',
          },
          children: [
            {
              id: 'analyze_liability',
              type: 'agent',
              name: 'Liability Analyst',
              instructions: 'Review all indemnification and liability clauses.',
              config: {
                inputs: ['clauses_parsed.json'],
                outputs: ['liability_findings.json'],
                skills: ['contract-law-basics'],
                budget: { maxTurns: 35, maxBudgetUsd: 4.0 },
              },
              children: [],
            },
            {
              id: 'analyze_ip',
              type: 'agent',
              name: 'IP & Confidentiality Analyst',
              instructions: 'Review all IP, confidentiality, and non-compete clauses.',
              config: {
                inputs: ['clauses_parsed.json'],
                outputs: ['ip_findings.json'],
                skills: ['contract-law-basics'],
                budget: { maxTurns: 35, maxBudgetUsd: 4.0 },
              },
              children: [],
            },
            {
              id: 'analyze_termination',
              type: 'agent',
              name: 'Termination Analyst',
              instructions: 'Review termination, governance, and dispute resolution clauses.',
              config: {
                inputs: ['clauses_parsed.json'],
                outputs: ['termination_findings.json'],
                skills: ['contract-law-basics'],
                budget: { maxTurns: 35, maxBudgetUsd: 4.0 },
              },
              children: [],
            },
          ],
        },
        {
          id: 'review_checkpoint',
          type: 'checkpoint',
          name: 'Attorney Review',
          instructions: 'Present the risk analysis to the reviewing attorney.',
          config: {
            inputs: ['risk_matrix.json'],
            outputs: ['attorney_decisions.json'],
            skills: [],
            presentation: {
              title: 'Contract Risk Analysis Complete',
              sections: ['high_risk', 'medium_risk', 'low_risk', 'clean_clauses'],
            },
          },
          children: [],
        },
        {
          id: 'generate_output',
          type: 'agent',
          name: 'Generate Deliverables',
          instructions: 'Generate redlined contract, negotiation memo, and risk summary.',
          config: {
            inputs: ['clauses_parsed.json', 'risk_matrix.json', 'attorney_decisions.json'],
            outputs: ['redline_changes.md', 'negotiation_memo.md', 'risk_summary.json'],
            skills: ['contract-law-basics'],
            budget: { maxTurns: 100, maxBudgetUsd: 12.0 },
            estimatedDuration: '2min',
          },
          children: [],
        },
      ],
      edges: [
        { from: 'parse_contract', to: 'risk_analysis' },
        { from: 'risk_analysis', to: 'review_checkpoint' },
        { from: 'review_checkpoint', to: 'generate_output' },
      ],
    };
    await this.saveFlow(meta.id, flow);

    // Create the contract-law-basics skill
    await this.saveSkill(meta.id, 'contract-law-basics', [
      {
        path: 'SKILL.md',
        content: `---
name: contract-law-basics
description: "California contract law fundamentals for reviewing agreements"
version: "1.0.0"
---

# Contract Law Basics

Fundamental contract law concepts for reviewing legal agreements. Covers formation, interpretation, breach, and remedies.
`,
      },
    ]);
  }
}
