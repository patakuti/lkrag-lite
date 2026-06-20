import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import { initDb } from './db/sqlite.js';
import workspacesRouter from './routes/workspaces.js';
import indexRouter from './routes/index_route.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3456;
const DB_PATH = process.env.DATABASE_PATH ?? './data/lkrag.db';

initDb(DB_PATH);

app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/workspaces', workspacesRouter);
app.use('/api/index', indexRouter);

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`lkrag-lite server listening on http://localhost:${PORT}`);
});
