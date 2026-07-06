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
- **Public chat**: token-authenticated, read-only chat UI for sharing a single workspace with other people, served on a separate network-reachable port (see [Public Chat](#public-chat))

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

## Try it with sample data

No documents of your own yet? [`examples/`](examples/) contains a small fictional
project-notes dataset (overview, spec, meeting notes, roadmap, decision log,
glossary, known issues) you can point a workspace at right away — see
[`examples/README.md`](examples/README.md) for setup steps and example questions
to ask. `examples/demo.gif` shows the full flow (indexing → chat → citations →
live re-index after an edit) end to end:

![lkrag-lite demo](examples/demo.gif)

## Configuration (`.env`)

### Database

| Variable | Default | Description |
|---|---|---|
| `DATABASE_PATH` | Win: `%APPDATA%\lkragl\lkrag.db` / Linux・Mac: `~/.local/share/lkragl/lkrag.db` | SQLite database file path |
| `SQLITE_JOURNAL_MODE` | `wal` (Linux/Mac/WSL2), `delete` (WSL1 auto-detected) | SQLite journal mode. WSL1 is detected automatically and uses `delete` mode since WAL requires mmap/fcntl support unavailable in WSL1. |

### Index targets

| Variable | Default | Description |
|---|---|---|
| `RAG_INCLUDE_PATTERNS` | `**/*.md,...` | Glob patterns for files to index (comma-separated). To index PowerPoint files, add `**/*.pptx`. |
| `RAG_EXCLUDE_PATTERNS` | `node_modules/**,.git/**` | Glob patterns to exclude |

### Embedding

| Variable | Default | Description |
|---|---|---|
| `EMBEDDING_PROVIDER` | `openai` | `openai` / `openai-compatible` (use `openai-compatible` for LiteLLM, Ollama, llama.cpp's `llama-server`, etc.) |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model name |
| `EMBEDDING_API_KEY` | — | API key used for the embedding call (both `openai` and `openai-compatible`) |
| `EMBEDDING_BASE_URL` | `http://localhost:4000/v1` | Base URL used only when `EMBEDDING_PROVIDER=openai-compatible` (e.g. `http://localhost:11434/v1` for Ollama, `http://localhost:8080/v1` for llama.cpp's `llama-server`) |
| `EMBEDDING_QUERY_PREFIX` | _(empty)_ | Prefix prepended to query text before embedding (some models require e.g. `"query: "`) |
| `EMBEDDING_DOCUMENT_PREFIX` | _(empty)_ | Prefix prepended to document text before embedding (some models require e.g. `"passage: "`) |
| `EMBEDDING_BATCH_SIZE` | `500` | Number of texts embedded per API call |

> **`*_BASE_URL` gotcha**: this app always sends `POST {BASE_URL}/embeddings` (and `{BASE_URL}/chat/completions` for LLM/Rewriter) — the OpenAI-compatible route. Set `*_BASE_URL` to the API root the server exposes that route under (usually ending in `/v1`), **not** a vendor-specific native endpoint path (e.g. llama.cpp's own `/embedding`). If you point it at the wrong path, you'll get a 404 whose message now includes the exact URL that was requested — use that to spot a doubled or wrong path.

### LLM

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `openai` | `openai` / `anthropic` / `openai-compatible` |
| `LLM_MODEL` | `gpt-4o-mini` | LLM model name |
| `LLM_API_KEY` | — | API key used for the LLM call (both `openai` and `openai-compatible`) |
| `LLM_BASE_URL` | `http://localhost:4000/v1` | Base URL used only when `LLM_PROVIDER=openai-compatible` |
| `ANTHROPIC_API_KEY` | — | Anthropic API key, used when `LLM_PROVIDER=anthropic` and/or `QUERY_REWRITER_PROVIDER=anthropic` |

### RAG parameters

| Variable | Default | Description |
|---|---|---|
| `RAG_MAX_FILE_SIZE` | `10485760` (10MB) | Maximum file size in bytes to index; larger files are skipped |
| `RAG_CHUNK_SIZE` | `1000` | Chunk size in characters |
| `RAG_CHUNK_OVERLAP` | `200` | Overlap between consecutive chunks |
| `RAG_TOP_K` | `5` | Number of chunks to retrieve (overridable from UI) |
| `RAG_MIN_SIMILARITY` | `0.3` | Minimum cosine similarity score 0–1 applied to vector results before RRF merge (overridable from UI) |
| `RAG_OUTPUT_INSTRUCTIONS` | _(empty)_ | Extra instructions appended to the LLM system prompt, e.g. `"Answer in Japanese."` (overridable from UI) |

### Query Rewriter

| Variable | Default | Description |
|---|---|---|
| `QUERY_REWRITER_PROVIDER` | `openai` | `openai` / `anthropic` / `openai-compatible` |
| `QUERY_REWRITER_MODEL` | `gpt-4o-mini` (openai) / `claude-haiku-4-5` (anthropic) | Model used by the query rewriter |
| `QUERY_REWRITER_API_KEY` | — | API key used when `QUERY_REWRITER_PROVIDER` is `openai` / `openai-compatible` (uses `ANTHROPIC_API_KEY` when `anthropic`) |
| `QUERY_REWRITER_BASE_URL` | `http://localhost:4000/v1` | Base URL used only when `QUERY_REWRITER_PROVIDER=openai-compatible` |

### Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3456` | HTTP server port |
| `BROWSE_ROOT` | _(user home)_ | Top directory exposed by the file browser when adding a workspace. Restricts navigation to this directory and its subdirectories. Useful when home directory is too broad (e.g. set to `D:\Projects` on Windows or `/data` on Linux). |

### Public chat

| Variable | Default | Description |
|---|---|---|
| `PUBLIC_PORT` | _(unset)_ | If set, starts a separate, network-reachable (`0.0.0.0`) read-only chat server on this port, gated by tokens issued with `lkragl token create`. Unset by default (feature disabled). See "Public Chat" below. |

Not sure which Embedding/Rewriter/LLM combination to pick? See
[docs/recommended-configs.md](docs/recommended-configs.md) for recommended
Cloud / Local (CPU) / Local (GPU) presets for English and Japanese, with
ready-to-paste `.env` blocks.

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

### Configuration

`lkragl` loads `.env` files in the following order (later entries take priority):

1. User config dir — `%APPDATA%\lkragl\.env` (Windows) / `~/.config/lkragl/.env` (Linux/Mac)
2. Current working directory — `./.env`
3. `--env-file <path>` — explicit path (highest priority)

For the Windows binary, place your `.env` in `%APPDATA%\lkragl\` (e.g. `C:\Users\<you>\AppData\Roaming\lkragl\.env`).

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
| `rebuild-index` | **Auto-register**, index, and **activate** | Error |
| `status` | Error | Error |

`rebuild-index` activates the workspace upon completion so it is immediately usable from the Web UI. `update-index` does not change the active workspace (safe for cron jobs).

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
lkragl status --workspace-path /path/to/docs
lkragl status --find-workspace
```

## Public Chat

A read-only, token-authenticated chat UI for sharing a single workspace with other people, served on a separate port from the admin UI so the workspace-management API is never network-reachable. Set `PUBLIC_PORT` in `.env` to enable it.

Tokens are managed with `lkragl`:

```bash
lkragl token create --workspace-path /path/to/docs --name alice   # prints the token once; store it securely
lkragl token list                                                 # label, workspace, enabled/revoked
lkragl token revoke <id>                                          # disable a token
```

Deleting a workspace revokes all of its tokens.

Share `http://<host>:<PUBLIC_PORT>/?token=<token>` with the recipient. The page exchanges the token for an `HttpOnly` cookie on first load (redirecting to a clean URL), so the token itself doesn't stay visible or need to be resent. The UI supports multi-turn chat (with the same query rewriter as the admin UI) and a "Chat History" panel scoped to that token's workspace; citations link to `GET /api/file?path=...` to view the source file in the browser, or `&download=1` to download it — there is no workspace switching, index management, or settings, and no ability to delete chat history from this UI.

Every chat turn is recorded in an access log (token, query, prompt/completion token counts). Set `LLM_PRICE_INPUT_PER_1M` / `LLM_PRICE_OUTPUT_PER_1M` in `.env` to also record an estimated USD cost per request; otherwise only token counts are recorded.

## Changing the Embedding Model

If you change `EMBEDDING_MODEL` to a model with a different vector dimension, the server will return an error on the next indexing or search. Run a **full rebuild** to re-embed all documents with the new model.

## Development

```bash
npm run dev   # tsx watch mode (auto-reload on source change)
```

## Architecture

```
[Browser: admin UI]        [Browser: public chat]      [CLI: lkragl]
    ↕ HTTP (127.0.0.1)          ↕ HTTP (0.0.0.0)              ↕
[Admin app: server.ts]     [Public app: publicServer.ts]  [cli.ts]
    ├── Indexer (fast-glob → parser → chunker → Embedding API → sqlite-vec)
    ├── Query Rewriter (conversation history + user input → clean RAG query)
    ├── Retriever (RAG query → Embedding API → vector KNN + FTS5 BM25 → RRF merge)
    ├── LLM (conversation history + RAG context + user input → cited answer)
    └── SQLite + sqlite-vec (embedded vector DB, shared by both apps)

Public app has no admin routes mounted and skips the Host-header guard;
every request is instead gated by a per-recipient token (middleware/publicAuth.ts)
resolved to a single workspace, disabled unless PUBLIC_PORT is set.
```
