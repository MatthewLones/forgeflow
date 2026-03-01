import { Router } from 'express';
import { validateFlow, validateFlowDetailed } from '@forgeflow/validator';
import { compilePhase, compileChildPrompts } from '@forgeflow/compiler';
import type { FlowDefinition } from '@forgeflow/types';

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

    res.json({ valid: true, phases });
  } catch (err) {
    res.status(500).json({ error: 'Compilation failed unexpectedly' });
  }
});

export default router;
