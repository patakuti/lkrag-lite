import { Request, Response, NextFunction } from 'express';
import { getStatus } from '../indexer/index.js';

// Counts requests that are currently being handled, so that a newly started
// server can tell whether this process is idle enough to be replaced (§13).
// A request is counted from arrival until the response finishes or the
// connection closes, whichever comes first.
let inFlight = 0;

export function trackActivity(_req: Request, res: Response, next: NextFunction): void {
  inFlight++;
  let counted = true;
  const release = () => {
    if (counted) {
      counted = false;
      inFlight--;
    }
  };
  res.on('finish', release);
  res.on('close', release);
  next();
}

export function getInFlightCount(): number {
  return inFlight;
}

export type BusyReason = 'indexing' | 'requests';

/** Why this process must not be replaced right now, or null when it is idle. */
export function getBusyReason(): BusyReason | null {
  if (getStatus().state === 'indexing') return 'indexing';
  if (inFlight > 0) return 'requests';
  return null;
}
