import { Router } from 'express';
import path from 'path';
import { exec } from 'child_process';
import { getActiveWorkspace } from '../db/sqlite.js';

const router = Router();

router.get('/', (req, res) => {
  const rawPath = req.query.path;
  if (typeof rawPath !== 'string' || !rawPath) {
    res.status(400).json({ error: 'path query parameter is required' });
    return;
  }

  const ws = getActiveWorkspace();
  if (!ws) {
    res.status(400).json({ error: 'No active workspace' });
    return;
  }

  // Resolve the file path: treat as absolute or relative to workspace root
  const resolved = path.isAbsolute(rawPath) ? rawPath : path.join(ws.path, rawPath);
  const normalized = path.normalize(resolved);

  // Security: must stay within the active workspace directory
  const wsNorm = path.normalize(ws.path);
  if (!normalized.startsWith(wsNorm + path.sep) && normalized !== wsNorm) {
    res.status(403).json({ error: 'Path is outside the active workspace' });
    return;
  }

  const platform = process.platform;
  let cmd: string;
  if (platform === 'win32') {
    // Use cmd /c start to open with associated app
    cmd = `cmd /c start "" "${normalized.replace(/"/g, '\\"')}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${normalized.replace(/"/g, '\\"')}"`;
  } else {
    cmd = `xdg-open "${normalized.replace(/"/g, '\\"')}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      res.status(500).json({ error: `Failed to open file: ${err.message}` });
      return;
    }
    res.json({ opened: normalized });
  });
});

export default router;
