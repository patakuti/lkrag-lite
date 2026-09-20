import { parseTagList, TagFilter } from '../indexer/tags.js';

const REQUIRED_VAR = 'RAG_DEFAULT_REQUIRED_TAGS';
const EXCLUDE_VAR = 'RAG_DEFAULT_EXCLUDE_TAGS';

type Env = Record<string, string | undefined>;

/**
 * Default search condition from the environment (requirements §15.4). Read on
 * every call rather than kept in runtimeConfig: that snapshot is taken before
 * .env is loaded, and an enforced condition must not depend on it (D52).
 * Invalid entries are left out; validateTagDefaults() rejects them at startup.
 */
export function getDefaultTagFilter(env: Env = process.env): TagFilter {
  return {
    include: parseTagList(env[REQUIRED_VAR]).tags,
    exclude: parseTagList(env[EXCLUDE_VAR]).tags,
  };
}

/** Problems in the default tag settings (invalid entries, a tag both required and excluded). */
export function tagDefaultsErrors(env: Env = process.env): string[] {
  const required = parseTagList(env[REQUIRED_VAR]);
  const excluded = parseTagList(env[EXCLUDE_VAR]);
  const errors: string[] = [];
  for (const [name, parsed] of [[REQUIRED_VAR, required], [EXCLUDE_VAR, excluded]] as const) {
    for (const entry of parsed.invalid) {
      errors.push(
        `invalid tag "${entry}" in ${name} (a tag is 1-64 characters without whitespace, "," or "#"; separate tags with ",")`
      );
    }
  }
  for (const tag of required.tags.filter((t) => excluded.tags.includes(t))) {
    errors.push(`tag "${tag}" is in both ${REQUIRED_VAR} and ${EXCLUDE_VAR}`);
  }
  return errors;
}

/**
 * Fail fast on a misconfigured default condition: silently ignoring an entry
 * (say "obsolete internal") could expose documents that were meant to be hidden.
 */
export function validateTagDefaults(): void {
  const errors = tagDefaultsErrors();
  if (errors.length === 0) return;
  process.stderr.write(errors.map((e) => `Error: ${e}\n`).join(''));
  process.exit(1);
}
