import { z } from 'zod';

const nodeIdPattern = /^[a-z][a-z0-9_]*$/;

const nodeBudgetSchema = z.object({
  maxTurns: z.number().int().positive(),
  maxBudgetUsd: z.number().positive(),
});

const checkpointPresentationSchema = z.object({
  title: z.string().min(1),
  sections: z.array(z.string().min(1)).min(1),
});

const interruptConfigSchema = z.object({
  type: z.enum(['approval', 'qa', 'selection', 'review', 'escalation']),
  mode: z.enum(['inline', 'checkpoint']).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const nodeConfigSchema = z.object({
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  skills: z.array(z.string()),
  budget: nodeBudgetSchema.optional(),
  estimatedDuration: z.string().optional(),
  presentation: checkpointPresentationSchema.optional(),
  interrupts: z.array(interruptConfigSchema).optional(),
});

const flowNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    id: z.string().regex(nodeIdPattern, 'Node ID must be snake_case: [a-z][a-z0-9_]*'),
    type: z.enum(['agent', 'checkpoint', 'merge']),
    name: z.string().min(1),
    instructions: z.string(),
    config: nodeConfigSchema,
    children: z.array(flowNodeSchema),
  }),
);

const flowEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

const flowBudgetSchema = z.object({
  maxTurns: z.number().int().positive(),
  maxBudgetUsd: z.number().positive(),
  timeoutMs: z.number().int().positive(),
});

export const flowDefinitionSchema = z.object({
  id: z.string().regex(nodeIdPattern, 'Flow ID must be snake_case: [a-z][a-z0-9_]*'),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  skills: z.array(z.string()),
  budget: flowBudgetSchema,
  nodes: z.array(flowNodeSchema).min(1),
  edges: z.array(flowEdgeSchema),
});
