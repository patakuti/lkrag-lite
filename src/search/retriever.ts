import { searchChunks, getActiveWorkspace, SearchResult } from '../db/sqlite.js';
import { embed } from './embedding.js';
import { runtimeConfig } from '../config/runtime.js';

export interface RetrievedChunk {
  n: number;
  chunkId: number;
  fileId: number;
  filePath: string;
  content: string;
  snippet: string;
  score: number;
}

export async function retrieve(query: string): Promise<RetrievedChunk[]> {
  const ws = getActiveWorkspace();
  if (!ws) throw new Error('No active workspace');

  const topK     = runtimeConfig.topK;
  const minScore = runtimeConfig.minSimilarity;

  const [queryVec] = await embed([query], 'query');
  const raw: SearchResult[] = searchChunks(ws.id, queryVec, topK);

  return raw
    .map((r) => ({ ...r, score: 1 - r.distance }))
    .filter((r) => r.score >= minScore)
    .map((r, i) => ({
      n: i + 1,
      chunkId: r.chunkId,
      fileId: r.fileId,
      filePath: r.filePath,
      content: r.content,
      snippet: r.snippet,
      score: Math.round(r.score * 1000) / 1000,
    }));
}
