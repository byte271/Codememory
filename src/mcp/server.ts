import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DatabaseManager } from '../store/database.js';
import { IntentQueries } from '../store/queries/intent.js';
import { RuntimeQueries } from '../store/queries/runtime.js';
import { CaptureIntentTool } from './tools/capture_intent.js';
import { RecordRuntimeTool } from './tools/record_runtime.js';
import { LogFailureTool } from './tools/log_failure.js';
import { LogResolutionTool } from './tools/log_resolution.js';
import { GetRepairBriefTool } from './tools/get_repair_brief.js';
import { GetCodeLineageTool } from './tools/get_code_lineage.js';
import { QueryMemoryTool } from './tools/query_memory.js';
import { AutoHealTriggerTool } from './tools/auto_heal_trigger.js';
import { AutoHealStatusTool } from './tools/auto_heal_status.js';
import { PredictIssueTool } from './tools/predict_issue.js';
import { CrossProjectSearchTool } from './tools/cross_project_search.js';
import { RepairAssembler } from '../engines/repair/assembler.js';
import { RepairProvenance } from '../engines/repair/provenance.js';
import { LineageEngine } from '../engines/intent/lineage.js';
import { AutoHealEngine } from '../engines/heal/auto-heal.js';
import { PredictiveGuard } from '../engines/guard/predictive-guard.js';
import { CrossProjectGraph } from '../engines/knowledge/cross-project.js';
import { DashboardServer } from '../web/server.js';
import { logger } from '../utils/logger.js';
import {
  CaptureIntentInput,
  RecordRuntimeInput,
  LogFailureInput,
  QueryMemoryInput,
  LogResolutionInput,
  GetCodeLineageInput,
  AutoHealTriggerInput,
  AutoHealStatusInput,
  PredictIssueInput,
  CrossProjectSearchInput,
} from '../types/index.js';
import { MCP_TOOL_NAMES } from './tool-names.js';
import { formatToolError } from '../utils/errors.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { isAutoHealEnabled, isDashboardEnabled, getDashboardPort } from '../config.js';

/** Resolve worker script path across CJS/ESM builds. */
function resolveWorkerPath(): string {
  let cjsPath: string | null = null;
  if (typeof __dirname !== 'undefined') {
    cjsPath = join(__dirname, '..', 'engines', 'heal', 'worker.js');
    if (existsSync(cjsPath)) return cjsPath;
  }
  // ESM fallback
  // eslint-disable-next-line no-eval
  const url: string = eval('import.meta.url') as string;
  const esmPath = join(dirname(fileURLToPath(url)), '..', 'engines', 'heal', 'worker.js');
  if (existsSync(esmPath)) return esmPath;
  // Last-resort fallback: src layout for tsx/vitest
  const srcPath = join(dirname(fileURLToPath(url)), 'engines', 'heal', 'worker.js');
  if (existsSync(srcPath)) return srcPath;
  const lookedIn = [esmPath, srcPath];
  if (cjsPath) lookedIn.unshift(cjsPath);
  throw new Error(
    `Auto-heal worker script not found. Looked in:\n  ${lookedIn.join('\n  ')}`
  );
}

/**
 * MCP Server for Codememory.
 *
 * v0.3.0 adds:
 *   - auto_heal_trigger      — trigger autonomous self-repair for a failure
 *   - auto_heal_status       — check the status of an auto-heal task
 *   - predict_issue          — proactive guardrails: check code before bugs happen
 *   - cross_project_search   — search across all projects for shared learnings
 *   - Background worker      — automatic failure polling and self-healing
 *   - Web dashboard          — Behavioral Time Machine UI (opt-in)
 *
 * @security v0.3.0: Codememory does NOT provide per-client authentication or
 *   data isolation. All MCP clients connected to the same server share a single
 *   SQLite database with full read/write access. This is intentional for local
 *   single-user workflows. Multi-tenant deployments would require client identity
 *   tracking, per-client database scoping, and input provenance verification.
 *
 * Follows Rule 14: Every MCP tool must return structured JSON. No plain text responses.
 */
export class CodememoryServer {
  private server: Server;
  private dbManager: DatabaseManager;
  private captureIntentTool: CaptureIntentTool;
  private recordRuntimeTool: RecordRuntimeTool;
  private logFailureTool: LogFailureTool;
  private logResolutionTool: LogResolutionTool;
  private getRepairBriefTool: GetRepairBriefTool;
  private getCodeLineageTool: GetCodeLineageTool;
  private queryMemoryTool: QueryMemoryTool;
  private autoHealTriggerTool: AutoHealTriggerTool;
  private autoHealStatusTool: AutoHealStatusTool;
  private predictIssueTool: PredictIssueTool;
  private crossProjectSearchTool: CrossProjectSearchTool;

  /** v0.3 engines */
  private autoHealEngine: AutoHealEngine;
  private predictiveGuard: PredictiveGuard;
  private crossProjectGraph: CrossProjectGraph;

  /** v0.3 web dashboard */
  private dashboard: DashboardServer | null = null;

  /**
   * Initializes the MCP server and all its tools.
   */
  constructor() {
    this.server = new Server(
      {
        name: 'codememory',
        version: '0.3.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.dbManager = new DatabaseManager();
    const intentQueries = new IntentQueries(this.dbManager);
    const runtimeQueries = new RuntimeQueries(this.dbManager);
    const provenance = new RepairProvenance(this.dbManager);
    const repairAssembler = new RepairAssembler(intentQueries, runtimeQueries, provenance);
    const lineageEngine = new LineageEngine(this.dbManager);

    // v0.3 engines
    this.autoHealEngine = new AutoHealEngine(
      this.dbManager, intentQueries, runtimeQueries, repairAssembler
    );
    this.predictiveGuard = new PredictiveGuard(this.dbManager);
    this.crossProjectGraph = new CrossProjectGraph(this.dbManager);

    // v0.1–v0.2 tools
    this.captureIntentTool = new CaptureIntentTool(intentQueries, this.crossProjectGraph);
    this.recordRuntimeTool = new RecordRuntimeTool(intentQueries, runtimeQueries);
    this.logFailureTool = new LogFailureTool(intentQueries, runtimeQueries);
    this.logResolutionTool = new LogResolutionTool(provenance, intentQueries, runtimeQueries, this.predictiveGuard);
    this.getRepairBriefTool = new GetRepairBriefTool(repairAssembler);
    this.getCodeLineageTool = new GetCodeLineageTool(lineageEngine);
    this.queryMemoryTool = new QueryMemoryTool(intentQueries, this.dbManager);

    // v0.3 tools
    this.autoHealTriggerTool = new AutoHealTriggerTool(this.autoHealEngine, runtimeQueries);
    this.autoHealStatusTool = new AutoHealStatusTool(this.autoHealEngine, runtimeQueries);
    this.predictIssueTool = new PredictIssueTool(this.predictiveGuard, this.crossProjectGraph);
    this.crossProjectSearchTool = new CrossProjectSearchTool(this.crossProjectGraph);

    this.setupTools();
  }

  /**
   * Sets up the MCP tool list and call handler.
   */
  private setupTools(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: MCP_TOOL_NAMES.capture_intent,
            description: 'Called when AI generates code to capture intent and bind it to the generated code.',
            inputSchema: {
              type: 'object',
              properties: {
                prompt: { type: 'string' },
                generated_code: { type: 'string' },
                file_path: { type: 'string' },
                ai_tool: { type: 'string' },
                language: { type: 'string' },
                parent_intent_id: { type: 'string', description: 'The memory_id of the intent being replaced (v0.2 lineage).' },
                replacement_reason: { type: 'string', description: 'Why the previous code is being replaced (v0.2 lineage).' },
                project_name: { type: 'string', description: 'Project name for cross-project knowledge sharing (v0.3).' },
              },
              required: ['prompt', 'generated_code', 'file_path', 'ai_tool', 'language'],
            },
          },
          {
            name: MCP_TOOL_NAMES.record_runtime,
            description: 'Called during/after code execution to record behavior.',
            inputSchema: {
              type: 'object',
              properties: {
                memory_id: { type: 'string' },
                function_name: { type: 'string' },
                file_path: { type: 'string' },
                arguments: { type: 'array' },
                return_value: { description: 'Return value (any JSON-serializable value)' },
                duration_ms: { type: 'number' },
                success: { type: 'boolean' },
              },
              required: ['memory_id', 'function_name', 'arguments', 'duration_ms', 'success'],
            },
          },
          {
            name: MCP_TOOL_NAMES.log_failure,
            description: 'Called when runtime error occurs.',
            inputSchema: {
              type: 'object',
              properties: {
                memory_id: { type: 'string' },
                snapshot_id: { type: 'string' },
                error_type: { type: 'string' },
                error_message: { type: 'string' },
                stack_trace: { type: 'string' },
                call_chain: { type: 'array', items: { type: 'string' } },
              },
              required: ['memory_id', 'error_type', 'error_message', 'stack_trace', 'call_chain'],
            },
          },
          {
            name: MCP_TOOL_NAMES.log_resolution,
            description:
              'Called after a bug is fixed to link the resolved failure to the intent that fixed it. ' +
              'Enables Codememory to surface proven fixes when similar errors recur.',
            inputSchema: {
              type: 'object',
              properties: {
                failure_id: { type: 'string', description: 'The failure that was resolved.' },
                fixing_intent_id: { type: 'string', description: 'The memory_id of the intent that fixed it.' },
                approach: { type: 'string', description: 'Description of the fix approach used.' },
                diff_summary: { type: 'string', description: 'Summary of what changed in the fix.' },
              },
              required: ['failure_id', 'fixing_intent_id'],
            },
          },
          {
            name: MCP_TOOL_NAMES.get_repair_brief,
            description:
              'The killer feature — called when AI needs to fix something. ' +
              'v0.2: now includes proven fixes from past similar errors.',
            inputSchema: {
              type: 'object',
              properties: {
                failure_id: { type: 'string' },
                memory_id: { type: 'string' },
              },
            },
          },
          {
            name: MCP_TOOL_NAMES.get_code_lineage,
            description:
              'Traces the full generational history of AI-generated code. ' +
              'Shows what was tried before, why each generation failed, and how it was resolved.',
            inputSchema: {
              type: 'object',
              properties: {
                memory_id: { type: 'string', description: 'The memory_id to trace lineage for.' },
              },
              required: ['memory_id'],
            },
          },
          {
            name: MCP_TOOL_NAMES.query_memory,
            description:
              'General purpose memory search. v0.2: supports natural-language FTS5 search via the `query` field.',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: { type: 'string' },
                since: { type: 'number' },
                status: { type: 'string' },
                limit: { type: 'number' },
                query: { type: 'string', description: 'Natural-language search query (FTS5).' },
              },
            },
          },
          // ── v0.3.0 tools ──────────────────────────────────────────
          {
            name: MCP_TOOL_NAMES.auto_heal_trigger,
            description:
              'v0.3: Triggers autonomous self-repair for a failure. ' +
              'Codememory generates a patch from historical memory and proven fixes, ' +
              'validates it, and returns the auto-heal task for review.',
            inputSchema: {
              type: 'object',
              properties: {
                failure_id: { type: 'string', description: 'The failure to auto-heal.' },
              },
              required: ['failure_id'],
            },
          },
          {
            name: MCP_TOOL_NAMES.auto_heal_status,
            description:
              'v0.3: Checks the status of an auto-heal task. ' +
              'Returns the generated patch, test results, and PR URL if available.',
            inputSchema: {
              type: 'object',
              properties: {
                task_id: { type: 'string', description: 'The auto-heal task ID to check.' },
              },
              required: ['task_id'],
            },
          },
          {
            name: MCP_TOOL_NAMES.predict_issue,
            description:
              'v0.3: Proactive Guardrails — check your code approach BEFORE writing. ' +
              'Returns warnings from learned failure patterns across all projects. ' +
              'Transforms post-mortem repair into preemptive prevention.',
            inputSchema: {
              type: 'object',
              properties: {
                proposed_code: { type: 'string', description: 'The code you are about to generate.' },
                description: { type: 'string', description: 'Natural language description of the task.' },
                file_path: { type: 'string', description: 'Target file path for context-aware predictions.' },
                project_name: { type: 'string', description: 'Project name for cross-project rule matching.' },
              },
            },
          },
          {
            name: MCP_TOOL_NAMES.cross_project_search,
            description:
              'v0.3: Cross-Project Knowledge Graph — search failures and fixes across ALL your projects. ' +
              'Applies lessons learned in Project A to prevent bugs in Project B.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Error pattern or description to search across projects.' },
                limit: { type: 'number', description: 'Max results (default 5).' },
              },
              required: ['query'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === MCP_TOOL_NAMES.capture_intent) {
          return { content: [{ type: 'text', text: JSON.stringify(await this.captureIntentTool.execute(args as unknown as CaptureIntentInput)) }] };
        }
        if (name === MCP_TOOL_NAMES.record_runtime) {
          return { content: [{ type: 'text', text: JSON.stringify(await this.recordRuntimeTool.execute(args as unknown as RecordRuntimeInput)) }] };
        }
        if (name === MCP_TOOL_NAMES.log_failure) {
          return { content: [{ type: 'text', text: JSON.stringify(await this.logFailureTool.execute(args as unknown as LogFailureInput)) }] };
        }
        if (name === MCP_TOOL_NAMES.log_resolution) {
          return { content: [{ type: 'text', text: JSON.stringify(await this.logResolutionTool.execute(args as unknown as LogResolutionInput)) }] };
        }
        if (name === MCP_TOOL_NAMES.get_repair_brief) {
          const input = args as { failure_id?: string; memory_id?: string };
          return { content: [{ type: 'text', text: JSON.stringify(await this.getRepairBriefTool.execute(input)) }] };
        }
        if (name === MCP_TOOL_NAMES.get_code_lineage) {
          return { content: [{ type: 'text', text: JSON.stringify(await this.getCodeLineageTool.execute(args as unknown as GetCodeLineageInput)) }] };
        }
        if (name === MCP_TOOL_NAMES.query_memory) {
          const input = args as unknown as QueryMemoryInput;
          return { content: [{ type: 'text', text: JSON.stringify(await this.queryMemoryTool.execute(input)) }] };
        }
        // ── v0.3.0 tools ──────────────────────────────────────────
        if (name === MCP_TOOL_NAMES.auto_heal_trigger) {
          return { content: [{ type: 'text', text: JSON.stringify(await this.autoHealTriggerTool.execute(args as unknown as AutoHealTriggerInput)) }] };
        }
        if (name === MCP_TOOL_NAMES.auto_heal_status) {
          return { content: [{ type: 'text', text: JSON.stringify(await this.autoHealStatusTool.execute(args as unknown as AutoHealStatusInput)) }] };
        }
        if (name === MCP_TOOL_NAMES.predict_issue) {
          return { content: [{ type: 'text', text: JSON.stringify(await this.predictIssueTool.execute(args as unknown as PredictIssueInput)) }] };
        }
        if (name === MCP_TOOL_NAMES.cross_project_search) {
          return { content: [{ type: 'text', text: JSON.stringify(await this.crossProjectSearchTool.execute(args as unknown as CrossProjectSearchInput)) }] };
        }

        throw new Error(`Unknown tool: ${name}`);
      } catch (error) {
        logger.error(`Error executing tool ${name}`, error);
        return {
          content: [{ type: 'text', text: JSON.stringify(formatToolError(error)) }],
          isError: true,
        };
      }
    });
  }

  /**
   * Starts the MCP server, auto-heal worker, and optionally the dashboard.
   *
   * Follows Rule 06: Logs initialization status.
   */
  public async run(): Promise<void> {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info('Codememory MCP server running on stdio (v0.3.0)');

      // Start auto-heal background worker
      if (isAutoHealEnabled()) {
        try {
          this.autoHealEngine.startWorker(resolveWorkerPath());
        } catch (error) {
          logger.error('Failed to start auto-heal worker', error);
        }
      }

      // Start dashboard if enabled
      if (isDashboardEnabled()) {
        this.dashboard = new DashboardServer(this.dbManager, getDashboardPort());
        this.dashboard.start();
      }
    } catch (error) {
      logger.error('Failed to start Codememory server', error);
      throw error;
    }
  }

  /**
   * Gracefully shuts down the server, worker, dashboard, and database.
   */
  public async shutdown(): Promise<void> {
    try {
      logger.info('Codememory server shutting down...');
      await this.autoHealEngine.stopWorker();
      if (this.dashboard) {
        await this.dashboard.stop();
      }
      await this.server.close();
      this.dbManager.close();
      logger.info('Codememory server shut down cleanly');
    } catch (error) {
      logger.error('Error during Codememory shutdown', error);
    }
  }
}
