import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  initDb, ensureVecTable, addWorkspace, upsertFile, deleteFile, clearWorkspaceIndex, deleteWorkspace,
  replaceFileTags, replaceSystemTags, listTags, getTagsForPaths, addManualTag, removeManualTag, fileExists, getDb,
} from './sqlite.js';

let dir: string;
let wsId: number;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkrag-tags-'));
  initDb(path.join(dir, 'test.db'));
  ensureVecTable(4); // deleteFile assumes vec_chunks exists (created on first embedding)
  wsId = addWorkspace('ws', '/tmp/ws').id;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const file = (p: string) => upsertFile(wsId, p, 1, 1, 'h');

describe('file tags', () => {
  it('replaceFileTags replaces the set', () => {
    const id = file('a.md');
    replaceFileTags(id, ['x', 'y']);
    replaceFileTags(id, ['y', 'z']);
    expect(getTagsForPaths(wsId, ['a.md'])['a.md'].map((t) => t.name)).toEqual(['y', 'z']);
  });

  it('cascades when the file is deleted', () => {
    const id = file('a.md');
    replaceFileTags(id, ['x']);
    deleteFile(id);
    expect(listTags(wsId)).toEqual([]);
  });

  it('listTags counts files per tag (count desc, then name)', () => {
    replaceFileTags(file('a.md'), ['b', 'a']);
    replaceFileTags(file('b.md'), ['b']);
    expect(listTags(wsId)).toEqual([{ tag: 'b', count: 2 }, { tag: 'a', count: 1 }]);
  });
});

describe('manual tags', () => {
  it('merges with file tags and reports sources', () => {
    const id = file('a.pdf');
    replaceFileTags(id, ['x']);
    addManualTag(wsId, 'a.pdf', 'x');
    addManualTag(wsId, 'a.pdf', 'm');
    expect(getTagsForPaths(wsId, ['a.pdf'])['a.pdf']).toEqual([
      { name: 'm', sources: ['manual'] },
      { name: 'x', sources: ['file', 'manual'] },
    ]);
  });

  it('is idempotent on add and on remove, and reports whether a row actually changed', () => {
    file('a.pdf');
    expect(addManualTag(wsId, 'a.pdf', 'm')).toBe(true);
    expect(addManualTag(wsId, 'a.pdf', 'm')).toBe(false);
    expect(listTags(wsId)).toEqual([{ tag: 'm', count: 1 }]);
    expect(removeManualTag(wsId, 'a.pdf', 'm')).toBe(true);
    expect(removeManualTag(wsId, 'a.pdf', 'm')).toBe(false);
    expect(listTags(wsId)).toEqual([]);
  });

  it('survives a full rebuild (clearWorkspaceIndex) and reattaches to the re-indexed file', () => {
    const id = file('a.pdf');
    replaceFileTags(id, ['auto']);
    addManualTag(wsId, 'a.pdf', 'm');
    clearWorkspaceIndex(wsId);
    expect(listTags(wsId)).toEqual([]);
    expect(getTagsForPaths(wsId, ['a.pdf'])['a.pdf']).toEqual([]);
    file('a.pdf');
    expect(getTagsForPaths(wsId, ['a.pdf'])['a.pdf']).toEqual([{ name: 'm', sources: ['manual'] }]);
  });

  it('detaches when the file is renamed (path no longer matches)', () => {
    file('old.pdf');
    addManualTag(wsId, 'old.pdf', 'm');
    file('new.pdf');
    expect(getTagsForPaths(wsId, ['new.pdf'])['new.pdf']).toEqual([]);
    expect(fileExists(wsId, 'new.pdf')).toBe(true);
  });

  it('is removed with the workspace', () => {
    file('a.pdf');
    addManualTag(wsId, 'a.pdf', 'm');
    deleteWorkspace(wsId);
    const ws2 = addWorkspace('ws2', '/tmp/ws2').id;
    upsertFile(ws2, 'a.pdf', 1, 1, 'h');
    expect(listTags(ws2)).toEqual([]);
  });

  it('keeps workspaces separate', () => {
    file('a.pdf');
    const ws2 = addWorkspace('ws2', '/tmp/ws2').id;
    upsertFile(ws2, 'a.pdf', 1, 1, 'h');
    addManualTag(wsId, 'a.pdf', 'only-ws1');
    expect(getTagsForPaths(ws2, ['a.pdf'])['a.pdf']).toEqual([]);
  });
});

describe('getTagsForPaths', () => {
  it('returns an empty entry for unknown paths', () => {
    expect(getTagsForPaths(wsId, ['missing.md'])).toEqual({ 'missing.md': [] });
    expect(getTagsForPaths(wsId, [])).toEqual({});
  });
});

describe('system tags', () => {
  it('appear with source "system" and cascade with the file', () => {
    const id = file('docs/a.pdf');
    replaceSystemTags(id, ['ext:pdf', 'dir:docs']);
    expect(getTagsForPaths(wsId, ['docs/a.pdf'])['docs/a.pdf']).toEqual([
      { name: 'dir:docs', sources: ['system'] },
      { name: 'ext:pdf', sources: ['system'] },
    ]);
    expect(listTags(wsId).map((t) => t.tag)).toEqual(['dir:docs', 'ext:pdf']);
    deleteFile(id);
    expect(listTags(wsId)).toEqual([]);
  });

  it('replaceSystemTags replaces the set and is independent of file tags', () => {
    const id = file('a.md');
    replaceFileTags(id, ['x']);
    replaceSystemTags(id, ['ext:md']);
    replaceSystemTags(id, ['ext:txt']);
    expect(getTagsForPaths(wsId, ['a.md'])['a.md']).toEqual([
      { name: 'ext:txt', sources: ['system'] },
      { name: 'x', sources: ['file'] },
    ]);
  });

  it('manual tags with a reserved prefix are ignored by the view', () => {
    file('a.md');
    addManualTag(wsId, 'a.md', 'ext:fake');
    addManualTag(wsId, 'a.md', 'dir:fake');
    addManualTag(wsId, 'a.md', 'real');
    expect(getTagsForPaths(wsId, ['a.md'])['a.md']).toEqual([{ name: 'real', sources: ['manual'] }]);
  });

  it('an old view definition (without system tags) is replaced on init', () => {
    const id = file('a.md');
    replaceSystemTags(id, ['ext:md']);
    const db = getDb();
    db.exec(`
      DROP VIEW v_file_tags;
      CREATE VIEW v_file_tags AS SELECT file_id, tag, 'file' AS source FROM file_tags;
    `);
    expect(getTagsForPaths(wsId, ['a.md'])['a.md']).toEqual([]);
    initDb(path.join(dir, 'test.db'));
    expect(getTagsForPaths(wsId, ['a.md'])['a.md']).toEqual([{ name: 'ext:md', sources: ['system'] }]);
  });
});
