import { Router } from 'express';
import { runtimeConfig, reloadFromEnv } from '../config/runtime.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    embeddingProvider:  process.env.EMBEDDING_PROVIDER ?? 'openai',
    embeddingModel:     process.env.EMBEDDING_MODEL    ?? 'text-embedding-3-small',
    llmProvider:        process.env.LLM_PROVIDER       ?? 'openai',
    llmModel:           process.env.LLM_MODEL          ?? 'gpt-4o-mini',
    chunkSize:          Number(process.env.RAG_CHUNK_SIZE)    || 1000,
    chunkOverlap:       Number(process.env.RAG_CHUNK_OVERLAP) || 200,
    topK:               runtimeConfig.topK,
    minSimilarity:      runtimeConfig.minSimilarity,
    outputInstructions: runtimeConfig.outputInstructions,
  });
});

router.put('/', (req, res) => {
  const { topK, minSimilarity, outputInstructions } = req.body as {
    topK?: unknown;
    minSimilarity?: unknown;
    outputInstructions?: unknown;
  };

  if (topK !== undefined) {
    const n = Number(topK);
    if (!Number.isInteger(n) || n < 1) {
      res.status(400).json({ error: 'topK must be a positive integer' });
      return;
    }
    runtimeConfig.topK = n;
  }

  if (minSimilarity !== undefined) {
    const n = Number(minSimilarity);
    if (isNaN(n) || n < 0 || n > 1) {
      res.status(400).json({ error: 'minSimilarity must be a number between 0 and 1' });
      return;
    }
    runtimeConfig.minSimilarity = n;
  }

  if (outputInstructions !== undefined) {
    runtimeConfig.outputInstructions = String(outputInstructions);
  }

  res.json({
    topK:               runtimeConfig.topK,
    minSimilarity:      runtimeConfig.minSimilarity,
    outputInstructions: runtimeConfig.outputInstructions,
  });
});

router.post('/reload', (_req, res) => {
  reloadFromEnv();
  res.json({
    topK:               runtimeConfig.topK,
    minSimilarity:      runtimeConfig.minSimilarity,
    outputInstructions: runtimeConfig.outputInstructions,
  });
});

export default router;
