import { Router } from 'express';
import { getStatus, runUpdate, runRebuild, requestCancel } from '../indexer/index.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json(getStatus());
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
