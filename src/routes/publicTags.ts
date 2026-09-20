import { createTagReadRouter } from './tags.js';

// Read-only tag API for the public chat (D49). Deliberately exposes no manual
// tag writes; the workspace comes from the token, never from the request.
export default createTagReadRouter((req) => req.publicAuth!.workspaceId);
