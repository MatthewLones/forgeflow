import { describe, it, expect } from 'vitest';
import { runValidationPipeline } from '../src/rule-runner.js';
import { createDefaultRegistry, createRegistry } from '../src/rule-registry.js';
import { buildFlowGraph } from '../src/flow-graph.js';
import type {
  FlowDefinition,
  FlowNode,
  FlowGraph,
  ValidationRule,
  FlowDiagnostic,
  ValidateOptions,
} from '@forgeflow/types';

function makeNode(overrides: Partial<FlowNode> & { id: string }): FlowNode {
  return {
    type: 'agent',
    name: overrides.id,
    instructions: 'Do something',
    config: {
      inputs: [],
      outputs: [],
      skills: [],
    },
    children: [],
    ...overrides,
  };
}

function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    id: 'test_flow',
    name: 'Test Flow',
    version: '1.0.0',
    description: 'A test flow',
    skills: [],
    budget: { maxTurns: 100, maxBudgetUsd: 10, timeoutMs: 300000 },
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function makeRule(overrides: Partial<ValidationRule['descriptor']> & { id: string }): ValidationRule {
  return {
    descriptor: {
      name: overrides.id,
      description: `Rule ${overrides.id}`,
      category: 'custom',
      dependencies: [],
      defaultSeverity: 'error',
      enabledByDefault: true,
      ...overrides,
    },
    check: () => [],
  };
}

function makeErrorDiagnostic(code: string, nodeId?: string): FlowDiagnostic {
  return {
    code,
    severity: 'error',
    message: `Error: ${code}`,
    location: { nodeId },
  };
}

function makeWarningDiagnostic(code: string, nodeId?: string): FlowDiagnostic {
  return {
    code,
    severity: 'warning',
    message: `Warning: ${code}`,
    location: { nodeId },
  };
}

describe('runValidationPipeline', () => {
  it('runs all default rules on a valid flow', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({ id: 'a', config: { inputs: ['doc.pdf'], outputs: ['result.md'], skills: [] } }),
      ],
    });
    const graph = buildFlowGraph(flow);
    const rules = createDefaultRegistry();

    const { result, ruleResults, totalDurationMs } = runValidationPipeline(graph, rules);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.executionPlan).not.toBeNull();
    expect(ruleResults).toHaveLength(11);
    expect(ruleResults.every((r) => !r.skipped)).toBe(true);
    expect(totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('collects errors from failing rules', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({ id: 'a', config: { inputs: [], outputs: ['out.md'], skills: [] } }),
        makeNode({ id: 'b', config: { inputs: ['missing.txt'], outputs: ['final.md'], skills: [] } }),
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const graph = buildFlowGraph(flow);
    const rules = createDefaultRegistry();

    const { result } = runValidationPipeline(graph, rules);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.executionPlan).toBeNull();
  });

  it('disables rules via disabledRules option', () => {
    const graph = buildFlowGraph(makeFlow({ nodes: [makeNode({ id: 'a' })] }));

    const ruleA = makeRule({ id: 'test/a' });
    const ruleB = makeRule({ id: 'test/b' });
    ruleA.check = () => [makeErrorDiagnostic('A_ERROR')];
    ruleB.check = () => [makeWarningDiagnostic('B_WARN')];

    const { result, ruleResults } = runValidationPipeline(graph, [ruleA, ruleB], {
      disabledRules: ['test/a'],
    });

    // Only ruleB ran
    expect(ruleResults).toHaveLength(1);
    expect(ruleResults[0].ruleId).toBe('test/b');
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });

  it('force-enables rules that are disabled by default', () => {
    const graph = buildFlowGraph(makeFlow({ nodes: [makeNode({ id: 'a' })] }));

    const rule = makeRule({ id: 'test/disabled', enabledByDefault: false });
    rule.check = () => [makeWarningDiagnostic('DISABLED_WARN')];

    // Without enabledRules — rule should not run
    const result1 = runValidationPipeline(graph, [rule]);
    expect(result1.ruleResults).toHaveLength(0);

    // With enabledRules — rule should run
    const result2 = runValidationPipeline(graph, [rule], { enabledRules: ['test/disabled'] });
    expect(result2.ruleResults).toHaveLength(1);
    expect(result2.result.warnings).toHaveLength(1);
  });

  it('skips rules whose dependencies produced errors', () => {
    const graph = buildFlowGraph(makeFlow({ nodes: [makeNode({ id: 'a' })] }));

    const ruleA = makeRule({ id: 'test/a' });
    ruleA.check = () => [makeErrorDiagnostic('A_ERROR')];

    const ruleB = makeRule({ id: 'test/b', dependencies: ['test/a'] });
    let ruleBCalled = false;
    ruleB.check = () => {
      ruleBCalled = true;
      return [];
    };

    const { ruleResults } = runValidationPipeline(graph, [ruleA, ruleB]);

    expect(ruleResults).toHaveLength(2);
    expect(ruleResults[0].ruleId).toBe('test/a');
    expect(ruleResults[0].skipped).toBe(false);
    expect(ruleResults[1].ruleId).toBe('test/b');
    expect(ruleResults[1].skipped).toBe(true);
    expect(ruleResults[1].skipReason).toContain('test/a');
    expect(ruleBCalled).toBe(false);
  });

  it('runs skipped rules when continueOnDependencyFailure is true', () => {
    const graph = buildFlowGraph(makeFlow({ nodes: [makeNode({ id: 'a' })] }));

    const ruleA = makeRule({ id: 'test/a' });
    ruleA.check = () => [makeErrorDiagnostic('A_ERROR')];

    const ruleB = makeRule({ id: 'test/b', dependencies: ['test/a'] });
    ruleB.check = () => [makeWarningDiagnostic('B_WARN')];

    const { ruleResults, result } = runValidationPipeline(graph, [ruleA, ruleB], {
      continueOnDependencyFailure: true,
    });

    expect(ruleResults).toHaveLength(2);
    expect(ruleResults[0].skipped).toBe(false);
    expect(ruleResults[1].skipped).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it('respects topological order from dependencies', () => {
    const graph = buildFlowGraph(makeFlow({ nodes: [makeNode({ id: 'a' })] }));
    const executionOrder: string[] = [];

    const ruleC = makeRule({ id: 'test/c', dependencies: ['test/b'] });
    ruleC.check = () => { executionOrder.push('c'); return []; };

    const ruleA = makeRule({ id: 'test/a' });
    ruleA.check = () => { executionOrder.push('a'); return []; };

    const ruleB = makeRule({ id: 'test/b', dependencies: ['test/a'] });
    ruleB.check = () => { executionOrder.push('b'); return []; };

    // Pass rules in non-dependency order
    runValidationPipeline(graph, [ruleC, ruleA, ruleB]);

    expect(executionOrder).toEqual(['a', 'b', 'c']);
  });

  it('separates diagnostics by severity', () => {
    const graph = buildFlowGraph(makeFlow({ nodes: [makeNode({ id: 'a' })] }));

    const rule = makeRule({ id: 'test/mixed' });
    rule.check = () => [
      makeErrorDiagnostic('ERR'),
      makeWarningDiagnostic('WARN'),
      { code: 'SUG', severity: 'suggestion', message: 'Suggestion', location: {} },
    ];

    const { result } = runValidationPipeline(graph, [rule]);

    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.suggestions).toHaveLength(1);
    expect(result.valid).toBe(false);
  });

  it('builds execution plan only when no errors', () => {
    const flow = makeFlow({
      nodes: [makeNode({ id: 'a' })],
    });
    const graph = buildFlowGraph(flow);

    // With errors — no plan
    const errorRule = makeRule({ id: 'test/err' });
    errorRule.check = () => [makeErrorDiagnostic('FAIL')];

    const result1 = runValidationPipeline(graph, [errorRule]);
    expect(result1.result.executionPlan).toBeNull();

    // Warnings only — plan is built
    const warnRule = makeRule({ id: 'test/warn' });
    warnRule.check = () => [makeWarningDiagnostic('WARN')];

    const result2 = runValidationPipeline(graph, [warnRule]);
    expect(result2.result.executionPlan).not.toBeNull();
    expect(result2.result.valid).toBe(true);
  });

  it('provides per-rule timing data', () => {
    const graph = buildFlowGraph(makeFlow({ nodes: [makeNode({ id: 'a' })] }));

    const rule = makeRule({ id: 'test/timed' });
    rule.check = () => [];

    const { ruleResults } = runValidationPipeline(graph, [rule]);

    expect(ruleResults).toHaveLength(1);
    expect(ruleResults[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(ruleResults[0].category).toBe('custom');
    expect(ruleResults[0].ruleName).toBe('test/timed');
  });

  it('returns the FlowGraph in the result', () => {
    const flow = makeFlow({ nodes: [makeNode({ id: 'a' })] });
    const graph = buildFlowGraph(flow);

    const { graph: returnedGraph } = runValidationPipeline(graph, []);

    expect(returnedGraph).toBe(graph);
    expect(returnedGraph.symbols.has('a')).toBe(true);
  });

  it('handles empty rule list', () => {
    const flow = makeFlow({ nodes: [makeNode({ id: 'a' })] });
    const graph = buildFlowGraph(flow);

    const { result, ruleResults } = runValidationPipeline(graph, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(ruleResults).toHaveLength(0);
    expect(result.executionPlan).not.toBeNull();
  });

  it('handles dependency on a rule not in the registry (graceful skip)', () => {
    const graph = buildFlowGraph(makeFlow({ nodes: [makeNode({ id: 'a' })] }));

    // Depends on a rule that doesn't exist in the provided list
    const rule = makeRule({ id: 'test/orphan', dependencies: ['nonexistent/rule'] });
    rule.check = () => [];

    const { ruleResults } = runValidationPipeline(graph, [rule]);

    // Should run anyway — unknown dependency treated as satisfied
    expect(ruleResults).toHaveLength(1);
    expect(ruleResults[0].skipped).toBe(false);
  });
});

describe('createRegistry', () => {
  it('returns default registry with 11 rules', () => {
    const rules = createDefaultRegistry();
    expect(rules).toHaveLength(11);

    const ids = rules.map((r) => r.descriptor.id);
    // 6 structural rules
    expect(ids).toContain('structural/node-id-format');
    expect(ids).toContain('structural/node-id-unique');
    expect(ids).toContain('structural/edge-validity');
    expect(ids).toContain('structural/dag-acyclic');
    expect(ids).toContain('structural/connectivity');
    expect(ids).toContain('structural/node-type-rules');
    // Non-structural rules
    expect(ids).toContain('type-system/output-uniqueness');
    expect(ids).toContain('type-system/schema-compatibility');
    expect(ids).toContain('dataflow/dependency-resolution');
    expect(ids).toContain('resource/budget-check');
    expect(ids).toContain('runtime/interrupt-validity');
  });

  it('composes a custom registry with additions', () => {
    const base = createDefaultRegistry();
    const customRule = makeRule({ id: 'custom/my-rule' });

    const registry = createRegistry(base, { additions: [customRule] });

    expect(registry).toHaveLength(12);
    expect(registry[11].descriptor.id).toBe('custom/my-rule');
  });

  it('composes a custom registry with removals', () => {
    const base = createDefaultRegistry();

    const registry = createRegistry(base, { removals: ['resource/budget-check'] });

    expect(registry).toHaveLength(10);
    expect(registry.every((r) => r.descriptor.id !== 'resource/budget-check')).toBe(true);
  });

  it('composes with both additions and removals', () => {
    const base = createDefaultRegistry();
    const customRule = makeRule({ id: 'custom/replacement' });

    const registry = createRegistry(base, {
      removals: ['resource/budget-check'],
      additions: [customRule],
    });

    expect(registry).toHaveLength(11);
    expect(registry.every((r) => r.descriptor.id !== 'resource/budget-check')).toBe(true);
    expect(registry.some((r) => r.descriptor.id === 'custom/replacement')).toBe(true);
  });
});

describe('validateFlowDetailed integration', () => {
  it('returns full pipeline introspection', async () => {
    // Use dynamic import to test the exported function
    const { validateFlowDetailed } = await import('../src/validator.js');

    const flow = makeFlow({
      nodes: [
        makeNode({ id: 'a', config: { inputs: ['doc.pdf'], outputs: ['result.md'], skills: [] } }),
      ],
    });

    const detailed = validateFlowDetailed(flow);

    expect(detailed.result.valid).toBe(true);
    expect(detailed.ruleResults).toHaveLength(11);
    expect(detailed.graph.symbols.has('a')).toBe(true);
    expect(detailed.totalDurationMs).toBeGreaterThanOrEqual(0);

    // Check that each rule result has the expected shape
    for (const rr of detailed.ruleResults) {
      expect(rr.ruleId).toBeTruthy();
      expect(rr.ruleName).toBeTruthy();
      expect(rr.category).toBeTruthy();
      expect(Array.isArray(rr.diagnostics)).toBe(true);
      expect(typeof rr.skipped).toBe('boolean');
      expect(typeof rr.durationMs).toBe('number');
    }
  });

  it('dependency-resolution is skipped when structural fails', async () => {
    const { validateFlowDetailed } = await import('../src/validator.js');

    const flow = makeFlow({
      nodes: [
        makeNode({ id: 'a' }),
        makeNode({ id: 'b' }),
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },  // cycle → structural fails
      ],
    });

    const detailed = validateFlowDetailed(flow);

    expect(detailed.result.valid).toBe(false);

    const depResult = detailed.ruleResults.find((r) => r.ruleId === 'dataflow/dependency-resolution');
    expect(depResult).toBeDefined();
    expect(depResult!.skipped).toBe(true);
    expect(depResult!.skipReason).toContain('structural/dag-acyclic');
  });
});
