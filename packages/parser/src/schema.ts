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

const artifactFieldSchema = z.object({
  key: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
  description: z.string(),
  required: z.boolean().optional(),
});

const artifactSchemaSchema = z.object({
  name: z.string().min(1),
  format: z.enum(['json', 'markdown', 'text', 'csv', 'pdf', 'image', 'binary']),
  description: z.string(),
  fields: z.array(artifactFieldSchema).optional(),
});

/** An input/output entry: plain filename string or full ArtifactSchema */
const artifactRefSchema = z.union([z.string(), artifactSchemaSchema]);

const nodeConfigSchema = z.object({
  inputs: z.array(artifactRefSchema),
  outputs: z.array(artifactRefSchema),
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
  auto: z.boolean().optional(),
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
  artifacts: z.record(z.string(), artifactSchemaSchema).optional(),
});
