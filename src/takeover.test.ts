import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { takeoverPort, ServerBusyError } from './takeover.js';

const servers: http.Server[] = [];

function listen(handler: http.RequestListener, port = 0): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    servers.push(server);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const portOf = (s: http.Server) => (s.address() as AddressInfo).port;

/** Free port number nobody is listening on. */
async function freePort(): Promise<number> {
  const s = await listen((_req, res) => res.end());
  const port = portOf(s);
  await new Promise((r) => s.close(r));
  return port;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise((r) => { s.closeAllConnections(); s.close(r); }))
  );
});

describe('takeoverPort', () => {
  it("returns 'free' when nothing is listening", async () => {
    expect(await takeoverPort(await freePort())).toBe('free');
  });

  it("asks the old server to shut down and returns 'replaced' once the port is free", async () => {
    let sawHeader: string | undefined;
    const old = await listen((req, res) => {
      if (req.method === 'POST' && req.url === '/api/shutdown') {
        sawHeader = req.headers['x-lkragl-client'] as string;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ shutdown: true }));
        setTimeout(() => { old.closeAllConnections(); old.close(); }, 50);
        return;
      }
      res.statusCode = 403;
      res.end();
    });
    expect(await takeoverPort(portOf(old), { intervalMs: 20 })).toBe('replaced');
    expect(sawHeader).toBe('1');
  });

  it('throws ServerBusyError and leaves a busy server running', async () => {
    const busy = await listen((req, res) => {
      if (req.method === 'POST' && req.url === '/api/shutdown') {
        res.statusCode = 409;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ busy: true, reason: 'indexing' }));
        return;
      }
      res.end();
    });
    const err = await takeoverPort(portOf(busy)).catch((e) => e);
    expect(err).toBeInstanceOf(ServerBusyError);
    expect(err.reason).toBe('indexing');
    expect(busy.listening).toBe(true);
  });

  it('refuses to touch a program that is not lkrag-lite', async () => {
    const other = await listen((_req, res) => {
      res.statusCode = 404;
      res.end('nope');
    });
    await expect(takeoverPort(portOf(other))).rejects.toThrow(/another program/);
    expect(other.listening).toBe(true);
  });

  it('times out if the old server acknowledges but never exits', async () => {
    const stuck = await listen((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ shutdown: true }));
    });
    await expect(takeoverPort(portOf(stuck), { waitMs: 200, intervalMs: 20 })).rejects.toThrow(/Timed out/);
  });
});
