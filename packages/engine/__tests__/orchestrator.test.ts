import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { FlowOrchestrator } from '../src/orchestrator.js';
import { MockRunner } from '../src/runner.js';
import { LocalStateStore } from '../../state-store/src/local.js';
import { parseFlowJSON } from '../../parser/src/parser.js';
import type { FlowDefinition, StateFile, ProgressEvent } from '@forgeflow/types';
import type { MockBehavior } from '../src/runner.js';

let storeDir: string;
let workspaceDir: string;
let store: LocalStateStore;

beforeEach(async () => {
  storeDir = await mkdtemp(join(tmpdir(), 'forgeflow-store-'));
  workspaceDir = await mkdtemp(join(tmpdir(), 'forgeflow-workspace-'));
  store = new LocalStateStore(storeDir);
});

afterEach(async () => {
  await rm(storeDir, { recursive: true, force: true });
  await rm(workspaceDir, { recursive: true, force: true });
});

const EXAMPLES_DIR = resolve(import.meta.dirname, '../../../examples');

async function loadFlow(name: string): Promise<FlowDefinition> {
  const raw = await readFile(resolve(EXAMPLES_DIR, name, 'FLOW.json'), 'utf-8');
  const parsed = parseFlowJSON(raw);
  if (!parsed.success) throw new Error(`Parse failed: ${parsed.errors.map((e) => e.message).join(', ')}`);
  return parsed.flow!;
}

describe('FlowOrchestrator', () => {
  it('executes simple-summary flow end-to-end', async () => {
    const flow = await loadFlow('simple-summary');

    const behaviors = new Map<string, MockBehavior>([
      [
        'extract_content',
        {
          outputFiles: { 'content_extracted.json': '{"text":"extracted content"}' },
          cost: { turns: 8, usd: 1.2 },
        },
      ],
      [
        'generate_summary',
        {
          outputFiles: { 'summary.json': '{"summary":"the summary"}' },
          cost: { turns: 6, usd: 0.8 },
        },
      ],
    ]);

    const runner = new MockRunner(behaviors);
    const orchestrator = new FlowOrchestrator(runner, store, {
      workspaceBasePath: workspaceDir,
    });

    const userUploads: StateFile[] = [
      { name: 'document.pdf', content: Buffer.from('fake pdf'), producedByPhase: 'user_upload' },
    ];

    const result = await orchestrator.execute(flow, userUploads);

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.totalCost.turns).toBe(14); // 8 + 6
    expect(result.totalCost.usd).toBeCloseTo(2.0); // 1.2 + 0.8
    expect(result.outputFiles).toContain('content_extracted.json');
    expect(result.outputFiles).toContain('summary.json');
  });

  it('executes paper-summary flow (3 phases)', async () => {
    const flow = await loadFlow('paper-summary');

    const behaviors = new Map<string, MockBehavior>([
      [
        'extract_structure',
        {
          outputFiles: { 'paper_structure.json': '{"structure":"extracted"}' },
          cost: { turns: 10, usd: 1.5 },
        },
      ],
      [
        'critique_methodology',
        {
          outputFiles: { 'methodology_critique.json': '{"critique":"done"}' },
          cost: { turns: 15, usd: 2.0 },
        },
      ],
      [
        'generate_summary',
        {
          outputFiles: { 'paper_summary.md': '# Summary' },
          cost: { turns: 8, usd: 1.0 },
        },
      ],
    ]);

    const runner = new MockRunner(behaviors);
    const orchestrator = new FlowOrchestrator(runner, store, {
      workspaceBasePath: workspaceDir,
    });

    const result = await orchestrator.execute(flow, [
      { name: 'paper.pdf', content: Buffer.from('pdf'), producedByPhase: 'user_upload' },
    ]);

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.totalCost.turns).toBe(33); // 10 + 15 + 8
    expect(result.outputFiles).toHaveLength(3);
  });

  it('stops at checkpoint and returns awaiting_input', async () => {
    const flow = await loadFlow('insurance-claim');

    const behaviors = new Map<string, MockBehavior>([
      [
        'document_intake',
        {
          outputFiles: { 'claim_extracted.json': '{"claim":"data"}' },
          cost: { turns: 8, usd: 1.0 },
        },
      ],
      [
        'coverage_check',
        {
          outputFiles: {
            'policy_analysis.json': '{"coverage":"full"}',
            'medical_review.json': '{"review":"done"}',
          },
          cost: { turns: 20, usd: 3.0 },
        },
      ],
    ]);

    const runner = new MockRunner(behaviors);
    const events: ProgressEvent[] = [];
    const orchestrator = new FlowOrchestrator(runner, store, {
      workspaceBasePath: workspaceDir,
      onProgress: (e) => events.push(e),
    });

    const result = await orchestrator.execute(flow, [
      { name: 'claim_form.pdf', content: Buffer.from('claim'), producedByPhase: 'user_upload' },
      { name: 'policy.pdf', content: Buffer.from('policy'), producedByPhase: 'user_upload' },
      { name: 'medical_records.pdf', content: Buffer.from('medical'), producedByPhase: 'user_upload' },
    ]);

    // Should pause at the checkpoint
    expect(result.status).toBe('awaiting_input');
    expect(result.success).toBe(true);

    // Should have emitted checkpoint event
    const checkpointEvent = events.find((e) => e.type === 'checkpoint');
    expect(checkpointEvent).toBeDefined();

    // Run state should be saved
    const runState = await store.loadRunState(result.runId);
    expect(runState).not.toBeNull();
    expect(runState!.status).toBe('awaiting_input');
  });

  it('stops on phase failure', async () => {
    const flow = await loadFlow('simple-summary');

    const behaviors = new Map<string, MockBehavior>([
      [
        'extract_content',
        {
          outputFiles: {},
          success: false,
          error: 'Agent timed out',
        },
      ],
    ]);

    const runner = new MockRunner(behaviors);
    const events: ProgressEvent[] = [];
    const orchestrator = new FlowOrchestrator(runner, store, {
      workspaceBasePath: workspaceDir,
      onProgress: (e) => events.push(e),
    });

    const result = await orchestrator.execute(flow, [
      { name: 'document.pdf', content: Buffer.from('pdf'), producedByPhase: 'user_upload' },
    ]);

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('Agent timed out');

    // Should have emitted phase_failed event
    const failEvent = events.find((e) => e.type === 'phase_failed');
    expect(failEvent).toBeDefined();
  });

  it('emits progress events in correct order', async () => {
    const flow = await loadFlow('simple-summary');

    const behaviors = new Map<string, MockBehavior>([
      ['extract_content', { outputFiles: { 'content_extracted.json': '{}' } }],
      ['generate_summary', { outputFiles: { 'summary.json': '{}' } }],
    ]);

    const runner = new MockRunner(behaviors);
    const events: ProgressEvent[] = [];
    const orchestrator = new FlowOrchestrator(runner, store, {
      workspaceBasePath: workspaceDir,
      onProgress: (e) => events.push(e),
    });

    await orchestrator.execute(flow, [
      { name: 'document.pdf', content: Buffer.from('pdf'), producedByPhase: 'user_upload' },
    ]);

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'phase_started',
      'prompt_compiled',
      'workspace_prepared',
      'output_validated',
      'phase_completed',
      'phase_started',
      'prompt_compiled',
      'workspace_prepared',
      'output_validated',
      'phase_completed',
      'run_completed',
    ]);
  });

  it('saves run state after each phase', async () => {
    const flow = await loadFlow('simple-summary');

    const behaviors = new Map<string, MockBehavior>([
      ['extract_content', { outputFiles: { 'content_extracted.json': '{}' }, cost: { turns: 10, usd: 1.0 } }],
      ['generate_summary', { outputFiles: { 'summary.json': '{}' }, cost: { turns: 5, usd: 0.5 } }],
    ]);

    const runner = new MockRunner(behaviors);
    const orchestrator = new FlowOrchestrator(runner, store, {
      workspaceBasePath: workspaceDir,
    });

    const result = await orchestrator.execute(flow, [
      { name: 'document.pdf', content: Buffer.from('pdf'), producedByPhase: 'user_upload' },
    ]);

    const finalState = await store.loadRunState(result.runId);
    expect(finalState).not.toBeNull();
    expect(finalState!.status).toBe('completed');
    expect(finalState!.completedPhases).toEqual(['extract_content', 'generate_summary']);
    expect(finalState!.totalCost.turns).toBe(15);
    expect(finalState!.totalCost.usd).toBeCloseTo(1.5);
  });

  it('persists output artifacts in state store', async () => {
    const flow = await loadFlow('simple-summary');

    const behaviors = new Map<string, MockBehavior>([
      ['extract_content', { outputFiles: { 'content_extracted.json': '{"text":"hello"}' } }],
      ['generate_summary', { outputFiles: { 'summary.json': '{"summary":"world"}' } }],
    ]);

    const runner = new MockRunner(behaviors);
    const orchestrator = new FlowOrchestrator(runner, store, {
      workspaceBasePath: workspaceDir,
    });

    const result = await orchestrator.execute(flow, [
      { name: 'document.pdf', content: Buffer.from('pdf'), producedByPhase: 'user_upload' },
    ]);

    // Verify artifacts are in state store
    const artifacts = await store.loadPhaseInputs(result.runId, [
      'content_extracted.json',
      'summary.json',
    ]);
    expect(artifacts).toHaveLength(2);
    expect(artifacts.find((f) => f.name === 'content_extracted.json')!.content.toString()).toBe(
      '{"text":"hello"}',
    );
  });

  it('resumes after checkpoint and completes', async () => {
    const flow = await loadFlow('insurance-claim');

    const behaviors = new Map<string, MockBehavior>([
      [
        'parse_claim',
        {
          outputFiles: {
            'claim_parsed.json': '{"claim":"data"}',
            'damage_assessment.json': '{"damage":"moderate"}',
          },
          cost: { turns: 8, usd: 1.0 },
        },
      ],
      [
        'coverage_check',
        {
          outputFiles: {
            'coverage_analysis.json': '{"coverage":"full"}',
            'comparable_claims.json': '{"claims":[]}',
          },
          cost: { turns: 20, usd: 3.0 },
        },
      ],
      [
        'generate_recommendation',
        {
          outputFiles: {
            'determination_letter.md': '# Approved',
            'reserve_recommendation.json': '{"reserve":5000}',
            'decision_rationale.md': '# Rationale',
          },
          cost: { turns: 15, usd: 2.5 },
        },
      ],
    ]);

    const runner = new MockRunner(behaviors);
    const events: ProgressEvent[] = [];
    const orchestrator = new FlowOrchestrator(runner, store, {
      workspaceBasePath: workspaceDir,
      onProgress: (e) => events.push(e),
    });

    const userUploads: StateFile[] = [
      { name: 'incident_report.pdf', content: Buffer.from('report'), producedByPhase: 'user_upload' },
      { name: 'photos.zip', content: Buffer.from('photos'), producedByPhase: 'user_upload' },
      { name: 'policy.pdf', content: Buffer.from('policy'), producedByPhase: 'user_upload' },
    ];

    // Phase 1: Execute — should pause at checkpoint
    const firstResult = await orchestrator.execute(flow, userUploads);
    expect(firstResult.status).toBe('awaiting_input');
    expect(firstResult.success).toBe(true);

    // Verify checkpoint was saved with correct state
    const checkpoint = await store.loadCheckpoint(firstResult.runId);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.checkpointNodeId).toBe('adjuster_review');
    expect(checkpoint!.status).toBe('waiting');

    const runStateBeforeResume = await store.loadRunState(firstResult.runId);
    expect(runStateBeforeResume!.completedPhases).toEqual(['parse_claim', 'coverage_check']);

    // Phase 2: Resume with adjuster input
    events.length = 0;
    const resumeResult = await orchestrator.resume(flow, firstResult.runId, {
      fileName: 'adjuster_input.json',
      content: Buffer.from('{"approved":true,"notes":"looks good"}'),
    });

    expect(resumeResult.success).toBe(true);
    expect(resumeResult.status).toBe('completed');

    // Cost should combine pre-checkpoint + post-checkpoint
    expect(resumeResult.totalCost.turns).toBe(28 + 15); // (8+20) + 15
    expect(resumeResult.totalCost.usd).toBeCloseTo(4.0 + 2.5); // (1+3) + 2.5

    // Outputs should include post-checkpoint files
    expect(resumeResult.outputFiles).toContain('determination_letter.md');
    expect(resumeResult.outputFiles).toContain('reserve_recommendation.json');
    expect(resumeResult.outputFiles).toContain('decision_rationale.md');

    // Should have emitted resume event
    const resumeEvent = events.find((e) => e.type === 'resume');
    expect(resumeEvent).toBeDefined();
    if (resumeEvent?.type === 'resume') {
      expect(resumeEvent.checkpointNodeId).toBe('adjuster_review');
    }

    // Final state should be completed
    const finalState = await store.loadRunState(firstResult.runId);
    expect(finalState!.status).toBe('completed');
    expect(finalState!.completedPhases).toContain('generate_recommendation');
  });

  it('resume fails if run is not awaiting_input', async () => {
    const flow = await loadFlow('simple-summary');

    const behaviors = new Map<string, MockBehavior>([
      ['extract_content', { outputFiles: { 'content_extracted.json': '{}' } }],
      ['generate_summary', { outputFiles: { 'summary.json': '{}' } }],
    ]);

    const runner = new MockRunner(behaviors);
    const orchestrator = new FlowOrchestrator(runner, store, {
      workspaceBasePath: workspaceDir,
    });

    const result = await orchestrator.execute(flow, [
      { name: 'document.pdf', content: Buffer.from('pdf'), producedByPhase: 'user_upload' },
    ]);

    expect(result.status).toBe('completed');

    // Try to resume a completed run
    const resumeResult = await orchestrator.resume(flow, result.runId, {
      fileName: 'answer.json',
      content: Buffer.from('{}'),
    });

    expect(resumeResult.success).toBe(false);
    expect(resumeResult.error).toContain('not awaiting input');
  });

  it('resume fails if run does not exist', async () => {
    const flow = await loadFlow('simple-summary');

    const runner = new MockRunner(new Map());
    const orchestrator = new FlowOrchestrator(runner, store, {
      workspaceBasePath: workspaceDir,
    });

    const resumeResult = await orchestrator.resume(flow, 'nonexistent-run-id', {
      fileName: 'answer.json',
      content: Buffer.from('{}'),
    });

    expect(resumeResult.success).toBe(false);
    expect(resumeResult.error).toContain('not found');
  });

  it('rejects invalid flow', async () => {
    const invalidFlow: FlowDefinition = {
      id: 'bad_flow',
      name: 'Bad Flow',
      version: '1.0',
      description: 'Has a cycle',
      skills: [],
      budget: { maxTurns: 100, maxBudgetUsd: 10, timeoutMs: 300000 },
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    };

    const runner = new MockRunner(new Map());
    const orchestrator = new FlowOrchestrator(runner, store, {
      workspaceBasePath: workspaceDir,
    });

    const result = await orchestrator.execute(invalidFlow, []);

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('validation failed');
  });
});
