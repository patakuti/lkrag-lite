import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import {
  initDb, addWorkspace, activateWorkspace, upsertFile, replaceFileTags, getTagsForPaths,
} from '../db/sqlite.js';
import tagsRouter from './tags.js';

let dir: string;
let server: Server;
let base: string;
let wsId: number;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkrag-tagroutes-'));
  initDb(path.join(dir, 't.db'));
  wsId = addWorkspace('ws', '/tmp/ws').id;
  activateWorkspace(wsId);
  replaceFileTags(upsertFile(wsId, 'a.md', 1, 1, 'h'), ['auto']);
  upsertFile(wsId, 'b.pdf', 1, 1, 'h');

  const app = express();
  app.use(express.json());
  app.use('/api/tags', tagsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tags`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

const send = (method: string, url: string, body?: unknown) =>
  fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('manual tag routes', () => {
  it('adds a normalized manual tag and returns the file\'s current tags', async () => {
    const res = await send('POST', '/manual', { path: 'a.md', tag: '#Review' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      tags: [{ name: 'auto', sources: ['file'] }, { name: 'review', sources: ['manual'] }],
    });
  });

  it('rejects an invalid tag or missing fields with 400', async () => {
    expect((await send('POST', '/manual', { path: 'a.md', tag: 'has space' })).status).toBe(400);
    expect((await send('POST', '/manual', { path: 'a.md' })).status).toBe(400);
    expect((await send('POST', '/manual', { tag: 'x' })).status).toBe(400);
    expect((await send('DELETE', '/manual', { path: 'a.md', tag: '' })).status).toBe(400);
  });

  it('rejects reserved ext:/dir: tags with 400', async () => {
    expect((await send('POST', '/manual', { path: 'a.md', tag: 'ext:pdf' })).status).toBe(400);
    expect((await send('POST', '/manual', { path: 'a.md', tag: '#Dir:x' })).status).toBe(400);
  });

  it('returns 404 for a path that is not in the index', async () => {
    expect((await send('POST', '/manual', { path: '../etc/passwd', tag: 'x' })).status).toBe(404);
    expect(getTagsForPaths(wsId, ['../etc/passwd'])['../etc/passwd']).toEqual([]);
  });

  it('removes a manual tag (idempotent) but never an automatic one', async () => {
    await send('POST', '/manual', { path: 'b.pdf', tag: 'm' });
    expect((await send('DELETE', '/manual', { path: 'b.pdf', tag: 'm' })).status).toBe(204);
    expect((await send('DELETE', '/manual', { path: 'b.pdf', tag: 'm' })).status).toBe(204);
    expect(getTagsForPaths(wsId, ['b.pdf'])['b.pdf']).toEqual([]);

    expect((await send('DELETE', '/manual', { path: 'a.md', tag: 'auto' })).status).toBe(204);
    expect(getTagsForPaths(wsId, ['a.md'])['a.md']).toEqual([{ name: 'auto', sources: ['file'] }]);
  });

  it('lists and looks up tags', async () => {
    await send('POST', '/manual', { path: 'b.pdf', tag: 'auto' });
    expect(await (await send('GET', '/')).json()).toEqual([{ tag: 'auto', count: 2 }]);
    const lookup = await (await send('POST', '/lookup', { paths: ['b.pdf'] })).json();
    expect(lookup).toEqual({ fileTags: { 'b.pdf': [{ name: 'auto', sources: ['manual'] }] } });
    expect((await send('POST', '/lookup', { paths: 'a' })).status).toBe(400);
  });
});
