import { describe, it, expect } from 'vitest';
import { chunk, makeSnippet } from './chunker.js';

describe('chunk', () => {
  it('returns empty array for empty string', () => {
    expect(chunk('', 100, 0)).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(chunk('   ', 100, 0)).toEqual([]);
  });

  it('returns single chunk when text is shorter than size', () => {
    expect(chunk('hello world', 100, 0)).toEqual(['hello world']);
  });

  it('returns single chunk when text length equals size', () => {
    const text = 'a'.repeat(100);
    expect(chunk(text, 100, 0)).toEqual([text]);
  });

  it('splits into multiple chunks without overlap', () => {
    // size=6, window=0 (floor(6*0.1)=0), no natural boundary found → split at rawEnd
    const result = chunk('abcdefghij', 6, 0);
    expect(result[0]).toBe('abcdef');
    expect(result.length).toBeGreaterThan(1);
  });

  it('respects newline as natural boundary', () => {
    // "hello world.\n" is 13 chars; size=12, window=1 → findBoundary finds '\n' at index 12
    const text = 'hello world.\nfoo';
    const result = chunk(text, 12, 0);
    expect(result[0]).toBe('hello world.');
    expect(result[1]).toBe('foo');
  });

  it('respects period as natural boundary', () => {
    // '.' at index 11; size=12, window=1 → findBoundary finds '.' at index 11
    const text = 'hello world. foo bar baz';
    const result = chunk(text, 12, 0);
    expect(result[0]).toBe('hello world.');
  });

  it('respects CJK period as natural boundary', () => {
    // '。' at index 9; size=10, window=floor(10*0.1)=1 → findBoundary finds '。' in window [9,11]
    const text = 'abcdefghi。xyz';
    const result = chunk(text, 10, 0);
    expect(result[0]).toBe('abcdefghi。');
    expect(result[1]).toBe('xyz');
  });

  it('applies overlap so consecutive chunks share content', () => {
    // size=6, overlap=3, window=0 → chunk1=[0,6), start2=max(1,6-3)=3 → chunk2=[3,9)
    const result = chunk('abcdefghij', 6, 3);
    expect(result[0]).toBe('abcdef');
    expect(result[1]).toBe('defghi');
  });

  it('trims leading and trailing whitespace from each chunk', () => {
    expect(chunk('  hello world  ', 100, 0)).toEqual(['hello world']);
  });
});

describe('makeSnippet', () => {
  it('returns short text unchanged', () => {
    expect(makeSnippet('hello')).toBe('hello');
  });

  it('truncates text to 120 characters', () => {
    const text = 'a'.repeat(200);
    expect(makeSnippet(text).length).toBe(120);
  });

  it('collapses multiple spaces into one', () => {
    expect(makeSnippet('hello   world')).toBe('hello world');
  });

  it('collapses newlines to a single space', () => {
    expect(makeSnippet('hello\nworld')).toBe('hello world');
  });

  it('trims leading and trailing whitespace', () => {
    expect(makeSnippet('  hello  ')).toBe('hello');
  });
});
