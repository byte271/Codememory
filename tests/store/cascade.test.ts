import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { DatabaseManager } from '../../src/store/database.js';
import { IntentQueries } from '../../src/store/queries/intent.js';
import { RuntimeQueries } from '../../src/store/queries/runtime.js';

describe('Migration v2 CASCADE deletes', () => {
  const testDbPath = './test-cascade.db';
  let dbManager: DatabaseManager;
  let intentQueries: IntentQueries;
  let runtimeQueries: RuntimeQueries;

  beforeEach(() => {
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    dbManager = new DatabaseManager(testDbPath);
    intentQueries = new IntentQueries(dbManager);
    runtimeQueries = new RuntimeQueries(dbManager);
  });

  afterEach(() => {
    dbManager.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
  });

  it('deletes snapshots and failures when intent is removed', () => {
    intentQueries.insert({
      id: 'intent-cascade',
      created_at: Date.now(),
      file_path: 'c.ts',
      prompt: 'test cascade',
      generated: 'code',
      ai_tool: 'test',
      language: 'typescript',
      status: 'active',
      parent_intent_id: null,
      replacement_reason: '',
    });

    runtimeQueries.insertSnapshot({
      id: 'snap-cascade',
      intent_id: 'intent-cascade',
      recorded_at: Date.now(),
      function_name: 'fn',
      file_path: 'c.ts',
      arguments: '[]',
      return_value: null,
      duration_ms: 1,
      success: 0,
    });

    runtimeQueries.insertFailure({
      id: 'fail-cascade',
      intent_id: 'intent-cascade',
      snapshot_id: 'snap-cascade',
      failed_at: Date.now(),
      error_type: 'Error',
      error_message: 'boom',
      stack_trace: '',
      call_chain: '[]',
      repair_status: 'unresolved',
    });

    runtimeQueries.deleteIntentCascade('intent-cascade');

    expect(intentQueries.getById('intent-cascade')).toBeUndefined();
    expect(runtimeQueries.getSnapshotById('snap-cascade')).toBeUndefined();
    expect(runtimeQueries.getFailureById('fail-cascade')).toBeUndefined();
  });
});
