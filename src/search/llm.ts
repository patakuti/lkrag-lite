import { RetrievedChunk } from './retriever.js';
import { runtimeConfig } from '../config/runtime.js';

export interface Citation {
  n: number;
  path: string;
  absolutePath: string;
  score: number;
  snippet: string;
}

export interface LLMUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface LLMResult {
  answer: string;
  citations: Citation[];
  rewriterFallback: boolean;
  usage: LLMUsage;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c) => `<source id="${c.n}" file="${c.filePath}">\n${c.content}\n</source>`)
    .join('\n\n');
}

const SYSTEM_PROMPT =
  'You are a helpful assistant. Answer the user\'s question based ONLY on the provided source documents. ' +
  'When citing a source, use ONLY the plain bracket format: [1], [2], [3], etc., where the number matches the source id attribute. ' +
  'Do NOT use any other citation format such as [1†...], [2†source], or 【n†...】. ' +
  'Output your answer in Markdown format. ' +
  'If the sources do not contain enough information, say so clearly instead of guessing.';

const SYSTEM_PROMPT_NO_RAG =
  'You are a helpful assistant. Answer the user\'s question based on the conversation history. ' +
  'Output your answer in Markdown format.';

const REWRITER_SYSTEM_PROMPT =
  'You are a search query optimizer. Given a conversation history and the latest user message, ' +
  'generate a concise, standalone search query that captures the key information need for a vector database lookup. ' +
  'The query should be topically focused and free of conversational filler. ' +
  'Output ONLY a JSON object matching the schema: {"search_query": "<query string>"}.';

/** Normalize unusual LLM citation formats (e.g. [1†L2-L9], 【2†source】) to plain [n]. */
function normalizeCitations(text: string): string {
  text = text.replace(/【(\d+)[†][^】]*】/g, '[$1]');
  text = text.replace(/\[(\d+)[†][^\]]*\]/g, '[$1]');
  return text;
}

// ---------- OpenAI / OpenAI-compatible ----------

interface OpenAIChatResponse {
  choices: { message: { content: string } }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function usageFromOpenAI(json: OpenAIChatResponse): LLMUsage {
  return {
    promptTokens: json.usage?.prompt_tokens ?? null,
    completionTokens: json.usage?.completion_tokens ?? null,
  };
}

async function callOpenAI(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: string; content: string }[]
): Promise<{ content: string; usage: LLMUsage }> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM API error ${res.status}: ${text}`);
  }

  const json = await res.json() as OpenAIChatResponse;
  return { content: json.choices[0].message.content, usage: usageFromOpenAI(json) };
}

async function callOpenAIStructured(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{ content: string; usage: LLMUsage }> {
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
        { role: 'user', content: userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'search_query',
          schema: {
            type: 'object',
            properties: {
              search_query: { type: 'string' },
            },
            required: ['search_query'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Query rewriter API error ${res.status}: ${text}`);
  }

  const json = await res.json() as OpenAIChatResponse;
  return { content: json.choices[0].message.content, usage: usageFromOpenAI(json) };
}

// ---------- Anthropic ----------

interface AnthropicMessagesResponse {
  content: { type: string; text?: string; name?: string; input?: unknown }[];
  usage?: { input_tokens: number; output_tokens: number };
}

function usageFromAnthropic(json: AnthropicMessagesResponse): LLMUsage {
  return {
    promptTokens: json.usage?.input_tokens ?? null,
    completionTokens: json.usage?.output_tokens ?? null,
  };
}

async function callAnthropicStructured(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{ content: string; usage: LLMUsage }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [{
        name: 'search_query',
        description: 'Output a structured search query',
        input_schema: {
          type: 'object',
          properties: {
            search_query: { type: 'string' },
          },
          required: ['search_query'],
        },
      }],
      tool_choice: { type: 'tool', name: 'search_query' },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Query rewriter API error ${res.status}: ${text}`);
  }

  const json = await res.json() as AnthropicMessagesResponse;
  const toolUse = json.content.find((b) => b.type === 'tool_use' && b.name === 'search_query');
  const content = toolUse?.input ? JSON.stringify(toolUse.input) : '{}';
  return { content, usage: usageFromAnthropic(json) };
}

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: string; content: string }[]
): Promise<{ content: string; usage: LLMUsage }> {
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
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const json = await res.json() as AnthropicMessagesResponse;
  const block = json.content.find((b) => b.type === 'text');
  return { content: block?.text ?? '', usage: usageFromAnthropic(json) };
}

// ---------- Query Rewriter ----------

const NO_USAGE: LLMUsage = { promptTokens: null, completionTokens: null };

export async function rewriteQuery(
  userInput: string,
  history: ConversationMessage[]
): Promise<{ searchQuery: string; fallback: boolean; usage: LLMUsage }> {
  const provider = process.env.QUERY_REWRITER_PROVIDER ?? 'openai';

  const historyText = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
  const userPrompt = history.length > 0
    ? `Conversation so far:\n${historyText}\n\nLatest user message: ${userInput}`
    : `User message: ${userInput}`;

  try {
    let raw: string;
    let usage: LLMUsage;

    if (provider === 'anthropic') {
      const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
      const model  = process.env.QUERY_REWRITER_MODEL ?? 'claude-haiku-4-5';
      ({ content: raw, usage } = await callAnthropicStructured(apiKey, model, REWRITER_SYSTEM_PROMPT, userPrompt));
    } else {
      const model   = process.env.QUERY_REWRITER_MODEL ?? 'gpt-4o-mini';
      const apiKey  = process.env.OPENAI_API_KEY ?? '';
      const baseUrl =
        provider === 'openai-compatible'
          ? (process.env.OPENAI_COMPATIBLE_BASE_URL ?? 'http://localhost:4000/v1').replace(/\/$/, '')
          : 'https://api.openai.com/v1';
      ({ content: raw, usage } = await callOpenAIStructured(baseUrl, apiKey, model, REWRITER_SYSTEM_PROMPT, userPrompt));
    }

    const parsed = JSON.parse(raw) as { search_query?: unknown };
    const searchQuery = typeof parsed.search_query === 'string' && parsed.search_query.trim()
      ? parsed.search_query.trim()
      : null;

    if (!searchQuery) {
      return { searchQuery: userInput, fallback: true, usage };
    }
    return { searchQuery, fallback: false, usage };
  } catch {
    return { searchQuery: userInput, fallback: true, usage: NO_USAGE };
  }
}

// ---------- Answer generation ----------

export async function generateAnswer(
  query: string,
  chunks: RetrievedChunk[],
  history: ConversationMessage[] = [],
  skipRag = false
): Promise<Omit<LLMResult, 'rewriterFallback'>> {
  if (!skipRag && chunks.length === 0) {
    return {
      answer: 'No relevant documents found in the active workspace.',
      citations: [],
      usage: NO_USAGE,
    };
  }

  const provider = process.env.LLM_PROVIDER ?? 'openai';
  const model    = process.env.LLM_MODEL    ?? 'gpt-4o-mini';

  const extra = runtimeConfig.outputInstructions.trim();

  let systemPrompt: string;
  let messages: { role: string; content: string }[];

  if (skipRag) {
    systemPrompt = extra ? `${SYSTEM_PROMPT_NO_RAG}\n${extra}` : SYSTEM_PROMPT_NO_RAG;
    messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: query },
    ];
  } else {
    const context = buildContext(chunks);
    systemPrompt = extra ? `${SYSTEM_PROMPT}\n${extra}` : SYSTEM_PROMPT;
    // Build messages: history turns + current user message with RAG context
    messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${query}` },
    ];
  }

  let answer: string;
  let usage: LLMUsage;

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
    ({ content: answer, usage } = await callAnthropic(apiKey, model, systemPrompt, messages));
  } else {
    const apiKey = process.env.OPENAI_API_KEY ?? '';
    const baseUrl =
      provider === 'openai-compatible'
        ? (process.env.OPENAI_COMPATIBLE_BASE_URL ?? 'http://localhost:4000/v1').replace(/\/$/, '')
        : 'https://api.openai.com/v1';
    ({ content: answer, usage } = await callOpenAI(baseUrl, apiKey, model, systemPrompt, messages));
  }

  answer = normalizeCitations(answer);

  const citations: Citation[] = chunks.map((c) => ({
    n: c.n,
    path: c.filePath,
    absolutePath: c.absolutePath,
    score: c.score,
    snippet: c.snippet,
  }));

  return { answer, citations, usage };
}
