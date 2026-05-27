import { CaptureIntentTool } from '../../src/mcp/tools/capture_intent.js';
import { IntentQueries } from '../../src/store/queries/intent.js';
import { DatabaseManager } from '../../src/store/database.js';

/**
 * Example: Capturing AI intent.
 */
async function example() {
  const dbManager = new DatabaseManager('./example.db');
  const queries = new IntentQueries(dbManager);
  const tool = new CaptureIntentTool(queries);

  const result = await tool.execute({
    prompt: 'Create a function to calculate Fibonacci numbers',
    generated_code: 'function fib(n) { return n <= 1 ? n : fib(n-1) + fib(n-2); }',
    file_path: 'math.ts',
    ai_tool: 'claude_code',
    language: 'typescript'
  });

  console.log('Captured Intent:', result);
  dbManager.close();
}

example();
