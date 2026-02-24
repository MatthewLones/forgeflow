import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseFlowJSON } from '../../parser/src/parser.js';
import { validateFlow } from '../src/validator.js';
import { formatValidationSummary } from '../src/diagnostics.js';

const EXAMPLES_DIR = resolve(import.meta.dirname, '../../../examples');

async function loadAndValidate(name: string, userUploads?: string[]) {
  const raw = await readFile(resolve(EXAMPLES_DIR, name, 'FLOW.json'), 'utf-8');
  const parsed = parseFlowJSON(raw);
  if (!parsed.success) throw new Error(`Parse failed for ${name}: ${parsed.errors.map((e) => e.message).join(', ')}`);
  return validateFlow(parsed.flow!, userUploads ? { userUploadFiles: userUploads } : undefined);
}

describe('validateFlow integration', () => {
  it('validates simple-summary flow', async () => {
    const result = await loadAndValidate('simple-summary');
    expect(result.valid).toBe(true);
    expect(result.executionPlan).not.toBeNull();
    expect(result.executionPlan!.phases).toHaveLength(2);
    expect(result.executionPlan!.phases[0].nodeId).toBe('extract_content');
    expect(result.executionPlan!.phases[1].nodeId).toBe('generate_summary');
  });

  it('validates paper-summary flow', async () => {
    const result = await loadAndValidate('paper-summary');
    expect(result.valid).toBe(true);
    expect(result.executionPlan).not.toBeNull();
    expect(result.executionPlan!.phases).toHaveLength(3);
  });

  it('catches contract-review dependency error', async () => {
    const result = await loadAndValidate('contract-review');
    expect(result.valid).toBe(false);
    const unresolvedErrors = result.errors.filter((e) => e.code === 'UNRESOLVED_INPUT');
    expect(unresolvedErrors.length).toBeGreaterThan(0);
    // Should flag risk_matrix.json as unresolved
    const riskMatrixError = unresolvedErrors.find((e) => e.message.includes('risk_matrix.json'));
    expect(riskMatrixError).toBeDefined();
  });

  it('validates insurance-claim flow', async () => {
    const result = await loadAndValidate('insurance-claim');
    expect(result.valid).toBe(true);
    expect(result.executionPlan).not.toBeNull();
    expect(result.executionPlan!.phases).toHaveLength(4);
  });

  it('produces correct execution plan for simple-summary', async () => {
    const result = await loadAndValidate('simple-summary');
    const plan = result.executionPlan!;

    // Phase 0: extract_content reads document.pdf (user upload)
    expect(plan.phases[0].inputsFrom).toEqual([
      { file: 'document.pdf', source: 'user_upload' },
    ]);

    // Phase 1: generate_summary reads content_extracted.json (from extract_content)
    expect(plan.phases[1].inputsFrom).toEqual([
      { file: 'content_extracted.json', source: 'extract_content' },
    ]);

    // Total estimated cost
    expect(plan.totalEstimatedCost.turns).toBe(45); // 25 + 20
    expect(plan.totalEstimatedCost.usd).toBe(5); // 3 + 2

    // Critical path is the full chain
    expect(plan.criticalPath).toEqual(['extract_content', 'generate_summary']);
  });

  it('produces execution plan with children for insurance-claim', async () => {
    const result = await loadAndValidate('insurance-claim');
    const plan = result.executionPlan!;

    // Phase 1 (coverage_check) should have children
    const coveragePhase = plan.phases.find((p) => p.nodeId === 'coverage_check');
    expect(coveragePhase).toBeDefined();
    expect(coveragePhase!.children).toBeDefined();
    expect(coveragePhase!.children).toHaveLength(2);
  });

  it('formats error output readably', async () => {
    const result = await loadAndValidate('contract-review');
    const output = formatValidationSummary(result.errors, result.warnings, result.suggestions);
    expect(output).toContain('UNRESOLVED_INPUT');
    expect(output).toContain('risk_matrix.json');
    expect(output).toContain('Validation FAILED');
  });
});
