import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { initDb, createChatSession, appendChatMessage, getChatMessages } from './sqlite.js';

let dir: string;

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('chat_messages.filter_tags', () => {
  it('stores the applied tags as JSON, or NULL when none', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkrag-chat-'));
    initDb(path.join(dir, 't.db'));
    createChatSession('s1', null, 'title');
    appendChatMessage('s1', 'user', 'q1', null, { include: ['a', '設計'], exclude: ['obsolete'] });
    appendChatMessage('s1', 'user', 'q2', null);
    const msgs = getChatMessages('s1');
    expect(JSON.parse(msgs[0].filter_tags!)).toEqual(['a', '設計']);
    expect(JSON.parse(msgs[0].filter_exclude_tags!)).toEqual(['obsolete']);
    expect(msgs[1].filter_tags).toBeNull();
    expect(msgs[1].filter_exclude_tags).toBeNull();
  });

  it('are added to a pre-existing chat_messages table without them', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkrag-chat-'));
    const file = path.join(dir, 'old.db');
    const old = new Database(file);
    old.exec(`
      CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, workspace_id INTEGER, title TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL, content TEXT NOT NULL, citations TEXT, created_at INTEGER NOT NULL);
      INSERT INTO chat_sessions VALUES ('s', NULL, 't', 1, 1);
      INSERT INTO chat_messages (session_id, role, content, created_at) VALUES ('s', 'user', 'old', 1);
    `);
    old.close();

    initDb(file);
    appendChatMessage('s', 'user', 'new', null, { include: ['x'], exclude: ['y'] });
    const msgs = getChatMessages('s');
    expect(msgs[0].filter_tags).toBeNull();
    expect(msgs[0].filter_exclude_tags).toBeNull();
    expect(JSON.parse(msgs[1].filter_tags!)).toEqual(['x']);
    expect(JSON.parse(msgs[1].filter_exclude_tags!)).toEqual(['y']);
  });
});
