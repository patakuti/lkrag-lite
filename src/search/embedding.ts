import { checkEmbeddingDim } from '../db/sqlite.js';
import { resolveEmbeddingConfig } from '../config/providers.js';

export type EmbeddingPurpose = 'query' | 'document';

/** Thrown when the embedding API itself is unreachable or rejects the request. */
export class EmbeddingApiError extends Error {}

async function embedBatch(
  input: string[],
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<number[][]> {
  const url = `${baseUrl}/embeddings`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EmbeddingApiError(`Embedding API unreachable at ${url}: ${msg}`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new EmbeddingApiError(`Embedding API error ${res.status} at ${url}: ${text}`);
  }

  const json = await res.json() as { data: { embedding: number[]; index: number }[] };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embed(texts: string[], purpose?: EmbeddingPurpose): Promise<number[][]> {
  const { model, apiKey, baseUrl } = resolveEmbeddingConfig();

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
