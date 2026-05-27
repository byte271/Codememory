/**
 * End-to-End Integration Tests — Full MCP Tool Pipeline.
 *
 * Exercises all 7 Codememory MCP tools using an in-memory SQLite database:
 *   capture_intent → record_runtime → log_failure → query_memory →
 *   get_repair_brief → log_resolution → get_code_lineage
 *
 * Also covers: idempotency, error paths, lineage chains, FTS5 search,
 * and proven-fix surfacing.
 *
 * Uses `:memory:` SQLite — no filesystem side effects, fully isolated per test.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../src/store/database.js';
import { IntentQueries } from '../src/store/queries/intent.js';
import { RuntimeQueries } from '../src/store/queries/runtime.js';
import { RepairAssembler } from '../src/engines/repair/assembler.js';
import { RepairProvenance } from '../src/engines/repair/provenance.js';
import { LineageEngine } from '../src/engines/intent/lineage.js';
import { CaptureIntentTool } from '../src/mcp/tools/capture_intent.js';
import { RecordRuntimeTool } from '../src/mcp/tools/record_runtime.js';
import { LogFailureTool } from '../src/mcp/tools/log_failure.js';
import { LogResolutionTool } from '../src/mcp/tools/log_resolution.js';
import { QueryMemoryTool } from '../src/mcp/tools/query_memory.js';
import { GetRepairBriefTool } from '../src/mcp/tools/get_repair_brief.js';
import { GetCodeLineageTool } from '../src/mcp/tools/get_code_lineage.js';
import {
  CaptureIntentInput,
} from '../src/types/index.js';
import { CodememoryError } from '../src/utils/errors.js';
import { existsSync, unlinkSync } from 'fs';

// ── Shared fixture constants ───────────────────────────────────────────

const FILE_PATH = 'src/utils/math.ts';
const AI_TOOL = 'claude_code';
const LANGUAGE = 'typescript';

/** Unique temp DB path per test file — avoids :memory: FTS5 virtual-table quirks. */
const TEST_DB_PATH = './test-e2e-pipeline.db';

// ── Test suite ─────────────────────────────────────────────────────────

describe('E2E: Full MCP Tool Pipeline (:memory:)', () => {
  let dbManager: DatabaseManager;
  let intentQueries: IntentQueries;
  let runtimeQueries: RuntimeQueries;
  let provenance: RepairProvenance;

  // All 7 tools
  let captureIntent: CaptureIntentTool;
  let recordRuntime: RecordRuntimeTool;
  let logFailure: LogFailureTool;
  let logResolution: LogResolutionTool;
  let queryMemory: QueryMemoryTool;
  let getRepairBrief: GetRepairBriefTool;
  let getCodeLineage: GetCodeLineageTool;

  beforeEach(() => {
    // Clean up any leftover DB from a previous run
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
    // File-backed DB avoids :memory: FTS5 virtual-table quirks
    dbManager = new DatabaseManager(TEST_DB_PATH);
    intentQueries = new IntentQueries(dbManager);
    runtimeQueries = new RuntimeQueries(dbManager);
    provenance = new RepairProvenance(dbManager);

    const assembler = new RepairAssembler(intentQueries, runtimeQueries, provenance);
    const lineage = new LineageEngine(dbManager);

    captureIntent = new CaptureIntentTool(intentQueries);
    recordRuntime = new RecordRuntimeTool(intentQueries, runtimeQueries);
    logFailure = new LogFailureTool(intentQueries, runtimeQueries);
    logResolution = new LogResolutionTool(provenance, intentQueries, runtimeQueries);
    queryMemory = new QueryMemoryTool(intentQueries, dbManager);
    getRepairBrief = new GetRepairBriefTool(assembler);
    getCodeLineage = new GetCodeLineageTool(lineage);
  });

  afterEach(() => {
    dbManager.close();
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Happy Path: Full 7-tool pipeline
  // ─────────────────────────────────────────────────────────────────────

  it('full pipeline: capture → record → fail → query → brief → resolve → lineage', async () => {
    // ── Step 1: capture_intent ──────────────────────────────────────
    const captureResult = await captureIntent.execute({
      prompt: 'Write a divide function that handles zero gracefully',
      generated_code: `function divide(a: number, b: number): number {
  if (b === 0) throw new Error("Division by zero");
  return a / b;
}`,
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    expect(captureResult.status).toBe('captured');
    expect(captureResult.duplicate).toBe(false);
    const memoryId = captureResult.memory_id;
    expect(memoryId).toBeDefined();
    expect(typeof memoryId).toBe('string');

    // ── Step 2: record_runtime (successful execution) ────────────────
    const successSnapshot = await recordRuntime.execute({
      memory_id: memoryId,
      function_name: 'divide',
      file_path: FILE_PATH,
      arguments: [10, 2],
      return_value: 5,
      duration_ms: 1,
      success: true,
    });
    expect(successSnapshot.status).toBe('recorded');
    expect(successSnapshot.snapshot_id).toBeDefined();

    // ── Step 3: record_runtime (failing execution) ──────────────────
    const failSnapshot = await recordRuntime.execute({
      memory_id: memoryId,
      function_name: 'divide',
      file_path: FILE_PATH,
      arguments: [10, 0],
      return_value: undefined,
      duration_ms: 0,
      success: false,
    });
    expect(failSnapshot.status).toBe('recorded');

    // ── Step 4: log_failure ─────────────────────────────────────────
    const failureResult = await logFailure.execute({
      memory_id: memoryId,
      snapshot_id: failSnapshot.snapshot_id,
      error_type: 'Error',
      error_message: 'Division by zero',
      stack_trace: 'Error: Division by zero\n    at divide (math.ts:2:18)',
      call_chain: ['divide'],
    });
    expect(failureResult.status).toBe('logged');
    const failureId = failureResult.failure_id;
    expect(failureId).toBeDefined();

    // ── Step 5: query_memory (filtered) ─────────────────────────────
    const queryResult = await queryMemory.execute({ file_path: FILE_PATH });
    expect(queryResult.total).toBe(1);
    expect(queryResult.records[0].id).toBe(memoryId);
    expect(queryResult.records[0].prompt).toContain('divide');

    // ── Step 6: get_repair_brief ────────────────────────────────────
    const brief = await getRepairBrief.execute({ failure_id: failureId });
    expect(brief.original_intent).toContain('divide');
    expect(brief.failure_details).not.toBeNull();
    expect(brief.failure_details!.error_message).toBe('Division by zero');
    expect(brief.repair_context).toContain('REPAIR BRIEF');
    expect(brief.repair_context).toContain('Division by zero');
    expect(brief.confidence).toBe('high');
    expect(brief.runtime_history.length).toBe(2);

    // ── Step 7: capture_intent (replacement/fix) ────────────────────
    const fixResult = await captureIntent.execute({
      prompt: 'Fix the divide function to handle zero with a default',
      generated_code: `function divide(a: number, b: number): number {
  if (b === 0) return 0;
  return a / b;
}`,
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
      parent_intent_id: memoryId,
      replacement_reason: 'Original threw on zero; fix returns 0 instead',
    });
    expect(fixResult.status).toBe('captured');
    expect(fixResult.duplicate).toBe(false);
    const fixMemoryId = fixResult.memory_id;
    expect(fixMemoryId).not.toBe(memoryId);

    // Verify parent was marked replaced
    const parent = intentQueries.getById(memoryId);
    expect(parent?.status).toBe('replaced');

    // ── Step 8: log_resolution ──────────────────────────────────────
    const resolutionResult = await logResolution.execute({
      failure_id: failureId,
      fixing_intent_id: fixMemoryId,
      approach: 'Return 0 as default instead of throwing',
      diff_summary: 'Changed throw to return 0',
    });
    expect(resolutionResult.status).toBe('resolved');
    expect(resolutionResult.resolution_id).toBeDefined();

    // Verify failure is now resolved
    const resolvedFailure = runtimeQueries.getFailureById(failureId);
    expect(resolvedFailure?.repair_status).toBe('resolved');

    // ── Step 9: get_code_lineage ────────────────────────────────────
    const lineageResult = await getCodeLineage.execute({ memory_id: fixMemoryId });
    expect(lineageResult.depth).toBe(2); // original → fix
    expect(lineageResult.total_failures).toBe(1);
    expect(lineageResult.root.intent.id).toBe(memoryId);
    expect(lineageResult.root.parent).not.toBeNull();
    expect(lineageResult.root.parent!.intent.id).toBe(fixMemoryId);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Idempotency: duplicate capture_intent
  // ─────────────────────────────────────────────────────────────────────

  it('capture_intent is idempotent — duplicate returns status captured with duplicate:true', async () => {
    const input: CaptureIntentInput = {
      prompt: 'Write an add function',
      generated_code: 'function add(a, b) { return a + b; }',
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    };

    const first = await captureIntent.execute(input);
    expect(first.duplicate).toBe(false);

    const second = await captureIntent.execute(input);
    expect(second.duplicate).toBe(true);
    expect(second.memory_id).toBe(first.memory_id);
    expect(second.status).toBe('captured');

    // Only one row should exist
    const all = intentQueries.getByFilePath(FILE_PATH);
    expect(all.length).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Error paths
  // ─────────────────────────────────────────────────────────────────────

  it('record_runtime rejects non-existent memory_id', async () => {
    await expect(
      recordRuntime.execute({
        memory_id: 'nonexistent-id',
        function_name: 'fn',
        file_path: FILE_PATH,
        arguments: [1],
        return_value: 2,
        duration_ms: 1,
        success: true,
      })
    ).rejects.toThrow(CodememoryError);
  });

  it('log_failure rejects non-existent memory_id', async () => {
    await expect(
      logFailure.execute({
        memory_id: 'nonexistent-id',
        error_type: 'Error',
        error_message: 'Oops',
        stack_trace: '',
        call_chain: [],
      })
    ).rejects.toThrow(CodememoryError);
  });

  it('get_repair_brief rejects when neither failure_id nor memory_id provided', async () => {
    await expect(
      getRepairBrief.execute({})
    ).rejects.toThrow(CodememoryError);
  });

  it('get_repair_brief returns low-confidence brief when memory_id has no failures', async () => {
    const { memory_id } = await captureIntent.execute({
      prompt: 'Helper function',
      generated_code: 'function help() {}',
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    const brief = await getRepairBrief.execute({ memory_id });
    expect(brief.confidence).toBe('low');
    expect(brief.failure_details).toBeNull();
    expect(brief.repair_context).toContain('No failures recorded');
  });

  it('log_resolution rejects when failure_id does not exist', async () => {
    const { memory_id } = await captureIntent.execute({
      prompt: 'Some intent',
      generated_code: 'function foo() {}',
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    await expect(
      logResolution.execute({
        failure_id: 'nonexistent-failure',
        fixing_intent_id: memory_id,
      })
    ).rejects.toThrow(CodememoryError);
  });

  it('log_resolution rejects duplicate resolution of already-resolved failure', async () => {
    // Capture original intent
    const { memory_id } = await captureIntent.execute({
      prompt: 'Write a function',
      generated_code: 'function fn() {}',
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    // Record a failure
    const snapshot = await recordRuntime.execute({
      memory_id,
      function_name: 'fn',
      file_path: FILE_PATH,
      arguments: [],
      return_value: undefined,
      duration_ms: 1,
      success: false,
    });

    const { failure_id } = await logFailure.execute({
      memory_id,
      snapshot_id: snapshot.snapshot_id,
      error_type: 'TypeError',
      error_message: 'Cannot read property',
      stack_trace: '',
      call_chain: ['fn'],
    });

    // Capture the fix
    const { memory_id: fixId } = await captureIntent.execute({
      prompt: 'Fix the function',
      generated_code: 'function fn() { return null; }',
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
      parent_intent_id: memory_id,
      replacement_reason: 'Bug fix',
    });

    // First resolution succeeds
    await logResolution.execute({
      failure_id,
      fixing_intent_id: fixId,
    });

    // Second resolution on same failure_id should fail
    // (The fixing_intent_id must be different since same pair is unique-constrained)
    const thirdResult = await captureIntent.execute({
      prompt: 'Another fix attempt',
      generated_code: 'function fn() { return undefined; }',
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    // Resolving the SAME failure with a DIFFERENT fixing intent
    // The failure is already 'resolved', so this should fail with DUPLICATE_INTENT
    await expect(
      logResolution.execute({
        failure_id,
        fixing_intent_id: thirdResult.memory_id,
      })
    ).rejects.toThrow(/already resolved/);
  });

  it('capture_intent rejects parent_intent_id from a different file', async () => {
    const { memory_id } = await captureIntent.execute({
      prompt: 'Auth function',
      generated_code: 'function auth() {}',
      file_path: 'src/auth.ts',
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    await expect(
      captureIntent.execute({
        prompt: 'Payment function',
        generated_code: 'function pay() {}',
        file_path: 'src/payment.ts', // Different file!
        ai_tool: AI_TOOL,
        language: LANGUAGE,
        parent_intent_id: memory_id,
      })
    ).rejects.toThrow(/belongs to file/);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Lineage chain: 3 generations deep
  // ─────────────────────────────────────────────────────────────────────

  it('get_code_lineage traces a 3-generation chain', async () => {
    // Gen 1: original
    const g1 = await captureIntent.execute({
      prompt: 'Write a sort function',
      generated_code: 'function sort(arr) { return arr.sort(); }',
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    // Fail gen 1
    const snap1 = await recordRuntime.execute({
      memory_id: g1.memory_id,
      function_name: 'sort',
      file_path: FILE_PATH,
      arguments: [[3, 1, 2]],
      return_value: [1, 2, 3],
      duration_ms: 1,
      success: false,
    });
    const { failure_id: f1 } = await logFailure.execute({
      memory_id: g1.memory_id,
      snapshot_id: snap1.snapshot_id,
      error_type: 'Error',
      error_message: 'Lexicographic sort bug',
      stack_trace: '',
      call_chain: ['sort'],
    });

    // Gen 2: first fix
    const g2 = await captureIntent.execute({
      prompt: 'Fix sort to use numeric comparator',
      generated_code: 'function sort(arr) { return arr.sort((a, b) => a - b); }',
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
      parent_intent_id: g1.memory_id,
      replacement_reason: 'Lexicographic sort was wrong for numbers',
    });

    await logResolution.execute({
      failure_id: f1,
      fixing_intent_id: g2.memory_id,
      approach: 'Add numeric comparator',
    });

    // Fail gen 2
    const snap2 = await recordRuntime.execute({
      memory_id: g2.memory_id,
      function_name: 'sort',
      file_path: FILE_PATH,
      arguments: [[NaN, 1, 2]],
      return_value: [NaN, 1, 2],
      duration_ms: 1,
      success: false,
    });
    const { failure_id: f2 } = await logFailure.execute({
      memory_id: g2.memory_id,
      snapshot_id: snap2.snapshot_id,
      error_type: 'Error',
      error_message: 'NaN handling broken',
      stack_trace: '',
      call_chain: ['sort'],
    });

    // Gen 3: second fix
    const g3 = await captureIntent.execute({
      prompt: 'Fix sort to handle NaN',
      generated_code: 'function sort(arr) { return arr.filter(n => !isNaN(n)).sort((a, b) => a - b); }',
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
      parent_intent_id: g2.memory_id,
      replacement_reason: 'NaN was not handled',
    });

    await logResolution.execute({
      failure_id: f2,
      fixing_intent_id: g3.memory_id,
      approach: 'Filter NaN values before sorting',
    });

    // Trace lineage from gen 3
    const lineage = await getCodeLineage.execute({ memory_id: g3.memory_id });
    expect(lineage.depth).toBe(3);
    expect(lineage.total_failures).toBe(2);

    // Root should be gen 1
    expect(lineage.root.intent.id).toBe(g1.memory_id);
    expect(lineage.root.trigger_failures.length).toBe(1);
    expect(lineage.root.trigger_failures[0].error_message).toBe('Lexicographic sort bug');

    // Next gen
    expect(lineage.root.parent).not.toBeNull();
    expect(lineage.root.parent!.intent.id).toBe(g2.memory_id);
    expect(lineage.root.parent!.trigger_failures[0].error_message).toBe('NaN handling broken');

    // Leaf (gen 3) has no parent
    expect(lineage.root.parent!.parent).not.toBeNull();
    expect(lineage.root.parent!.parent!.intent.id).toBe(g3.memory_id);
    expect(lineage.root.parent!.parent!.parent).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────
  // FTS5 full-text search (query_memory)
  // ─────────────────────────────────────────────────────────────────────

  it('query_memory FTS5 search finds intents by prompt keyword', async () => {
    await captureIntent.execute({
      prompt: 'Write a function to validate email addresses',
      generated_code: 'function validateEmail(e) { return e.includes("@"); }',
      file_path: 'src/validators.ts',
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    await captureIntent.execute({
      prompt: 'Write a function to parse phone numbers',
      generated_code: "function parsePhone(p) { return p.replace(/[^0-9]/g, ''); }",
      file_path: 'src/parsers.ts',
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    await captureIntent.execute({
      prompt: 'Write a function to validate URLs',
      generated_code: 'function validateUrl(u) { try { new URL(u); return true; } catch { return false; } }',
      file_path: 'src/validators.ts',
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    // Search for "validate" — should find 2 intents
    const result = await queryMemory.execute({ query: 'validate', limit: 10 });
    expect(result.total).toBe(2);
    expect(result.search_results).toBeDefined();
    expect(result.search_results!.length).toBe(2);

    // IntentExtractor strips common prefixes like "Write a function to "
    const prompts = result.records.map(r => r.prompt);
    expect(prompts).toContain('Validate email addresses');
    expect(prompts).toContain('Validate URLs');

    // Search with file_path filter
    const filtered = await queryMemory.execute({
      query: 'validate',
      file_path: 'src/validators.ts',
    });
    expect(filtered.total).toBe(2);

    // No match
    const noMatch = await queryMemory.execute({ query: 'blockchain' });
    expect(noMatch.total).toBe(0);
  });

  it('query_memory filtered mode works without FTS5 query', async () => {
    const now = Date.now();

    await captureIntent.execute({
      prompt: 'Active function',
      generated_code: 'function a() {}',
      file_path: 'src/filtered.ts',
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    // This one gets replaced (status=replaced)
    const { memory_id: parentId } = await captureIntent.execute({
      prompt: 'Replaced function',
      generated_code: 'function b() {}',
      file_path: 'src/filtered.ts',
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    await captureIntent.execute({
      prompt: 'Replacement function',
      generated_code: 'function c() {}',
      file_path: 'src/filtered.ts',
      ai_tool: AI_TOOL,
      language: LANGUAGE,
      parent_intent_id: parentId,
      replacement_reason: 'Better version',
    });

    // Filter by status=active
    const active = await queryMemory.execute({
      file_path: 'src/filtered.ts',
      status: 'active',
    });
    expect(active.records.every(r => r.status === 'active')).toBe(true);

    // Filter by status=replaced
    const replaced = await queryMemory.execute({
      file_path: 'src/filtered.ts',
      status: 'replaced',
    });
    expect(replaced.records.every(r => r.status === 'replaced')).toBe(true);

    // Filter by since
    const since = await queryMemory.execute({
      file_path: 'src/filtered.ts',
      since: now,
    });
    expect(since.total).toBe(3);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Repair brief with proven fixes
  // ─────────────────────────────────────────────────────────────────────

  it('get_repair_brief surfaces proven fixes for similar failures', async () => {
    // ── First bug + fix cycle ────────────────────────────────────────
    const g1 = await captureIntent.execute({
      prompt: 'Write a parseJSON wrapper',
      generated_code: 'function parseJSON(s) { return JSON.parse(s); }',
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    const snap1 = await recordRuntime.execute({
      memory_id: g1.memory_id,
      function_name: 'parseJSON',
      file_path: FILE_PATH,
      arguments: ['{invalid}'],
      return_value: undefined,
      duration_ms: 1,
      success: false,
    });

    const { failure_id: f1 } = await logFailure.execute({
      memory_id: g1.memory_id,
      snapshot_id: snap1.snapshot_id,
      error_type: 'SyntaxError',
      error_message: 'Unexpected token i in JSON at position 1',
      stack_trace: 'at JSON.parse (<anonymous>)',
      call_chain: ['parseJSON'],
    });

    const g2 = await captureIntent.execute({
      prompt: 'Fix parseJSON to handle malformed input',
      generated_code: 'function parseJSON(s) { try { return JSON.parse(s); } catch { return null; } }',
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
      parent_intent_id: g1.memory_id,
      replacement_reason: 'Did not handle malformed JSON',
    });

    await logResolution.execute({
      failure_id: f1,
      fixing_intent_id: g2.memory_id,
      approach: 'Wrap JSON.parse in try/catch, return null on error',
      diff_summary: 'Added try/catch block',
    });

    // ── Second bug — same error type ─────────────────────────────────
    const g3 = await captureIntent.execute({
      prompt: 'Write a config loader',
      generated_code: 'function loadConfig(s) { return JSON.parse(s); }',
      file_path: 'src/config.ts',
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    const snap3 = await recordRuntime.execute({
      memory_id: g3.memory_id,
      function_name: 'loadConfig',
      file_path: 'src/config.ts',
      arguments: ['{bad json}'],
      return_value: undefined,
      duration_ms: 1,
      success: false,
    });

    const { failure_id: f3 } = await logFailure.execute({
      memory_id: g3.memory_id,
      snapshot_id: snap3.snapshot_id,
      error_type: 'SyntaxError',
      error_message: 'Unexpected token b in JSON at position 1',
      stack_trace: 'at JSON.parse (<anonymous>)',
      call_chain: ['loadConfig'],
    });

    // Get repair brief for the second failure — should surface the proven fix
    const brief = await getRepairBrief.execute({ failure_id: f3 });
    expect(brief.failure_details).not.toBeNull();
    expect(brief.failure_details!.error_type).toBe('SyntaxError');

    // Proven fixes should include the try/catch approach from g2
    expect(brief.proven_fixes.length).toBeGreaterThan(0);
    const provenApproach = brief.proven_fixes[0].resolution.approach;
    expect(provenApproach).toContain('try/catch');
    expect(brief.repair_context).toContain('PROVEN FIXES');
  });

  // ─────────────────────────────────────────────────────────────────────
  // record_runtime with edge case arguments
  // ─────────────────────────────────────────────────────────────────────

  it('record_runtime handles empty, large, and complex arguments', async () => {
    const { memory_id } = await captureIntent.execute({
      prompt: 'Test function',
      generated_code: 'function test() {}',
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    // Empty arguments
    const r1 = await recordRuntime.execute({
      memory_id,
      function_name: 'test',
      arguments: [],
      return_value: undefined,
      duration_ms: 0,
      success: true,
    });
    expect(r1.status).toBe('recorded');

    // Complex nested arguments
    const r2 = await recordRuntime.execute({
      memory_id,
      function_name: 'test',
      arguments: [{ nested: { deep: [1, 2, { key: 'value' }] } }, [3, 4]],
      return_value: { result: 'ok' },
      duration_ms: 5,
      success: true,
    });
    expect(r2.status).toBe('recorded');

    // Null return value
    const r3 = await recordRuntime.execute({
      memory_id,
      function_name: 'test',
      arguments: [null, undefined],
      return_value: null,
      duration_ms: 1,
      success: false,
    });
    expect(r3.status).toBe('recorded');

    // Verify all 3 snapshots exist
    const snapshots = runtimeQueries.getSnapshotsByIntentId(memory_id);
    expect(snapshots.length).toBe(3);
  });

  // ─────────────────────────────────────────────────────────────────────
  // log_failure with snapshot validation
  // ─────────────────────────────────────────────────────────────────────

  it('log_failure validates snapshot belongs to the given intent', async () => {
    const { memory_id: id1 } = await captureIntent.execute({
      prompt: 'Intent A',
      generated_code: 'function a() {}',
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    const { memory_id: id2 } = await captureIntent.execute({
      prompt: 'Intent B',
      generated_code: 'function b() {}',
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    const snapB = await recordRuntime.execute({
      memory_id: id2,
      function_name: 'b',
      arguments: [],
      duration_ms: 1,
      success: true,
    });

    // Try to log failure for intent A with intent B's snapshot
    await expect(
      logFailure.execute({
        memory_id: id1,
        snapshot_id: snapB.snapshot_id,
        error_type: 'Error',
        error_message: 'Wrong snapshot',
        stack_trace: '',
        call_chain: [],
      })
    ).rejects.toThrow(/belongs to intent/);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Input size validation (DoS guard)
  // ─────────────────────────────────────────────────────────────────────

  it('capture_intent rejects oversized prompt', async () => {
    await expect(
      captureIntent.execute({
        prompt: 'x'.repeat(100_000), // Exceeds MAX_PROMPT_LENGTH (65536)
        generated_code: 'function f() {}',
        file_path: FILE_PATH,
        ai_tool: AI_TOOL,
        language: LANGUAGE,
      })
    ).rejects.toThrow(/exceeds maximum length/);
  });

  it('log_failure rejects oversized error_message', async () => {
    const { memory_id } = await captureIntent.execute({
      prompt: 'Test',
      generated_code: 'function t() {}',
      file_path: FILE_PATH,
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    await expect(
      logFailure.execute({
        memory_id,
        error_type: 'Error',
        error_message: 'x'.repeat(5_000), // Exceeds MAX_ERROR_MESSAGE_LENGTH (4096)
        stack_trace: '',
        call_chain: [],
      })
    ).rejects.toThrow(/exceeds maximum length/);
  });

  // ─────────────────────────────────────────────────────────────────────
  // query_memory with status filter on FTS5 results
  // ─────────────────────────────────────────────────────────────────────

  it('query_memory FTS5 search respects post-search status filter', async () => {
    await captureIntent.execute({
      prompt: 'Write an active searchable function',
      generated_code: 'function activeFn() {}',
      file_path: 'src/searchable.ts',
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    const { memory_id: parentId } = await captureIntent.execute({
      prompt: 'Write a replaced searchable function',
      generated_code: 'function replacedFn() {}',
      file_path: 'src/searchable.ts',
      ai_tool: AI_TOOL,
      language: LANGUAGE,
    });

    // Replace the second intent
    await captureIntent.execute({
      prompt: 'Replacement searchable',
      generated_code: 'function newFn() {}',
      file_path: 'src/searchable.ts',
      ai_tool: AI_TOOL,
      language: LANGUAGE,
      parent_intent_id: parentId,
      replacement_reason: 'Updated',
    });

    // FTS5 finds all 3 matching "searchable" prompts
    const all = await queryMemory.execute({ query: 'searchable', limit: 10 });
    expect(all.total).toBe(3);

    // Filter to only active
    const activeOnly = await queryMemory.execute({
      query: 'searchable',
      status: 'active',
      limit: 10,
    });
    expect(activeOnly.total).toBe(2);
    expect(activeOnly.records.every(r => r.status === 'active')).toBe(true);

    // Filter to only replaced
    const replacedOnly = await queryMemory.execute({
      query: 'searchable',
      status: 'replaced',
      limit: 10,
    });
    expect(replacedOnly.total).toBe(1);
    expect(replacedOnly.records[0].status).toBe('replaced');
  });
});
