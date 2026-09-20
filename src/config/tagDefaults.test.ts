import { describe, it, expect } from 'vitest';
import { getDefaultTagFilter, tagDefaultsErrors } from './tagDefaults.js';
import { parseTagList } from '../indexer/tags.js';

describe('parseTagList', () => {
  it('splits on commas, trims, normalizes, skips empty entries and de-duplicates', () => {
    expect(parseTagList(' Obsolete , #draft,, obsolete ,dir:Archive ')).toEqual({
      tags: ['obsolete', 'draft', 'dir:archive'],
      invalid: [],
    });
  });
  it('reports invalid entries', () => {
    expect(parseTagList('ok,obsolete internal,a#b')).toEqual({ tags: ['ok'], invalid: ['obsolete internal', 'a#b'] });
  });
  it('treats undefined and empty as no tags', () => {
    expect(parseTagList(undefined)).toEqual({ tags: [], invalid: [] });
    expect(parseTagList('')).toEqual({ tags: [], invalid: [] });
  });
});

describe('getDefaultTagFilter', () => {
  it('reads both variables', () => {
    expect(getDefaultTagFilter({ RAG_DEFAULT_REQUIRED_TAGS: 'Team', RAG_DEFAULT_EXCLUDE_TAGS: 'obsolete, dir:archive' }))
      .toEqual({ include: ['team'], exclude: ['obsolete', 'dir:archive'] });
  });
  it('is empty when unset', () => {
    expect(getDefaultTagFilter({})).toEqual({ include: [], exclude: [] });
  });
  it('leaves invalid entries out (validation rejects them at startup)', () => {
    expect(getDefaultTagFilter({ RAG_DEFAULT_EXCLUDE_TAGS: 'obsolete,bad tag' })).toEqual({ include: [], exclude: ['obsolete'] });
  });
  it('reads the live environment by default (not a snapshot)', () => {
    const before = process.env.RAG_DEFAULT_EXCLUDE_TAGS;
    process.env.RAG_DEFAULT_EXCLUDE_TAGS = 'later';
    try {
      expect(getDefaultTagFilter().exclude).toEqual(['later']);
    } finally {
      if (before === undefined) delete process.env.RAG_DEFAULT_EXCLUDE_TAGS;
      else process.env.RAG_DEFAULT_EXCLUDE_TAGS = before;
    }
  });
});

describe('tagDefaultsErrors', () => {
  it('has no errors for valid or unset settings', () => {
    expect(tagDefaultsErrors({})).toEqual([]);
    expect(tagDefaultsErrors({ RAG_DEFAULT_REQUIRED_TAGS: 'a,b', RAG_DEFAULT_EXCLUDE_TAGS: 'c' })).toEqual([]);
  });
  it('reports an invalid entry with the variable name', () => {
    const errors = tagDefaultsErrors({ RAG_DEFAULT_EXCLUDE_TAGS: 'obsolete internal' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"obsolete internal"');
    expect(errors[0]).toContain('RAG_DEFAULT_EXCLUDE_TAGS');
  });
  it('reports a tag that is both required and excluded (case-insensitively)', () => {
    const errors = tagDefaultsErrors({ RAG_DEFAULT_REQUIRED_TAGS: 'Team', RAG_DEFAULT_EXCLUDE_TAGS: 'team' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"team"');
  });
  it('reports every problem', () => {
    expect(tagDefaultsErrors({ RAG_DEFAULT_REQUIRED_TAGS: 'a b,x', RAG_DEFAULT_EXCLUDE_TAGS: 'x,c#d' })).toHaveLength(3);
  });
});
