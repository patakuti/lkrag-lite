#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { Command, InvalidArgumentError } from 'commander';
import { getUserConfigDir, getUserDataDir } from './config/paths.js';
import { resolveEmbeddingConfig } from './config/providers.js';
import {
  initDb, listWorkspaces, addWorkspace, activateWorkspace, getIndexedFileCount, getLastIndexedAt, Workspace,
  createPublicToken, listPublicTokens, revokePublicToken, listTags, getTagsForPaths,
} from './db/sqlite.js';
import { normalizeTag } from './indexer/tags.js';
import { runUpdateForWorkspace, runRebuildForWorkspace, getStatus, requestCancel } from './indexer/index.js';
import { retrieveForWorkspace, RetrievedChunk } from './search/retriever.js';

// Load .env in cascade order (later calls override earlier):
//   1. User config dir  (%APPDATA%\lkragl\.env  or  ~/.config/lkragl/.env)
//   2. Current working directory (./.env)
// --env-file <path> per-command is loaded with override:true and takes highest priority.
dotenv.config({ path: path.join(getUserConfigDir(), '.env'), quiet: true });
dotenv.config({ path: path.join(process.cwd(), '.env'), override: true, quiet: true });

// ---------- DB init ----------

function initDbFromEnv(): void {
  const dbPath = process.env.DATABASE_PATH
    ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
    : path.join(getUserDataDir(), 'lkrag.db');
  initDb(dbPath);
}

// ---------- pre-flight checks ----------

function validateEmbeddingConfig(): void {
  const { provider, apiKey } = resolveEmbeddingConfig();
  if (provider === 'openai' && !apiKey) {
    process.stderr.write(
      'Error: EMBEDDING_API_KEY is not set.\n' +
      `Set it in ${path.join(getUserConfigDir(), '.env')} or in .env in the current directory.\n`,
    );
    process.exit(1);
  }
}

// ---------- workspace resolution ----------

function findWorkspaceByPath(wsPath: string): Workspace | null {
  const normalized = path.resolve(wsPath);
  return listWorkspaces().find((w) => path.resolve(w.path) === normalized) ?? null;
}

function findWorkspaceUpward(fromDir: string): Workspace | null {
  const workspaces = listWorkspaces();
  let dir = path.resolve(fromDir);
  while (true) {
    const found = workspaces.find((w) => path.resolve(w.path) === dir);
    if (found) return found;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

interface ResolveOptions {
  workspacePath?: string;
  findWorkspace?: boolean;
}

type ResolveMode = 'require' | 'auto-register';

function resolveWorkspace(opts: ResolveOptions, mode: ResolveMode): Workspace {
  if (opts.workspacePath && opts.findWorkspace) {
    process.stderr.write('Error: --workspace-path and --find-workspace cannot be used together.\n');
    process.exit(1);
  }

  if (opts.findWorkspace) {
    const ws = findWorkspaceUpward(process.cwd());
    if (!ws) {
      process.stderr.write('Error: No registered workspace found in current directory or any parent directory.\n');
      process.exit(1);
    }
    return ws;
  }

  const wsPath = path.resolve(opts.workspacePath ?? process.cwd());
  const existing = findWorkspaceByPath(wsPath);

  if (existing) return existing;

  if (mode === 'require') {
    process.stderr.write(`Error: No workspace registered for path: ${wsPath}\n`);
    process.stderr.write('Use "lkragl rebuild-index" to register and index this directory.\n');
    process.exit(1);
  }

  // auto-register: use directory name as workspace name
  const name = path.basename(wsPath);
  const ws = addWorkspace(name, wsPath);
  process.stderr.write(`Registered new workspace "${ws.name}" at ${wsPath}\n`);
  return ws;
}

// ---------- output formatters ----------

type TagsByPath = Record<string, string[]>;

function printPlain(results: RetrievedChunk[], tags: TagsByPath, quiet: boolean): void {
  if (results.length === 0) {
    if (!quiet) process.stderr.write('No results found.\n');
    return;
  }
  for (const r of results) {
    process.stdout.write(`[${r.n}] ${r.filePath} (score: ${r.score})\n`);
    const t = tags[r.filePath] ?? [];
    if (t.length > 0) process.stdout.write(`tags: ${t.join(', ')}\n`);
    process.stdout.write(`${r.snippet}\n\n`);
  }
}

function printTsv(results: RetrievedChunk[], tags: TagsByPath): void {
  for (const r of results) {
    const snippet = r.snippet.replace(/\t/g, ' ').replace(/\n/g, ' ');
    process.stdout.write(`${r.filePath}\t1\t${r.score}\t${snippet}\t${(tags[r.filePath] ?? []).join(',')}\n`);
  }
}

function printJson(results: RetrievedChunk[], tags: TagsByPath): void {
  const withTags = results.map((r) => ({ ...r, tags: tags[r.filePath] ?? [] }));
  process.stdout.write(JSON.stringify(withTags, null, 2) + '\n');
}

// ---------- env file loader ----------

function loadEnvFile(envFile: string | undefined): void {
  if (!envFile) return;
  const resolved = path.resolve(envFile);
  if (!fs.existsSync(resolved)) {
    process.stderr.write(`Warning: env file not found: ${resolved}\n`);
    return;
  }
  dotenv.config({ path: resolved, override: true, quiet: true });
}

// ---------- CLI definition ----------

const program = new Command();

program
  .name('lkragl')
  .description('CLI tool for lkrag-lite: search and index management')
  .version('0.1.0');

const sharedOptions = (cmd: Command) =>
  cmd
    .option('--workspace-path <path>', 'workspace directory path (default: current directory)')
    .option('--find-workspace', 'search up from current directory for a registered workspace')
    .option('--env-file <path>', 'load additional .env file')
    .option('--quiet', 'suppress informational messages on stderr');

// ---------- search ----------

sharedOptions(
  program
    .command('search <query>')
    .description('search indexed documents')
    .option('--limit <n>', 'number of results', (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1) throw new InvalidArgumentError('Must be a positive integer.');
      return n;
    }, 5)
    .option('--min-similarity <n>', 'minimum similarity score (0-1)', (v) => {
      const n = parseFloat(v);
      if (isNaN(n) || n < 0 || n > 1) throw new InvalidArgumentError('Must be a number between 0 and 1.');
      return n;
    }, 0.3)
    .option('--tag <tag>', 'only documents having this tag (repeatable; all given tags are required)', (v: string, prev: string[]) => {
      const tag = normalizeTag(v);
      if (tag === null) throw new InvalidArgumentError('Invalid tag (must be 1-64 chars, no whitespace, commas or #).');
      return prev.includes(tag) ? prev : [...prev, tag];
    }, [] as string[])
    .option('--format <fmt>', 'output format: plain, tsv, json', 'plain')
).action(async (query: string, opts) => {
  if (opts.envFile) loadEnvFile(opts.envFile);
  validateEmbeddingConfig();
  initDbFromEnv();
  const ws = resolveWorkspace(opts, 'require');
  if (!opts.quiet) process.stderr.write(`Searching workspace "${ws.name}" (${ws.path})...\n`);

  const results = await retrieveForWorkspace(query, ws.id, {
    topK: opts.limit,
    minSimilarity: opts.minSimilarity,
    tags: opts.tag,
  });

  const fileTags = getTagsForPaths(ws.id, results.map((r) => r.filePath));
  const tags: TagsByPath = Object.fromEntries(
    Object.entries(fileTags).map(([p, list]) => [p, list.map((t) => t.name)])
  );

  if (opts.format === 'tsv') {
    printTsv(results, tags);
  } else if (opts.format === 'json') {
    printJson(results, tags);
  } else {
    printPlain(results, tags, opts.quiet);
  }
});

// ---------- tags ----------

sharedOptions(
  program
    .command('tags')
    .description('list document tags with the number of documents having each')
    .option('--format <fmt>', 'output format: plain (tag<TAB>count), json', 'plain')
).action((opts) => {
  if (opts.envFile) loadEnvFile(opts.envFile);
  initDbFromEnv();
  const ws = resolveWorkspace(opts, 'require');
  const tags = listTags(ws.id);
  if (opts.format === 'json') {
    process.stdout.write(JSON.stringify(tags, null, 2) + '\n');
  } else {
    for (const t of tags) process.stdout.write(`${t.tag}\t${t.count}\n`);
  }
});

// ---------- update-index ----------

sharedOptions(
  program
    .command('update-index')
    .description('incrementally update the index')
).action(async (opts) => {
  if (opts.envFile) loadEnvFile(opts.envFile);
  validateEmbeddingConfig();
  initDbFromEnv();
  const ws = resolveWorkspace(opts, 'require');
  if (!opts.quiet) process.stderr.write(`Updating index for workspace "${ws.name}" (${ws.path})...\n`);

  const onSigint = () => {
    process.stderr.write('\nCancelling... waiting for current file to finish.\n');
    requestCancel();
  };
  process.once('SIGINT', onSigint);
  try {
    await runUpdateForWorkspace(ws);
  } finally {
    process.removeListener('SIGINT', onSigint);
  }

  const s = getStatus();
  if (s.error) {
    process.stderr.write(`Error: ${s.error}\n`);
    process.exit(1);
  }
  const cancelled = s.cancelRequested ? ' (cancelled)' : '';
  if (!opts.quiet) process.stderr.write(`Done. Processed ${s.processed} / ${s.total} files${cancelled}.\n`);
});

// ---------- rebuild-index ----------

sharedOptions(
  program
    .command('rebuild-index')
    .description('rebuild the entire index from scratch')
).action(async (opts) => {
  if (opts.envFile) loadEnvFile(opts.envFile);
  validateEmbeddingConfig();
  initDbFromEnv();
  const ws = resolveWorkspace(opts, 'auto-register');
  if (!opts.quiet) process.stderr.write(`Rebuilding index for workspace "${ws.name}" (${ws.path})...\n`);

  const onSigint = () => {
    process.stderr.write('\nCancelling... waiting for current file to finish.\n');
    requestCancel();
  };
  process.once('SIGINT', onSigint);
  try {
    await runRebuildForWorkspace(ws);
  } finally {
    process.removeListener('SIGINT', onSigint);
  }

  const s = getStatus();
  if (s.error) {
    process.stderr.write(`Error: ${s.error}\n`);
    process.exit(1);
  }
  activateWorkspace(ws.id);
  const cancelled = s.cancelRequested ? ' (cancelled)' : '';
  if (!opts.quiet) process.stderr.write(`Done. Processed ${s.processed} / ${s.total} files${cancelled}. Workspace activated.\n`);
});

// ---------- status ----------

sharedOptions(
  program
    .command('status')
    .description('show index status')
).action((opts) => {
  if (opts.envFile) loadEnvFile(opts.envFile);
  initDbFromEnv();
  const ws = resolveWorkspace(opts, 'require');

  const fileCount = getIndexedFileCount(ws.id);
  const lastIndexed = getLastIndexedAt(ws.id);

  process.stdout.write(`Workspace : ${ws.name}\n`);
  process.stdout.write(`Path      : ${ws.path}\n`);
  process.stdout.write(`Files     : ${fileCount}\n`);
  process.stdout.write(`Last index: ${lastIndexed ?? 'never'}\n`);
});

// ---------- token ----------

const tokenCmd = program.command('token').description('manage public chat access tokens');

sharedOptions(
  tokenCmd
    .command('create')
    .description('issue a new public chat token for a workspace')
    .requiredOption('--name <label>', 'label identifying the recipient of this token')
).action((opts) => {
  if (opts.envFile) loadEnvFile(opts.envFile);
  initDbFromEnv();
  const ws = resolveWorkspace(opts, 'require');
  const { token, record } = createPublicToken(ws.id, opts.name);
  process.stdout.write(`Created token "${record.label}" for workspace "${ws.name}" (${ws.path})\n`);
  process.stdout.write(`token: ${token}\n`);
  process.stdout.write('This value is shown only once and cannot be retrieved later; store it securely.\n');
});

tokenCmd
  .command('list')
  .description('list public chat tokens')
  .action(() => {
    initDbFromEnv();
    const tokens = listPublicTokens();
    if (tokens.length === 0) {
      process.stdout.write('No tokens found.\n');
      return;
    }
    for (const t of tokens) {
      const ws = t.workspace_name ?? '(deleted workspace)';
      const status = t.enabled ? 'enabled' : 'revoked';
      process.stdout.write(`[${t.id}] ${t.label} -> ${ws} (${status}, created ${t.created_at})\n`);
    }
  });

tokenCmd
  .command('revoke <id>')
  .description('revoke a public chat token')
  .action((id: string) => {
    initDbFromEnv();
    const tokenId = parseInt(id, 10);
    if (isNaN(tokenId)) {
      process.stderr.write('Error: id must be an integer.\n');
      process.exit(1);
    }
    revokePublicToken(tokenId);
    process.stdout.write(`Token ${tokenId} revoked.\n`);
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
