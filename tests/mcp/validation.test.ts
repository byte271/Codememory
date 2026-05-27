import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { DatabaseManager } from '../../src/store/database.js';
import { IntentQueries } from '../../src/store/queries/intent.js';
import { RuntimeQueries } from '../../src/store/queries/runtime.js';
import { RecordRuntimeTool } from '../../src/mcp/tools/record_runtime.js';
import { LogFailureTool } from '../../src/mcp/tools/log_failure.js';
import { CodememoryError, CODEMEMORY_ERROR_CODES } from '../../src/utils/errors.js';

describe('MCP tool validation', () => {
  const testDbPath = './test-validation.db';
  let dbManager: DatabaseManager;
  let intentQueries: IntentQueries;
  let runtimeQueries: RuntimeQueries;
  let recordTool: RecordRuntimeTool;
  let logFailureTool: LogFailureTool;

  beforeEach(() => {
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    dbManager = new DatabaseManager(testDbPath);
    intentQueries = new IntentQueries(dbManager);
    runtimeQueries = new RuntimeQueries(dbManager);
    recordTool = new RecordRuntimeTool(intentQueries, runtimeQueries);
    logFailureTool = new LogFailureTool(intentQueries, runtimeQueries);
  });

  afterEach(() => {
    dbManager.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
  });

  it('record_runtime rejects unknown memory_id', async () => {
    await expect(
      recordTool.execute({
        memory_id: 'missing-intent',
        function_name: 'fn',
        arguments: [],
        duration_ms: 1,
        success: true,
      })
    ).rejects.toMatchObject({
      code: CODEMEMORY_ERROR_CODES.INTENT_NOT_FOUND,
    } satisfies Partial<CodememoryError>);
  });

  it('log_failure rejects unknown memory_id', async () => {
    await expect(
      logFailureTool.execute({
        memory_id: 'missing-intent',
        error_type: 'Error',
        error_message: 'boom',
        stack_trace: '',
        call_chain: ['fn'],
      })
    ).rejects.toMatchObject({
      code: CODEMEMORY_ERROR_CODES.INTENT_NOT_FOUND,
    });
  });

  it('log_failure rejects snapshot_id from a different intent', async () => {
    intentQueries.insert({
      id: 'intent-a',
      created_at: Date.now(),
      file_path: 'a.ts',
      prompt: 'intent A',
      generated: 'code A',
      ai_tool: 'test',
      language: 'typescript',
      status: 'active',
      parent_intent_id: null,
      replacement_reason: '',
    });
    intentQueries.insert({
      id: 'intent-b',
      created_at: Date.now(),
      file_path: 'b.ts',
      prompt: 'intent B',
      generated: 'code B',
      ai_tool: 'test',
      language: 'typescript',
      status: 'active',
      parent_intent_id: null,
      replacement_reason: '',
    });

    const { snapshot_id } = await recordTool.execute({
      memory_id: 'intent-a',
      function_name: 'fn',
      arguments: [],
      duration_ms: 1,
      success: true,
    });

    await expect(
      logFailureTool.execute({
        memory_id: 'intent-b',
        snapshot_id,
        error_type: 'Error',
        error_message: 'boom',
        stack_trace: '',
        call_chain: ['fn'],
      })
    ).rejects.toMatchObject({
      code: CODEMEMORY_ERROR_CODES.SNAPSHOT_INTENT_MISMATCH,
    });
  });
});
