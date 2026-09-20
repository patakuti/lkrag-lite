import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  initDb, ensureVecTable, addWorkspace, upsertFile, insertChunk, insertVec, insertFts,
  replaceFileTags, replaceSystemTags, addManualTag, searchChunks, searchFts,
} from './sqlite.js';

let dir: string;
let wsId: number;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkrag-tagsearch-'));
  initDb(path.join(dir, 'test.db'));
  ensureVecTable(2);
  wsId = addWorkspace('ws', '/tmp/ws').id;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// One chunk per file; vec = [x, 0] so distance to query [1,0] grows with |x-1|.
function addDoc(p: string, text: string, vec: number[], tags: string[] = []): void {
  const fileId = upsertFile(wsId, p, 1, 1, p);
  replaceFileTags(fileId, tags);
  const chunkId = insertChunk(fileId, wsId, 0, text, text);
  insertVec(chunkId, wsId, vec);
  insertFts(chunkId, text);
}

const inc = (include: string[]) => ({ include, exclude: [] as string[] });
const exc = (exclude: string[]) => ({ include: [] as string[], exclude });
const paths = (rows: { filePath: string }[]) => rows.map((r) => r.filePath).sort();

describe('tag filtered search', () => {
  beforeEach(() => {
    // The 5 nearest vectors belong to untagged files; tagged ones are far away.
    for (let i = 0; i < 5; i++) addDoc(`near${i}.md`, `common near ${i}`, [1, 0.01 * i]);
    addDoc('far-a.md', 'common far a', [0, 1], ['a']);
    addDoc('far-ab.md', 'common far ab', [0, 1], ['a', 'b']);
    addDoc('far-b.md', 'common far b', [0, 1], ['b']);
  });

  it('without tags returns unfiltered results', () => {
    expect(searchChunks(wsId, [1, 0], 3)).toHaveLength(3);
    expect(searchFts(wsId, 'common', 20)).toHaveLength(8);
  });

  it('vector search fills top-k from matching chunks even when non-matching are nearer', () => {
    const rows = searchChunks(wsId, [1, 0], 2, inc(['a']));
    expect(paths(rows)).toEqual(['far-a.md', 'far-ab.md']);
  });

  it('multiple tags are ANDed (vector and FTS)', () => {
    expect(paths(searchChunks(wsId, [1, 0], 5, inc(['a', 'b'])))).toEqual(['far-ab.md']);
    expect(paths(searchFts(wsId, 'common', 20, inc(['a', 'b'])))).toEqual(['far-ab.md']);
  });

  it('FTS honors a single tag', () => {
    expect(paths(searchFts(wsId, 'common', 20, inc(['b'])))).toEqual(['far-ab.md', 'far-b.md']);
  });

  it('manual tags filter too', () => {
    addManualTag(wsId, 'near0.md', 'a');
    expect(paths(searchChunks(wsId, [1, 0], 5, inc(['a'])))).toEqual(['far-a.md', 'far-ab.md', 'near0.md']);
    expect(paths(searchFts(wsId, 'common', 20, inc(['a'])))).toEqual(['far-a.md', 'far-ab.md', 'near0.md']);
  });

  it('an unknown tag matches nothing', () => {
    expect(searchChunks(wsId, [1, 0], 5, inc(['nope']))).toEqual([]);
    expect(searchFts(wsId, 'common', 20, inc(['nope']))).toEqual([]);
  });

  it('does not leak across workspaces', () => {
    const ws2 = addWorkspace('ws2', '/tmp/ws2').id;
    const f2 = upsertFile(ws2, 'other.md', 1, 1, 'x');
    replaceFileTags(f2, ['a']);
    const c2 = insertChunk(f2, ws2, 0, 'common other', 'common other');
    insertVec(c2, ws2, [1, 0]);
    insertFts(c2, 'common other');
    expect(paths(searchChunks(wsId, [1, 0], 10, inc(['a'])))).toEqual(['far-a.md', 'far-ab.md']);
    expect(paths(searchFts(wsId, 'common', 20, inc(['a'])))).toEqual(['far-a.md', 'far-ab.md']);
  });
});

describe('excluded tags', () => {
  beforeEach(() => {
    for (let i = 0; i < 5; i++) addDoc(`near${i}.md`, `common near ${i}`, [1, 0.01 * i], i < 3 ? ['old'] : []);
    addDoc('far-a.md', 'common far a', [0, 1], ['a']);
    addDoc('far-ab.md', 'common far ab', [0, 1], ['a', 'b']);
    addDoc('far-b.md', 'common far b', [0, 1], ['b']);
  });

  it('drops documents having any excluded tag (vector and FTS)', () => {
    const expected = ['far-b.md', 'near3.md', 'near4.md'];
    expect(paths(searchChunks(wsId, [1, 0], 20, exc(['a', 'old'])))).toEqual(expected);
    expect(paths(searchFts(wsId, 'common', 20, exc(['a', 'old'])))).toEqual(expected);
  });

  it('fills top-k from the remaining documents when the nearest ones are excluded', () => {
    const rows = searchChunks(wsId, [1, 0], 3, exc(['old']));
    expect(rows).toHaveLength(3);
    // nearest two remaining documents come first, then one of the equally distant far ones
    expect(rows.slice(0, 2).map((r) => r.filePath).sort()).toEqual(['near3.md', 'near4.md']);
    expect(rows[2].filePath.startsWith('far-')).toBe(true);
    expect(paths(rows).some((p) => ['near0.md', 'near1.md', 'near2.md'].includes(p))).toBe(false);
  });

  it('combines required and excluded tags', () => {
    const f = { include: ['b'], exclude: ['a'] };
    expect(paths(searchChunks(wsId, [1, 0], 20, f))).toEqual(['far-b.md']);
    expect(paths(searchFts(wsId, 'common', 20, f))).toEqual(['far-b.md']);
  });

  it('a tag both required and excluded matches nothing (exclusion wins)', () => {
    const f = { include: ['a'], exclude: ['a'] };
    expect(searchChunks(wsId, [1, 0], 20, f)).toEqual([]);
    expect(searchFts(wsId, 'common', 20, f)).toEqual([]);
  });

  it('excludes by manual tag and by system tag', () => {
    addManualTag(wsId, 'near4.md', 'hide');
    replaceSystemTags(upsertFile(wsId, 'near3.md', 1, 1, 'near3.md'), ['dir:archive']);
    const f = exc(['hide', 'dir:archive', 'old', 'a', 'b']);
    expect(searchChunks(wsId, [1, 0], 20, f)).toEqual([]);
    expect(searchFts(wsId, 'common', 20, f)).toEqual([]);
    expect(paths(searchFts(wsId, 'common', 20, exc(['hide', 'dir:archive'])))).not.toContain('near4.md');
    expect(paths(searchFts(wsId, 'common', 20, exc(['hide', 'dir:archive'])))).not.toContain('near3.md');
  });

  it('an unknown excluded tag changes nothing', () => {
    expect(searchFts(wsId, 'common', 20, exc(['nope']))).toHaveLength(8);
    expect(searchChunks(wsId, [1, 0], 20, exc(['nope']))).toHaveLength(8);
  });
});
