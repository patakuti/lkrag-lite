import net from 'net';
import { describe, it, expect } from 'vitest';
import { describeFetchError, fetchLlmApi, LlmApiError } from './fetchError.js';

describe('describeFetchError', () => {
  it('appends the cause code and message of a fetch failure', () => {
    const err = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }),
    });
    expect(describeFetchError(err)).toBe('fetch failed (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:1)');
  });

  it('returns the plain message when there is no cause', () => {
    expect(describeFetchError(new Error('boom'))).toBe('boom');
    expect(describeFetchError('str')).toBe('str');
  });
});

/** A port that was just free, so nothing is listening on it. */
function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

describe('fetchLlmApi', () => {
  it('reports the URL and the underlying cause when the connection is refused', async () => {
    const url = `http://127.0.0.1:${await closedPort()}/v1/chat/completions`;
    const err = await fetchLlmApi(url, { method: 'POST' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmApiError);
    expect((err as Error).message).toContain(`LLM API unreachable at ${url}`);
    expect((err as Error).message).toContain('ECONNREFUSED');
  });
});
