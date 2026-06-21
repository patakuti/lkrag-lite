import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import { initDb } from './db/sqlite.js';
import workspacesRouter from './routes/workspaces.js';
import indexRouter from './routes/index_route.js';
import searchRouter from './routes/search.js';
import configRouter from './routes/config.js';
import openRouter from './routes/open.js';
import browseRouter from './routes/browse.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3456;
const DB_PATH = process.env.DATABASE_PATH ?? './data/lkrag.db';

initDb(DB_PATH);

app.use(express.json());

// Reject requests whose Host header is not localhost/127.0.0.1 (DNS-rebinding guard)
app.use((req, res, next) => {
  const host = (req.headers.host ?? '').split(':')[0];
  if (host !== 'localhost' && host !== '127.0.0.1') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/workspaces', workspacesRouter);
app.use('/api/index', indexRouter);
app.use('/api/search', searchRouter);
app.use('/api/config', configRouter);
app.use('/api/open', openRouter);
app.use('/api/browse', browseRouter);

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`lkrag-lite server listening on http://localhost:${PORT}`);
});
