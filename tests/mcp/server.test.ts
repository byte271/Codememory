import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../src/store/database.js';
import { IntentQueries } from '../../src/store/queries/intent.js';
import { CaptureIntentTool } from '../../src/mcp/tools/capture_intent.js';
import { existsSync, unlinkSync } from 'fs';

describe('CaptureIntentTool', () => {
  const testDbPath = './test-mcp.db';
  let dbManager: DatabaseManager;
  let queries: IntentQueries;
  let tool: CaptureIntentTool;

  beforeEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    dbManager = new DatabaseManager(testDbPath);
    queries = new IntentQueries(dbManager);
    tool = new CaptureIntentTool(queries);
  });

  afterEach(() => {
    dbManager.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('should capture intent and return memory_id', async () => {
    const input = {
      prompt: 'Write a hello world function',
      generated_code: 'function hello() { console.log("hello"); }',
      file_path: 'hello.ts',
      ai_tool: 'claude_code',
      language: 'typescript'
    };

    const result = await tool.execute(input);

    expect(result.status).toBe('captured');
    expect(result.memory_id).toBeDefined();

    const record = queries.getById(result.memory_id);
    expect(record).toBeDefined();
    expect(record?.prompt).toBe(input.prompt);
    expect(record?.generated).toContain(input.generated_code);
    expect(record?.generated).toContain(`// memory_id: ${result.memory_id}`);
  });
});
