export interface RuntimeConfig {
  topK: number;
  minSimilarity: number;
  outputInstructions: string;
}

function loadFromEnv(): RuntimeConfig {
  return {
    topK:               Number(process.env.RAG_TOP_K)          || 5,
    minSimilarity:      Number(process.env.RAG_MIN_SIMILARITY)  || 0.3,
    outputInstructions: process.env.RAG_OUTPUT_INSTRUCTIONS     ?? '',
  };
}

export const runtimeConfig: RuntimeConfig = loadFromEnv();

export function reloadFromEnv(): void {
  const fresh = loadFromEnv();
  runtimeConfig.topK               = fresh.topK;
  runtimeConfig.minSimilarity      = fresh.minSimilarity;
  runtimeConfig.outputInstructions = fresh.outputInstructions;
}
