import { Router } from 'express';
import { retrieve } from '../search/retriever.js';
import { generateAnswer } from '../search/llm.js';

const router = Router();

router.post('/', (req, res) => {
  void (async () => {
    const { query } = req.body as { query?: string };
    if (!query || typeof query !== 'string' || !query.trim()) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    try {
      const chunks = await retrieve(query.trim());
      const result = await generateAnswer(query.trim(), chunks);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  })();
});

export default router;
