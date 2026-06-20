import { RetrievedChunk } from './retriever.js';

export interface Citation {
  n: number;
  path: string;
  score: number;
  snippet: string;
}

export interface LLMResult {
  answer: string;
  citations: Citation[];
}

function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c) => `[${c.n}] (${c.filePath})\n${c.content}`)
    .join('\n\n---\n\n');
}

const SYSTEM_PROMPT =
  'You are a helpful assistant. Answer the user\'s question based ONLY on the provided context. ' +
  'For each claim, cite the source using the reference number like [1], [2], etc. ' +
  'If the context does not contain enough information, say so clearly instead of guessing.';

// ---------- OpenAI / OpenAI-compatible ----------

async function callOpenAI(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM API error ${res.status}: ${text}`);
  }

  const json = await res.json() as {
    choices: { message: { content: string } }[];
  };
  return json.choices[0].message.content;
}

// ---------- Anthropic ----------

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const json = await res.json() as {
    content: { type: string; text: string }[];
  };
  const block = json.content.find((b) => b.type === 'text');
  return block?.text ?? '';
}

// ---------- public ----------

export async function generateAnswer(
  query: string,
  chunks: RetrievedChunk[]
): Promise<LLMResult> {
  if (chunks.length === 0) {
    return {
      answer: 'No relevant documents found in the active workspace.',
      citations: [],
    };
  }

  const provider = process.env.LLM_PROVIDER ?? 'openai';
  const model    = process.env.LLM_MODEL    ?? 'gpt-4o-mini';
  const context  = buildContext(chunks);
  const userPrompt = `Context:\n${context}\n\nQuestion: ${query}`;

  let answer: string;

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
    answer = await callAnthropic(apiKey, model, SYSTEM_PROMPT, userPrompt);
  } else {
    const apiKey = process.env.OPENAI_API_KEY ?? '';
    const baseUrl =
      provider === 'openai-compatible'
        ? (process.env.OPENAI_COMPATIBLE_BASE_URL ?? 'http://localhost:4000/v1').replace(/\/$/, '')
        : 'https://api.openai.com/v1';
    answer = await callOpenAI(baseUrl, apiKey, model, SYSTEM_PROMPT, userPrompt);
  }

  const citations: Citation[] = chunks.map((c) => ({
    n: c.n,
    path: c.filePath,
    score: c.score,
    snippet: c.snippet,
  }));

  return { answer, citations };
}
