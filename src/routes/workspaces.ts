import { Router } from 'express';
import {
  listWorkspaces, addWorkspace, deleteWorkspace, activateWorkspace,
} from '../db/sqlite.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json(listWorkspaces());
});

router.post('/', (req, res) => {
  const { name, path: wsPath } = req.body as { name?: string; path?: string };
  if (!name || !wsPath) {
    res.status(400).json({ error: 'name and path are required' });
    return;
  }
  const ws = addWorkspace(name, wsPath);
  res.status(201).json(ws);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'invalid id' }); return; }
  deleteWorkspace(id);
  res.status(204).end();
});

router.put('/:id/activate', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'invalid id' }); return; }
  activateWorkspace(id);
  res.json({ activated: id });
});

export default router;
