import { Request, Response, NextFunction } from 'express';
import { findPublicTokenByToken } from '../db/sqlite.js';

const COOKIE_NAME = 'pw_token';

declare module 'express-serve-static-core' {
  interface Request {
    publicAuth?: { tokenId: number; workspaceId: number; label: string };
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

/**
 * Resolves a public token from a `pw_token` cookie or a `?token=` query
 * parameter, hashes and looks it up (D25/D26), and attaches the resolved
 * workspace to `req.publicAuth`. On first access via `?token=`, sets the
 * cookie and redirects HTML page loads to strip the token from the URL bar.
 */
export function publicAuth(req: Request, res: Response, next: NextFunction): void {
  const cookies = parseCookies(req.headers.cookie);
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const token = cookies[COOKIE_NAME] ?? queryToken;

  if (!token) {
    res.status(401).json({ error: 'token is required' });
    return;
  }

  const record = findPublicTokenByToken(token);
  if (!record) {
    res.status(403).json({ error: 'invalid or revoked token' });
    return;
  }

  req.publicAuth = { tokenId: record.id, workspaceId: record.workspace_id, label: record.label };

  const isNewQueryToken = queryToken !== null && cookies[COOKIE_NAME] !== queryToken;
  if (isNewQueryToken) {
    res.cookie(COOKIE_NAME, queryToken as string, { httpOnly: true, sameSite: 'lax' });

    const wantsHtml = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html');
    if (wantsHtml) {
      const url = new URL(req.originalUrl, 'http://placeholder');
      url.searchParams.delete('token');
      res.redirect(url.pathname + url.search);
      return;
    }
  }

  next();
}
