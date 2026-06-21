import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import fg from 'fast-glob';
import * as textParser from './parsers/text.js';
import * as pdfParser  from './parsers/pdf.js';
import * as docxParser from './parsers/docx.js';
import * as xlsxParser from './parsers/xlsx.js';
import * as htmlParser from './parsers/html.js';
import * as pptxParser from './parsers/pptx.js';
import { chunk, makeSnippet } from './chunker.js';
import {
  getFile, upsertFile, listFileIds, deleteFile,
  deleteChunksByFile, insertChunk, insertVec,
  clearWorkspaceIndex, getActiveWorkspace,
} from '../db/sqlite.js';
import { embed } from '../search/embedding.js';

// ---------- types ----------

export interface IndexStatus {
  state: 'idle' | 'indexing';
  total: number;
  processed: number;
  currentFile: string | null;
  startedAt: string | null;
  error: string | null;
  cancelRequested: boolean;
}

// ---------- singleton state ----------

let status: IndexStatus = {
  state: 'idle',
  total: 0,
  processed: 0,
  currentFile: null,
  startedAt: null,
  error: null,
  cancelRequested: false,
};

export function getStatus(): IndexStatus {
  return { ...status };
}

export function requestCancel(): void {
  if (status.state === 'indexing') status.cancelRequested = true;
}

// ---------- parsers registry ----------

interface Parser {
  extensions: string[];
  parse(filePath: string): Promise<string>;
}

const parsers: Parser[] = [textParser, pdfParser, docxParser, xlsxParser, htmlParser, pptxParser];

function getParser(filePath: string): Parser | null {
  const ext = path.extname(filePath).toLowerCase();
  return parsers.find((p) => p.extensions.includes(ext)) ?? null;
}

// ---------- helpers ----------

function fileHash(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function getEnvPatterns(key: string, defaults: string[]): string[] {
  const val = process.env[key];
  if (!val) return defaults;
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

// ---------- core indexer ----------

async function indexWorkspace(workspaceId: number, wsPath: string, rebuild: boolean): Promise<void> {
  const includePatterns = getEnvPatterns(
    'RAG_INCLUDE_PATTERNS',
    ['**/*.md', '**/*.txt']
  );
  const excludePatterns = getEnvPatterns(
    'RAG_EXCLUDE_PATTERNS',
    ['node_modules/**', '.git/**']
  );

  const files = await fg(includePatterns, {
    cwd: wsPath,
    ignore: excludePatterns,
    absolute: false,
    onlyFiles: true,
  });

  if (rebuild) {
    clearWorkspaceIndex(workspaceId);
  }

  status.total = files.length;
  status.processed = 0;

  // Track existing DB paths for deletion detection
  const existingPaths = new Map<string, number>(
    listFileIds(workspaceId).map((r) => [r.path, r.id])
  );
  const seenPaths = new Set<string>();

  const chunkSize = Number(process.env.RAG_CHUNK_SIZE) || 1000;
  const chunkOverlap = Number(process.env.RAG_CHUNK_OVERLAP) || 200;

  for (const relPath of files) {
    if (status.cancelRequested) break;

    status.currentFile = relPath;
    const absPath = path.join(wsPath, relPath);

    const parser = getParser(absPath);
    if (!parser) {
      status.processed++;
      continue;
    }

    const stat = fs.statSync(absPath);
    const mtime = stat.mtimeMs;
    const size = stat.size;
    const hash = fileHash(absPath);

    seenPaths.add(relPath);

    const existing = getFile(workspaceId, relPath);
    const unchanged = existing && existing.mtime === mtime && existing.size === size && existing.hash === hash;

    if (!unchanged) {
      // Remove old chunks/vecs if re-indexing
      if (existing) deleteChunksByFile(existing.id);

      const text = await parser.parse(absPath);
      const chunks = chunk(text, chunkSize, chunkOverlap);
      const fileId = upsertFile(workspaceId, relPath, mtime, size, hash);

      if (chunks.length > 0) {
        const embeddings = await embed(chunks, 'document');
        for (let i = 0; i < chunks.length; i++) {
          const snippet = makeSnippet(chunks[i]);
          const chunkId = insertChunk(fileId, workspaceId, i, chunks[i], snippet);
          insertVec(chunkId, workspaceId, embeddings[i]);
        }
      }
    }

    status.processed++;
  }

  // Delete files no longer in the workspace
  if (!status.cancelRequested) {
    for (const [filePath, fileId] of existingPaths) {
      if (!seenPaths.has(filePath)) {
        deleteFile(fileId);
      }
    }
  }
}

// ---------- public API ----------

export async function runUpdate(): Promise<void> {
  if (status.state === 'indexing') throw new Error('Already indexing');

  const ws = getActiveWorkspace();
  if (!ws) throw new Error('No active workspace');

  status = {
    state: 'indexing',
    total: 0,
    processed: 0,
    currentFile: null,
    startedAt: new Date().toISOString(),
    error: null,
    cancelRequested: false,
  };

  indexWorkspace(ws.id, ws.path, false)
    .catch((err) => { status.error = String(err); })
    .finally(() => { status.state = 'idle'; status.currentFile = null; });
}

export async function runRebuild(): Promise<void> {
  if (status.state === 'indexing') throw new Error('Already indexing');

  const ws = getActiveWorkspace();
  if (!ws) throw new Error('No active workspace');

  status = {
    state: 'indexing',
    total: 0,
    processed: 0,
    currentFile: null,
    startedAt: new Date().toISOString(),
    error: null,
    cancelRequested: false,
  };

  indexWorkspace(ws.id, ws.path, true)
    .catch((err) => { status.error = String(err); })
    .finally(() => { status.state = 'idle'; status.currentFile = null; });
}
