/**
 * Pure helpers for `lkragl tag add` / `lkragl tag remove` (requirements §18, D59):
 * resolving the `--dir` / `--files-from` target-file selectors. Kept free of
 * fs/DB access so they can be unit tested directly.
 */

/**
 * Normalizes a `--dir` argument for prefix matching against workspace-relative
 * paths: backslashes become slashes, a leading `./` and trailing `/` are
 * stripped. `.` (or an already-empty value) normalizes to `''`, which
 * `matchesDir` treats as "the whole workspace".
 */
export function normalizeDirArg(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/?/, '')
    .replace(/\/+$/, '');
}

/** Whether a workspace-relative path is the given directory or lives under it. */
export function matchesDir(relPath: string, dir: string): boolean {
  if (dir === '') return true;
  return relPath === dir || relPath.startsWith(`${dir}/`);
}

/**
 * Parses `--files-from` file/stdin content into a deduplicated list of
 * workspace-relative paths: one per line, blank lines and lines starting
 * with `#` are ignored, backslashes become slashes.
 */
export function parseFileList(content: string): string[] {
  const seen = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    seen.add(trimmed.replace(/\\/g, '/'));
  }
  return [...seen];
}
