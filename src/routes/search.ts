import { Router } from 'express';
import { retrieve } from '../search/retriever.js';
import { generateAnswer, rewriteQuery, ConversationMessage } from '../search/llm.js';
import { appendChatMessage, getActiveWorkspace, getChatSession, getTagsForPaths } from '../db/sqlite.js';
import { normalizeTagList } from '../indexer/tags.js';

const router = Router();

router.post('/', (req, res) => {
  void (async () => {
    const { query, history, session_id, skip_rag, tags } = req.body as {
      query?: string;
      history?: ConversationMessage[];
      session_id?: string;
      skip_rag?: boolean;
      tags?: unknown;
    };
    const filterTags = normalizeTagList(tags);

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
        appendChatMessage(sessionId, 'user', query.trim(), null, filterTags);
      }

      const { searchQuery, fallback: rewriterFallback } = await rewriteQuery(
        query.trim(),
        safeHistory
      );

      const chunks = skip_rag ? [] : await retrieve(searchQuery, filterTags);
      const result = await generateAnswer(query.trim(), chunks, safeHistory, skip_rag);

      if (sessionId) {
        appendChatMessage(sessionId, 'assistant', result.answer, JSON.stringify(result.citations));
      }

      // Current tags of the cited files (not persisted with the citations, D45)
      const ws = getActiveWorkspace();
      const fileTags = ws ? getTagsForPaths(ws.id, result.citations.map((c) => c.path)) : {};

      res.json({ ...result, rewriterFallback, fileTags });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  })();
});

export default router;
