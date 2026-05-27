import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../src/store/database.js';
import { FailureQueries } from '../../src/store/queries/failure.js';
import { existsSync, unlinkSync } from 'fs';

describe('FailureQueries', () => {
  const testDbPath = './test-failure-queries.db';
  let dbManager: DatabaseManager;
  let queries: FailureQueries;

  beforeEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    dbManager = new DatabaseManager(testDbPath);
    queries = new FailureQueries(dbManager);
  });

  afterEach(() => {
    dbManager.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('should insert and retrieve a failure record', () => {
    const db = dbManager.getDb();
    // Seed referenced records
    db.prepare('INSERT INTO intent_records (id, created_at, file_path, prompt, generated, ai_tool, language) VALUES (?, ?, ?, ?, ?, ?, ?)').run('intent-1', Date.now(), 'file.ts', 'prompt', 'code', 'claude', 'ts');
    db.prepare('INSERT INTO runtime_snapshots (id, intent_id, recorded_at, function_name, file_path, success) VALUES (?, ?, ?, ?, ?, ?)').run('snap-1', 'intent-1', Date.now(), 'fn', 'file.ts', 1);

    const failure = {
      id: 'fail-1',
      intent_id: 'intent-1',
      snapshot_id: 'snap-1',
      failed_at: Date.now(),
      error_type: 'TypeError',
      error_message: 'Cannot read property of undefined',
      stack_trace: 'stack...',
      call_chain: JSON.stringify(['main', 'fail']),
      repair_status: 'unresolved' as const
    };

    queries.insert(failure);

    const retrieved = queries.getById('fail-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.error_type).toBe('TypeError');
  });

  it('should update repair status', () => {
    const db = dbManager.getDb();
    // Seed referenced records
    db.prepare('INSERT INTO intent_records (id, created_at, file_path, prompt, generated, ai_tool, language) VALUES (?, ?, ?, ?, ?, ?, ?)').run('intent-1', Date.now(), 'file.ts', 'prompt', 'code', 'claude', 'ts');
    db.prepare('INSERT INTO runtime_snapshots (id, intent_id, recorded_at, function_name, file_path, success) VALUES (?, ?, ?, ?, ?, ?)').run('snap-1', 'intent-1', Date.now(), 'fn', 'file.ts', 1);

    queries.insert({
      id: 'fail-2',
      intent_id: 'intent-1',
      snapshot_id: 'snap-1',
      failed_at: Date.now(),
      error_type: 'Error',
      error_message: 'Msg',
      stack_trace: '',
      call_chain: '[]',
      repair_status: 'unresolved'
    });

    queries.updateStatus('fail-2', 'resolved');
    const retrieved = queries.getById('fail-2');
    expect(retrieved?.repair_status).toBe('resolved');
  });
});
