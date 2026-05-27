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
import { RepairAssembler } from '../engines/repair/assembler.js';
import { RepairProvenance } from '../engines/repair/provenance.js';
import { LineageEngine } from '../engines/intent/lineage.js';
import { logger } from '../utils/logger.js';
import { CaptureIntentInput, RecordRuntimeInput, LogFailureInput, QueryMemoryInput, LogResolutionInput, GetCodeLineageInput } from '../types/index.js';
import { MCP_TOOL_NAMES } from './tool-names.js';
import { formatToolError } from '../utils/errors.js';

/**
 * MCP Server for Codememory.
 *
 * v0.2.1 adds:
 *   - log_resolution   — link a resolved failure to the intent that fixed it
 *   - get_code_lineage — trace full generational history of generated code
 *   - query_memory     — enhanced with FTS5 natural-language search
 *   - get_repair_brief — enhanced with proven fix suggestions
 *
 * @security v0.2.1: Codememory does NOT provide per-client authentication or
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

  /**
   * Initializes the MCP server and all its tools.
   */
  constructor() {
    this.server = new Server(
      {
        name: 'codememory',
        version: '0.2.1',
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

    this.captureIntentTool = new CaptureIntentTool(intentQueries);
    this.recordRuntimeTool = new RecordRuntimeTool(intentQueries, runtimeQueries);
    this.logFailureTool = new LogFailureTool(intentQueries, runtimeQueries);
    this.logResolutionTool = new LogResolutionTool(provenance, intentQueries, runtimeQueries);
    this.getRepairBriefTool = new GetRepairBriefTool(repairAssembler);
    this.getCodeLineageTool = new GetCodeLineageTool(lineageEngine);
    this.queryMemoryTool = new QueryMemoryTool(intentQueries, this.dbManager);

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
   * Starts the MCP server using the Stdio transport.
   * Follows Rule 06: Logs initialization status.
   */
  public async run(): Promise<void> {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info('Codememory MCP server running on stdio');
    } catch (error) {
      logger.error('Failed to start Codememory server', error);
      throw error;
    }
  }

  /**
   * Gracefully shuts down the server, checkpoints the WAL, and closes the
   * database. Safe to call multiple times (idempotent).
   *
   * Called on SIGINT/SIGTERM so the WAL is flushed and -wal/-shm files
   * are cleaned up rather than left behind on disk.
   */
  public async shutdown(): Promise<void> {
    try {
      logger.info('Codememory server shutting down...');
      await this.server.close();
      this.dbManager.close();
      logger.info('Codememory server shut down cleanly');
    } catch (error) {
      logger.error('Error during Codememory shutdown', error);
    }
  }
}
