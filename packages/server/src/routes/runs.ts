import { Router } from 'express';
import { lookup } from 'mime-types';
import { runManager } from '../services/run-manager.js';
import { ProjectStore } from '../services/project-store.js';
import type { RunnerType } from '../services/run-manager.js';

const router = Router();
const store = new ProjectStore();

// POST /api/projects/:id/run — start a new run
router.post('/projects/:id/run', async (req, res) => {
  try {
    const projectId = req.params.id;
    const { runner = 'mock', model, apiKey, skillPaths } = req.body as {
      runner?: RunnerType;
      model?: string;
      apiKey?: string;
      skillPaths?: string[];
    };

    const flow = await store.getFlow(projectId);
    if (!flow) {
      res.status(404).json({ error: 'Flow not found for project' });
      return;
    }

    const runId = await runManager.startRun(projectId, flow, runner, {
      model,
      apiKey,
      skillPaths,
    });

    res.status(201).json({ runId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start run';
    res.status(500).json({ error: message });
  }
});

// GET /api/runs/:runId/progress — SSE stream of progress events
router.get('/runs/:runId/progress', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Send initial keepalive
  res.write(':ok\n\n');

  const unsubscribe = runManager.subscribeProgress(req.params.runId, res);

  req.on('close', () => {
    unsubscribe();
  });
});

// GET /api/runs/:runId — get current run state
router.get('/runs/:runId', async (req, res) => {
  try {
    const state = await runManager.getRunState(req.params.runId);
    if (!state) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get run state' });
  }
});

// POST /api/runs/:runId/interrupt-answer — answer a pending interrupt
router.post('/runs/:runId/interrupt-answer', (req, res) => {
  try {
    const answered = runManager.answerInterrupt(req.params.runId, req.body);
    if (!answered) {
      res.status(404).json({ error: 'No pending interrupt for this run' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to answer interrupt' });
  }
});

// POST /api/runs/:runId/resume — resume from checkpoint
router.post('/runs/:runId/resume', async (req, res) => {
  try {
    const { projectId, fileName, content } = req.body as {
      projectId: string;
      fileName: string;
      content: string; // base64 encoded
    };

    if (!projectId || !fileName || !content) {
      res.status(400).json({ error: 'projectId, fileName, and content are required' });
      return;
    }

    const flow = await store.getFlow(projectId);
    if (!flow) {
      res.status(404).json({ error: 'Flow not found for project' });
      return;
    }

    const runner = (req.body.runner ?? 'mock') as RunnerType;
    const contentBuffer = Buffer.from(content, 'base64');

    const runId = await runManager.resumeRun(
      req.params.runId,
      flow,
      { fileName, content: contentBuffer },
      runner,
      { model: req.body.model, apiKey: req.body.apiKey },
    );

    res.json({ runId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to resume run';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/runs — list runs for a project
router.get('/projects/:id/runs', async (req, res) => {
  try {
    const runs = await runManager.listRuns(req.params.id);
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

// GET /api/runs/:runId/outputs — list output artifacts for a run
router.get('/runs/:runId/outputs', async (req, res) => {
  try {
    const artifacts = await runManager.listArtifacts(req.params.runId);
    res.json(artifacts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list outputs' });
  }
});

// GET /api/runs/:runId/outputs/:fileName — serve an output file
router.get('/runs/:runId/outputs/:fileName', async (req, res) => {
  try {
    const fileName = req.params.fileName;
    const content = await runManager.readArtifact(req.params.runId, fileName);
    if (!content) {
      res.status(404).json({ error: 'Output file not found' });
      return;
    }

    const mimeType = lookup(fileName) || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', content.length);
    res.send(content);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read output file' });
  }
});

export default router;
