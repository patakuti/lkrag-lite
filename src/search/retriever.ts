import { searchChunks, searchFts, getActiveWorkspace } from '../db/sqlite.js';
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

const RRF_K = 60;

export async function retrieve(query: string): Promise<RetrievedChunk[]> {
  const ws = getActiveWorkspace();
  if (!ws) throw new Error('No active workspace');

  const topK     = runtimeConfig.topK;
  const minScore = runtimeConfig.minSimilarity;
  const fetchN   = topK * 2;

  const [queryVec] = await embed([query], 'query');

  const vecRaw = searchChunks(ws.id, queryVec, fetchN);
  const ftsRaw = searchFts(ws.id, query, fetchN);

  // Apply min similarity filter to vec results before ranking
  const vecFiltered = vecRaw
    .map((r) => ({ ...r, score: 1 - r.distance }))
    .filter((r) => r.score >= minScore);

  type Entry = {
    chunkId: number; fileId: number; filePath: string;
    content: string; snippet: string; rrfScore: number;
  };
  const map = new Map<number, Entry>();

  vecFiltered.forEach((r, rank) => {
    map.set(r.chunkId, {
      chunkId: r.chunkId, fileId: r.fileId, filePath: r.filePath,
      content: r.content, snippet: r.snippet,
      rrfScore: 1 / (RRF_K + rank + 1),
    });
  });

  ftsRaw.forEach((r, rank) => {
    const existing = map.get(r.chunkId);
    if (existing) {
      existing.rrfScore += 1 / (RRF_K + rank + 1);
    } else {
      map.set(r.chunkId, {
        chunkId: r.chunkId, fileId: r.fileId, filePath: r.filePath,
        content: r.content, snippet: r.snippet,
        rrfScore: 1 / (RRF_K + rank + 1),
      });
    }
  });

  return [...map.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, topK)
    .map((r, i) => ({
      n: i + 1,
      chunkId: r.chunkId,
      fileId: r.fileId,
      filePath: r.filePath,
      content: r.content,
      snippet: r.snippet,
      score: Math.round(r.rrfScore * 10000) / 10000,
    }));
}
