import dotenv from 'dotenv';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import express, { type Express } from 'express';
import cors from 'cors';
import type { Server } from 'node:http';

// Load .env: try cwd first (dev), then ~/.forgeflow/.env (packaged Electron)
dotenv.config();
if (!process.env.ANTHROPIC_API_KEY) {
  const userEnv = path.join(os.homedir(), '.forgeflow', '.env');
  if (fs.existsSync(userEnv)) {
    dotenv.config({ path: userEnv });
  }
}
import healthRouter from './routes/health.js';
import projectsRouter from './routes/projects.js';
import skillsRouter from './routes/skills.js';
import flowsRouter from './routes/flows.js';
import runsRouter from './routes/runs.js';
import referencesRouter from './routes/references.js';
import copilotRouter from './routes/copilot.js';
import gitRouter from './routes/git.js';
import githubRouter from './routes/github.js';
import { WorkspaceCleaner } from './services/workspace-cleaner.js';
import { runManager } from './services/run-manager.js';

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Routes
  app.use('/api', healthRouter);
  app.use('/api', projectsRouter);
  app.use('/api', skillsRouter);
  app.use('/api', flowsRouter);
  app.use('/api', runsRouter);
  app.use('/api', referencesRouter);
  app.use('/api', copilotRouter);
  app.use('/api', gitRouter);
  app.use('/api', githubRouter);

  return app;
}

export function startServer(port = 3001): Server {
  const app = createApp();

  // Start workspace cleaner with configurable TTL
  const ttlHours = Number(process.env.WORKSPACE_TTL_HOURS) || 24;
  const cleaner = new WorkspaceCleaner(
    runManager.workspaceBasePath,
    ttlHours * 60 * 60 * 1000,
  );
  cleaner.start();

  const server = app.listen(port, () => {
    console.log(`ForgeFlow server listening on http://localhost:${port}`);
    console.log(`Workspace TTL: ${ttlHours}h`);
  });

  return server;
}

// Run standalone if this is the entry point
const isMain = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isMain) {
  startServer();
}
