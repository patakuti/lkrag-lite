import { createTagReadRouter } from './tags.js';
import { getDefaultTagFilter } from '../config/tagDefaults.js';

// Read-only tag API for the public chat (D49). Deliberately exposes no manual
// tag writes; the workspace comes from the token, never from the request, and
// only tags/counts of files that pass the enforced default condition are
// reported, so hidden documents' tag names do not leak (D53).
export default createTagReadRouter((req) => req.publicAuth!.workspaceId, () => getDefaultTagFilter());
