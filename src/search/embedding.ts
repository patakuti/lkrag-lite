import { checkEmbeddingDim } from '../db/sqlite.js';

export type EmbeddingPurpose = 'query' | 'document';

async function embedBatch(
  input: string[],
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<number[][]> {
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${text}`);
  }

  const json = await res.json() as { data: { embedding: number[]; index: number }[] };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embed(texts: string[], purpose?: EmbeddingPurpose): Promise<number[][]> {
  const provider = process.env.EMBEDDING_PROVIDER ?? 'openai';
  const model    = process.env.EMBEDDING_MODEL    ?? 'text-embedding-3-small';
  const apiKey   = process.env.OPENAI_API_KEY     ?? '';

  let baseUrl: string;
  if (provider === 'ollama') {
    baseUrl = (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1').replace(/\/$/, '');
  } else if (provider === 'litellm') {
    baseUrl = (process.env.OPENAI_COMPATIBLE_BASE_URL ?? 'http://localhost:4000/v1').replace(/\/$/, '');
  } else {
    baseUrl = 'https://api.openai.com/v1';
  }

  const prefix = purpose === 'query'    ? (process.env.EMBEDDING_QUERY_PREFIX    ?? '')
               : purpose === 'document' ? (process.env.EMBEDDING_DOCUMENT_PREFIX ?? '')
               : '';
  const input = prefix ? texts.map((t) => prefix + t) : texts;

  const batchSize = Number(process.env.EMBEDDING_BATCH_SIZE) || 500;
  const embeddings: number[][] = [];

  for (let i = 0; i < input.length; i += batchSize) {
    const batch = input.slice(i, i + batchSize);
    const batchEmbeddings = await embedBatch(batch, baseUrl, apiKey, model);
    embeddings.push(...batchEmbeddings);
  }

  if (embeddings.length > 0) {
    checkEmbeddingDim(model, embeddings[0].length);
  }

  return embeddings;
}
