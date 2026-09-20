import { Router } from 'express';
import { getActiveWorkspace, listTags, getTagsForPaths } from '../db/sqlite.js';

const router = Router();

const MAX_LOOKUP_PATHS = 200;

// GET /api/tags — tags of the active workspace with file counts
router.get('/', (_req, res) => {
  const ws = getActiveWorkspace();
  res.json(ws ? listTags(ws.id) : []);
});

// POST /api/tags/lookup — current tags (auto + manual) of the given relative paths
router.post('/lookup', (req, res) => {
  const { paths } = req.body as { paths?: unknown };
  if (
    !Array.isArray(paths) ||
    paths.length > MAX_LOOKUP_PATHS ||
    !paths.every((p) => typeof p === 'string')
  ) {
    res.status(400).json({ error: `paths must be an array of at most ${MAX_LOOKUP_PATHS} strings` });
    return;
  }
  const ws = getActiveWorkspace();
  res.json({ fileTags: ws ? getTagsForPaths(ws.id, paths as string[]) : {} });
});

export default router;
