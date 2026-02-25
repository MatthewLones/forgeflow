import express, { type Express } from 'express';
import cors from 'cors';
import type { Server } from 'node:http';
import healthRouter from './routes/health.js';

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  app.use('/api', healthRouter);

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
