import path from 'path';
import express, { Express } from 'express';
import { publicAuth } from './middleware/publicAuth.js';
import publicChatRouter from './routes/publicChat.js';
import publicFileRouter from './routes/publicFile.js';

// Separate Express app for the public read-only workspace chat (§11, D23).
// Deliberately has no Host-header/DNS-rebinding guard (D24): unlike the admin
// app, this one is meant to be reached from arbitrary hostnames. Every route
// is gated by publicAuth instead.
export function createPublicApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(publicAuth);

  app.use('/api', publicChatRouter);
  app.use('/api', publicFileRouter);

  // Minimal chat-only frontend (D31), separate from the admin public/ UI.
  app.use(express.static(path.join(__dirname, '..', 'public-chat')));

  return app;
}
