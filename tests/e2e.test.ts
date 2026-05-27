import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../src/store/database.js';
import { IntentQueries } from '../src/store/queries/intent.js';
import { RuntimeQueries } from '../src/store/queries/runtime.js';
import { RuntimeObserver } from '../src/engines/runtime/observer.js';
import { RepairAssembler } from '../src/engines/repair/assembler.js';
import { RepairProvenance } from '../src/engines/repair/provenance.js';
import { RecordRuntimeTool } from '../src/mcp/tools/record_runtime.js';
import { LogFailureTool } from '../src/mcp/tools/log_failure.js';
import { RecordRuntimeInput, LogFailureInput } from '../src/types/index.js';
import fs from 'fs';

/**
 * End-to-End Pipeline Tests.
 * Follows Rule 09: Every feature must have a test in /tests.
 */
describe('End-to-End Pipeline', () => {
  const DB_PATH = './test-e2e.db';
  let dbManager: DatabaseManager;
  let intentQueries: IntentQueries;
  let runtimeQueries: RuntimeQueries;
  let observer: RuntimeObserver;
  let assembler: RepairAssembler;
  let recordTool: RecordRuntimeTool;
  let logFailureTool: LogFailureTool;

  beforeEach(() => {
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    dbManager = new DatabaseManager(DB_PATH);
    
    intentQueries = new IntentQueries(dbManager);
    runtimeQueries = new RuntimeQueries(dbManager);
    assembler = new RepairAssembler(intentQueries, runtimeQueries, new RepairProvenance(dbManager));
    recordTool = new RecordRuntimeTool(intentQueries, runtimeQueries);
    logFailureTool = new LogFailureTool(intentQueries, runtimeQueries);

    observer = new RuntimeObserver(
      'test-memory-id',
      async (data) => {
        const result = await recordTool.execute(data as RecordRuntimeInput);
        return { snapshot_id: result.snapshot_id };
      },
      async (data) => { await logFailureTool.execute(data as LogFailureInput); },
      'test.ts'
    );
  });

  afterEach(() => {
    dbManager.close();
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  });

  it('should capture failure and generate a repair brief', async () => {
    // 1. Seed an intent record
    intentQueries.insert({
      id: 'test-memory-id',
      created_at: Date.now(),
      file_path: 'test.ts',
      prompt: 'Write a divider function',
      generated: 'function divide(a, b) { if (b === 0) throw new Error("Division by zero"); return a / b; }',
      ai_tool: 'test-tool',
      language: 'typescript',
      status: 'active',
      parent_intent_id: null,
      replacement_reason: '',
    });

    // 2. Define and wrap the function
    const divide = (a: number, b: number) => {
      if (b === 0) throw new Error("Division by zero");
      return a / b;
    };
    const observedDivide = observer.observe(divide, 'divide');

    // 3. Call with bad input and catch error
    try {
      await observedDivide(10, 0);
    } catch (e) {
      // Expected error
    }

    // 4. Wait for fire-and-forget recording
    await new Promise(resolve => setTimeout(resolve, 100));

    // 5. Verify runtime snapshot and failure records exist
    const snapshots = runtimeQueries.getSnapshotsByIntentId('test-memory-id');
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots[0].file_path).toBe('test.ts');

    const failures = runtimeQueries.getFailuresByIntentId('test-memory-id');
    expect(failures.length).toBe(1);
    expect(failures[0].error_message).toBe('Division by zero');
    expect(failures[0].snapshot_id).toBe(snapshots.find(s => s.success === 0)?.id);

    // 6. Call repair brief assembler
    const brief = await assembler.assemble(failures[0].id);

    // 7. Verify brief contents
    expect(brief.original_intent).toBe('Write a divider function');
    expect(brief.failure_details.error_message).toBe('Division by zero');
    expect(brief.repair_context).toContain('Division by zero');
    expect(brief.repair_context).toContain('divide');
  });
});
