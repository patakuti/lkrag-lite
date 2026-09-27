import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { normalizeTag, isReservedTag, tagsFromYamlValue, PatternTagRule } from './tags.js';

export const PATTERN_TAGS_FILENAME = '.lkragtags.yml';

/** A problem in a workspace's `.lkragtags.yml` (requirements §19.4). Aborts the whole index run. */
export class PatternTagConfigError extends Error {}

/**
 * Load and validate a workspace's `.lkragtags.yml` (requirements §19.2). Returns
 * `[]` when the file does not exist (the feature is opt-in per workspace). Any
 * problem with the file throws `PatternTagConfigError` rather than skipping the
 * bad entry, since a misconfigured rule affects tagging workspace-wide.
 */
export function loadPatternTagRules(wsPath: string): PatternTagRule[] {
  const filePath = path.join(wsPath, PATTERN_TAGS_FILENAME);
  if (!fs.existsSync(filePath)) return [];

  let data: unknown;
  try {
    data = parseYaml(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    throw new PatternTagConfigError(
      `${PATTERN_TAGS_FILENAME}: invalid YAML (${err instanceof Error ? err.message : String(err)})`
    );
  }

  if (data === null || data === undefined) return [];
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new PatternTagConfigError(`${PATTERN_TAGS_FILENAME}: must be a mapping of glob pattern to tags`);
  }

  const rules: PatternTagRule[] = [];
  for (const [rawPattern, rawValue] of Object.entries(data as Record<string, unknown>)) {
    const pattern = rawPattern.trim();
    if (pattern === '') {
      throw new PatternTagConfigError(`${PATTERN_TAGS_FILENAME}: empty pattern`);
    }

    const tags: string[] = [];
    for (const raw of tagsFromYamlValue(rawValue)) {
      const tag = normalizeTag(raw);
      if (tag === null) {
        throw new PatternTagConfigError(`${PATTERN_TAGS_FILENAME}: invalid tag "${raw}" for pattern "${pattern}"`);
      }
      if (isReservedTag(tag)) {
        throw new PatternTagConfigError(
          `${PATTERN_TAGS_FILENAME}: tag "${tag}" for pattern "${pattern}" uses the reserved "ext:"/"dir:" prefix`
        );
      }
      tags.push(tag);
    }
    if (tags.length === 0) {
      throw new PatternTagConfigError(`${PATTERN_TAGS_FILENAME}: pattern "${pattern}" has no tags`);
    }

    rules.push({ pattern, tags });
  }
  return rules;
}
