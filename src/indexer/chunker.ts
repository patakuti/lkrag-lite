const SNIPPET_LENGTH = 120;

/** Natural boundary search: find the nearest newline or CJK punctuation within a window. */
function findBoundary(text: string, pos: number, window: number): number {
  const start = Math.max(0, pos - window);
  const end   = Math.min(text.length, pos + window);
  let best = pos;
  let bestDist = window + 1;
  for (let i = end; i >= start; i--) {
    const ch = text[i];
    if (ch === '\n' || ch === '。' || ch === '.' || ch === '！' || ch === '！') {
      const dist = Math.abs(i - pos);
      if (dist < bestDist) { bestDist = dist; best = i + 1; break; }
    }
  }
  return best;
}

export function chunk(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  const window = Math.floor(size * 0.1);

  while (start < text.length) {
    const rawEnd = Math.min(start + size, text.length);
    const end = rawEnd < text.length ? findBoundary(text, rawEnd, window) : rawEnd;
    const piece = text.slice(start, end).trim();
    if (piece.length > 0) chunks.push(piece);
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

export function makeSnippet(text: string): string {
  return text.slice(0, SNIPPET_LENGTH).replace(/\s+/g, ' ').trim();
}
