import { Router } from 'express';
import { getStatus, runUpdate, runRebuild, requestCancel } from '../indexer/index.js';
import { getActiveWorkspace, getIndexedFileCount, getLastIndexedAt } from '../db/sqlite.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json(getStatus());
});

router.get('/stats', (_req, res) => {
  const ws = getActiveWorkspace();
  if (!ws) {
    res.json({ indexedFiles: 0, lastUpdatedAt: null });
    return;
  }
  res.json({
    indexedFiles: getIndexedFileCount(ws.id),
    lastUpdatedAt: getLastIndexedAt(ws.id),
  });
});

router.post('/update', (req, res) => {
  void (async () => {
    try {
      await runUpdate();
      res.json({ started: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg === 'Already indexing' ? 409 : 500).json({ error: msg });
    }
  })();
});

router.post('/rebuild', (req, res) => {
  void (async () => {
    try {
      await runRebuild();
      res.json({ started: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg === 'Already indexing' ? 409 : 500).json({ error: msg });
    }
  })();
});

router.post('/cancel', (_req, res) => {
  requestCancel();
  res.json({ cancelRequested: true });
});

export default router;
