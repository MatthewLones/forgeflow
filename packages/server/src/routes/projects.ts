import { Router } from 'express';
import { ProjectStore } from '../services/project-store.js';

const router = Router();
const store = new ProjectStore();

// Seed default data on first access
let seeded = false;
async function ensureSeeded() {
  if (!seeded) {
    await store.seedIfEmpty();
    seeded = true;
  }
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

export default router;
