import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { Request, Response } from 'express';

import { trackActivity, getInFlightCount, getBusyReason } from './activity.js';

const { getStatus } = vi.hoisted(() => ({ getStatus: vi.fn(() => ({ state: 'idle' })) }));
vi.mock('../indexer/index.js', () => ({ getStatus }));

function start(): EventEmitter {
  const res = new EventEmitter();
  trackActivity({} as Request, res as unknown as Response, () => {});
  return res;
}

describe('activity tracking', () => {
  beforeEach(() => {
    getStatus.mockReturnValue({ state: 'idle' });
  });

  it('is idle with no requests', () => {
    expect(getInFlightCount()).toBe(0);
    expect(getBusyReason()).toBeNull();
  });

  it('counts a request until the response finishes', () => {
    const res = start();
    expect(getInFlightCount()).toBe(1);
    expect(getBusyReason()).toBe('requests');
    res.emit('finish');
    expect(getInFlightCount()).toBe(0);
    expect(getBusyReason()).toBeNull();
  });

  it('releases on close and never double-counts finish + close', () => {
    const a = start();
    const b = start();
    expect(getInFlightCount()).toBe(2);
    a.emit('finish');
    a.emit('close');
    expect(getInFlightCount()).toBe(1);
    b.emit('close');
    expect(getInFlightCount()).toBe(0);
  });

  it('reports indexing before requests', () => {
    getStatus.mockReturnValue({ state: 'indexing' });
    const res = start();
    expect(getBusyReason()).toBe('indexing');
    res.emit('finish');
    expect(getBusyReason()).toBe('indexing');
  });
});
