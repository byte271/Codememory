import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../src/store/database.js';
import { IntentQueries } from '../../src/store/queries/intent.js';
import { QueryMemoryTool } from '../../src/mcp/tools/query_memory.js';
import { existsSync, unlinkSync } from 'fs';

describe('QueryMemoryTool filters', () => {
  const testDbPath = './test-query-filters.db';
  let dbManager: DatabaseManager;
  let queries: IntentQueries;
  let tool: QueryMemoryTool;

  beforeEach(() => {
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    dbManager = new DatabaseManager(testDbPath);
    queries = new IntentQueries(dbManager);
    tool = new QueryMemoryTool(queries);
  });

  afterEach(() => {
    dbManager.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
  });

  it('filters by since (epoch ms)', async () => {
    const t0 = 1_000_000;
    queries.insert({ id: 'old', created_at: t0, file_path: 'a.ts', prompt: 'p', generated: 'g', ai_tool: 'c', language: 'ts', status: 'active' });
    queries.insert({ id: 'new', created_at: t0 + 1000, file_path: 'a.ts', prompt: 'p', generated: 'g', ai_tool: 'c', language: 'ts', status: 'active' });

    const result = await tool.execute({ since: t0 + 500 });
    expect(result.records).toHaveLength(1);
    expect(result.records[0].id).toBe('new');
  });

  it('filters by status', async () => {
    queries.insert({ id: 'a', created_at: 1, file_path: 'a.ts', prompt: 'p', generated: 'g', ai_tool: 'c', language: 'ts', status: 'active' });
    queries.insert({ id: 'b', created_at: 2, file_path: 'a.ts', prompt: 'p', generated: 'g', ai_tool: 'c', language: 'ts', status: 'deprecated' });
    queries.insert({ id: 'c', created_at: 3, file_path: 'a.ts', prompt: 'p', generated: 'g', ai_tool: 'c', language: 'ts', status: 'active' });

    const result = await tool.execute({ status: 'active' });
    expect(result.records).toHaveLength(2);
    expect(result.records.map((r) => r.id).sort()).toEqual(['a', 'c']);
  });
});
