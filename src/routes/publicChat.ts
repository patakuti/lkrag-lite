import { Router } from 'express';
import { randomUUID } from 'crypto';
import { retrieveForWorkspace } from '../search/retriever.js';
import { generateAnswer, rewriteQuery, ConversationMessage, LLMUsage } from '../search/llm.js';
import {
  appendChatMessage,
  createChatSession,
  deleteChatSessionForToken,
  deleteChatSessionsForToken,
  getChatMessages,
  getChatSession,
  insertPublicAccessLog,
  listChatSessionsForToken,
  listWorkspaces,
} from '../db/sqlite.js';
import { runtimeConfig } from '../config/runtime.js';

const router = Router();

function sumUsage(a: LLMUsage, b: LLMUsage): { promptTokens: number | null; completionTokens: number | null } {
  return {
    promptTokens: a.promptTokens !== null || b.promptTokens !== null
      ? (a.promptTokens ?? 0) + (b.promptTokens ?? 0)
      : null,
    completionTokens: a.completionTokens !== null || b.completionTokens !== null
      ? (a.completionTokens ?? 0) + (b.completionTokens ?? 0)
      : null,
  };
}

function estimateCostUsd(promptTokens: number | null, completionTokens: number | null): number | null {
  const inputPrice = process.env.LLM_PRICE_INPUT_PER_1M ? Number(process.env.LLM_PRICE_INPUT_PER_1M) : null;
  const outputPrice = process.env.LLM_PRICE_OUTPUT_PER_1M ? Number(process.env.LLM_PRICE_OUTPUT_PER_1M) : null;
  if (inputPrice === null || outputPrice === null || promptTokens === null || completionTokens === null) {
    return null;
  }
  return (promptTokens / 1_000_000) * inputPrice + (completionTokens / 1_000_000) * outputPrice;
}

// GET /whoami — token label + workspace name, for the chat UI header
router.get('/whoami', (req, res) => {
  const { workspaceId, label } = req.publicAuth!;
  const ws = listWorkspaces().find((w) => w.id === workspaceId);
  res.json({ label, workspaceName: ws?.name ?? null });
});

// GET /chats — sessions created by this token only (not shared with other
// tokens on the same workspace, D33)
router.get('/chats', (req, res) => {
  res.json(listChatSessionsForToken(req.publicAuth!.tokenId));
});

// GET /chats/:id — session + messages, scoped to this token only
router.get('/chats/:id', (req, res) => {
  const tokenId = req.publicAuth!.tokenId;
  const session = getChatSession(req.params.id);
  if (!session || session.token_id !== tokenId) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const messages = getChatMessages(req.params.id);
  res.json({ session, messages });
});

// DELETE /chats/:id — delete a single session, scoped to this token only
router.delete('/chats/:id', (req, res) => {
  const changes = deleteChatSessionForToken(req.params.id, req.publicAuth!.tokenId);
  if (changes === 0) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.status(204).end();
});

// DELETE /chats — delete all sessions belonging to this token only
router.delete('/chats', (req, res) => {
  deleteChatSessionsForToken(req.publicAuth!.tokenId);
  res.status(204).end();
});

// POST /chat — send a message; creates a session on first call if none given
router.post('/chat', (req, res) => {
  void (async () => {
    const workspaceId = req.publicAuth!.workspaceId;
    const tokenId = req.publicAuth!.tokenId;
    const { query, history, session_id } = req.body as {
      query?: string;
      history?: ConversationMessage[];
      session_id?: string;
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

    let sessionId: string;
    if (typeof session_id === 'string' && session_id.trim()) {
      const existing = getChatSession(session_id.trim());
      if (!existing || existing.token_id !== tokenId) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      sessionId = existing.id;
    } else {
      sessionId = randomUUID();
      createChatSession(sessionId, workspaceId, query.trim().slice(0, 60), tokenId);
    }

    try {
      appendChatMessage(sessionId, 'user', query.trim(), null);

      const { searchQuery, fallback: rewriterFallback, usage: rewriterUsage } = await rewriteQuery(
        query.trim(),
        safeHistory
      );

      const chunks = await retrieveForWorkspace(searchQuery, workspaceId, {
        topK: runtimeConfig.topK,
        minSimilarity: runtimeConfig.minSimilarity,
      });
      const { answer, citations, usage: answerUsage } = await generateAnswer(query.trim(), chunks, safeHistory);

      appendChatMessage(sessionId, 'assistant', answer, JSON.stringify(citations));

      const { promptTokens, completionTokens } = sumUsage(rewriterUsage, answerUsage);
      insertPublicAccessLog(
        tokenId,
        workspaceId,
        query.trim(),
        promptTokens,
        completionTokens,
        estimateCostUsd(promptTokens, completionTokens)
      );

      res.json({ session_id: sessionId, answer, citations, rewriterFallback });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  })();
});

export default router;
