import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { DatabaseManager } from '../../src/store/database.js';
import { IntentQueries } from '../../src/store/queries/intent.js';

describe('IntentQueries.getFiltered (cached statements)', () => {
  const testDbPath = './test-intent-filtered.db';
  let dbManager: DatabaseManager;
  let queries: IntentQueries;

  beforeEach(() => {
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    dbManager = new DatabaseManager(testDbPath);
    queries = new IntentQueries(dbManager);

    queries.insert({
      id: 'old-active',
      created_at: 1000,
      file_path: 'src/a.ts',
      prompt: 'old',
      generated: 'a',
      ai_tool: 'test',
      language: 'typescript',
      status: 'active',
      parent_intent_id: null,
      replacement_reason: '',
    });
    queries.insert({
      id: 'new-active',
      created_at: 2000,
      file_path: 'src/a.ts',
      prompt: 'new',
      generated: 'b',
      ai_tool: 'test',
      language: 'typescript',
      status: 'active',
      parent_intent_id: null,
      replacement_reason: '',
    });
    queries.insert({
      id: 'new-deprecated',
      created_at: 3000,
      file_path: 'src/b.ts',
      prompt: 'dep',
      generated: 'c',
      ai_tool: 'test',
      language: 'typescript',
      status: 'deprecated',
      parent_intent_id: null,
      replacement_reason: '',
    });
  });

  afterEach(() => {
    dbManager.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
  });

  it('filters by file_path and since together', () => {
    const rows = queries.getFiltered({
      file_path: 'src/a.ts',
      since: 1500,
      limit: 10,
    });
    expect(rows.map(r => r.id)).toEqual(['new-active']);
  });

  it('filters by status', () => {
    const rows = queries.getFiltered({ status: 'deprecated', limit: 5 });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('new-deprecated');
  });

  it('returns newest first with default limit', () => {
    const rows = queries.getFiltered({ limit: 2 });
    expect(rows.map(r => r.id)).toEqual(['new-deprecated', 'new-active']);
  });
});
