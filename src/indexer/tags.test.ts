import { describe, it, expect } from 'vitest';
import { normalizeTag, extractMarkdownTags } from './tags.js';

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
  it('ignores invalid YAML but still reads the body', () => {
    expect(extractMarkdownTags('---\ntags: [unclosed\n---\n#body')).toEqual(['body']);
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

describe('extractMarkdownTags: inline #tag', () => {
  it('finds tags at line start, after spaces and Japanese text', () => {
    expect(extractMarkdownTags('#one text #two\nこれは #設計 です')).toEqual(['one', 'two', '設計']);
  });
  it('supports hierarchical tags and trims trailing separators', () => {
    expect(extractMarkdownTags('#a/b and #c- and #d/')).toEqual(['a/b', 'c', 'd']);
  });
  it('ignores headings', () => {
    expect(extractMarkdownTags('# Title\n## Sub\n### x')).toEqual([]);
  });
  it('ignores URL fragments and HTML numeric references', () => {
    expect(extractMarkdownTags('see http://x.com/page#section and &#39; and a#b')).toEqual([]);
  });
  it('ignores purely numeric tags', () => {
    expect(extractMarkdownTags('issue #123 and #4a')).toEqual(['4a']);
  });
  it('ignores fenced code blocks', () => {
    const text = 'before #in\n```\n#code\n```\n~~~sh\n#code2\n~~~\nafter #out';
    expect(extractMarkdownTags(text)).toEqual(['in', 'out']);
  });
  it('does not close a ``` fence with ~~~', () => {
    expect(extractMarkdownTags('```\n~~~\n#still-code\n```\n#real')).toEqual(['real']);
  });
  it('ignores inline code', () => {
    expect(extractMarkdownTags('use `#define` and #tag')).toEqual(['tag']);
  });
  it('de-duplicates across frontmatter and body, case-insensitively', () => {
    expect(extractMarkdownTags('---\ntags: [Foo]\n---\n#foo #FOO #bar')).toEqual(['foo', 'bar']);
  });
});
