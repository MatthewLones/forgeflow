import { Router } from 'express';
import { GitHubService } from '../services/github-service.js';
import { GitManager } from '../services/git-manager.js';

const router = Router();
const githubService = new GitHubService();
const gitManager = new GitManager();

// GET /api/github/status — connection status
router.get('/github/status', async (_req, res) => {
  try {
    const connection = await githubService.getConnection();
    res.json(connection);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/github/auth-url — get OAuth authorization URL
router.get('/github/auth-url', (req, res) => {
  try {
    // Determine callback URL: use origin from Referer header or default
    const origin = req.headers.referer
      ? new URL(req.headers.referer).origin
      : 'http://localhost:5173';
    const callbackUrl = `${origin}/github/callback`;

    const url = githubService.getAuthUrl(callbackUrl);
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/github/callback — exchange OAuth code for token
router.post('/github/callback', async (req, res) => {
  try {
    const { code } = req.body as { code: string };
    if (!code) {
      res.status(400).json({ error: 'OAuth code is required' });
      return;
    }
    const connection = await githubService.handleCallback(code);
    res.json(connection);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/github/repos — list user repos
router.get('/github/repos', async (_req, res) => {
  try {
    const repos = await githubService.listRepos();
    res.json(repos);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/github/repos — create new repo
router.post('/github/repos', async (req, res) => {
  try {
    const { name, description, private: isPrivate } = req.body as {
      name: string;
      description: string;
      private: boolean;
    };
    if (!name?.trim()) {
      res.status(400).json({ error: 'Repository name is required' });
      return;
    }
    const repo = await githubService.createRepo(
      name.trim(),
      description || '',
      isPrivate ?? true,
    );
    res.json(repo);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/github/repos/link — create repo + set as remote for project
router.post('/github/repos/link', async (req, res) => {
  try {
    const { projectId, repoUrl } = req.body as {
      projectId: string;
      repoUrl: string;
    };
    if (!projectId || !repoUrl) {
      res.status(400).json({ error: 'projectId and repoUrl are required' });
      return;
    }

    // Configure git remote to use the token for authentication
    const token = await githubService.getAccessToken();
    let authUrl = repoUrl;
    if (token && repoUrl.startsWith('https://')) {
      // Inject token into URL for auth: https://token@github.com/...
      authUrl = repoUrl.replace('https://', `https://${token}@`);
    }

    await gitManager.addRemote(projectId, authUrl);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/github/disconnect
router.post('/github/disconnect', async (_req, res) => {
  try {
    await githubService.disconnect();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
