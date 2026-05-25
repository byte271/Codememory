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
import { GetRepairBriefTool } from './tools/get_repair_brief.js';
import { QueryMemoryTool } from './tools/query_memory.js';
import { RepairAssembler } from '../engines/repair/assembler.js';
import { logger } from '../utils/logger.js';
import { CaptureIntentInput, RecordRuntimeInput, LogFailureInput, QueryMemoryInput } from '../types/index.js';
import { MCP_TOOL_NAMES } from './tool-names.js';
import { formatToolError } from '../utils/errors.js';

/**
 * MCP Server for Codememory.
 * Follows Rule 14: Every MCP tool must return structured JSON. No plain text responses.
 */
export class CodememoryServer {
  private server: Server;
  private dbManager: DatabaseManager;
  private captureIntentTool: CaptureIntentTool;
  private recordRuntimeTool: RecordRuntimeTool;
  private logFailureTool: LogFailureTool;
  private getRepairBriefTool: GetRepairBriefTool;
  private queryMemoryTool: QueryMemoryTool;

  /**
   * Initializes the MCP server and all its tools.
   */
  constructor() {
    this.server = new Server(
      {
        name: 'codememory',
        version: '0.1.0',
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
    const repairAssembler = new RepairAssembler(intentQueries, runtimeQueries);

    this.captureIntentTool = new CaptureIntentTool(intentQueries);
    this.recordRuntimeTool = new RecordRuntimeTool(intentQueries, runtimeQueries);
    this.logFailureTool = new LogFailureTool(intentQueries, runtimeQueries);
    this.getRepairBriefTool = new GetRepairBriefTool(repairAssembler);
    this.queryMemoryTool = new QueryMemoryTool(intentQueries);

    this.setupTools();
  }

  /**
   * Sets up the MCP tools.
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
            name: MCP_TOOL_NAMES.get_repair_brief,
            description: 'The killer feature — called when AI needs to fix something.',
            inputSchema: {
              type: 'object',
              properties: {
                failure_id: { type: 'string' },
                memory_id: { type: 'string' },
              },
            },
          },
          {
            name: MCP_TOOL_NAMES.query_memory,
            description: 'General purpose memory search.',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: { type: 'string' },
                since: { type: 'number' },
                status: { type: 'string' },
                limit: { type: 'number' },
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
        if (name === MCP_TOOL_NAMES.get_repair_brief) {
          const input = args as { failure_id?: string; memory_id?: string };
          return { content: [{ type: 'text', text: JSON.stringify(await this.getRepairBriefTool.execute(input)) }] };
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
}
