import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../src/store/database.js';
import { IntentQueries } from '../../src/store/queries/intent.js';
import { QueryMemoryTool } from '../../src/mcp/tools/query_memory.js';
import { existsSync, unlinkSync } from 'fs';

describe('QueryMemoryTool', () => {
  const testDbPath = './test-query.db';
  let dbManager: DatabaseManager;
  let queries: IntentQueries;
  let tool: QueryMemoryTool;

  beforeEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    dbManager = new DatabaseManager(testDbPath);
    queries = new IntentQueries(dbManager);
    tool = new QueryMemoryTool(queries);
  });

  afterEach(() => {
    dbManager.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('should query memory records with limit', async () => {
    // Seed data
    for (let i = 0; i < 5; i++) {
      queries.insert({
        id: `id-${i}`,
        created_at: Date.now() + i,
        file_path: 'test.ts',
        prompt: `prompt ${i}`,
        generated: `code ${i}`,
        ai_tool: 'claude',
        language: 'typescript',
        status: 'active'
      });
    }

    const result = await tool.execute({ limit: 2 });
    expect(result.records).toHaveLength(2);
    expect(result.total).toBe(5);
  });

  it('should filter by file_path', async () => {
    queries.insert({
      id: 'id-1',
      created_at: Date.now(),
      file_path: 'file1.ts',
      prompt: 'prompt 1',
      generated: 'code 1',
      ai_tool: 'claude',
      language: 'typescript',
      status: 'active'
    });

    queries.insert({
      id: 'id-2',
      created_at: Date.now(),
      file_path: 'file2.ts',
      prompt: 'prompt 2',
      generated: 'code 2',
      ai_tool: 'claude',
      language: 'typescript',
      status: 'active'
    });

    const result = await tool.execute({ file_path: 'file1.ts' });
    expect(result.records).toHaveLength(1);
    expect(result.records[0].file_path).toBe('file1.ts');
  });
});
