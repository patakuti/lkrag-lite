import { describe, it, expect } from 'vitest';
import { normalizeTag, normalizeTagList, extractMarkdownTags, systemTagsForPath, isReservedTag, normalizeTagFilter, mergeTagFilters, isEmptyTagFilter } from './tags.js';

describe('normalizeTag', () => {
  it('strips #, trims, lowercases', () => {
    expect(normalizeTag('  #Project ')).toBe('project');
  });
  it('applies NFKC (full-width → half-width)', () => {
    expect(normalizeTag('ＡＢＣ')).toBe('abc');
  });
  it('keeps Japanese and hierarchical tags', () => {
    expect(normalizeTag('設計')).toBe('設計');
    expect(normalizeTag('a/b')).toBe('a/b');
  });
  it('rejects empty, whitespace, comma, inner #, too long', () => {
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag('#')).toBeNull();
    expect(normalizeTag('a b')).toBeNull();
    expect(normalizeTag('a,b')).toBeNull();
    expect(normalizeTag('a#b')).toBeNull();
    expect(normalizeTag('a'.repeat(65))).toBeNull();
    expect(normalizeTag('a'.repeat(64))).toBe('a'.repeat(64));
  });
});

describe('extractMarkdownTags: frontmatter', () => {
  it('reads an inline array', () => {
    expect(extractMarkdownTags('---\ntags: [Foo, bar]\n---\nbody')).toEqual(['foo', 'bar']);
  });
  it('reads a block list', () => {
    expect(extractMarkdownTags('---\ntitle: x\ntags:\n  - one\n  - two\n---\n')).toEqual(['one', 'two']);
  });
  it('reads a comma / space separated string and the `tag` key', () => {
    expect(extractMarkdownTags('---\ntags: a, b c\ntag: d\n---\n')).toEqual(['a', 'b', 'c', 'd']);
  });
  it('handles CRLF and BOM', () => {
    expect(extractMarkdownTags('﻿---\r\ntags: [x]\r\n---\r\nbody')).toEqual(['x']);
  });
  it('returns no tags for invalid YAML', () => {
    expect(extractMarkdownTags('---\ntags: [unclosed\n---\n#body')).toEqual([]);
  });
  it('de-duplicates case-insensitively', () => {
    expect(extractMarkdownTags('---\ntags: [Foo, foo, bar]\n---\n')).toEqual(['foo', 'bar']);
  });
  it('does not treat a non-leading --- block as frontmatter', () => {
    expect(extractMarkdownTags('intro\n---\ntags: [x]\n---\n')).toEqual([]);
  });
  it('drops invalid tag values (with spaces after split they are separate)', () => {
    expect(extractMarkdownTags('---\ntags:\n  - "has space"\n  - ok\n---\n')).toEqual(['ok']);
  });
  it('does not scan the frontmatter block for inline tags', () => {
    expect(extractMarkdownTags('---\ntitle: "a #notatag"\n---\nbody')).toEqual([]);
  });
});

describe('extractMarkdownTags: body #tag is not imported (D58)', () => {
  it('ignores #tag in a document without frontmatter', () => {
    expect(extractMarkdownTags('#one text #two\nこれは #設計 です')).toEqual([]);
  });
  it('ignores #tag in the body of a document with frontmatter', () => {
    expect(extractMarkdownTags('---\ntags: [Foo]\n---\n#foo #bar and #aurora-hub')).toEqual(['foo']);
  });
  it('ignores headings, URL fragments, issue numbers and code', () => {
    const text = '# Title\nsee http://x.com/page#section, issue #123, `#define`\n```\n#code\n```';
    expect(extractMarkdownTags(text)).toEqual([]);
  });
});

describe('normalizeTagList', () => {
  it('normalizes, de-duplicates and drops invalid entries', () => {
    expect(normalizeTagList(['#A', 'a', 'b c', 5, '設計'])).toEqual(['a', '設計']);
  });
  it('returns [] for non-arrays', () => {
    expect(normalizeTagList(undefined)).toEqual([]);
    expect(normalizeTagList('a')).toEqual([]);
  });
  it('caps at 10 tags', () => {
    expect(normalizeTagList(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(10);
  });
});

describe('systemTagsForPath', () => {
  it('derives ext: and dir: tags', () => {
    expect(systemTagsForPath('設計/spec/a.PDF')).toEqual(['ext:pdf', 'dir:設計']);
  });
  it('gives no dir: tag to files in the workspace root', () => {
    expect(systemTagsForPath('README.md')).toEqual(['ext:md']);
  });
  it('uses the last extension and skips extensionless files and dotfiles', () => {
    expect(systemTagsForPath('a/b.tar.gz')).toEqual(['ext:gz', 'dir:a']);
    expect(systemTagsForPath('a/Makefile')).toEqual(['dir:a']);
    expect(systemTagsForPath('.gitignore')).toEqual([]);
  });
  it('handles Windows separators', () => {
    expect(systemTagsForPath('docs\\x.md')).toEqual(['ext:md', 'dir:docs']);
  });
  it('replaces whitespace, commas and # in the folder name with -', () => {
    expect(systemTagsForPath('My Docs, v#2/a.md')).toEqual(['ext:md', 'dir:my-docs-v-2']);
  });
  it('skips a dir: tag that would be too long', () => {
    expect(systemTagsForPath(`${'x'.repeat(70)}/a.md`)).toEqual(['ext:md']);
  });
});

describe('reserved tags', () => {
  it('isReservedTag recognizes ext: and dir:', () => {
    expect(isReservedTag('ext:pdf')).toBe(true);
    expect(isReservedTag('dir:x')).toBe(true);
    expect(isReservedTag('extra')).toBe(false);
  });
  it('frontmatter tags cannot impersonate system tags', () => {
    expect(extractMarkdownTags('---\ntags: [ext:pdf, DIR:x, ok]\n---\n')).toEqual(['ok']);
  });
  it('normalizeTag / normalizeTagList still allow them (used for filtering)', () => {
    expect(normalizeTag('ext:pdf')).toBe('ext:pdf');
    expect(normalizeTagList(['dir:Archive'])).toEqual(['dir:archive']);
  });
});

describe('TagFilter helpers', () => {
  it('normalizeTagFilter normalizes both lists independently', () => {
    expect(normalizeTagFilter({ tags: ['#A', 'a', 'b c'], excludeTags: ['Obsolete', 5] }))
      .toEqual({ include: ['a'], exclude: ['obsolete'] });
    expect(normalizeTagFilter({})).toEqual({ include: [], exclude: [] });
  });
  it('mergeTagFilters unions both lists', () => {
    expect(mergeTagFilters({ include: ['a'], exclude: ['x'] }, { include: ['a', 'b'], exclude: ['y'] }))
      .toEqual({ include: ['a', 'b'], exclude: ['x', 'y'] });
  });
  it('isEmptyTagFilter', () => {
    expect(isEmptyTagFilter({ include: [], exclude: [] })).toBe(true);
    expect(isEmptyTagFilter({ include: [], exclude: ['x'] })).toBe(false);
  });
});
