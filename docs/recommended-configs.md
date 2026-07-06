# Recommended Configurations

lkrag-lite lets you pick a provider independently for each of the three roles
(Embedding / Query Rewriter / LLM — see the [Configuration](../README.md#configuration-env)
section of the README). That flexibility means there's no single "right"
answer for a new setup, which is exactly what makes the first configuration
attempt tedious. This page lists combinations that should work, so you can
copy an `.env` block and adjust only the API keys. Except where noted, these
are recommended pairings rather than combinations we've actually run
end-to-end — please report back if one doesn't work as expected.

Each block below is a drop-in replacement for the corresponding sections of
your `.env` (Embedding / LLM / Query Rewriter). Combine any Embedding preset
with any LLM/Rewriter preset — for example, keep Embedding local while using
a cloud LLM.

## Quick reference

| Target | Environment | Embedding | Rewriter | LLM |
|---|---|---|---|---|
| [en](#en--cloud) | Cloud | OpenAI `text-embedding-3-small` | OpenAI `gpt-4o-mini` | OpenAI `gpt-4.1-mini` |
| [en](#en--local-gpu) | Local (GPU) | Ollama `nomic-embed-text` | Ollama `qwen2.5:7b` | Ollama `qwen2.5:7b` |
| [ja](#ja--local-embedding-cpu--cloud-rewriterllm) | Local (CPU) embedding + Cloud rewriter/LLM | llama.cpp `ruri-v3-310m` | OpenAI `gpt-4o-mini` | OpenAI `gpt-4.1-mini` |
| [ja](#ja--local-gpu) | Local (GPU) | llama.cpp `ruri-v3-310m` | Ollama `qwen2.5:7b` | Ollama `qwen2.5:7b` |

Anthropic can be substituted for OpenAI in any Cloud preset (`LLM_PROVIDER=anthropic`,
`LLM_MODEL=claude-haiku-4-5`, using `ANTHROPIC_API_KEY` — see the README for details).

---

## en / Cloud

No local server required; only API keys.

```env
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...

LLM_PROVIDER=openai
LLM_MODEL=gpt-4.1-mini
LLM_API_KEY=sk-...

QUERY_REWRITER_PROVIDER=openai
QUERY_REWRITER_MODEL=gpt-4o-mini
QUERY_REWRITER_API_KEY=sk-...
```

## en / Local (GPU)

Requires [Ollama](https://ollama.com/) with a GPU (7B-class models are slow on CPU-only
machines).

```bash
ollama pull nomic-embed-text
ollama pull qwen2.5:7b
```

```env
EMBEDDING_PROVIDER=openai-compatible
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_BASE_URL=http://localhost:11434/v1
EMBEDDING_API_KEY=ollama

LLM_PROVIDER=openai-compatible
LLM_MODEL=qwen2.5:7b
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama

QUERY_REWRITER_PROVIDER=openai-compatible
QUERY_REWRITER_MODEL=qwen2.5:7b
QUERY_REWRITER_BASE_URL=http://localhost:11434/v1
QUERY_REWRITER_API_KEY=ollama
```

`*_API_KEY` can be any non-empty string for Ollama; it does not check the value.

## ja / Local (embedding, CPU) + Cloud (rewriter/LLM)

General-purpose embedding models are weak on Japanese, so this preset runs a
Japanese-specialized embedding model locally via
[llama.cpp](https://github.com/ggml-org/llama.cpp)'s `llama-server`, while
keeping the rewriter/LLM on a cloud provider (no GPU required). The
`llama-server` command below has actually been run and confirmed to serve
embeddings correctly; the rest of this preset (and all others on this page)
is a recommended pairing, not something we've run end-to-end ourselves.

```bash
llama-server -hf Targoyle/ruri-v3-310m-GGUF:Q8_0 \
  --embedding --port 8082 \
  --batch-size 2048 --ubatch-size 2048
```

```env
EMBEDDING_PROVIDER=openai-compatible
EMBEDDING_MODEL=ruri-v3-310m
EMBEDDING_BASE_URL=http://localhost:8082/v1
EMBEDDING_API_KEY=none
EMBEDDING_QUERY_PREFIX="検索クエリ: "
EMBEDDING_DOCUMENT_PREFIX="検索文書: "

LLM_PROVIDER=openai
LLM_MODEL=gpt-4.1-mini
LLM_API_KEY=sk-...

QUERY_REWRITER_PROVIDER=openai
QUERY_REWRITER_MODEL=gpt-4o-mini
QUERY_REWRITER_API_KEY=sk-...
```

`ruri-v3` expects the `検索クエリ: ` / `検索文書: ` prefixes shown above (see the
model card); omitting them degrades retrieval quality.

## ja / Local (GPU)

Fully local: the CPU-based embedding server above plus Ollama for
rewriter/LLM.

```bash
llama-server -hf Targoyle/ruri-v3-310m-GGUF:Q8_0 \
  --embedding --port 8082 \
  --batch-size 2048 --ubatch-size 2048
ollama pull qwen2.5:7b
```

```env
EMBEDDING_PROVIDER=openai-compatible
EMBEDDING_MODEL=ruri-v3-310m
EMBEDDING_BASE_URL=http://localhost:8082/v1
EMBEDDING_API_KEY=none
EMBEDDING_QUERY_PREFIX="検索クエリ: "
EMBEDDING_DOCUMENT_PREFIX="検索文書: "

LLM_PROVIDER=openai-compatible
LLM_MODEL=qwen2.5:7b
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama

QUERY_REWRITER_PROVIDER=openai-compatible
QUERY_REWRITER_MODEL=qwen2.5:7b
QUERY_REWRITER_BASE_URL=http://localhost:11434/v1
QUERY_REWRITER_API_KEY=ollama
```

`qwen2.5:7b` handles Japanese reasonably well, but for higher-quality Japanese
answers, consider swapping it for a larger or Japanese-tuned model your GPU
can fit.

---

These presets are recommended pairings, not run end-to-end or evaluated for
answer quality — try more than one if retrieval or answer quality doesn't
meet your needs, and see the `*_BASE_URL` gotcha note in the main
[README](../README.md#configuration-env) if you hit a 404 pointing an
`openai-compatible` provider at a new server.
