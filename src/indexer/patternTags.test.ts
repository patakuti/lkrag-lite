import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadPatternTagRules, PatternTagConfigError, PATTERN_TAGS_FILENAME } from './patternTags.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkrag-pattern-tags-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(content: string): void {
  fs.writeFileSync(path.join(dir, PATTERN_TAGS_FILENAME), content, 'utf-8');
}

describe('loadPatternTagRules', () => {
  it('returns [] when the file does not exist', () => {
    expect(loadPatternTagRules(dir)).toEqual([]);
  });

  it('returns [] for an empty file', () => {
    write('');
    expect(loadPatternTagRules(dir)).toEqual([]);
  });

  it('reads inline array, comma-separated string and single-value tags', () => {
    write([
      '"docs/**": [design, spec]',
      '"archive/**": obsolete',
      '"**/*.pdf": pdf',
    ].join('\n'));
    expect(loadPatternTagRules(dir)).toEqual([
      { pattern: 'docs/**', tags: ['design', 'spec'] },
      { pattern: 'archive/**', tags: ['obsolete'] },
      { pattern: '**/*.pdf', tags: ['pdf'] },
    ]);
  });

  it('normalizes tags (trim, lowercase, NFKC)', () => {
    write('"docs/**": [" Design ", "ＡＢＣ"]');
    expect(loadPatternTagRules(dir)).toEqual([{ pattern: 'docs/**', tags: ['design', 'abc'] }]);
  });

  it('throws on invalid YAML', () => {
    write('"docs/**": [unclosed');
    expect(() => loadPatternTagRules(dir)).toThrow(PatternTagConfigError);
  });

  it('throws when the top level is not a mapping', () => {
    write('- a\n- b');
    expect(() => loadPatternTagRules(dir)).toThrow(PatternTagConfigError);
  });

  it('throws on an empty pattern key', () => {
    write('"  ": [design]');
    expect(() => loadPatternTagRules(dir)).toThrow(PatternTagConfigError);
  });

  it('throws on an invalid tag value', () => {
    write('"docs/**": ["has space"]');
    expect(() => loadPatternTagRules(dir)).toThrow(PatternTagConfigError);
  });

  it('throws on a reserved-prefixed tag', () => {
    write('"docs/**": [ext:pdf]');
    expect(() => loadPatternTagRules(dir)).toThrow(PatternTagConfigError);
  });

  it('throws when a pattern has no tags', () => {
    write('"docs/**": []');
    expect(() => loadPatternTagRules(dir)).toThrow(PatternTagConfigError);
  });
});
