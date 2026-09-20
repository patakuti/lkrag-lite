import { Router } from 'express';
import {
  getActiveWorkspace, listTags, getTagsForPaths, fileExists, addManualTag, removeManualTag,
} from '../db/sqlite.js';
import { normalizeTag } from '../indexer/tags.js';

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

// Manual tags (D48): validated against the active workspace's index so tags
// cannot be attached to paths outside it. Written only by the admin app.
function parseManualBody(body: unknown): { path: string; tag: string } | null {
  const { path, tag } = (body ?? {}) as { path?: unknown; tag?: unknown };
  if (typeof path !== 'string' || !path || typeof tag !== 'string') return null;
  const normalized = normalizeTag(tag);
  return normalized === null ? null : { path, tag: normalized };
}

// POST /api/tags/manual — add a manual tag; returns the file's current tags
router.post('/manual', (req, res) => {
  const parsed = parseManualBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: 'path and a valid tag are required (1-64 chars, no whitespace, commas or #)' });
    return;
  }
  const ws = getActiveWorkspace();
  if (!ws) {
    res.status(400).json({ error: 'No active workspace' });
    return;
  }
  if (!fileExists(ws.id, parsed.path)) {
    res.status(404).json({ error: 'File is not in the index of the active workspace' });
    return;
  }
  addManualTag(ws.id, parsed.path, parsed.tag);
  res.status(201).json({ tags: getTagsForPaths(ws.id, [parsed.path])[parsed.path] });
});

// DELETE /api/tags/manual — remove a manual tag (idempotent)
router.delete('/manual', (req, res) => {
  const parsed = parseManualBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: 'path and a valid tag are required' });
    return;
  }
  const ws = getActiveWorkspace();
  if (!ws) {
    res.status(400).json({ error: 'No active workspace' });
    return;
  }
  removeManualTag(ws.id, parsed.path, parsed.tag);
  res.status(204).end();
});

export default router;
