import path from 'path';
import { parse as parseYaml } from 'yaml';

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

// '#' not preceded by a letter/digit/_ / & # (URL fragments, HTML numeric
// references, heading markers), followed by tag characters.
const INLINE_TAG_RE = /(?<![\p{L}\p{N}_/&#])#([\p{L}\p{N}_\-/]+)/gu;

function splitFrontmatter(text: string): { yaml: string | null; body: string } {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { yaml: null, body: text };
  return { yaml: m[1], body: text.slice(m[0].length) };
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
  for (const key of ['tags', 'tag']) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === 'string' || typeof v === 'number') out.push(String(v));
      }
    } else if (typeof value === 'string') {
      out.push(...value.split(/[,\s]+/));
    } else if (typeof value === 'number') {
      out.push(String(value));
    }
  }
  return out;
}

/** Remove fenced code blocks and inline code spans. */
function stripCode(body: string): string {
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence === null) {
      if (m) {
        fence = m[1][0];
        continue;
      }
      kept.push(line.replace(/`[^`\n]*`/g, ''));
    } else if (m && m[1][0] === fence) {
      fence = null;
    }
  }
  return kept.join('\n');
}

function inlineTags(body: string): string[] {
  const out: string[] = [];
  for (const m of stripCode(body).matchAll(INLINE_TAG_RE)) {
    const tag = m[1].replace(/[-/]+$/, '');
    if (tag === '' || /^\d+$/.test(tag)) continue;
    out.push(tag);
  }
  return out;
}

/** Tags of a Markdown document: frontmatter `tags`/`tag` plus inline `#tag`. Normalized and de-duplicated. */
export function extractMarkdownTags(text: string): string[] {
  const { yaml, body } = splitFrontmatter(text);
  const raw = [...(yaml !== null ? frontmatterTags(yaml) : []), ...inlineTags(body)];
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
