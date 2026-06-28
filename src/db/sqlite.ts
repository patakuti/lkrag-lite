import os from 'os';
import path from 'path';
import fs from 'fs';
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

// Windows filesystems accessed through WSL (/mnt/<drive>/) do not support the
// fcntl() advisory locking that SQLite WAL mode requires on the -shm file.
// Attempting pragma journal_mode = WAL on such paths raises SQLITE_PROTOCOL,
// and the partial WAL initialisation it performs before failing leaves the DB
// header in WAL mode — making even a DELETE fallback impossible on the same
// connection.  The only safe strategy is to detect these paths upfront and
// never attempt WAL at all.  A freshly created database already defaults to
// DELETE journal mode, so no pragma is needed.
function isNtfsDrvFs(dbPath: string): boolean {
  return /^\/mnt\/[a-zA-Z]\//.test(path.resolve(dbPath));
}

function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  loadSqliteVecExtension(db);

  if (isNtfsDrvFs(dbPath)) {
    // WAL is not supported here.  A newly created DB is already in DELETE
    // mode.  If the DB was previously created in WAL mode, it must be deleted
    // and rebuilt — switching modes also requires WAL locking.
    const mode = db.pragma('journal_mode', { simple: true }) as string;
    if (mode === 'wal') {
      try { db.close(); } catch { /* ignore */ }
      throw new Error(
        'The database is in WAL mode but WAL file locking is not supported on this filesystem.\n' +
        `Delete the database file and try again: ${dbPath}`
      );
    }
    return db;
  }

  db.pragma('journal_mode = WAL', { simple: true });
  return db;
}

export function initDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  createSchema(db);
  syncFtsTable(db);
  _db = db;
  return db;
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
  const chunkIds = (
    db.prepare('SELECT id FROM chunks WHERE file_id = ?').all(fileId) as { id: number }[]
  ).map((r) => r.id);

  const del = db.transaction(() => {
    for (const cid of chunkIds) {
      db.prepare('DELETE FROM vec_chunks WHERE rowid = ?').run(cid);
      db.prepare('DELETE FROM fts_chunks WHERE rowid = ?').run(cid);
    }
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
  const chunkIds = (
    db.prepare('SELECT id FROM chunks WHERE file_id = ?').all(fileId) as { id: number }[]
  ).map((r) => r.id);

  const del = db.transaction(() => {
    for (const cid of chunkIds) {
      db.prepare('DELETE FROM vec_chunks WHERE rowid = ?').run(cid);
      db.prepare('DELETE FROM fts_chunks WHERE rowid = ?').run(cid);
    }
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

export function listChatSessions(): ChatSessionWithWorkspace[] {
  return getDb().prepare(`
    SELECT s.*, w.name AS workspace_name
    FROM chat_sessions s
    LEFT JOIN workspaces w ON w.id = s.workspace_id
    ORDER BY s.updated_at DESC
  `).all() as ChatSessionWithWorkspace[];
}

export function createChatSession(id: string, workspaceId: number | null, title: string): ChatSession {
  const now = Date.now();
  getDb().prepare(
    'INSERT INTO chat_sessions (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, workspaceId, title, now, now);
  return { id, workspace_id: workspaceId, title, created_at: now, updated_at: now };
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

export function deleteChatSession(id: string): void {
  getDb().prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
}

export function deleteAllChatSessions(): void {
  getDb().prepare('DELETE FROM chat_sessions').run();
}

// ---------- workspace-level clear ----------

export function clearWorkspaceIndex(workspaceId: number): void {
  const db = getDb();
  const fileIds = (
    db.prepare('SELECT id FROM files WHERE workspace_id = ?').all(workspaceId) as { id: number }[]
  ).map((r) => r.id);

  const clear = db.transaction(() => {
    for (const fid of fileIds) {
      const chunkIds = (
        db.prepare('SELECT id FROM chunks WHERE file_id = ?').all(fid) as { id: number }[]
      ).map((r) => r.id);
      for (const cid of chunkIds) {
        db.prepare('DELETE FROM vec_chunks WHERE rowid = ?').run(cid);
        db.prepare('DELETE FROM fts_chunks WHERE rowid = ?').run(cid);
      }
    }
    db.prepare('DELETE FROM files WHERE workspace_id = ?').run(workspaceId);
  });
  clear();
}
