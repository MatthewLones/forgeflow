import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStateStore } from '../src/local.js';
import type { StateFile, RunState, CheckpointState } from '@forgeflow/types';

let store: LocalStateStore;
let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'forgeflow-test-'));
  store = new LocalStateStore(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const RUN_ID = 'test_run_001';

function makeFile(name: string, content: string, phase = 'test_phase'): StateFile {
  return { name, content: Buffer.from(content), producedByPhase: phase };
}

describe('LocalStateStore', () => {
  it('saves and loads phase outputs', async () => {
    const files = [
      makeFile('output_a.json', '{"result":"a"}'),
      makeFile('output_b.json', '{"result":"b"}'),
    ];

    await store.savePhaseOutputs(RUN_ID, 'phase_1', files);
    const loaded = await store.loadPhaseInputs(RUN_ID, ['output_a.json', 'output_b.json']);

    expect(loaded).toHaveLength(2);
    expect(loaded[0].name).toBe('output_a.json');
    expect(loaded[0].content.toString()).toBe('{"result":"a"}');
    expect(loaded[1].name).toBe('output_b.json');
    expect(loaded[1].content.toString()).toBe('{"result":"b"}');
  });

  it('loads inputs from both artifacts and uploads', async () => {
    await store.saveUserUploads(RUN_ID, [makeFile('user_doc.pdf', 'pdf-content')]);
    await store.savePhaseOutputs(RUN_ID, 'phase_1', [makeFile('parsed.json', '{"data":1}')]);

    const loaded = await store.loadPhaseInputs(RUN_ID, ['user_doc.pdf', 'parsed.json']);
    expect(loaded).toHaveLength(2);
    expect(loaded.find((f) => f.name === 'user_doc.pdf')!.content.toString()).toBe('pdf-content');
    expect(loaded.find((f) => f.name === 'parsed.json')!.content.toString()).toBe('{"data":1}');
  });

  it('returns empty array for missing files', async () => {
    const loaded = await store.loadPhaseInputs(RUN_ID, ['nonexistent.json']);
    expect(loaded).toHaveLength(0);
  });

  it('saves and loads run state', async () => {
    const state: RunState = {
      runId: RUN_ID,
      flowId: 'test_flow',
      status: 'running',
      currentPhaseId: 'phase_1',
      completedPhases: [],
      totalCost: { turns: 0, usd: 0 },
      startedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    await store.saveRunState(RUN_ID, state);
    const loaded = await store.loadRunState(RUN_ID);

    expect(loaded).not.toBeNull();
    expect(loaded!.runId).toBe(RUN_ID);
    expect(loaded!.status).toBe('running');
    expect(loaded!.currentPhaseId).toBe('phase_1');
  });

  it('returns null for non-existent run state', async () => {
    const loaded = await store.loadRunState('nonexistent');
    expect(loaded).toBeNull();
  });

  it('saves and loads checkpoint', async () => {
    const checkpoint: CheckpointState = {
      runId: RUN_ID,
      checkpointNodeId: 'review_step',
      status: 'waiting',
      presentFiles: ['analysis.json'],
      waitingForFile: 'decisions.json',
      completedPhases: ['phase_1'],
      costSoFar: { turns: 10, usd: 1.5 },
      presentation: { title: 'Review', sections: ['findings'] },
    };

    await store.saveCheckpoint(RUN_ID, checkpoint);
    const loaded = await store.loadCheckpoint(RUN_ID);

    expect(loaded).not.toBeNull();
    expect(loaded!.checkpointNodeId).toBe('review_step');
    expect(loaded!.status).toBe('waiting');
    expect(loaded!.presentation.title).toBe('Review');
  });

  it('returns null for non-existent checkpoint', async () => {
    const loaded = await store.loadCheckpoint('nonexistent');
    expect(loaded).toBeNull();
  });

  it('saves checkpoint answer as artifact', async () => {
    const answerContent = Buffer.from('{"approved":true}');
    await store.saveCheckpointAnswer(RUN_ID, 'decisions.json', answerContent);

    const loaded = await store.loadPhaseInputs(RUN_ID, ['decisions.json']);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].content.toString()).toBe('{"approved":true}');
  });

  it('overwrites files from later phases', async () => {
    await store.savePhaseOutputs(RUN_ID, 'phase_1', [makeFile('data.json', '{"v":1}')]);
    await store.savePhaseOutputs(RUN_ID, 'phase_2', [makeFile('data.json', '{"v":2}')]);

    const loaded = await store.loadPhaseInputs(RUN_ID, ['data.json']);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].content.toString()).toBe('{"v":2}');
  });

  it('saves user uploads to uploads directory', async () => {
    const files = [makeFile('doc.pdf', 'pdf-bytes'), makeFile('image.png', 'png-bytes')];
    await store.saveUserUploads(RUN_ID, files);

    const loaded = await store.loadPhaseInputs(RUN_ID, ['doc.pdf', 'image.png']);
    expect(loaded).toHaveLength(2);
  });
});
