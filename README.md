# lkrag-lite

Lightweight, easy-to-deploy RAG (Retrieval-Augmented Generation) system for local files.

## Features

- **Workspace management**: named workspaces pointing to local directories, one active at a time
- **Incremental indexing**: re-indexes only changed files (mtime + size + SHA-256 hash)
- **Supported file types**: Markdown, plain text, PDF, Word (.docx), Excel (.xlsx), HTML
- **Vector search**: SQLite + sqlite-vec (no external DB server required)
- **Cited answers**: LLM answers with inline `[n]` citation numbers linked to source files
- **File open**: click a citation to open the original file with the OS-associated application
- **Flexible LLM/Embedding**: OpenAI / Anthropic / any OpenAI-compatible endpoint (LiteLLM, Ollama)
- **Runtime settings UI**: adjust Top K, Min Similarity, and Output Instructions from the browser without restarting the server

## Requirements

- Node.js 18+
- npm

## Setup

```bash
git clone https://github.com/patakuti/lkrag-lite.git
cd lkrag-lite
npm install
cp .env.example .env
# Edit .env and set your API keys and preferences
npm run build
npm start
```

Open http://localhost:3456 in your browser.

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_PATH` | `./data/lkrag.db` | SQLite database file path |
| `RAG_INCLUDE_PATTERNS` | `**/*.md,...` | Glob patterns for files to index (comma-separated) |
| `RAG_EXCLUDE_PATTERNS` | `node_modules/**,.git/**` | Glob patterns to exclude |
| `EMBEDDING_PROVIDER` | `openai` | `openai` / `litellm` / `ollama` |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model name |
| `OPENAI_API_KEY` | — | OpenAI API key (also used for litellm bearer token) |
| `OPENAI_COMPATIBLE_BASE_URL` | — | Base URL for LiteLLM (`http://localhost:4000/v1`) |
| `OLLAMA_BASE_URL` | — | Base URL for Ollama (`http://localhost:11434/v1`) |
| `LLM_PROVIDER` | `openai` | `openai` / `anthropic` / `openai-compatible` |
| `LLM_MODEL` | `gpt-4o-mini` | LLM model name |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `RAG_CHUNK_SIZE` | `1000` | Chunk size in characters |
| `RAG_CHUNK_OVERLAP` | `200` | Overlap between consecutive chunks |
| `RAG_TOP_K` | `5` | Number of chunks to retrieve (overridable from UI) |
| `RAG_MIN_SIMILARITY` | `0.3` | Minimum cosine similarity score 0–1 (overridable from UI) |
| `RAG_OUTPUT_INSTRUCTIONS` | _(empty)_ | Extra instructions appended to the LLM system prompt, e.g. `"Answer in Japanese."` (overridable from UI) |
| `PORT` | `3456` | HTTP server port |

## Usage

1. **Add a workspace**: click "+ Add..." and pick a directory
2. **Activate**: select a workspace from the dropdown to make it active
3. **Index**: click "Update" (incremental) or "Full Rebuild"
4. **Search**: type a natural language question and click "Search"
5. **Citations**: click `[n]` in the answer or "Open" in the citation list to open the source file
6. **Settings**: adjust Top K, Min Similarity, and Output Instructions in the Settings panel; click "Reload .env" to reset to the values in `.env`

## Changing the Embedding Model

If you change `EMBEDDING_MODEL` to a model with a different vector dimension, the server will return an error on the next indexing or search. Run a **full rebuild** ("フルリビルド") to re-embed all documents with the new model.

## Development

```bash
npm run dev   # tsx watch mode (auto-reload on source change)
```

## Architecture

```
[Browser]
    ↕ HTTP
[Express (Node.js / TypeScript)]
    ├── Indexer (fast-glob → parser → chunker → Embedding API → sqlite-vec)
    ├── Retriever (query → Embedding API → KNN search)
    ├── LLM (context + query → cited answer)
    └── SQLite + sqlite-vec (embedded vector DB)
```

See `02_design.md` for detailed design decisions (local file, not version-controlled).
