import { Router } from 'express';
import { retrieve } from '../search/retriever.js';
import { generateAnswer, rewriteQuery, ConversationMessage } from '../search/llm.js';

const router = Router();

router.post('/', (req, res) => {
  void (async () => {
    const { query, history } = req.body as {
      query?: string;
      history?: ConversationMessage[];
    };

    if (!query || typeof query !== 'string' || !query.trim()) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const safeHistory: ConversationMessage[] = Array.isArray(history)
      ? history.filter(
          (m) =>
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string'
        )
      : [];

    try {
      const { searchQuery, fallback: rewriterFallback } = await rewriteQuery(
        query.trim(),
        safeHistory
      );

      const chunks = await retrieve(searchQuery);
      const result = await generateAnswer(query.trim(), chunks, safeHistory);

      res.json({ ...result, rewriterFallback });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  })();
});

export default router;
