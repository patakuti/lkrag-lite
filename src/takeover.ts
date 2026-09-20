// Startup takeover (requirements §13): if another lkrag-lite is already
// serving PORT, ask it to shut down and wait until the port is free. The old
// process refuses (409) while it is busy indexing or answering requests, in
// which case the caller should give up and leave it running.

export type TakeoverResult = 'free' | 'replaced';

export class ServerBusyError extends Error {
  constructor(public readonly reason: string) {
    super(`An existing lkrag-lite server on this port is busy (${reason}); it was left running.`);
    this.name = 'ServerBusyError';
  }
}

export interface TakeoverOptions {
  /** Max time to wait for the old process to release the port (ms). */
  waitMs?: number;
  /** Polling interval while waiting (ms). */
  intervalMs?: number;
}

const REQUEST_TIMEOUT_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when nothing accepts connections on 127.0.0.1:port. */
async function isPortFree(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return false;
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code;
    return code === 'ECONNREFUSED';
  }
}

export async function takeoverPort(
  port: number,
  { waitMs = 5000, intervalMs = 100 }: TakeoverOptions = {}
): Promise<TakeoverResult> {
  if (await isPortFree(port)) return 'free';

  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
      method: 'POST',
      headers: { 'x-lkragl-client': '1' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      `Port ${port} is in use and did not respond to a shutdown request: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { reason?: string };
    throw new ServerBusyError(body.reason ?? 'unknown');
  }
  const body = res.ok ? ((await res.json().catch(() => null)) as { shutdown?: boolean } | null) : null;
  if (!body?.shutdown) {
    throw new Error(`Port ${port} is in use by another program (not lkrag-lite); not replacing it.`);
  }

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return 'replaced';
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for the previous server on port ${port} to exit.`);
}
