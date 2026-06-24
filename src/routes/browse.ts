import fs from 'fs';
import os from 'os';
import path from 'path';
import { Router } from 'express';

const router = Router();
const HOME = os.homedir();

function safePath(raw: string): string | null {
  const expanded = raw.startsWith('~') ? HOME + raw.slice(1) : raw;
  const resolved = path.resolve(expanded);
  if (resolved !== HOME && !resolved.startsWith(HOME + path.sep)) return null;
  return resolved;
}

router.get('/', (req, res) => {
  const rawPath = (req.query.path as string) || HOME;
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
  const parent = dir === HOME ? null : (safePath(parentRaw) ?? null);

  res.json({ current: dir, parent, dirs });
});

export default router;
