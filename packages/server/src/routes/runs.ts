import { Router } from 'express';
import multer from 'multer';
import { lookup } from 'mime-types';
import type { StateFile } from '@forgeflow/types';
import { runManager } from '../services/run-manager.js';
import { ProjectStore } from '../services/project-store.js';
import type { RunnerType } from '../services/run-manager.js';

const router = Router();
const store = new ProjectStore();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
});

// POST /api/projects/:id/run — start a new run (multipart: files + metadata)
router.post('/projects/:id/run', upload.array('files', 20), async (req, res) => {
  try {
    const rawId = req.params.id;
    const projectId = Array.isArray(rawId) ? rawId.join('/') : rawId;
    // In multipart, body fields are strings
    const runner = (req.body.runner ?? 'mock') as RunnerType;
    const model = req.body.model as string | undefined;
    const apiKey = req.body.apiKey as string | undefined;

    console.log(`[runs] POST /projects/${projectId}/run runner=${runner}`);

    // Fall back to env var when no apiKey in request
    const resolvedApiKey = apiKey || process.env.ANTHROPIC_API_KEY;

    if (runner !== 'mock' && !resolvedApiKey) {
      res.status(400).json({ error: 'ANTHROPIC_API_KEY required for non-mock runners. Set it in packages/server/.env or pass it in the request.' });
      return;
    }

    const flow = await store.getFlow(projectId);
    if (!flow) {
      console.error(`[runs] flow not found for project ${projectId}`);
      res.status(404).json({ error: 'Flow not found for project' });
      return;
    }

    // Convert multer files to StateFile[]
    const multerFiles = (req.files as Express.Multer.File[]) ?? [];
    const userUploads: StateFile[] = multerFiles.map((f) => ({
      name: f.originalname,
      content: f.buffer,
      producedByPhase: 'user_upload',
    }));

    console.log(`[runs] starting run: ${multerFiles.length} uploads, flow has ${flow.nodes.length} nodes`);

    const runId = await runManager.startRun(projectId, flow, runner, {
      model,
      apiKey: resolvedApiKey,
      userUploads,
    });

    console.log(`[runs] run started: ${runId}`);
    res.status(201).json({ runId });
  } catch (err) {
    console.error('[runs] startRun error:', err);
    const message = err instanceof Error ? err.message : 'Failed to start run';
    res.status(500).json({ error: message });
  }
});

// GET /api/runs/:runId/progress — SSE stream of progress events
router.get('/runs/:runId/progress', (req, res) => {
  console.log(`[runs] SSE connect: ${req.params.runId}`);

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
    console.log(`[runs] SSE disconnect: ${req.params.runId}`);
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

// POST /api/runs/:runId/stop — stop a running run
router.post('/runs/:runId/stop', (req, res) => {
  try {
    const stopped = runManager.stopRun(req.params.runId);
    if (!stopped) {
      res.status(404).json({ error: 'Run not found or already completed' });
      return;
    }
    console.log(`[runs] stopped run: ${req.params.runId}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to stop run' });
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
    const resolvedKey = req.body.apiKey || process.env.ANTHROPIC_API_KEY;
    const contentBuffer = Buffer.from(content, 'base64');

    const runId = await runManager.resumeRun(
      req.params.runId,
      flow,
      { fileName, content: contentBuffer },
      runner,
      { model: req.body.model, apiKey: resolvedKey },
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

// GET /api/runs/:runId/summary — computed post-run summary
router.get('/runs/:runId/summary', async (req, res) => {
  try {
    const summary = await runManager.computeSummary(req.params.runId);
    if (!summary) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute summary' });
  }
});

// GET /api/runs/:runId/workspace — list workspace files for a run
router.get('/runs/:runId/workspace', async (req, res) => {
  try {
    const tree = await runManager.listWorkspaceFiles(req.params.runId);
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list workspace files' });
  }
});

// GET /api/runs/:runId/workspace/:phaseId/*path — read a workspace file
router.get('/runs/:runId/workspace/:phaseId/*path', async (req, res) => {
  try {
    const phaseId = req.params.phaseId;
    const segments = req.params.path;
    const filePath = Array.isArray(segments) ? segments.join('/') : segments;

    const content = await runManager.readWorkspaceFile(req.params.runId, phaseId, filePath);
    if (!content) {
      res.status(404).json({ error: 'Workspace file not found' });
      return;
    }

    const mimeType = lookup(filePath) || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', content.length);
    res.send(content);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read workspace file' });
  }
});

export default router;
