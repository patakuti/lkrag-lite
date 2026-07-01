import express, { Express } from 'express';
import { publicAuth } from './middleware/publicAuth.js';

// Separate Express app for the public read-only workspace chat (§11, D23).
// Deliberately has no Host-header/DNS-rebinding guard (D24): unlike the admin
// app, this one is meant to be reached from arbitrary hostnames. Every route
// is gated by publicAuth instead.
export function createPublicApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(publicAuth);

  // Temporary connectivity-check route for Phase 10. Replaced by the real
  // chat/file routes in Phase 11.
  app.get('/api/ping', (req, res) => {
    res.json({ ok: true, workspace: req.publicAuth });
  });

  return app;
}
