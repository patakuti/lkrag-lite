import { describe, it, expect } from 'vitest';
import { normalizeDirArg, matchesDir, parseFileList } from './bulkTag.js';

describe('normalizeDirArg', () => {
  it('strips a leading ./ and trailing /', () => {
    expect(normalizeDirArg('./manuals/')).toBe('manuals');
    expect(normalizeDirArg('manuals')).toBe('manuals');
  });

  it('converts backslashes to slashes', () => {
    expect(normalizeDirArg('manuals\\sub')).toBe('manuals/sub');
  });

  it('normalizes "." and "" to the empty string (whole workspace)', () => {
    expect(normalizeDirArg('.')).toBe('');
    expect(normalizeDirArg('')).toBe('');
  });
});

describe('matchesDir', () => {
  it('matches everything when dir is empty', () => {
    expect(matchesDir('a.md', '')).toBe(true);
    expect(matchesDir('manuals/a.md', '')).toBe(true);
  });

  it('matches the directory itself and files under it, recursively', () => {
    expect(matchesDir('manuals', 'manuals')).toBe(true);
    expect(matchesDir('manuals/a.md', 'manuals')).toBe(true);
    expect(matchesDir('manuals/sub/b.md', 'manuals')).toBe(true);
  });

  it('does not match a sibling directory with a shared prefix', () => {
    expect(matchesDir('manuals-old/a.md', 'manuals')).toBe(false);
  });

  it('does not match an unrelated path', () => {
    expect(matchesDir('other/a.md', 'manuals')).toBe(false);
  });
});

describe('parseFileList', () => {
  it('splits lines, trims, and drops blank and comment lines', () => {
    expect(parseFileList('a.md\n\n  b.md  \n# comment\nc.md\n')).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('converts backslashes to slashes', () => {
    expect(parseFileList('manuals\\a.md')).toEqual(['manuals/a.md']);
  });

  it('deduplicates', () => {
    expect(parseFileList('a.md\na.md\n')).toEqual(['a.md']);
  });

  it('handles CRLF line endings', () => {
    expect(parseFileList('a.md\r\nb.md\r\n')).toEqual(['a.md', 'b.md']);
  });
});
