import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import {
  initDb, getDb, ensureVecTable, addWorkspace, activateWorkspace, upsertFile, replaceFileTags, replaceSystemTags,
  insertChunk, insertVec, insertFts, createPublicToken, getChatMessages, listChatSessionsForToken,
} from '../db/sqlite.js';
import { createPublicApp } from '../publicServer.js';
import tagsRouter from './tags.js';

// Public chat enforcement of the default tag condition (requirements §15.4, D53).

const ENV_KEYS = [
  'RAG_DEFAULT_REQUIRED_TAGS', 'RAG_DEFAULT_EXCLUDE_TAGS',
  'EMBEDDING_PROVIDER', 'EMBEDDING_MODEL', 'EMBEDDING_API_KEY', 'EMBEDDING_BASE_URL',
  'LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_BASE_URL',
  'QUERY_REWRITER_PROVIDER', 'QUERY_REWRITER_MODEL', 'QUERY_REWRITER_API_KEY', 'QUERY_REWRITER_BASE_URL',
];
const savedEnv: Record<string, string | undefined> = {};

let mock: Server;
let dir: string;
let wsDir: string;
let server: Server;
let base: string;
let wsId: number;
let token: string;

// Minimal OpenAI-compatible embedding + chat server: every text embeds to [1, 0].
beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url?.endsWith('/embeddings')) {
        const input = JSON.parse(body).input;
        const texts: string[] = Array.isArray(input) ? input : [input];
        res.end(JSON.stringify({ data: texts.map((_, index) => ({ index, embedding: [1, 0] })) }));
      } else {
        res.end(JSON.stringify({ choices: [{ message: { content: 'answer [1]' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
      }
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', () => resolve()));
  const url = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    EMBEDDING_PROVIDER: 'openai-compatible', EMBEDDING_MODEL: 'm', EMBEDDING_API_KEY: 'x', EMBEDDING_BASE_URL: url,
    LLM_PROVIDER: 'openai-compatible', LLM_MODEL: 'm', LLM_API_KEY: 'x', LLM_BASE_URL: url,
    QUERY_REWRITER_PROVIDER: 'openai-compatible', QUERY_REWRITER_MODEL: 'm', QUERY_REWRITER_API_KEY: 'x', QUERY_REWRITER_BASE_URL: url,
  });
});

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await new Promise((resolve) => mock.close(resolve));
});

function addDoc(rel: string, opts: { tags?: string[]; system?: string[] } = {}): void {
  const abs = path.join(wsDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `content of ${rel}`);
  const id = upsertFile(wsId, rel, 1, 1, rel);
  replaceFileTags(id, opts.tags ?? []);
  replaceSystemTags(id, opts.system ?? []);
  const text = `shared keyword in ${rel}`;
  const chunkId = insertChunk(id, wsId, 0, text, text);
  insertVec(chunkId, wsId, [1, 0]);
  insertFts(chunkId, text);
}

beforeEach(async () => {
  delete process.env.RAG_DEFAULT_REQUIRED_TAGS;
  delete process.env.RAG_DEFAULT_EXCLUDE_TAGS;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkrag-enforce-'));
  wsDir = path.join(dir, 'ws');
  fs.mkdirSync(wsDir);
  initDb(path.join(dir, 't.db'));
  ensureVecTable(2);
  wsId = addWorkspace('ws', wsDir).id;
  activateWorkspace(wsId);

  addDoc('visible.md', { tags: ['keep', 'team'], system: ['ext:md'] });
  addDoc('hidden.md', { tags: ['obsolete', 'secret-topic', 'team'], system: ['ext:md'] });
  addDoc('archive/old.md', { tags: ['keep'], system: ['ext:md', 'dir:archive'] });
  addDoc('notes.md', { tags: [], system: ['ext:md'] });
  fs.writeFileSync(path.join(wsDir, 'unindexed.md'), 'not in the index');
  token = createPublicToken(wsId, 'tester').token;

  await new Promise<void>((resolve) => { server = createPublicApp().listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

const call = (method: string, url: string, body?: unknown) =>
  fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: `pw_token=${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const chat = async (body: object) => {
  const res = await call('POST', '/chat', { query: 'shared keyword', ...body });
  expect(res.status).toBe(200);
  return res.json() as Promise<{ citations: { path: string }[]; session_id: string; fileTags: Record<string, unknown> }>;
};
const chatPaths = async (body: object = {}) => (await chat(body)).citations.map((c) => c.path).sort();

describe('with RAG_DEFAULT_EXCLUDE_TAGS=obsolete,dir:archive', () => {
  beforeEach(() => { process.env.RAG_DEFAULT_EXCLUDE_TAGS = 'obsolete,dir:archive'; });

  it('whoami reports the locked tags', async () => {
    const who = await (await call('GET', '/whoami')).json() as { lockedTags: unknown };
    expect(who.lockedTags).toEqual({ include: [], exclude: ['obsolete', 'dir:archive'] });
  });

  it('search never returns hidden documents', async () => {
    expect(await chatPaths()).toEqual(['notes.md', 'visible.md']);
  });

  it('the request cannot remove or override the condition', async () => {
    expect(await chatPaths({ tags: ['obsolete'] })).toEqual([]);
    expect(await chatPaths({ tags: ['secret-topic'] })).toEqual([]);
    expect(await chatPaths({ excludeTags: [] , tags: [] })).toEqual(['notes.md', 'visible.md']);
    expect(await chatPaths({ tags: ['keep'] })).toEqual(['visible.md']);
    expect(await chatPaths({ excludeTags: ['team'] })).toEqual(['notes.md']);
  });

  it('records only what the viewer chose, not the enforced condition', async () => {
    const { session_id } = await chat({ tags: ['keep'], excludeTags: ['team'] });
    const user = getChatMessages(session_id).find((m) => m.role === 'user')!;
    expect(JSON.parse(user.filter_tags!)).toEqual(['keep']);
    expect(JSON.parse(user.filter_exclude_tags!)).toEqual(['team']);
    expect(listChatSessionsForToken(1)).toHaveLength(1);
  });

  it('does not report hidden documents\' tags in the tag list', async () => {
    const tags = await (await call('GET', '/tags')).json() as { tag: string; count: number }[];
    const names = tags.map((t) => t.tag);
    expect(names).toContain('keep');
    expect(names).toContain('ext:md');
    expect(names).not.toContain('obsolete');
    expect(names).not.toContain('secret-topic');
    expect(names).not.toContain('dir:archive');
    // counts cover visible files only: keep is on visible.md (archive/old.md is hidden)
    expect(tags.find((t) => t.tag === 'keep')!.count).toBe(1);
    expect(tags.find((t) => t.tag === 'team')!.count).toBe(1);
    expect(tags.find((t) => t.tag === 'ext:md')!.count).toBe(2);
  });

  it('tag lookup returns nothing for hidden documents', async () => {
    const res = await (await call('POST', '/tags/lookup', { paths: ['visible.md', 'hidden.md', 'archive/old.md'] })).json() as {
      fileTags: Record<string, unknown[]>;
    };
    expect(res.fileTags['visible.md'].length).toBeGreaterThan(0);
    expect(res.fileTags['hidden.md']).toEqual([]);
    expect(res.fileTags['archive/old.md']).toEqual([]);
  });

  it('cited files are served, hidden and unindexed ones are 404 (also by absolute path and for download)', async () => {
    expect((await call('GET', '/file?path=visible.md')).status).toBe(200);
    expect((await call('GET', '/file?path=hidden.md')).status).toBe(404);
    expect((await call('GET', '/file?path=hidden.md&download=1')).status).toBe(404);
    expect((await call('GET', `/file?path=${encodeURIComponent(path.join(wsDir, 'hidden.md'))}`)).status).toBe(404);
    expect((await call('GET', '/file?path=' + encodeURIComponent('archive/old.md'))).status).toBe(404);
    expect((await call('GET', '/file?path=' + encodeURIComponent('./sub/../hidden.md'))).status).toBe(404);
    expect((await call('GET', '/file?path=unindexed.md')).status).toBe(404);
  });

  it('the admin tag API is not restricted', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/tags', tagsRouter);
    const adminServer = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const url = `http://127.0.0.1:${(adminServer.address() as AddressInfo).port}/api/tags`;
      const tags = await (await fetch(url)).json() as { tag: string }[];
      expect(tags.map((t) => t.tag)).toContain('obsolete');
      expect(tags.map((t) => t.tag)).toContain('dir:archive');
    } finally {
      await new Promise((resolve) => adminServer.close(resolve));
    }
    expect(getDb()).toBeTruthy();
  });
});

describe('with RAG_DEFAULT_REQUIRED_TAGS=team', () => {
  beforeEach(() => { process.env.RAG_DEFAULT_REQUIRED_TAGS = 'team'; });

  it('only documents with the tag are searched and served', async () => {
    expect(await chatPaths()).toEqual(['hidden.md', 'visible.md']);
    expect((await call('GET', '/file?path=visible.md')).status).toBe(200);
    expect((await call('GET', '/file?path=notes.md')).status).toBe(404);
  });

  it('a viewer\'s exclusion still narrows further, and the locked tag cannot be excluded away', async () => {
    expect(await chatPaths({ excludeTags: ['obsolete'] })).toEqual(['visible.md']);
    expect(await chatPaths({ excludeTags: ['team'] })).toEqual([]);
  });
});

describe('without a default condition', () => {
  it('behaves as before: everything is searchable, listed and served', async () => {
    expect(await chatPaths()).toEqual(['archive/old.md', 'hidden.md', 'notes.md', 'visible.md']);
    expect((await call('GET', '/file?path=hidden.md')).status).toBe(200);
    expect((await call('GET', '/file?path=unindexed.md')).status).toBe(200);
    const tags = await (await call('GET', '/tags')).json() as { tag: string }[];
    expect(tags.map((t) => t.tag)).toContain('obsolete');
    const who = await (await call('GET', '/whoami')).json() as { lockedTags: unknown };
    expect(who.lockedTags).toEqual({ include: [], exclude: [] });
  });
});
