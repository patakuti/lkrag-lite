import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import {
  initDb, addWorkspace, upsertFile, replaceFileTags, addManualTag, createPublicToken, getTagsForPaths,
} from '../db/sqlite.js';
import { createPublicApp } from '../publicServer.js';

let dir: string;
let server: Server;
let base: string;
let ws1: number;
let ws2: number;
let token1: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkrag-pubtags-'));
  initDb(path.join(dir, 't.db'));
  ws1 = addWorkspace('one', '/tmp/one').id;
  ws2 = addWorkspace('two', '/tmp/two').id;
  replaceFileTags(upsertFile(ws1, 'a.md', 1, 1, 'h'), ['shared', 'only-one']);
  upsertFile(ws1, 'b.pdf', 1, 1, 'h');
  addManualTag(ws1, 'b.pdf', 'manual-one');
  replaceFileTags(upsertFile(ws2, 'a.md', 1, 1, 'h'), ['only-two']);
  token1 = createPublicToken(ws1, 'tester').token;

  const app = createPublicApp();
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tags`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

const send = (method: string, url: string, body?: unknown, token: string | null = token1) =>
  fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Cookie: `pw_token=${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('public tag API', () => {
  it('requires a token', async () => {
    expect((await send('GET', '/', undefined, null)).status).toBe(401);
    expect((await send('GET', '/', undefined, 'bogus')).status).toBe(403);
  });

  it('lists only the tags of the token\'s workspace', async () => {
    const tags = await (await send('GET', '/')).json() as { tag: string }[];
    expect(tags.map((t) => t.tag).sort()).toEqual(['manual-one', 'only-one', 'shared']);
  });

  it('looks up tags (auto and manual) in the token\'s workspace only', async () => {
    const res = await (await send('POST', '/lookup', { paths: ['a.md', 'b.pdf'] })).json() as {
      fileTags: Record<string, { name: string; sources: string[] }[]>;
    };
    expect(res.fileTags['a.md'].map((t) => t.name)).toEqual(['only-one', 'shared']);
    expect(res.fileTags['b.pdf']).toEqual([{ name: 'manual-one', sources: ['manual'] }]);
    expect(res.fileTags['a.md'].some((t) => t.name === 'only-two')).toBe(false);
  });

  it('has no way to write manual tags', async () => {
    expect((await send('POST', '/manual', { path: 'a.md', tag: 'evil' })).status).toBe(404);
    expect((await send('DELETE', '/manual', { path: 'b.pdf', tag: 'manual-one' })).status).toBe(404);
    expect(getTagsForPaths(ws1, ['a.md', 'b.pdf'])['a.md'].map((t) => t.name)).not.toContain('evil');
    expect(getTagsForPaths(ws1, ['b.pdf'])['b.pdf']).toEqual([{ name: 'manual-one', sources: ['manual'] }]);
  });
});
