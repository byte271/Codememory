/**
 * Canonical MCP tool names exposed by CodememoryServer.
 * Must match CODEMEMORY.md / README so agents call tools that actually exist.
 */
export const MCP_TOOL_NAMES = {
  capture_intent: 'capture_intent',
  record_runtime: 'record_runtime',
  log_failure: 'log_failure',
  log_resolution: 'log_resolution',
  get_repair_brief: 'get_repair_brief',
  get_code_lineage: 'get_code_lineage',
  query_memory: 'query_memory',
} as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES];
