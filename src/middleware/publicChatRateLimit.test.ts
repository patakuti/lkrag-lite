import { describe, it, expect, vi } from 'vitest';
import { Request, Response } from 'express';
import { createChatRateLimiter } from './publicChatRateLimit.js';

function fakeReq(tokenId: number): Request {
  return { publicAuth: { tokenId, workspaceId: 1, label: 'test' } } as unknown as Request;
}

function fakeRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe('createChatRateLimiter', () => {
  it('allows requests up to the limit', () => {
    const limiter = createChatRateLimiter(3, 60_000);
    const req = fakeReq(1);
    for (let i = 0; i < 3; i++) {
      const res = fakeRes();
      const next = vi.fn();
      limiter(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it('rejects the request once the limit is exceeded within the window', () => {
    const limiter = createChatRateLimiter(2, 60_000);
    const req = fakeReq(2);
    limiter(req, fakeRes(), vi.fn());
    limiter(req, fakeRes(), vi.fn());

    const res = fakeRes();
    const next = vi.fn();
    limiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('tracks separate tokens independently', () => {
    const limiter = createChatRateLimiter(1, 60_000);
    limiter(fakeReq(10), fakeRes(), vi.fn());

    const res = fakeRes();
    const next = vi.fn();
    limiter(fakeReq(11), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows a new request once old timestamps fall outside the window', () => {
    vi.useFakeTimers();
    try {
      const limiter = createChatRateLimiter(1, 1_000);
      const req = fakeReq(20);
      limiter(req, fakeRes(), vi.fn());

      const blocked = fakeRes();
      limiter(req, blocked, vi.fn());
      expect(blocked.status).toHaveBeenCalledWith(429);

      vi.advanceTimersByTime(1_001);

      const allowed = fakeRes();
      const next = vi.fn();
      limiter(req, allowed, next);
      expect(next).toHaveBeenCalledOnce();
      expect(allowed.status).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
