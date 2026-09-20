import { Router } from 'express';
import path from 'path';
import { listWorkspaces, fileVisible } from '../db/sqlite.js';
import { isEmptyTagFilter } from '../indexer/tags.js';
import { getDefaultTagFilter } from '../config/tagDefaults.js';

const router = Router();

// GET /file?path=...&download=1 — view or download a citation source file,
// restricted to the workspace the requester's token is scoped to (D28).
router.get('/file', (req, res) => {
  const rawPath = req.query.path;
  if (typeof rawPath !== 'string' || !rawPath) {
    res.status(400).json({ error: 'path query parameter is required' });
    return;
  }

  const workspaceId = req.publicAuth!.workspaceId;
  const ws = listWorkspaces().find((w) => w.id === workspaceId);
  if (!ws) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const resolved = path.isAbsolute(rawPath) ? rawPath : path.join(ws.path, rawPath);
  const normalized = path.normalize(resolved);

  const wsNorm = path.normalize(ws.path);
  if (!normalized.startsWith(wsNorm + path.sep) && normalized !== wsNorm) {
    res.status(403).json({ error: 'Path is outside the workspace' });
    return;
  }

  // Enforced default condition (D53): a document hidden from search must not be
  // fetchable by guessing its path either. Same 404 as a missing file.
  const enforced = getDefaultTagFilter();
  if (!isEmptyTagFilter(enforced)) {
    const relPath = path.relative(wsNorm, normalized).split(path.sep).join('/');
    if (!fileVisible(workspaceId, relPath, enforced)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
  }

  if (req.query.download) {
    res.download(normalized, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'File not found' });
      }
    });
  } else {
    res.sendFile(normalized, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'File not found' });
      }
    });
  }
});

export default router;
