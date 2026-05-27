import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import { DatabaseManager } from '../src/store/database.js';
import { IntentQueries } from '../src/store/queries/intent.js';
import { RuntimeQueries } from '../src/store/queries/runtime.js';
import { RepairAssembler } from '../src/engines/repair/assembler.js';
import { RepairProvenance } from '../src/engines/repair/provenance.js';
import { CaptureIntentTool } from '../src/mcp/tools/capture_intent.js';
import { RecordRuntimeTool } from '../src/mcp/tools/record_runtime.js';
import { LogFailureTool } from '../src/mcp/tools/log_failure.js';
import { GetRepairBriefTool } from '../src/mcp/tools/get_repair_brief.js';

/**
 * Launch Benchmark.
 *
 * Measures p50 latency for the three hot-path MCP tools using the real
 * SQLite-backed pipeline (no mocks). The targets exist so we notice
 * regressions before they reach users — they are intentionally generous
 * relative to local-machine SQLite throughput.
 *
 * Targets:
 *   capture_intent     p50 < 10ms
 *   record_runtime     p50 < 5ms
 *   get_repair_brief   p50 < 50ms
 */
describe('Launch Benchmark', () => {
  const DB_PATH = './test-benchmark.db';
  const ITERATIONS = 100;

  let db: DatabaseManager;
  let intentQueries: IntentQueries;
  let runtimeQueries: RuntimeQueries;
  let captureTool: CaptureIntentTool;
  let recordTool: RecordRuntimeTool;
  let logFailureTool: LogFailureTool;
  let repairBriefTool: GetRepairBriefTool;

  beforeAll(() => {
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    db = new DatabaseManager(DB_PATH);
    intentQueries = new IntentQueries(db);
    runtimeQueries = new RuntimeQueries(db);
    const assembler = new RepairAssembler(intentQueries, runtimeQueries, new RepairProvenance(db));
    captureTool = new CaptureIntentTool(intentQueries);
    recordTool = new RecordRuntimeTool(intentQueries, runtimeQueries);
    logFailureTool = new LogFailureTool(intentQueries, runtimeQueries);
    repairBriefTool = new GetRepairBriefTool(assembler);
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  });

  /**
   * Runs `fn` ITERATIONS times and returns the median (p50) duration in ms.
   * Median is more representative than mean for I/O-bound paths because it
   * is not skewed by the occasional GC pause or fsync spike.
   */
  const measureP50 = async (fn: () => Promise<unknown>): Promise<number> => {
    const samples: number[] = [];
    // Warm-up to avoid measuring first-call SQLite prepared-statement cost.
    await fn();
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      await fn();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
  };

  it('capture_intent p50 < 10ms', async () => {
    let i = 0;
    const p50 = await measureP50(() =>
      captureTool.execute({
        prompt: 'Add a divider function',
        generated_code: `function divide_${i++}(a, b) { return a / b; }`,
        file_path: 'bench/divide.ts',
        ai_tool: 'benchmark',
        language: 'typescript',
      })
    );
    console.log(`[benchmark] capture_intent p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(10);
  });

  it('record_runtime p50 < 5ms', async () => {
    // Seed an intent so record_runtime has a valid memory_id to attach to.
    const { memory_id } = await captureTool.execute({
      prompt: 'Seed for record_runtime benchmark',
      generated_code: 'function noop() {}',
      file_path: 'bench/noop.ts',
      ai_tool: 'benchmark',
      language: 'typescript',
    });

    const p50 = await measureP50(() =>
      recordTool.execute({
        memory_id,
        function_name: 'noop',
        arguments: [1, 2, 3],
        return_value: 6,
        duration_ms: 1,
        success: true,
      })
    );
    console.log(`[benchmark] record_runtime p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(5);
  });

  it('get_repair_brief p50 < 50ms', async () => {
    // Seed intent + a failure so the assembler has something to fuse.
    const { memory_id } = await captureTool.execute({
      prompt: 'Seed for get_repair_brief benchmark',
      generated_code: 'function divide(a, b) { return a / b; }',
      file_path: 'bench/divide.ts',
      ai_tool: 'benchmark',
      language: 'typescript',
    });
    await logFailureTool.execute({
      memory_id,
      error_type: 'TypeError',
      error_message: 'Division by zero',
      stack_trace: 'at divide (bench/divide.ts:1:1)',
      call_chain: ['divide'],
    });

    const p50 = await measureP50(() => repairBriefTool.execute({ memory_id }));
    console.log(`[benchmark] get_repair_brief p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(50);
  });
});
