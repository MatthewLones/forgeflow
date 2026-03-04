import { Router } from 'express';
import { GitManager } from '../services/git-manager.js';

const router = Router();
const gitManager = new GitManager();

// GET /api/projects/:id/git/status
router.get('/projects/:id/git/status', async (req, res) => {
  try {
    const status = await gitManager.status(req.params.id);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get git status' });
  }
});

// POST /api/projects/:id/git/init
router.post('/projects/:id/git/init', async (req, res) => {
  try {
    await gitManager.ensureInit(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to init git repo' });
  }
});

// POST /api/projects/:id/git/stage
router.post('/projects/:id/git/stage', async (req, res) => {
  try {
    const { paths } = req.body as { paths?: string[] };
    if (paths && paths.length > 0) {
      await gitManager.stageFiles(req.params.id, paths);
    } else {
      await gitManager.stageAll(req.params.id);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to stage files' });
  }
});

// POST /api/projects/:id/git/unstage
router.post('/projects/:id/git/unstage', async (req, res) => {
  try {
    const { paths } = req.body as { paths: string[] };
    if (!paths?.length) {
      res.status(400).json({ error: 'paths array is required' });
      return;
    }
    await gitManager.unstageFiles(req.params.id, paths);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to unstage files' });
  }
});

// POST /api/projects/:id/git/commit
router.post('/projects/:id/git/commit', async (req, res) => {
  try {
    const { message } = req.body as { message: string };
    if (!message?.trim()) {
      res.status(400).json({ error: 'Commit message is required' });
      return;
    }
    const hash = await gitManager.commit(req.params.id, message.trim());
    res.json({ hash });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to commit' });
  }
});

// GET /api/projects/:id/git/log
router.get('/projects/:id/git/log', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const commits = await gitManager.log(req.params.id, limit);
    res.json(commits);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get log' });
  }
});

// GET /api/projects/:id/git/diff
router.get('/projects/:id/git/diff', async (req, res) => {
  try {
    const hash = req.query.hash as string | undefined;
    const entries = await gitManager.diff(req.params.id, hash);
    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get diff' });
  }
});

// GET /api/projects/:id/git/branches
router.get('/projects/:id/git/branches', async (req, res) => {
  try {
    const branches = await gitManager.branches(req.params.id);
    res.json(branches);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to list branches' });
  }
});

// POST /api/projects/:id/git/branches — create new branch
router.post('/projects/:id/git/branches', async (req, res) => {
  try {
    const { name } = req.body as { name: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'Branch name is required' });
      return;
    }
    await gitManager.createBranch(req.params.id, name.trim());
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create branch' });
  }
});

// PUT /api/projects/:id/git/branches — switch branch
router.put('/projects/:id/git/branches', async (req, res) => {
  try {
    const { name } = req.body as { name: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'Branch name is required' });
      return;
    }
    await gitManager.switchBranch(req.params.id, name.trim());
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to switch branch' });
  }
});

// POST /api/projects/:id/git/push
router.post('/projects/:id/git/push', async (req, res) => {
  try {
    await gitManager.push(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to push' });
  }
});

// POST /api/projects/:id/git/pull
router.post('/projects/:id/git/pull', async (req, res) => {
  try {
    const changes = await gitManager.pull(req.params.id);
    res.json({ success: true, changes });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to pull' });
  }
});

// POST /api/projects/:id/git/reset
router.post('/projects/:id/git/reset', async (req, res) => {
  try {
    const { hash } = req.body as { hash: string };
    if (!hash?.trim()) {
      res.status(400).json({ error: 'Commit hash is required' });
      return;
    }
    await gitManager.resetToCommit(req.params.id, hash.trim());
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to reset' });
  }
});

// POST /api/projects/:id/git/remote — set remote URL
router.post('/projects/:id/git/remote', async (req, res) => {
  try {
    const { url } = req.body as { url: string };
    if (!url?.trim()) {
      res.status(400).json({ error: 'Remote URL is required' });
      return;
    }
    await gitManager.addRemote(req.params.id, url.trim());
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to set remote' });
  }
});

// GET /api/projects/:id/git/remote
router.get('/projects/:id/git/remote', async (req, res) => {
  try {
    const url = await gitManager.getRemote(req.params.id);
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get remote' });
  }
});

export default router;
