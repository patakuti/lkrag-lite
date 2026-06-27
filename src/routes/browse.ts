import fs from 'fs';
import os from 'os';
import path from 'path';
import { Router } from 'express';

const router = Router();

// Evaluated per-request so that BROWSE_ROOT is read after dotenv.config() runs.
// path.resolve normalises slash direction on Windows (C:/foo → C:\foo).
function getBrowseRoot(): string {
  return process.env.BROWSE_ROOT
    ? path.resolve(process.env.BROWSE_ROOT)
    : os.homedir();
}

function safePath(raw: string): string | null {
  const root = getBrowseRoot();
  const expanded = raw.startsWith('~') ? root + raw.slice(1) : raw;
  const resolved = path.resolve(expanded);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

router.get('/', (req, res) => {
  const root = getBrowseRoot();
  const rawPath = (req.query.path as string) || root;
  const dir = safePath(rawPath);
  if (!dir) {
    res.status(403).json({ error: 'access denied' });
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    res.status(404).json({ error: 'directory not found' });
    return;
  }

  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();

  const parentRaw = path.dirname(dir);
  const parent = dir === root ? null : (safePath(parentRaw) ?? null);

  res.json({ current: dir, parent, dirs });
});

export default router;
