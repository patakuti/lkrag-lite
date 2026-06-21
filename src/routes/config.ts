import { Router } from 'express';

const router = Router();

// Returns only non-sensitive configuration (no API keys)
router.get('/', (_req, res) => {
  res.json({
    embeddingProvider: process.env.EMBEDDING_PROVIDER ?? 'openai',
    embeddingModel:    process.env.EMBEDDING_MODEL    ?? 'text-embedding-3-small',
    llmProvider:       process.env.LLM_PROVIDER       ?? 'openai',
    llmModel:          process.env.LLM_MODEL          ?? 'gpt-4o-mini',
    chunkSize:         Number(process.env.RAG_CHUNK_SIZE)       || 1000,
    chunkOverlap:      Number(process.env.RAG_CHUNK_OVERLAP)    || 200,
    topK:              Number(process.env.RAG_TOP_K)            || 5,
    minSimilarity:     Number(process.env.RAG_MIN_SIMILARITY)   || 0.3,
  });
});

export default router;
