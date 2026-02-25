import { describe, it, expect } from 'vitest';
import { checkSchemaCompat } from '../src/passes/schema-compat.js';
import type { FlowDefinition, ArtifactSchema } from '@forgeflow/types';

function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    id: 'test_flow',
    name: 'Test Flow',
    version: '1.0',
    description: 'A test flow',
    skills: [],
    budget: { maxTurns: 100, maxBudgetUsd: 10, timeoutMs: 300000 },
    nodes: [],
    edges: [],
    ...overrides,
  };
}

describe('checkSchemaCompat', () => {
  it('returns no warnings when all string-based artifacts', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: [], outputs: ['data.json'], skills: [] }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: ['data.json'], outputs: [], skills: [] }, children: [] },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const diagnostics = checkSchemaCompat(flow);
    expect(diagnostics).toHaveLength(0);
  });

  it('returns no warnings when schemas match', () => {
    const outputSchema: ArtifactSchema = {
      name: 'data.json', format: 'json', description: 'Data',
      fields: [{ key: 'id', type: 'number', description: 'ID' }],
    };
    const inputSchema: ArtifactSchema = {
      name: 'data.json', format: 'json', description: 'Data',
      fields: [{ key: 'id', type: 'number', description: 'ID' }],
    };
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: [], outputs: [outputSchema], skills: [] }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: [inputSchema], outputs: [], skills: [] }, children: [] },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const diagnostics = checkSchemaCompat(flow);
    expect(diagnostics).toHaveLength(0);
  });

  it('warns on format mismatch', () => {
    const outputSchema: ArtifactSchema = { name: 'report.md', format: 'json', description: 'Report' };
    const inputSchema: ArtifactSchema = { name: 'report.md', format: 'markdown', description: 'Report' };
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: [], outputs: [outputSchema], skills: [] }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: [inputSchema], outputs: [], skills: [] }, children: [] },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const diagnostics = checkSchemaCompat(flow);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('SCHEMA_FORMAT_MISMATCH');
    expect(diagnostics[0].severity).toBe('warning');
  });

  it('warns on missing required fields', () => {
    const outputSchema: ArtifactSchema = {
      name: 'data.json', format: 'json', description: 'Data',
      fields: [{ key: 'id', type: 'number', description: 'ID' }],
    };
    const inputSchema: ArtifactSchema = {
      name: 'data.json', format: 'json', description: 'Data',
      fields: [
        { key: 'id', type: 'number', description: 'ID' },
        { key: 'title', type: 'string', description: 'Title', required: true },
      ],
    };
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: [], outputs: [outputSchema], skills: [] }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: [inputSchema], outputs: [], skills: [] }, children: [] },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const diagnostics = checkSchemaCompat(flow);
    const missingField = diagnostics.filter((d) => d.code === 'SCHEMA_MISSING_FIELD');
    expect(missingField).toHaveLength(1);
    expect(missingField[0].message).toContain('title');
  });

  it('does not warn on optional consumer fields missing from producer', () => {
    const outputSchema: ArtifactSchema = {
      name: 'data.json', format: 'json', description: 'Data',
      fields: [{ key: 'id', type: 'number', description: 'ID' }],
    };
    const inputSchema: ArtifactSchema = {
      name: 'data.json', format: 'json', description: 'Data',
      fields: [
        { key: 'id', type: 'number', description: 'ID' },
        { key: 'notes', type: 'string', description: 'Notes', required: false },
      ],
    };
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: [], outputs: [outputSchema], skills: [] }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: [inputSchema], outputs: [], skills: [] }, children: [] },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const diagnostics = checkSchemaCompat(flow);
    expect(diagnostics).toHaveLength(0);
  });

  it('checks schemas in children recursively', () => {
    const outputSchema: ArtifactSchema = { name: 'child_out.json', format: 'json', description: 'Out' };
    const inputSchema: ArtifactSchema = { name: 'child_out.json', format: 'markdown', description: 'Out' };
    const flow = makeFlow({
      nodes: [
        {
          id: 'parent', type: 'agent', name: 'Parent', instructions: 'Coordinate.',
          config: { inputs: [], outputs: [], skills: [] },
          children: [
            { id: 'child_a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: [], outputs: [outputSchema], skills: [] }, children: [] },
            { id: 'child_b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: [inputSchema], outputs: [], skills: [] }, children: [] },
          ],
        },
      ],
      edges: [],
    });
    const diagnostics = checkSchemaCompat(flow);
    expect(diagnostics.some((d) => d.code === 'SCHEMA_FORMAT_MISMATCH')).toBe(true);
  });
});
