# lkrag-lite

Lightweight, easy-to-deploy RAG (Retrieval-Augmented Generation) system for local files.

## Why lkrag-lite?

Most RAG tools treat your documents as data to be *imported* into a proprietary store: you upload files, the system ingests them, and if you edit the originals you must manually re-sync. lkrag-lite takes the opposite approach — **your local directory is the knowledge base**. There is no import step; the index is always a reflection of your file system.

| Feature | lkrag-lite | Dify | RAGFlow | AnythingLLM | PrivateGPT |
|---|:---:|:---:|:---:|:---:|:---:|
| **Search local files directly** (no upload required) | ○ | × | × | △ ¹ | × |
| **Easy to reflect file changes** (incremental re-index) | ○ | × | × | △ ¹ | × |
| **Citations open source files via OS** | ○ | × | × | × | × |
| **Embedded vector DB** (no separate DB server) | ○ | × | × | ○ | △ ² |
| **Query rewriter** (auto-rewrites follow-up questions for RAG) | ○ | △ ³ | △ ³ | × | × |
| **Chat history** (persistent, resumable across workspaces) | ○ | ○ | ○ | ○ | × |
| **CLI tool** (search & index management for cron / editor integration) | ○ | × | × | × | △ ⁵ |
| **Simple setup** (`npm install && npm start`) | ○ | × | × | △ ⁴ | △ |

¹ AnythingLLM: file-level watching only (beta); directory-wide indexing is not supported  
² PrivateGPT: only when using Qdrant in local embedded mode  
³ Dify / RAGFlow: achievable via workflow configuration, but not automatic out of the box  
⁴ AnythingLLM: desktop app available, but initial configuration involves multiple steps  
⁵ PrivateGPT: CLI available but limited to basic ingestion/query; no cron-friendly index management  

## Features

- **Workspace management**: named workspaces pointing to local directories, one active at a time
- **Incremental indexing**: re-indexes only changed files (mtime + size + SHA-256 hash)
- **Supported file types**: Markdown, plain text, PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), HTML
- **Hybrid search**: combines vector similarity search (sqlite-vec) with full-text BM25 search (SQLite FTS5), merged via Reciprocal Rank Fusion (RRF) for better recall on both semantic and keyword queries
- **Cited answers**: LLM answers with inline `[n]` citation numbers linked to source files
- **File open**: click a citation to open the original file with the OS-associated application
- **Flexible LLM/Embedding**: OpenAI / Anthropic / any OpenAI-compatible endpoint (LiteLLM, Ollama)
- **Runtime settings UI**: adjust Top K, Min Similarity, and Output Instructions from the browser without restarting the server
- **Multi-turn chat**: conversational UI that carries context across turns
- **Query rewriter**: LLM automatically rewrites follow-up questions into clean, standalone RAG search queries
- **Chat history**: chats are auto-saved to SQLite and can be resumed at any time; history is shown across all workspaces
- **CLI tool** (`lkragl`): command-line interface for search and index management, suitable for cron jobs, editor integrations, and automation

## Requirements

- Node.js 20 or 22 LTS
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
| `RAG_INCLUDE_PATTERNS` | `**/*.md,...` | Glob patterns for files to index (comma-separated). To index PowerPoint files, add `**/*.pptx`. |
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
| `RAG_MIN_SIMILARITY` | `0.3` | Minimum cosine similarity score 0–1 applied to vector results before RRF merge (overridable from UI) |
| `RAG_OUTPUT_INSTRUCTIONS` | _(empty)_ | Extra instructions appended to the LLM system prompt, e.g. `"Answer in Japanese."` (overridable from UI) |
| `QUERY_REWRITER_PROVIDER` | `openai` | `openai` / `openai-compatible` / `anthropic` |
| `QUERY_REWRITER_MODEL` | `gpt-4o-mini` (openai) / `claude-haiku-4-5` (anthropic) | Model used by the query rewriter. Reuses `OPENAI_API_KEY` / `OPENAI_COMPATIBLE_BASE_URL` for OpenAI variants, and `ANTHROPIC_API_KEY` for Anthropic. |
| `PORT` | `3456` | HTTP server port |

## Usage

1. **Add a workspace**: click "+ Add..." and pick a directory
2. **Activate**: select a workspace from the dropdown to make it active
3. **Index**: click "Update" (incremental) or "Full Rebuild"
4. **Chat**: type a question and click "Send"; follow-up questions carry conversation context automatically
5. **Citations**: click `[n]` in the answer or "Open" in the References section to open the source file
6. **Chat history**: past chats appear in the "Chat History" panel; click one to resume (workspace switches automatically)
7. **New Chat**: click "New Chat" to start a fresh conversation
8. **Delete chats**: click "×" next to a chat to delete it, or "Delete All" to clear all history
9. **Settings**: adjust Top K, Min Similarity, and Output Instructions in the Settings panel; click "Reload .env" to reset to the values in `.env`

## CLI Tool (`lkragl`)

A command-line interface for index management and search, suitable for cron jobs, editor integrations, and automation.

### Installation

**Windows** — download the prebuilt binary from [GitHub Releases](https://github.com/patakuti/lkrag-lite/releases):

1. Download `lkragl-windows-x64.exe` from the latest release
2. Place it somewhere in your `PATH` (e.g. `C:\Users\<you>\bin\`)
3. Run `lkragl` from the command prompt or PowerShell

**Linux / macOS** — install via npm after cloning and building the server:

```bash
npm run build
npm link   # makes lkragl available in PATH
```

### Commands

```
lkragl search <query>       Search indexed documents
lkragl update-index         Incrementally update the index
lkragl rebuild-index        Rebuild the entire index from scratch
lkragl status               Show index status
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--workspace-path <path>` | current directory | Workspace to operate on (mutually exclusive with `--find-workspace`) |
| `--find-workspace` | — | Traverse up from current directory to find a registered workspace |
| `--limit <n>` | 5 | Number of search results (`search` only) |
| `--min-similarity <n>` | 0.3 | Minimum similarity score 0–1 (`search` only) |
| `--format <fmt>` | plain | Output format: `plain`, `tsv`, `json` (`search` only) |
| `--quiet` | — | Suppress informational messages on stderr |
| `--env-file <path>` | — | Load additional .env file |

`--workspace-path` and `--find-workspace` are mutually exclusive.

### Workspace resolution

| Command | Unregistered path | `--find-workspace` (not found) |
|---------|-------------------|-------------------------------|
| `search` | Error | Error |
| `update-index` | Error | Error |
| `rebuild-index` | **Auto-register** and index | Error |
| `status` | Error | Error |

### Examples

```bash
# Search with plain output
lkragl search "authentication flow" --workspace-path /path/to/docs

# Search from a subdirectory — finds the nearest indexed ancestor automatically
lkragl search "error handling" --find-workspace

# TSV output for editor integration (path, line, score, content)
lkragl search "setup guide" --format tsv --limit 10

# JSON output for scripting
lkragl search "database schema" --format json | jq '.[0].filePath'

# Register and build index for the first time
lkragl rebuild-index --workspace-path /path/to/docs

# Update index incrementally from a subdirectory
lkragl update-index --find-workspace

# Schedule index updates via cron (daily at 3am)
# 0 3 * * * lkragl update-index --workspace-path /path/to/docs

# Check index status
lkragl status
```

## Changing the Embedding Model

If you change `EMBEDDING_MODEL` to a model with a different vector dimension, the server will return an error on the next indexing or search. Run a **full rebuild** to re-embed all documents with the new model.

## Development

```bash
npm run dev   # tsx watch mode (auto-reload on source change)
```

## Architecture

```
[Browser]                          [CLI: lkragl]
    ↕ HTTP                              ↕
[Express (Node.js / TypeScript)]   [cli.ts]
    ├── Indexer (fast-glob → parser → chunker → Embedding API → sqlite-vec)
    ├── Query Rewriter (conversation history + user input → clean RAG query)
    ├── Retriever (RAG query → Embedding API → vector KNN + FTS5 BM25 → RRF merge)
    ├── LLM (conversation history + RAG context + user input → cited answer)
    └── SQLite + sqlite-vec (embedded vector DB)
```
