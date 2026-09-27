import path from 'path';
import { parse as parseYaml } from 'yaml';
import mm from 'micromatch';

const MAX_TAG_LENGTH = 64;

/**
 * Normalize a tag for storage and comparison. Returns null when the result is
 * not a valid tag (empty, too long, or containing whitespace, ',' or '#').
 */
export function normalizeTag(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const tag = raw.trim().replace(/^#+/, '').normalize('NFKC').toLowerCase();
  if (tag.length === 0 || tag.length > MAX_TAG_LENGTH) return null;
  if (/[\s,#]/u.test(tag)) return null;
  return tag;
}

// `ext:` / `dir:` tags are derived from the path only (requirements §15.2) and
// cannot be written by documents or by hand, so they can be trusted in filters.
const RESERVED_PREFIXES = ['ext:', 'dir:'];

export function isReservedTag(tag: string): boolean {
  return RESERVED_PREFIXES.some((p) => tag.startsWith(p));
}

/**
 * Tags derived from a workspace-relative path: `ext:<extension>` and
 * `dir:<top-level folder>` (files directly in the workspace root get no `dir:`).
 */
export function systemTagsForPath(relPath: string): string[] {
  const segments = relPath.split(/[\\/]/).filter(Boolean);
  if (segments.length === 0) return [];
  const tags: string[] = [];

  const ext = path.posix.extname(segments[segments.length - 1]).slice(1);
  const extTag = ext ? normalizeTag(`ext:${ext}`) : null;
  if (extTag !== null) tags.push(extTag);

  if (segments.length > 1) {
    const dirTag = normalizeTag(`dir:${segments[0].replace(/[\s,#]+/g, '-')}`);
    if (dirTag !== null) tags.push(dirTag);
  }
  return tags;
}

const FRONTMATTER_RE = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/**
 * Tags from a single YAML value, in the same shapes frontmatter `tags:` / `tag:`
 * accept: an inline/block array, or a comma/space-separated string. Shared with
 * the pattern-tags config (§19), whose values follow the same syntax.
 */
export function tagsFromYamlValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === 'string' || typeof v === 'number').map(String);
  }
  if (typeof value === 'string') return value.split(/[,\s]+/);
  if (typeof value === 'number') return [String(value)];
  return [];
}

function frontmatterTags(yamlText: string): string[] {
  let data: unknown;
  try {
    data = parseYaml(yamlText);
  } catch {
    return [];
  }
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ['tags', 'tag']) out.push(...tagsFromYamlValue(record[key]));
  return out;
}

/**
 * Tags of a Markdown document: frontmatter `tags`/`tag` only. Inline `#tag` in the
 * body is not imported (it cannot be told apart from channel names, issue numbers, ...).
 * Normalized and de-duplicated.
 */
export function extractMarkdownTags(text: string): string[] {
  const m = FRONTMATTER_RE.exec(text);
  const raw = m ? frontmatterTags(m[1]) : [];
  const seen = new Set<string>();
  for (const r of raw) {
    const tag = normalizeTag(r);
    if (tag !== null && !isReservedTag(tag)) seen.add(tag);
  }
  return [...seen];
}

const MAX_FILTER_TAGS = 10;

/** Tag condition of a search: documents must have all `include` tags and none of the `exclude` tags. */
export interface TagFilter {
  include: string[];
  exclude: string[];
}

export function isEmptyTagFilter(filter: TagFilter): boolean {
  return filter.include.length === 0 && filter.exclude.length === 0;
}

/** Union of both lists (a tag in both means no document matches: exclusion wins). */
export function mergeTagFilters(a: TagFilter, b: TagFilter): TagFilter {
  return {
    include: [...new Set([...a.include, ...b.include])],
    exclude: [...new Set([...a.exclude, ...b.exclude])],
  };
}

/** Normalize a client-supplied tag list: drops non-strings, invalid and duplicate tags, caps the size. */
export function normalizeTagList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    const tag = typeof raw === 'string' ? normalizeTag(raw) : null;
    if (tag !== null) seen.add(tag);
    if (seen.size >= MAX_FILTER_TAGS) break;
  }
  return [...seen];
}

/** Tag filter from a request body (`tags` = required, `excludeTags` = excluded). */
export function normalizeTagFilter(body: { tags?: unknown; excludeTags?: unknown }): TagFilter {
  return { include: normalizeTagList(body.tags), exclude: normalizeTagList(body.excludeTags) };
}

/**
 * Parse a comma-separated tag list (e.g. from an environment variable).
 * Empty entries are ignored, invalid entries are reported, duplicates dropped.
 */
export function parseTagList(raw: string | undefined): { tags: string[]; invalid: string[] } {
  const tags = new Set<string>();
  const invalid: string[] = [];
  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const tag = normalizeTag(trimmed);
    if (tag === null) invalid.push(trimmed);
    else tags.add(tag);
  }
  return { tags: [...tags], invalid };
}

/** One rule of a workspace's `.lkragtags.yml` (requirements §19): a glob pattern and the tags it grants. */
export interface PatternTagRule {
  pattern: string;
  tags: string[];
}

/**
 * Tags a workspace-relative path gets from `.lkragtags.yml` rules: the union of
 * every matching pattern's tags (no priority between patterns, requirements §19.3).
 * Rules are assumed pre-validated (loadPatternTagRules); this function does no
 * normalization or reserved-tag filtering of its own.
 */
export function patternTagsForPath(relPath: string, rules: PatternTagRule[]): string[] {
  const tags = new Set<string>();
  for (const rule of rules) {
    if (mm.isMatch(relPath, rule.pattern)) {
      for (const t of rule.tags) tags.add(t);
    }
  }
  return [...tags];
}
