import path from 'path';
import express, { Express } from 'express';
import { publicAuth } from './middleware/publicAuth.js';
import { trackActivity } from './middleware/activity.js';
import publicChatRouter from './routes/publicChat.js';
import publicFileRouter from './routes/publicFile.js';
import publicTagsRouter from './routes/publicTags.js';

// Separate Express app for the public read-only workspace chat (§11, D23).
// Deliberately has no Host-header/DNS-rebinding guard (D24): unlike the admin
// app, this one is meant to be reached from arbitrary hostnames. Every route
// is gated by publicAuth instead.
export function createPublicApp(): Express {
  const app = express();
  // Count in-flight requests so a new server won't replace us mid-chat (§13).
  app.use(trackActivity);
  app.use(express.json());
  app.use(publicAuth);

  app.use('/api', publicChatRouter);
  app.use('/api', publicFileRouter);
  app.use('/api/tags', publicTagsRouter);

  // Minimal chat-only frontend (D31), separate from the admin public/ UI.
  app.use(express.static(path.join(__dirname, '..', 'public-chat')));

  return app;
}
