import { Router } from 'express';
import { validateFlow } from '@forgeflow/validator';
import { compilePhasePrompt, compileChildPromptFiles } from '@forgeflow/compiler';
import type { CompileContext } from '@forgeflow/compiler';
import type { FlowDefinition, FlowNode } from '@forgeflow/types';

const router = Router();

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
router.post('/compile/preview', (req, res) => {
  try {
    const flow = req.body as FlowDefinition;
    if (!flow || !flow.id || !flow.nodes) {
      res.status(400).json({ error: 'Valid FlowDefinition is required' });
      return;
    }

    // Validate first to get execution plan
    const validation = validateFlow(flow);
    if (!validation.valid || !validation.executionPlan) {
      res.json({
        valid: false,
        errors: validation.errors,
        phases: [],
      });
      return;
    }

    // Build output map for compile context
    const outputMap = buildOutputMap(flow.nodes);
    const nodeMap = new Map(flow.nodes.map((n) => [n.id, n]));

    const phases = validation.executionPlan.phases.map((phase) => {
      const node = nodeMap.get(phase.nodeId);
      if (!node) return { nodeId: phase.nodeId, prompt: '', childPrompts: {} };

      const inputSources = new Map<string, string>();
      for (const input of node.config.inputs) {
        inputSources.set(input, outputMap.get(input) ?? 'user_upload');
      }

      const context: CompileContext = {
        flowName: flow.name,
        globalSkills: flow.skills,
        inputSources,
        flowBudget: flow.budget,
      };

      const prompt = compilePhasePrompt(node, context);
      const childPrompts: Record<string, string> = {};

      if (node.children.length > 0) {
        const childFiles = compileChildPromptFiles(node, context);
        for (const [filename, content] of childFiles) {
          childPrompts[filename] = content;
        }
      }

      return {
        nodeId: phase.nodeId,
        nodeName: node.name,
        nodeType: node.type,
        prompt,
        childPrompts,
      };
    });

    res.json({ valid: true, phases });
  } catch (err) {
    res.status(500).json({ error: 'Compilation failed unexpectedly' });
  }
});

function buildOutputMap(nodes: FlowNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes) {
    for (const file of node.config.outputs) {
      map.set(file, node.id);
    }
  }
  return map;
}

export default router;
