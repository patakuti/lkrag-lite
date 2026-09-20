import path from 'path';
import type { Server } from 'http';
import express from 'express';
import dotenv from 'dotenv';
import { getUserConfigDir, getUserDataDir } from './config/paths.js';
import { validateProviderConfig, printProviderConfig } from './config/providers.js';
import { validateTagDefaults } from './config/tagDefaults.js';
import { initDb } from './db/sqlite.js';
import workspacesRouter from './routes/workspaces.js';
import indexRouter from './routes/index_route.js';
import searchRouter from './routes/search.js';
import configRouter from './routes/config.js';
import openRouter from './routes/open.js';
import browseRouter from './routes/browse.js';
import chatsRouter from './routes/chats.js';
import tagsRouter from './routes/tags.js';
import { createPublicApp } from './publicServer.js';
import { trackActivity, getBusyReason } from './middleware/activity.js';
import { takeoverPort, ServerBusyError } from './takeover.js';

// Load .env in cascade order (later calls override earlier):
//   1. User config dir  (%APPDATA%\lkragl\.env  or  ~/.config/lkragl/.env)
//   2. Current working directory (./.env)
dotenv.config({ path: path.join(getUserConfigDir(), '.env'), quiet: true });
dotenv.config({ path: path.join(process.cwd(), '.env'), override: true, quiet: true });

validateProviderConfig();
validateTagDefaults();

const app = express();
const PORT = Number(process.env.PORT) || 4456;
const DB_PATH = process.env.DATABASE_PATH ?? path.join(getUserDataDir(), 'lkrag.db');

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

// CSRF guard: the Host check above only stops DNS rebinding, not a malicious
// page (opened in the same browser) sending simple cross-origin requests
// (<img>, <form>, no-cors fetch) straight to this admin API. Those requests
// cannot carry a custom header without triggering a CORS preflight, which
// this server does not answer with any Access-Control-Allow-* headers — so
// the browser blocks them before they reach the handler. The admin frontend
// (public/app.js) sends this header on every /api/* call.
app.use('/api', (req, res, next) => {
  if (req.headers['x-lkragl-client'] !== '1') {
    res.status(403).json({ error: 'forbidden: missing client header' });
    return;
  }
  next();
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Shutdown. A newly started server calls this to replace us (§13), so refuse
// while busy instead of interrupting indexing or in-flight requests. Registered
// before trackActivity so the shutdown request itself is not counted as work.
app.post('/api/shutdown', (_req, res) => {
  const reason = getBusyReason();
  if (reason) {
    res.status(409).json({ busy: true, reason });
    return;
  }
  res.json({ shutdown: true });
  setTimeout(() => process.exit(0), 100);
});

app.use('/api', trackActivity);

app.use('/api/workspaces', workspacesRouter);
app.use('/api/index', indexRouter);
app.use('/api/search', searchRouter);
app.use('/api/config', configRouter);
app.use('/api/open', openRouter);
app.use('/api/browse', browseRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/tags', tagsRouter);

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

function exitOnListenError(server: Server, label: string, port: number): void {
  server.on('error', (err: NodeJS.ErrnoException) => {
    const detail = err.code === 'EADDRINUSE' ? `port ${port} is already in use` : err.message;
    console.error(`Failed to start ${label}: ${detail}`);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  // Replace an already-running (idle) instance before touching the DB, so the
  // old process is gone by the time we open and migrate it.
  try {
    const result = await takeoverPort(PORT);
    if (result === 'replaced') console.log(`Replaced the previous lkrag-lite server on port ${PORT}`);
  } catch (err) {
    console.error(err instanceof ServerBusyError ? err.message : `Cannot start: ${(err as Error).message}`);
    process.exit(1);
  }

  initDb(DB_PATH);

  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`lkrag-lite server listening on http://localhost:${PORT}`);
    printProviderConfig();
  });
  exitOnListenError(server, 'lkrag-lite server', PORT);

  // Public read-only workspace chat (§11). Disabled unless PUBLIC_PORT is set.
  const PUBLIC_PORT = process.env.PUBLIC_PORT ? Number(process.env.PUBLIC_PORT) : null;
  if (PUBLIC_PORT) {
    const publicServer = createPublicApp().listen(PUBLIC_PORT, '0.0.0.0', () => {
      console.log(`lkrag-lite public chat listening on http://0.0.0.0:${PUBLIC_PORT}`);
    });
    exitOnListenError(publicServer, 'lkrag-lite public chat', PUBLIC_PORT);
  }
}

void main();
