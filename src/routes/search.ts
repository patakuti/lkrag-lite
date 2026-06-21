import { Router } from 'express';
import { retrieve } from '../search/retriever.js';
import { generateAnswer, rewriteQuery, ConversationMessage } from '../search/llm.js';
import { appendChatMessage, getChatSession } from '../db/sqlite.js';

const router = Router();

router.post('/', (req, res) => {
  void (async () => {
    const { query, history, session_id, skip_rag } = req.body as {
      query?: string;
      history?: ConversationMessage[];
      session_id?: string;
      skip_rag?: boolean;
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

    const sessionId = typeof session_id === 'string' && session_id.trim()
      ? session_id.trim()
      : null;

    // Validate session exists before processing
    if (sessionId && !getChatSession(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    try {
      if (sessionId) {
        appendChatMessage(sessionId, 'user', query.trim(), null);
      }

      const { searchQuery, fallback: rewriterFallback } = await rewriteQuery(
        query.trim(),
        safeHistory
      );

      const chunks = skip_rag ? [] : await retrieve(searchQuery);
      const result = await generateAnswer(query.trim(), chunks, safeHistory);

      if (sessionId) {
        appendChatMessage(sessionId, 'assistant', result.answer, JSON.stringify(result.citations));
      }

      res.json({ ...result, rewriterFallback });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  })();
});

export default router;
