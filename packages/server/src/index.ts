import express, { type Express } from 'express';
import cors from 'cors';
import type { Server } from 'node:http';
import healthRouter from './routes/health.js';
import projectsRouter from './routes/projects.js';
import skillsRouter from './routes/skills.js';
import flowsRouter from './routes/flows.js';
import runsRouter from './routes/runs.js';

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

  return app;
}

export function startServer(port = 3001): Server {
  const app = createApp();

  const server = app.listen(port, () => {
    console.log(`ForgeFlow server listening on http://localhost:${port}`);
  });

  return server;
}

// Run standalone if this is the entry point
const isMain = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isMain) {
  startServer();
}
