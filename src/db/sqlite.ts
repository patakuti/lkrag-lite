import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

// When running as a pkg standalone binary, the sqlite-vec native extension
// (.so/.dll/.dylib) lives in pkg's virtual FS and cannot be dlopen()ed directly.
// We extract it to a real temp path on first use.
function loadSqliteVecExtension(db: Database.Database): void {
  if (!(process as unknown as { pkg?: boolean }).pkg) {
    sqliteVec.load(db);
    return;
  }
  const src = sqliteVec.getLoadablePath();
  const dst = path.join(os.tmpdir(), path.basename(src));
  try {
    fs.copyFileSync(src, dst);
  } catch {
    if (!fs.existsSync(dst)) {
      throw new Error(`Failed to extract sqlite-vec extension to ${dst}`);
    }
  }
  db.loadExtension(dst);
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) throw new Error('DB not initialized. Call initDb() first.');
  return _db;
}

// WSL1 does not implement mmap() or fcntl() advisory locking correctly for
// SQLite's WAL shared-memory file (.db-shm).  Attempting WAL mode on WSL1
// raises SQLITE_PROTOCOL ("locking protocol").  Fall back to DELETE journal
// mode automatically when WSL1 is detected.
function isWsl1(): boolean {
  try {
    const release = fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8').trim().toLowerCase();
    return release.includes('microsoft') && !release.includes('wsl2');
  } catch {
    return false;
  }
}

// Choose journal mode: env var takes priority, then WSL1 auto-detection, then WAL.
function resolveJournalMode(): string {
  const env = process.env.SQLITE_JOURNAL_MODE;
  if (env) return env.toLowerCase();
  return isWsl1() ? 'delete' : 'wal';
}

// Windows filesystems accessed through WSL (/mnt/<drive>/) do not support
// POSIX fcntl() advisory locking.  SQLite requires this even in DELETE journal
// mode, so any database placed on these paths will fail with SQLITE_IOERR or
// SQLITE_CORRUPT at runtime.  Detect the path upfront and abort with a clear
// message instead of letting obscure I/O errors surface later.
function isWslDrvFs(dbPath: string): boolean {
  let real: string;
  try {
    real = fs.realpathSync(dbPath);
  } catch {
    try {
      real = path.join(fs.realpathSync(path.dirname(dbPath)), path.basename(dbPath));
    } catch {
      real = path.resolve(dbPath);
    }
  }
  return /^\/mnt\/[a-zA-Z]\//.test(real);
}

function openDb(dbPath: string): Database.Database {
  if (isWslDrvFs(dbPath)) {
    throw new Error(
      `Database path is on a Windows filesystem mount: ${dbPath}\n` +
      'SQLite does not support POSIX file locking on /mnt/<drive>/ paths in WSL.\n' +
      'Set DATABASE_PATH to a Linux-native path, e.g. ~/.local/share/lkragl/lkrag.db'
    );
  }

  const db = new Database(dbPath);
  loadSqliteVecExtension(db);
  db.pragma(`journal_mode = ${resolveJournalMode()}`, { simple: true });
  return db;
}

export function initDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = openDb(dbPath);
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -65536');    // 64 MB page cache
  db.pragma('mmap_size = 536870912'); // 512 MB mmap

  createSchema(db);
  migrateChatSessionsTokenId(db);
  syncFtsTable(db);
  _db = db;
  return db;
}

// chat_sessions predates public_tokens (D15 before D33); add the column for
// existing databases instead of baking it into the CREATE TABLE above.
function migrateChatSessionsTokenId(db: Database.Database): void {
  const cols = db.prepare('PRAGMA table_info(chat_sessions)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'token_id')) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN token_id INTEGER REFERENCES public_tokens(id) ON DELETE SET NULL');
  }
}

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      path       TEXT NOT NULL,
      is_active  INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id  INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      path          TEXT NOT NULL,
      mtime         INTEGER NOT NULL,
      size          INTEGER NOT NULL,
      hash          TEXT NOT NULL,
      indexed_at    TEXT NOT NULL,
      UNIQUE(workspace_id, path)
    );

    CREATE INDEX IF NOT EXISTS idx_files_workspace ON files(workspace_id);

    CREATE TABLE IF NOT EXISTS chunks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id       INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      workspace_id  INTEGER NOT NULL,
      chunk_index   INTEGER NOT NULL,
      content       TEXT NOT NULL,
      snippet       TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_file      ON chunks(file_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_workspace ON chunks(workspace_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
      content,
      tokenize='trigram'
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id           TEXT    PRIMARY KEY,
      workspace_id INTEGER,
      title        TEXT    NOT NULL,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON chat_sessions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT    NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role       TEXT    NOT NULL,
      content    TEXT    NOT NULL,
      citations  TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id);

    CREATE TABLE IF NOT EXISTS public_tokens (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash    TEXT    NOT NULL UNIQUE,
      workspace_id  INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      label         TEXT    NOT NULL,
      enabled       INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_public_tokens_workspace ON public_tokens(workspace_id);

    CREATE TABLE IF NOT EXISTS public_access_log (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id           INTEGER REFERENCES public_tokens(id) ON DELETE SET NULL,
      workspace_id       INTEGER,
      query              TEXT    NOT NULL,
      prompt_tokens      INTEGER,
      completion_tokens  INTEGER,
      estimated_cost_usd REAL,
      created_at         TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_public_access_log_token ON public_access_log(token_id);
  `);
}

// ---------- FTS sync ----------

function syncFtsTable(db: Database.Database): void {
  const chunkCount = (db.prepare('SELECT COUNT(*) as cnt FROM chunks').get() as { cnt: number }).cnt;
  const ftsCount   = (db.prepare('SELECT COUNT(*) as cnt FROM fts_chunks').get() as { cnt: number }).cnt;
  if (chunkCount === ftsCount) return;

  const rebuild = db.transaction(() => {
    db.exec('DELETE FROM fts_chunks');
    const rows = db.prepare('SELECT id, content FROM chunks').all() as { id: number; content: string }[];
    const ins = db.prepare('INSERT INTO fts_chunks(rowid, content) VALUES (?, ?)');
    for (const row of rows) ins.run(row.id, row.content);
  });
  rebuild();
}

// ---------- meta ----------

export function getMeta(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setMeta(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}

// ---------- vec table ----------

export function ensureVecTable(dim: number): void {
  const db = getDb();
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      workspace_id INTEGER PARTITION KEY,
      embedding    FLOAT[${dim}]
    );
  `);
}

/** Validate or record embedding dimension. Throws if mismatch detected. */
export function checkEmbeddingDim(model: string, dim: number): void {
  const savedModel = getMeta('embedding_model');
  const savedDim   = getMeta('embedding_dim');

  if (savedDim !== null && Number(savedDim) !== dim) {
    throw new Error(
      `Embedding dimension mismatch: stored model "${savedModel}" uses dim ${savedDim}, ` +
      `but current model "${model}" returned dim ${dim}. Please run a full rebuild.`
    );
  }
  if (savedModel !== model || savedDim === null) {
    setMeta('embedding_model', model);
    setMeta('embedding_dim', String(dim));
    ensureVecTable(dim);
  }
}

// ---------- workspaces ----------

export interface Workspace {
  id: number;
  name: string;
  path: string;
  is_active: number;
  created_at: string;
}

export function listWorkspaces(): Workspace[] {
  return getDb().prepare('SELECT * FROM workspaces ORDER BY id').all() as Workspace[];
}

export function addWorkspace(name: string, wsPath: string): Workspace {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db.prepare(
    'INSERT INTO workspaces (name, path, is_active, created_at) VALUES (?, ?, 0, ?)'
  ).run(name, wsPath, now);
  return db.prepare('SELECT * FROM workspaces WHERE id = ?').get(info.lastInsertRowid) as Workspace;
}

export function deleteWorkspace(id: number): void {
  getDb().prepare('DELETE FROM workspaces WHERE id = ?').run(id);
}

export function activateWorkspace(id: number): void {
  const db = getDb();
  const activate = db.transaction(() => {
    db.prepare('UPDATE workspaces SET is_active = 0').run();
    db.prepare('UPDATE workspaces SET is_active = 1 WHERE id = ?').run(id);
  });
  activate();
}

export function getActiveWorkspace(): Workspace | null {
  const row = getDb().prepare('SELECT * FROM workspaces WHERE is_active = 1').get() as Workspace | undefined;
  return row ?? null;
}

// ---------- files ----------

export interface FileRecord {
  id: number;
  workspace_id: number;
  path: string;
  mtime: number;
  size: number;
  hash: string;
  indexed_at: string;
}

export function getFile(workspaceId: number, filePath: string): FileRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM files WHERE workspace_id = ? AND path = ?')
    .get(workspaceId, filePath) as FileRecord | undefined;
  return row ?? null;
}

export function upsertFile(
  workspaceId: number,
  filePath: string,
  mtime: number,
  size: number,
  hash: string
): number {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getFile(workspaceId, filePath);
  if (existing) {
    db.prepare(
      'UPDATE files SET mtime=?, size=?, hash=?, indexed_at=? WHERE id=?'
    ).run(mtime, size, hash, now, existing.id);
    return existing.id;
  }
  const info = db.prepare(
    'INSERT INTO files (workspace_id, path, mtime, size, hash, indexed_at) VALUES (?,?,?,?,?,?)'
  ).run(workspaceId, filePath, mtime, size, hash, now);
  return Number(info.lastInsertRowid);
}

export function listFileIds(workspaceId: number): { id: number; path: string }[] {
  return getDb()
    .prepare('SELECT id, path FROM files WHERE workspace_id = ?')
    .all(workspaceId) as { id: number; path: string }[];
}

export function deleteFile(fileId: number): void {
  const db = getDb();
  const del = db.transaction(() => {
    db.prepare('DELETE FROM vec_chunks WHERE rowid IN (SELECT id FROM chunks WHERE file_id = ?)').run(fileId);
    db.prepare('DELETE FROM fts_chunks WHERE rowid IN (SELECT id FROM chunks WHERE file_id = ?)').run(fileId);
    db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
  });
  del();
}

// ---------- chunks ----------

export interface ChunkRecord {
  id: number;
  file_id: number;
  workspace_id: number;
  chunk_index: number;
  content: string;
  snippet: string;
}

export function deleteChunksByFile(fileId: number): void {
  const db = getDb();
  const del = db.transaction(() => {
    db.prepare('DELETE FROM vec_chunks WHERE rowid IN (SELECT id FROM chunks WHERE file_id = ?)').run(fileId);
    db.prepare('DELETE FROM fts_chunks WHERE rowid IN (SELECT id FROM chunks WHERE file_id = ?)').run(fileId);
    db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileId);
  });
  del();
}

export function insertChunk(
  fileId: number,
  workspaceId: number,
  chunkIndex: number,
  content: string,
  snippet: string
): number {
  const info = getDb()
    .prepare(
      'INSERT INTO chunks (file_id, workspace_id, chunk_index, content, snippet) VALUES (?,?,?,?,?)'
    )
    .run(fileId, workspaceId, chunkIndex, content, snippet);
  return Number(info.lastInsertRowid);
}

export function insertVec(chunkId: number, workspaceId: number, embedding: number[]): void {
  getDb()
    .prepare('INSERT INTO vec_chunks (rowid, workspace_id, embedding) VALUES (?, ?, ?)')
    .run(BigInt(chunkId), BigInt(workspaceId), new Float32Array(embedding));
}

export function insertFts(chunkId: number, content: string): void {
  getDb()
    .prepare('INSERT INTO fts_chunks(rowid, content) VALUES (?, ?)')
    .run(chunkId, content);
}

export function deleteFts(chunkId: number): void {
  getDb()
    .prepare('DELETE FROM fts_chunks WHERE rowid = ?')
    .run(chunkId);
}

// ---------- search ----------

export interface SearchResult {
  chunkId: number;
  fileId: number;
  workspaceId: number;
  content: string;
  snippet: string;
  distance: number;
  filePath: string;
}

export interface FtsResult {
  chunkId: number;
  fileId: number;
  content: string;
  snippet: string;
  filePath: string;
}

export function searchFts(workspaceId: number, query: string, limit: number): FtsResult[] {
  const db = getDb();
  const escaped = query.replace(/"/g, '""');
  try {
    return db.prepare(`
      SELECT c.id AS chunkId, c.file_id AS fileId, c.content, c.snippet, f.path AS filePath
      FROM fts_chunks
      JOIN chunks c ON c.id = fts_chunks.rowid
      JOIN files  f ON f.id = c.file_id
      WHERE fts_chunks MATCH ?
        AND c.workspace_id = ?
      ORDER BY bm25(fts_chunks)
      LIMIT ?
    `).all(`"${escaped}"`, workspaceId, limit) as FtsResult[];
  } catch {
    return [];
  }
}

export function searchChunks(workspaceId: number, queryVec: number[], topK: number): SearchResult[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT c.id AS chunkId, c.file_id AS fileId, c.workspace_id AS workspaceId,
           c.content, c.snippet, v.distance, f.path AS filePath
    FROM vec_chunks v
    JOIN chunks c ON c.id = v.rowid
    JOIN files  f ON f.id = c.file_id
    WHERE v.workspace_id = ?
      AND v.embedding MATCH ?
      AND k = ?
    ORDER BY v.distance
  `).all(BigInt(workspaceId), new Float32Array(queryVec), topK) as SearchResult[];
  return rows;
}

// ---------- workspace-level clear ----------

export function getIndexedFileCount(workspaceId: number): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as cnt FROM files WHERE workspace_id = ?')
    .get(workspaceId) as { cnt: number };
  return row.cnt;
}

export function getLastIndexedAt(workspaceId: number): string | null {
  const row = getDb()
    .prepare('SELECT MAX(indexed_at) as last FROM files WHERE workspace_id = ?')
    .get(workspaceId) as { last: string | null };
  return row.last;
}

// ---------- chat sessions ----------

export interface ChatSession {
  id: string;
  workspace_id: number | null;
  token_id: number | null;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface ChatSessionWithWorkspace extends ChatSession {
  workspace_name: string | null;
}

export interface ChatMessage {
  id: number;
  session_id: string;
  role: string;
  content: string;
  citations: string | null;
  created_at: number;
}

// Admin UI history excludes sessions created via a public chat token (D33):
// those belong to whoever holds that token, not to the local admin user.
export function listChatSessions(): ChatSessionWithWorkspace[] {
  return getDb().prepare(`
    SELECT s.*, w.name AS workspace_name
    FROM chat_sessions s
    LEFT JOIN workspaces w ON w.id = s.workspace_id
    WHERE s.token_id IS NULL
    ORDER BY s.updated_at DESC
  `).all() as ChatSessionWithWorkspace[];
}

// Public chat history is scoped per issuing token, not per workspace, so that
// two tokens pointing at the same workspace don't see each other's chats (D33).
export function listChatSessionsForToken(tokenId: number): ChatSession[] {
  return getDb()
    .prepare('SELECT * FROM chat_sessions WHERE token_id = ? ORDER BY updated_at DESC')
    .all(tokenId) as ChatSession[];
}

export function deleteChatSessionForToken(id: string, tokenId: number): number {
  return getDb()
    .prepare('DELETE FROM chat_sessions WHERE id = ? AND token_id = ?')
    .run(id, tokenId).changes;
}

export function deleteChatSessionsForToken(tokenId: number): void {
  getDb().prepare('DELETE FROM chat_sessions WHERE token_id = ?').run(tokenId);
}

export function createChatSession(
  id: string,
  workspaceId: number | null,
  title: string,
  tokenId: number | null = null
): ChatSession {
  const now = Date.now();
  getDb().prepare(
    'INSERT INTO chat_sessions (id, workspace_id, token_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, workspaceId, tokenId, title, now, now);
  return { id, workspace_id: workspaceId, token_id: tokenId, title, created_at: now, updated_at: now };
}

export function getChatSession(id: string): ChatSessionWithWorkspace | null {
  const row = getDb().prepare(`
    SELECT s.*, w.name AS workspace_name
    FROM chat_sessions s
    LEFT JOIN workspaces w ON w.id = s.workspace_id
    WHERE s.id = ?
  `).get(id) as ChatSessionWithWorkspace | undefined;
  return row ?? null;
}

export function getChatMessages(sessionId: string): ChatMessage[] {
  return getDb().prepare(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at'
  ).all(sessionId) as ChatMessage[];
}

export function appendChatMessage(
  sessionId: string,
  role: string,
  content: string,
  citations: string | null
): void {
  const now = Date.now();
  const db = getDb();
  db.prepare(
    'INSERT INTO chat_messages (session_id, role, content, citations, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(sessionId, role, content, citations, now);
  db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
}

// Scoped to token_id IS NULL so the admin "delete" actions can't reach into
// a public token's chat history (mirrors the read-side scoping above).
export function deleteChatSession(id: string): void {
  getDb().prepare('DELETE FROM chat_sessions WHERE id = ? AND token_id IS NULL').run(id);
}

export function deleteAllChatSessions(): void {
  getDb().prepare('DELETE FROM chat_sessions WHERE token_id IS NULL').run();
}

// ---------- workspace-level clear ----------

export function clearWorkspaceIndex(workspaceId: number): void {
  const db = getDb();
  const clear = db.transaction(() => {
    db.prepare(`
      DELETE FROM vec_chunks WHERE rowid IN (
        SELECT c.id FROM chunks c JOIN files f ON c.file_id = f.id WHERE f.workspace_id = ?
      )
    `).run(workspaceId);
    db.prepare(`
      DELETE FROM fts_chunks WHERE rowid IN (
        SELECT c.id FROM chunks c JOIN files f ON c.file_id = f.id WHERE f.workspace_id = ?
      )
    `).run(workspaceId);
    db.prepare('DELETE FROM files WHERE workspace_id = ?').run(workspaceId);
  });
  clear();
}

// ---------- public tokens ----------

export interface PublicToken {
  id: number;
  workspace_id: number;
  label: string;
  enabled: number;
  created_at: string;
}

export interface PublicTokenWithWorkspace extends PublicToken {
  workspace_name: string | null;
}

function hashPublicToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createPublicToken(workspaceId: number, label: string): { token: string; record: PublicToken } {
  const db = getDb();
  const token = crypto.randomBytes(24).toString('base64url');
  const now = new Date().toISOString();
  const info = db.prepare(
    'INSERT INTO public_tokens (token_hash, workspace_id, label, enabled, created_at) VALUES (?, ?, ?, 1, ?)'
  ).run(hashPublicToken(token), workspaceId, label, now);
  const record = db.prepare('SELECT * FROM public_tokens WHERE id = ?').get(info.lastInsertRowid) as PublicToken;
  return { token, record };
}

export function listPublicTokens(): PublicTokenWithWorkspace[] {
  return getDb().prepare(`
    SELECT t.*, w.name AS workspace_name
    FROM public_tokens t
    LEFT JOIN workspaces w ON w.id = t.workspace_id
    ORDER BY t.id
  `).all() as PublicTokenWithWorkspace[];
}

export function revokePublicToken(id: number): void {
  getDb().prepare('UPDATE public_tokens SET enabled = 0 WHERE id = ?').run(id);
}

/** Looks up an enabled token by its plaintext value (hashes internally before querying). */
export function findPublicTokenByToken(token: string): PublicToken | null {
  const row = getDb()
    .prepare('SELECT * FROM public_tokens WHERE token_hash = ? AND enabled = 1')
    .get(hashPublicToken(token)) as PublicToken | undefined;
  return row ?? null;
}

// ---------- public access log ----------

export function insertPublicAccessLog(
  tokenId: number | null,
  workspaceId: number | null,
  query: string,
  promptTokens: number | null,
  completionTokens: number | null,
  estimatedCostUsd: number | null
): void {
  const now = new Date().toISOString();
  getDb().prepare(
    'INSERT INTO public_access_log (token_id, workspace_id, query, prompt_tokens, completion_tokens, estimated_cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(tokenId, workspaceId, query, promptTokens, completionTokens, estimatedCostUsd, now);
}
