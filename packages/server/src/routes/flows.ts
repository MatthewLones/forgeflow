import { Router } from 'express';
import { validateFlow, validateFlowDetailed, buildFlowGraph } from '@forgeflow/validator';
import { compilePhase, compileChildPrompts, FORGEFLOW_PHASE_SYSTEM_PROMPT } from '@forgeflow/compiler';
import type { FlowDefinition, ArtifactSchema } from '@forgeflow/types';
import { ProjectStore } from '../services/project-store.js';

const router = Router();
const store = new ProjectStore();

// POST /api/validate — validate a flow definition
router.post('/validate', (req, res) => {
  try {
    const flow = req.body as FlowDefinition;
    if (!flow || !flow.id || !flow.nodes) {
      res.status(400).json({ error: 'Valid FlowDefinition is required' });
      return;
    }
    const result = validateFlow(flow);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Validation failed unexpectedly' });
  }
});

// POST /api/compile/preview — preview compiled prompts for all phases
router.post('/compile/preview', async (req, res) => {
  try {
    // Accept { flow, projectId? } or bare FlowDefinition for backward compat
    const body = req.body as { flow?: FlowDefinition; projectId?: string } | FlowDefinition;
    const flow = ('flow' in body && body.flow) ? body.flow : body as FlowDefinition;
    const projectId = ('projectId' in body) ? body.projectId : undefined;

    if (!flow || !flow.id || !flow.nodes) {
      res.status(400).json({ error: 'Valid FlowDefinition is required' });
      return;
    }

    // Validate and get FlowGraph in one call
    const { result: validation, graph } = validateFlowDetailed(flow);
    if (!validation.valid || !validation.executionPlan) {
      res.json({
        valid: false,
        errors: validation.errors,
        phases: [],
      });
      return;
    }

    const phases = validation.executionPlan.phases.map((phase) => {
      const sym = graph.symbols.get(phase.nodeId);
      if (!sym) return { nodeId: phase.nodeId, prompt: '', childPrompts: {} };

      const { ir, markdown: prompt } = compilePhase(phase.nodeId, graph);
      const childPromptsResult: Record<string, { ir: unknown; markdown: string }> = {};

      if (sym.childIds.length > 0) {
        const { irs, markdowns } = compileChildPrompts(phase.nodeId, graph);
        for (const [filename, markdown] of markdowns) {
          childPromptsResult[filename] = {
            ir: irs.children.get(filename),
            markdown,
          };
        }
      }

      return {
        nodeId: phase.nodeId,
        nodeName: sym.node.name,
        nodeType: sym.node.type,
        ir,
        prompt,
        childPrompts: childPromptsResult,
      };
    });

    // Resolve skill content if projectId is provided
    let skills: Array<{ name: string; files: Array<{ path: string; content: string }> }> | undefined;
    if (projectId) {
      const allSkillNames = [...new Set([...flow.skills, ...flow.nodes.flatMap((n) => n.config.skills)])];
      if (allSkillNames.length > 0) {
        skills = [];
        for (const name of allSkillNames) {
          try {
            const skillState = await store.getSkill(projectId, name);
            if (skillState) {
              skills.push({ name: skillState.skillName, files: skillState.files });
            }
          } catch {
            // Skip skills that fail to load
          }
        }
      }
    }

    res.json({
      valid: true,
      systemPrompt: FORGEFLOW_PHASE_SYSTEM_PROMPT,
      skills,
      phases,
    });
  } catch (err) {
    res.status(500).json({ error: 'Compilation failed unexpectedly' });
  }
});

// GET /api/projects/:id/required-inputs — determine what files the user must provide
router.get('/projects/:id/required-inputs', async (req, res) => {
  try {
    const projectId = req.params.id;
    const flow = await store.getFlow(projectId);
    if (!flow) {
      res.status(404).json({ error: 'Flow not found for project' });
      return;
    }

    const graph = buildFlowGraph(flow);

    const requiredInputs = graph.userUploadFiles.map((filename) => {
      let schema: ArtifactSchema | null = null;
      // Check flow.artifacts registry first
      if (flow.artifacts?.[filename]) {
        schema = flow.artifacts[filename];
      } else {
        // Fall back to entry node inputSchemas
        for (const [, sym] of graph.symbols) {
          if (sym.inputSchemas.has(filename)) {
            schema = sym.inputSchemas.get(filename)!;
            break;
          }
        }
      }
      return { name: filename, schema };
    });

    res.json({ requiredInputs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to determine required inputs' });
  }
});

export default router;
