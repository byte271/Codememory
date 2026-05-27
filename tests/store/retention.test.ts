import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { DatabaseManager } from '../../src/store/database.js';
import { IntentQueries } from '../../src/store/queries/intent.js';
import { RuntimeQueries } from '../../src/store/queries/runtime.js';

describe('Runtime snapshot retention', () => {
  const testDbPath = './test-retention.db';
  let dbManager: DatabaseManager;
  let intentQueries: IntentQueries;
  let runtimeQueries: RuntimeQueries;

  beforeEach(() => {
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    dbManager = new DatabaseManager(testDbPath);
    intentQueries = new IntentQueries(dbManager);
    runtimeQueries = new RuntimeQueries(dbManager);

    intentQueries.insert({
      id: 'intent-retain',
      created_at: Date.now(),
      file_path: 'r.ts',
      prompt: 'retention test',
      generated: 'code',
      ai_tool: 'test',
      language: 'typescript',
      status: 'active',
      parent_intent_id: null,
      replacement_reason: '',
    });
  });

  afterEach(() => {
    dbManager.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
  });

  it('pruneSnapshots keeps only the newest N rows', () => {
    const maxKeep = 3;
    for (let i = 0; i < 5; i++) {
      runtimeQueries.insertSnapshot({
        id: `snap-${i}`,
        intent_id: 'intent-retain',
        recorded_at: 1000 + i,
        function_name: 'fn',
        file_path: 'r.ts',
        arguments: '[]',
        return_value: null,
        duration_ms: 1,
        success: 1,
      });
    }

    const pruned = runtimeQueries.pruneSnapshots('intent-retain', maxKeep);
    expect(pruned).toBe(2);

    const remaining = runtimeQueries.getSnapshotsByIntentId('intent-retain');
    expect(remaining).toHaveLength(maxKeep);
    expect(remaining.map(s => s.id)).toEqual(['snap-2', 'snap-3', 'snap-4']);
  });

  it('pruneSnapshots returns 0 when under the limit', () => {
    runtimeQueries.insertSnapshot({
      id: 'snap-only',
      intent_id: 'intent-retain',
      recorded_at: Date.now(),
      function_name: 'fn',
      file_path: 'r.ts',
      arguments: '[]',
      return_value: null,
      duration_ms: 1,
      success: 1,
    });

    expect(runtimeQueries.pruneSnapshots('intent-retain', 10)).toBe(0);
  });
});
