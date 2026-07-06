import { Router } from 'express';
import path from 'path';
import { execFile } from 'child_process';
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

  // execFile never spawns a shell, so `normalized` is passed to the OS as a
  // single literal argument regardless of characters like $(), `, &, | it
  // may contain (CWE-78: the previous exec()-based version interpolated it
  // into a shell command string, which bash/cmd would re-parse).
  const platform = process.platform;
  let file: string;
  let args: string[];
  if (platform === 'win32') {
    // rundll32's FileProtocolHandler resolves the file association the same
    // way `cmd /c start` did, without routing the path through cmd.exe's own
    // command-line grammar (&, |, etc.).
    file = 'rundll32';
    args = ['url.dll,FileProtocolHandler', normalized];
  } else if (platform === 'darwin') {
    file = 'open';
    args = [normalized];
  } else {
    file = 'xdg-open';
    args = [normalized];
  }

  execFile(file, args, (err) => {
    if (err) {
      res.status(500).json({ error: `Failed to open file: ${err.message}` });
      return;
    }
    res.json({ opened: normalized });
  });
});

export default router;
