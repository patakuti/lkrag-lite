#!/usr/bin/env node
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { Command, InvalidArgumentError } from 'commander';
import { initDb, listWorkspaces, addWorkspace, getIndexedFileCount, getLastIndexedAt, Workspace } from './db/sqlite.js';
import { runUpdateForWorkspace, runRebuildForWorkspace, getStatus } from './indexer/index.js';
import { retrieveForWorkspace, RetrievedChunk } from './search/retriever.js';

// ---------- DB init ----------

function initDbFromEnv(): void {
  const dbPath = process.env.DATABASE_PATH || './data/lkrag.db';
  initDb(dbPath);
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

function printPlain(results: RetrievedChunk[], quiet: boolean): void {
  if (results.length === 0) {
    if (!quiet) process.stderr.write('No results found.\n');
    return;
  }
  for (const r of results) {
    process.stdout.write(`[${r.n}] ${r.filePath} (score: ${r.score})\n`);
    process.stdout.write(`${r.snippet}\n\n`);
  }
}

function printTsv(results: RetrievedChunk[]): void {
  for (const r of results) {
    process.stdout.write(`${r.filePath}\t1\t${r.score}\t${r.snippet.replace(/\t/g, ' ').replace(/\n/g, ' ')}\n`);
  }
}

function printJson(results: RetrievedChunk[]): void {
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}

// ---------- env file loader ----------

function loadEnvFile(envFile: string | undefined): void {
  if (!envFile) return;
  const resolved = path.resolve(envFile);
  if (!fs.existsSync(resolved)) {
    process.stderr.write(`Warning: env file not found: ${resolved}\n`);
    return;
  }
  dotenv.config({ path: resolved, override: true });
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
    .option('--format <fmt>', 'output format: plain, tsv, json', 'plain')
).action(async (query: string, opts) => {
  if (opts.envFile) loadEnvFile(opts.envFile);
  initDbFromEnv();
  const ws = resolveWorkspace(opts, 'require');
  if (!opts.quiet) process.stderr.write(`Searching workspace "${ws.name}" (${ws.path})...\n`);

  const results = await retrieveForWorkspace(query, ws.id, {
    topK: opts.limit,
    minSimilarity: opts.minSimilarity,
  });

  if (opts.format === 'tsv') {
    printTsv(results);
  } else if (opts.format === 'json') {
    printJson(results);
  } else {
    printPlain(results, opts.quiet);
  }
});

// ---------- update-index ----------

sharedOptions(
  program
    .command('update-index')
    .description('incrementally update the index')
).action(async (opts) => {
  if (opts.envFile) loadEnvFile(opts.envFile);
  initDbFromEnv();
  const ws = resolveWorkspace(opts, 'require');
  if (!opts.quiet) process.stderr.write(`Updating index for workspace "${ws.name}" (${ws.path})...\n`);

  await runUpdateForWorkspace(ws);

  const s = getStatus();
  if (s.error) {
    process.stderr.write(`Error: ${s.error}\n`);
    process.exit(1);
  }
  if (!opts.quiet) process.stderr.write(`Done. Processed ${s.processed} / ${s.total} files.\n`);
});

// ---------- rebuild-index ----------

sharedOptions(
  program
    .command('rebuild-index')
    .description('rebuild the entire index from scratch')
).action(async (opts) => {
  if (opts.envFile) loadEnvFile(opts.envFile);
  initDbFromEnv();
  const ws = resolveWorkspace(opts, 'auto-register');
  if (!opts.quiet) process.stderr.write(`Rebuilding index for workspace "${ws.name}" (${ws.path})...\n`);

  await runRebuildForWorkspace(ws);

  const s = getStatus();
  if (s.error) {
    process.stderr.write(`Error: ${s.error}\n`);
    process.exit(1);
  }
  if (!opts.quiet) process.stderr.write(`Done. Processed ${s.processed} / ${s.total} files.\n`);
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

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
