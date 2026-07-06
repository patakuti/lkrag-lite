import { Request, Response, NextFunction } from 'express';

// Per-token sliding-window limiter for the public chat's /chat endpoint (D50).
// Tokens are high-entropy (24 random bytes) so brute-forcing one isn't
// practical, but anyone holding a valid token could otherwise call /chat as
// fast as they want, and each call bills an LLM query-rewrite + answer call.
const buckets = new Map<number, number[]>();

export function createChatRateLimiter(limit: number, windowMs: number) {
  return function chatRateLimit(req: Request, res: Response, next: NextFunction): void {
    const tokenId = req.publicAuth!.tokenId;
    const now = Date.now();

    const timestamps = (buckets.get(tokenId) ?? []).filter((t) => now - t < windowMs);
    if (timestamps.length >= limit) {
      res.status(429).json({ error: 'rate limit exceeded, please try again later' });
      return;
    }

    timestamps.push(now);
    buckets.set(tokenId, timestamps);
    next();
  };
}
