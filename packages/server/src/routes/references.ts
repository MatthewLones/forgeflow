import { Router } from 'express';
import multer from 'multer';
import { ProjectStore } from '../services/project-store.js';

const router = Router();
const store = new ProjectStore();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
});

// GET /api/projects/:id/references — list reference tree
router.get('/projects/:id/references', async (req, res) => {
  try {
    const tree = await store.listReferences(req.params.id);
    res.json(tree);
  } catch {
    res.status(500).json({ error: 'Failed to list references' });
  }
});

// POST /api/projects/:id/references/upload — upload files (multipart)
router.post('/projects/:id/references/upload', upload.array('files', 20), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No files provided' });
      return;
    }

    const targetFolder = (req.body.targetFolder as string) ?? '';
    // Normalize: ensure no leading slash, add trailing slash if non-empty
    const prefix = targetFolder
      ? targetFolder.replace(/^\//, '').replace(/\/?$/, '/')
      : '';

    for (const file of files) {
      const relativePath = prefix + file.originalname;
      const ok = await store.uploadReference(req.params.id, relativePath, file.buffer);
      if (!ok) {
        res.status(400).json({ error: `Invalid path: ${relativePath}` });
        return;
      }
    }

    // Return updated tree
    const tree = await store.listReferences(req.params.id);
    res.json(tree);
  } catch {
    res.status(500).json({ error: 'Failed to upload references' });
  }
});

// GET /api/projects/:id/references/file/* — serve a reference file
router.get('/projects/:id/references/file/*path', async (req, res) => {
  try {
    const refPath = req.params.path;
    if (!refPath) {
      res.status(400).json({ error: 'Path required' });
      return;
    }

    const result = await store.readReference(req.params.id, refPath);
    if (!result) {
      res.status(404).json({ error: 'Reference not found' });
      return;
    }

    res.set('Content-Type', result.mimeType);
    res.send(result.buffer);
  } catch {
    res.status(500).json({ error: 'Failed to read reference' });
  }
});

// DELETE /api/projects/:id/references/file/* — delete a reference file or folder
router.delete('/projects/:id/references/file/*path', async (req, res) => {
  try {
    const refPath = req.params.path;
    if (!refPath) {
      res.status(400).json({ error: 'Path required' });
      return;
    }

    const deleted = await store.deleteReference(req.params.id, refPath);
    if (!deleted) {
      res.status(404).json({ error: 'Reference not found' });
      return;
    }
    res.status(204).end();
  } catch {
    res.status(500).json({ error: 'Failed to delete reference' });
  }
});

// POST /api/projects/:id/references/folder — create a folder
router.post('/projects/:id/references/folder', async (req, res) => {
  try {
    const { path } = req.body;
    if (!path) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const created = await store.createReferenceFolder(req.params.id, path);
    if (!created) {
      res.status(400).json({ error: 'Invalid folder path' });
      return;
    }
    res.status(201).json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// PUT /api/projects/:id/references/rename — rename a file or folder
router.put('/projects/:id/references/rename', async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      res.status(400).json({ error: 'oldPath and newPath are required' });
      return;
    }
    const renamed = await store.renameReference(req.params.id, oldPath, newPath);
    if (!renamed) {
      res.status(400).json({ error: 'Rename failed' });
      return;
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to rename reference' });
  }
});

export default router;
