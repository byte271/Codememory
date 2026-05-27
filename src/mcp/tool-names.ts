/**
 * Canonical MCP tool names exposed by CodememoryServer.
 *
 * v0.3.0: Added auto_heal_trigger, auto_heal_status, predict_issue,
 *         and cross_project_search for Autonomous Self-Healing,
 *         Proactive Guardrails, and Cross-Project Knowledge Graph.
 *
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
  // ── v0.3.0 ──────────────────────────────────────────────────
  auto_heal_trigger: 'auto_heal_trigger',
  auto_heal_status: 'auto_heal_status',
  predict_issue: 'predict_issue',
  cross_project_search: 'cross_project_search',
} as const;

