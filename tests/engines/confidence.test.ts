import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../src/store/database.js';
import { IntentQueries } from '../../src/store/queries/intent.js';
import { RuntimeQueries } from '../../src/store/queries/runtime.js';
import { RepairAssembler } from '../../src/engines/repair/assembler.js';
import { existsSync, unlinkSync } from 'fs';

describe('RepairAssembler.calculateConfidence', () => {
  const testDbPath = './test-confidence.db';
  let dbManager: DatabaseManager;
  let intentQueries: IntentQueries;
  let runtimeQueries: RuntimeQueries;
  let assembler: RepairAssembler;

  beforeEach(() => {
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    dbManager = new DatabaseManager(testDbPath);
    intentQueries = new IntentQueries(dbManager);
    runtimeQueries = new RuntimeQueries(dbManager);
    assembler = new RepairAssembler(intentQueries, runtimeQueries);
  });

  afterEach(() => {
    dbManager.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
  });

  /**
   * Helper to seed an intent + failure (+ optional snapshots) and assemble a brief.
   */
  async function seedAndAssemble(opts: {
    prompt: string;
    stack_trace: string | null;
    call_chain: string | null;
    snapshotCount: number;
  }) {
    const intentId = `intent-${Math.random()}`;
    intentQueries.insert({
      id: intentId,
      created_at: Date.now(),
      file_path: 'test.ts',
      prompt: opts.prompt,
      generated: 'function f() {}',
      ai_tool: 'claude',
      language: 'typescript',
      status: 'active',
    });

    for (let i = 0; i < opts.snapshotCount; i++) {
      runtimeQueries.insertSnapshot({
        id: `snap-${intentId}-${i}`,
        intent_id: intentId,
        recorded_at: Date.now() + i,
        function_name: 'f',
        file_path: 'test.ts',
        arguments: '[]',
        return_value: null,
        duration_ms: 1,
        success: 1,
      });
    }

    const failureId = `fail-${intentId}`;
    runtimeQueries.insertFailure({
      id: failureId,
      intent_id: intentId,
      snapshot_id: null,
      failed_at: Date.now() + 100,
      error_type: 'Error',
      error_message: 'boom',
      stack_trace: opts.stack_trace,
      call_chain: opts.call_chain,
      repair_status: 'unresolved',
    });

    return assembler.assemble(failureId);
  }

  it('returns "high" when prompt + stack trace + snapshots + call chain are all present', async () => {
    const brief = await seedAndAssemble({
      prompt: 'Write a function that divides two numbers',
      stack_trace: 'Error: boom\n  at f (test.ts:1)',
      call_chain: JSON.stringify(['f']),
      snapshotCount: 1,
    });
    expect(brief.confidence).toBe('high');
  });

  it('returns "medium" with prompt + stack trace but no snapshots', async () => {
    const brief = await seedAndAssemble({
      prompt: 'Write a function that divides two numbers',
      stack_trace: 'Error: boom\n  at f (test.ts:1)',
      call_chain: '[]',
      snapshotCount: 0,
    });
    expect(brief.confidence).toBe('medium');
  });

  it('returns "low" when critical information is missing', async () => {
    const brief = await seedAndAssemble({
      prompt: 'too short',
      stack_trace: null,
      call_chain: null,
      snapshotCount: 0,
    });
    expect(brief.confidence).toBe('low');
  });
});
