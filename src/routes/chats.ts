import { Router } from 'express';
import { randomUUID } from 'crypto';
import {
  listChatSessions,
  createChatSession,
  getChatSession,
  getChatMessages,
  deleteChatSession,
  deleteAllChatSessions,
  getActiveWorkspace,
} from '../db/sqlite.js';

const router = Router();

// GET /api/chats — all sessions with workspace name
router.get('/', (_req, res) => {
  const sessions = listChatSessions();
  res.json(sessions);
});

// POST /api/chats — create new session
router.post('/', (req, res) => {
  const { workspace_id, title } = req.body as {
    workspace_id?: number | null;
    title?: string;
  };

  const ws = workspace_id !== undefined ? workspace_id : (getActiveWorkspace()?.id ?? null);
  const sessionTitle = (title ?? '').trim() || 'Untitled';
  const id = randomUUID();
  const session = createChatSession(id, ws ?? null, sessionTitle);
  res.status(201).json(session);
});

// GET /api/chats/:id — session + messages
router.get('/:id', (req, res) => {
  const session = getChatSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const messages = getChatMessages(req.params.id);
  res.json({ session, messages });
});

// DELETE /api/chats — delete all
router.delete('/', (_req, res) => {
  deleteAllChatSessions();
  res.status(204).end();
});

// DELETE /api/chats/:id — delete single
router.delete('/:id', (req, res) => {
  deleteChatSession(req.params.id);
  res.status(204).end();
});

export default router;
