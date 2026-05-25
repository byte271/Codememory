import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../src/store/database.js';
import { IntentQueries } from '../../src/store/queries/intent.js';
import { RuntimeQueries } from '../../src/store/queries/runtime.js';
import { RepairAssembler } from '../../src/engines/repair/assembler.js';
import { existsSync, unlinkSync } from 'fs';

describe('RepairAssembler', () => {
  const testDbPath = './test-repair.db';
  let dbManager: DatabaseManager;
  let intentQueries: IntentQueries;
  let runtimeQueries: RuntimeQueries;
  let assembler: RepairAssembler;

  beforeEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    dbManager = new DatabaseManager(testDbPath);
    intentQueries = new IntentQueries(dbManager);
    runtimeQueries = new RuntimeQueries(dbManager);
    assembler = new RepairAssembler(intentQueries, runtimeQueries);
  });

  afterEach(() => {
    dbManager.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('should assemble a complete repair brief', async () => {
    // 1. Setup intent
    const intent = {
      id: 'intent-1',
      created_at: Date.now(),
      file_path: 'test.ts',
      prompt: 'Write a division function',
      generated: 'function div(a, b) { return a / b; }',
      ai_tool: 'claude_code',
      language: 'typescript',
      status: 'active' as const
    };
    intentQueries.insert(intent);

    // 2. Setup snapshots
    runtimeQueries.insertSnapshot({
      id: 'snap-1',
      intent_id: 'intent-1',
      recorded_at: Date.now(),
      function_name: 'div',
      file_path: 'test.ts',
      arguments: JSON.stringify([10, 2]),
      return_value: '5',
      duration_ms: 1,
      success: 1
    });

    runtimeQueries.insertSnapshot({
      id: 'snap-2',
      intent_id: 'intent-1',
      recorded_at: Date.now() + 1,
      function_name: 'div',
      file_path: 'test.ts',
      arguments: JSON.stringify([10, 0]),
      return_value: null,
      duration_ms: 1,
      success: 0
    });

    // 3. Setup failure
    const failureId = 'fail-1';
    runtimeQueries.insertFailure({
      id: failureId,
      intent_id: 'intent-1',
      snapshot_id: 'snap-2',
      failed_at: Date.now() + 2,
      error_type: 'TypeError',
      error_message: 'Cannot divide by zero',
      stack_trace: 'Error at div (test.ts:1:20)',
      call_chain: JSON.stringify(['div']),
      repair_status: 'unresolved'
    });

    const brief = await assembler.assemble(failureId);

    expect(brief.original_intent).toBe(intent.prompt);
    expect(brief.repair_context).toContain('REPAIR BRIEF');
    expect(brief.repair_context).toContain('Cannot divide by zero');
    expect(brief.repair_context).toContain('Execution History');
    expect(brief.repair_context).toContain('Call Chain');
    expect(brief.repair_context).toContain('div');
  });

  it('prefers unresolved failures when assembling by memory_id', async () => {
    intentQueries.insert({
      id: 'intent-2',
      created_at: Date.now(),
      file_path: 'test.ts',
      prompt: 'Fix divide',
      generated: 'function div() {}',
      ai_tool: 'test',
      language: 'typescript',
      status: 'active',
    });

    runtimeQueries.insertFailure({
      id: 'fail-resolved',
      intent_id: 'intent-2',
      snapshot_id: null,
      failed_at: Date.now() + 1000,
      error_type: 'Error',
      error_message: 'resolved case',
      stack_trace: 'stack',
      call_chain: '[]',
      repair_status: 'resolved',
    });

    runtimeQueries.insertFailure({
      id: 'fail-open',
      intent_id: 'intent-2',
      snapshot_id: null,
      failed_at: Date.now(),
      error_type: 'Error',
      error_message: 'open case',
      stack_trace: 'stack',
      call_chain: '[]',
      repair_status: 'unresolved',
    });

    const brief = await assembler.assemble_by_memory_id('intent-2');
    expect(brief.failure_details?.id).toBe('fail-open');
    expect(brief.failure_details?.error_message).toBe('open case');
  });

  it('returns a low-confidence brief with null failure_details when no failures exist', async () => {
    intentQueries.insert({
      id: 'intent-only',
      created_at: Date.now(),
      file_path: 'solo.ts',
      prompt: 'Write a helper that formats dates',
      generated: 'function fmt() {}',
      ai_tool: 'test',
      language: 'typescript',
      status: 'active',
    });

    const brief = await assembler.assemble_by_memory_id('intent-only');
    expect(brief.failure_details).toBeNull();
    expect(brief.confidence).toBe('low');
    expect(brief.repair_context).toContain('No failures recorded');
  });
});
