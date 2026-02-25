import { Router } from 'express';
import { ProjectStore } from '../services/project-store.js';

const router = Router();
const store = new ProjectStore();

// GET /api/projects/:id/skills — list skills for a project
router.get('/projects/:id/skills', async (req, res) => {
  try {
    const skills = await store.listSkills(req.params.id);
    res.json(skills);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list skills' });
  }
});

// GET /api/projects/:id/skills/:name — get skill files
router.get('/projects/:id/skills/:name', async (req, res) => {
  try {
    const skill = await store.getSkill(req.params.id, req.params.name);
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }
    res.json(skill);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get skill' });
  }
});

// PUT /api/projects/:id/skills/:name — save/update skill files
router.put('/projects/:id/skills/:name', async (req, res) => {
  try {
    const { files } = req.body;
    if (!files || !Array.isArray(files)) {
      res.status(400).json({ error: 'files array is required' });
      return;
    }
    const saved = await store.saveSkill(req.params.id, req.params.name, files);
    if (!saved) {
      res.status(500).json({ error: 'Failed to save skill' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save skill' });
  }
});

// POST /api/projects/:id/skills — create a new skill
router.post('/projects/:id/skills', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const created = await store.createSkill(req.params.id, name);
    if (!created) {
      res.status(500).json({ error: 'Failed to create skill' });
      return;
    }
    res.status(201).json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create skill' });
  }
});

// PATCH /api/projects/:id/skills/:name — rename a skill
router.patch('/projects/:id/skills/:name', async (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName || typeof newName !== 'string') {
      res.status(400).json({ error: 'newName is required' });
      return;
    }
    const renamed = await store.renameSkill(req.params.id, req.params.name, newName);
    if (!renamed) {
      res.status(404).json({ error: 'Skill not found or rename failed' });
      return;
    }
    res.json({ ok: true, name: newName });
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename skill' });
  }
});

// DELETE /api/projects/:id/skills/:name — delete a skill
router.delete('/projects/:id/skills/:name', async (req, res) => {
  try {
    const deleted = await store.deleteSkill(req.params.id, req.params.name);
    if (!deleted) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete skill' });
  }
});

export default router;
