/**
 * Node's fetch (undici) rejects with a bare `TypeError: fetch failed` and keeps the
 * real reason (ECONNREFUSED, ENOTFOUND, timeout, ...) in `err.cause`. Include it so
 * connection problems can be diagnosed from the message alone.
 */
export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause;
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    return `${err.message} (${code ? `${code}: ` : ''}${cause.message})`;
  }
  return err.message;
}

/** Thrown when the LLM API (answer generation or query rewriter) is unreachable. */
export class LlmApiError extends Error {}

/** fetch() that reports the request URL and the underlying cause when the connection fails. */
export async function fetchLlmApi(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new LlmApiError(`LLM API unreachable at ${url}: ${describeFetchError(err)}`);
  }
}
