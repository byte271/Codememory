import { DatabaseManager } from '../../src/store/database.js';
import { IntentQueries } from '../../src/store/queries/intent.js';
import { RuntimeQueries } from '../../src/store/queries/runtime.js';
import { RepairAssembler } from '../../src/engines/repair/assembler.js';
import { GetRepairBriefTool } from '../../src/mcp/tools/get_repair_brief.js';

/**
 * Example: Generating a Repair Brief
 * This script demonstrates how Codememory assembles context for AI to fix a bug.
 */
async function example() {
  const dbManager = new DatabaseManager('./repair-example.db');
  const db = dbManager.getDb();
  
  const intentQueries = new IntentQueries(db);
  const runtimeQueries = new RuntimeQueries(db);
  const assembler = new RepairAssembler(intentQueries, runtimeQueries);
  const tool = new GetRepairBriefTool(assembler);

  // 1. Setup mock data
  const memoryId = 'mem-123';
  db.prepare('INSERT INTO intent_records (id, created_at, file_path, prompt, generated, ai_tool, language) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    memoryId, Date.now(), 'api.ts', 'Fetch user data', 'function fetchUser(id) { return {id}; }', 'claude', 'ts'
  );
  
  db.prepare('INSERT INTO runtime_snapshots (id, intent_id, recorded_at, function_name, file_path, success) VALUES (?, ?, ?, ?, ?, ?)').run(
    'snap-1', memoryId, Date.now(), 'fetchUser', 'api.ts', 1
  );

  db.prepare('INSERT INTO failures (id, intent_id, snapshot_id, failed_at, error_type, error_message, repair_status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'fail-1', memoryId, 'snap-1', Date.now(), 'NetworkError', 'Failed to fetch', 'unresolved'
  );

  // 2. Get the brief
  const brief = await tool.execute({ failure_id: 'fail-1' });
  
  console.log('--- REPAIR BRIEF FOR AI ---');
  console.log(brief.repair_context);
  
  dbManager.close();
}

example().catch(console.error);
