import { Router } from 'express';
import multer from 'multer';
import { ProjectStore } from '../services/project-store.js';

const router = Router();
const store = new ProjectStore();
const forgeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max bundle
});

// Seed default data if no projects exist (idempotent — checks internally)
async function ensureSeeded() {
  await store.seedIfEmpty();
}

// GET /api/projects — list all projects
router.get('/projects', async (_req, res) => {
  try {
    await ensureSeeded();
    const projects = await store.listProjects();
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// POST /api/projects — create a new project
router.post('/projects', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const meta = await store.createProject(name, description ?? '');
    res.status(201).json(meta);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// GET /api/projects/:id — get project details + flow
router.get('/projects/:id', async (req, res) => {
  try {
    await ensureSeeded();
    const project = await store.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get project' });
  }
});

// PUT /api/projects/:id — update project metadata
router.put('/projects/:id', async (req, res) => {
  try {
    const updated = await store.updateProject(req.params.id, req.body);
    if (!updated) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// DELETE /api/projects/:id — delete a project
router.delete('/projects/:id', async (req, res) => {
  try {
    const deleted = await store.deleteProject(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// PUT /api/projects/:id/flow — save/update the flow definition
router.put('/projects/:id/flow', async (req, res) => {
  try {
    const saved = await store.saveFlow(req.params.id, req.body);
    if (!saved) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save flow' });
  }
});

// GET /api/projects/:id/flow — get just the flow definition
router.get('/projects/:id/flow', async (req, res) => {
  try {
    const flow = await store.getFlow(req.params.id);
    if (!flow) {
      res.status(404).json({ error: 'Flow not found' });
      return;
    }
    res.json(flow);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get flow' });
  }
});

// GET /api/projects/:id/export — download .forge bundle
router.get('/projects/:id/export', async (req, res) => {
  try {
    const bundle = await store.exportProject(req.params.id);
    if (!bundle) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Get project name for filename
    const project = await store.getProject(req.params.id);
    const fileName = (project?.meta.name ?? req.params.id)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.forge"`);
    res.setHeader('Content-Length', bundle.length);
    res.send(bundle);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to export project';
    res.status(500).json({ error: message });
  }
});

// POST /api/projects/import — upload and import a .forge bundle
router.post('/projects/import', forgeUpload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const meta = await store.importProject(file.buffer);
    res.status(201).json(meta);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to import project';
    res.status(400).json({ error: message });
  }
});

export default router;
