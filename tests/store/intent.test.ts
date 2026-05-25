import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../src/store/database.js';
import { IntentQueries } from '../../src/store/queries/intent.js';
import { IntentRecord } from '../../src/types/index.js';
import { existsSync, unlinkSync } from 'fs';

describe('IntentQueries', () => {
  const testDbPath = './test-codememory.db';
  let dbManager: DatabaseManager;
  let queries: IntentQueries;

  beforeEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    dbManager = new DatabaseManager(testDbPath);
    queries = new IntentQueries(dbManager);
  });

  afterEach(() => {
    dbManager.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('should insert and retrieve an intent record', () => {
    const record: IntentRecord = {
      id: 'test-id',
      created_at: Date.now(),
      file_path: '/path/to/file.ts',
      prompt: 'Write a test function',
      generated: 'function test() {}',
      ai_tool: 'claude_code',
      language: 'typescript',
      status: 'active'
    };

    queries.insert(record);
    const retrieved = queries.getById('test-id');

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(record.id);
    expect(retrieved?.prompt).toBe(record.prompt);
  });

  it('should retrieve records by file path', () => {
    const record1: IntentRecord = {
      id: 'id-1',
      created_at: Date.now(),
      file_path: '/path/to/file.ts',
      prompt: 'Prompt 1',
      generated: 'Code 1',
      ai_tool: 'claude_code',
      language: 'typescript',
      status: 'active'
    };

    const record2: IntentRecord = {
      id: 'id-2',
      created_at: Date.now() + 1000,
      file_path: '/path/to/file.ts',
      prompt: 'Prompt 2',
      generated: 'Code 2',
      ai_tool: 'claude_code',
      language: 'typescript',
      status: 'active'
    };

    queries.insert(record1);
    queries.insert(record2);

    const records = queries.getByFilePath('/path/to/file.ts');
    expect(records.length).toBe(2);
    expect(records[0].id).toBe('id-2'); // Ordered by created_at DESC
  });
});
