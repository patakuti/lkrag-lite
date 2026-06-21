import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) throw new Error('DB not initialized. Call initDb() first.');
  return _db;
}

export function initDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createSchema(db);
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

    CREATE TABLE IF NOT EXISTS chunks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id       INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      workspace_id  INTEGER NOT NULL,
      chunk_index   INTEGER NOT NULL,
      content       TEXT NOT NULL,
      snippet       TEXT NOT NULL
    );
  `);
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
  // Delete vec_chunks rows for all chunks of this file before deleting chunks
  const chunkIds = (
    db.prepare('SELECT id FROM chunks WHERE file_id = ?').all(fileId) as { id: number }[]
  ).map((r) => r.id);

  const del = db.transaction(() => {
    for (const cid of chunkIds) {
      db.prepare('DELETE FROM vec_chunks WHERE rowid = ?').run(cid);
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
      }
    }
    db.prepare('DELETE FROM files WHERE workspace_id = ?').run(workspaceId);
  });
  clear();
}
