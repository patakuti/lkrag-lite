const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const COMPATIBLE_DEFAULT_BASE_URL = 'http://localhost:4000/v1';

const EMBEDDING_PROVIDERS = ['openai', 'openai-compatible'] as const;
const LLM_PROVIDERS = ['openai', 'anthropic', 'openai-compatible'] as const;
const REWRITER_PROVIDERS = ['openai', 'anthropic', 'openai-compatible'] as const;

export interface ResolvedProviderConfig {
  role: 'Embedding' | 'LLM' | 'Rewriter';
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
}

function failInvalidProvider(envVar: string, value: string, allowed: readonly string[]): never {
  process.stderr.write(
    `Error: invalid ${envVar}="${value}".\n` +
    `Allowed values: ${allowed.join(' / ')}\n`,
  );
  process.exit(1);
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

export function resolveEmbeddingConfig(): ResolvedProviderConfig {
  const provider = process.env.EMBEDDING_PROVIDER ?? 'openai';
  if (!EMBEDDING_PROVIDERS.includes(provider as (typeof EMBEDDING_PROVIDERS)[number])) {
    failInvalidProvider('EMBEDDING_PROVIDER', provider, EMBEDDING_PROVIDERS);
  }
  const model  = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
  const apiKey = process.env.EMBEDDING_API_KEY ?? '';
  const baseUrl = provider === 'openai-compatible'
    ? stripTrailingSlash(process.env.EMBEDDING_BASE_URL ?? COMPATIBLE_DEFAULT_BASE_URL)
    : OPENAI_DEFAULT_BASE_URL;
  return { role: 'Embedding', provider, model, apiKey, baseUrl };
}

export function resolveLlmConfig(): ResolvedProviderConfig {
  const provider = process.env.LLM_PROVIDER ?? 'openai';
  if (!LLM_PROVIDERS.includes(provider as (typeof LLM_PROVIDERS)[number])) {
    failInvalidProvider('LLM_PROVIDER', provider, LLM_PROVIDERS);
  }
  const model = process.env.LLM_MODEL ?? 'gpt-4o-mini';
  if (provider === 'anthropic') {
    return { role: 'LLM', provider, model, apiKey: process.env.ANTHROPIC_API_KEY ?? '', baseUrl: ANTHROPIC_BASE_URL };
  }
  const apiKey = process.env.LLM_API_KEY ?? '';
  const baseUrl = provider === 'openai-compatible'
    ? stripTrailingSlash(process.env.LLM_BASE_URL ?? COMPATIBLE_DEFAULT_BASE_URL)
    : OPENAI_DEFAULT_BASE_URL;
  return { role: 'LLM', provider, model, apiKey, baseUrl };
}

export function resolveRewriterConfig(): ResolvedProviderConfig {
  const provider = process.env.QUERY_REWRITER_PROVIDER ?? 'openai';
  if (!REWRITER_PROVIDERS.includes(provider as (typeof REWRITER_PROVIDERS)[number])) {
    failInvalidProvider('QUERY_REWRITER_PROVIDER', provider, REWRITER_PROVIDERS);
  }
  if (provider === 'anthropic') {
    const model = process.env.QUERY_REWRITER_MODEL ?? 'claude-haiku-4-5';
    return { role: 'Rewriter', provider, model, apiKey: process.env.ANTHROPIC_API_KEY ?? '', baseUrl: ANTHROPIC_BASE_URL };
  }
  const model  = process.env.QUERY_REWRITER_MODEL ?? 'gpt-4o-mini';
  const apiKey = process.env.QUERY_REWRITER_API_KEY ?? '';
  const baseUrl = provider === 'openai-compatible'
    ? stripTrailingSlash(process.env.QUERY_REWRITER_BASE_URL ?? COMPATIBLE_DEFAULT_BASE_URL)
    : OPENAI_DEFAULT_BASE_URL;
  return { role: 'Rewriter', provider, model, apiKey, baseUrl };
}

/** Validates all provider env vars, exiting the process on an unrecognized value. */
export function validateProviderConfig(): void {
  resolveEmbeddingConfig();
  resolveLlmConfig();
  resolveRewriterConfig();
}

function maskKey(key: string): string {
  if (!key) return '(none)';
  if (key.length <= 6) return '***';
  return `${key.slice(0, 4)}...${key.slice(-2)}`;
}

/** Prints the resolved Embedding/LLM/Rewriter config to stdout (API keys masked). */
export function printProviderConfig(): void {
  for (const cfg of [resolveEmbeddingConfig(), resolveLlmConfig(), resolveRewriterConfig()]) {
    console.log(
      `[config] ${cfg.role.padEnd(9)}: provider=${cfg.provider} model=${cfg.model} base=${cfg.baseUrl} key=${maskKey(cfg.apiKey)}`,
    );
  }
}
