/**
 * Core type definitions for Codememory.
 * Follows Rule 12: All public APIs must have TypeScript types exported from /src/types/index.ts.
 *
 * v0.3: Added Project, AutoHealTask, GuardRule, GuardPrediction,
 *       Cross-project, and Timeline types.
 */

export interface IntentRecord {
  id: string;
  created_at: number;
  file_path: string;
  prompt: string;
  generated: string;
  ai_tool: string;
  language: string;
  status: 'active' | 'deprecated' | 'replaced';
  /** v0.2 lineage: parent intent that this replaced, if any. */
  parent_intent_id: string | null;
  /** v0.2 lineage: why the replacement was made. */
  replacement_reason: string;
  /** v0.3: project this intent belongs to, for cross-project knowledge. */
  project_id: string | null;
}

export interface RuntimeSnapshot {
  id: string;
  intent_id: string;
  recorded_at: number;
  function_name: string;
  file_path: string;
  arguments: string | null;
  return_value: string | null;
  duration_ms: number | null;
  success: number;
}

export interface FailureRecord {
  id: string;
  intent_id: string;
  snapshot_id: string | null;
  failed_at: number;
  error_type: string;
  error_message: string;
  stack_trace: string | null;
  call_chain: string | null;
  repair_status: 'unresolved' | 'in_progress' | 'resolved';
}

/** v0.2: Links a resolved failure to the intent that fixed it. */
export interface Resolution {
  id: string;
  failure_id: string;
  fixing_intent_id: string;
  approach: string;
  diff_summary: string;
  resolved_at: number;
}

/** v0.2: A single link in a code lineage chain. */
export interface CodeLineageEntry {
  intent: IntentRecord;
  /** Failures that caused this generation. */
  trigger_failures: FailureRecord[];
  /** Resolution that linked the previous failure to this intent. */
  trigger_resolution: Resolution | null;
  /** The previous generation, if any. */
  parent: CodeLineageEntry | null;
}

/** v0.2: A proven fix from the past with the same error shape. */
export interface ProvenanceRecord {
  resolution: Resolution;
  intent: IntentRecord;
  failure: FailureRecord;
  /** Text snippet showing matching content (FTS5 snippet). */
  match_context: string;
}

/** v0.2: FTS5 search result with score and snippet. */
export interface IntentSearchResult {
  record: IntentRecord;
  score: number;
  snippet: string;
}

// ── v0.3 Types ────────────────────────────────────────────────────────────

/** v0.3: Registered project for cross-project knowledge sharing. */
export interface Project {
  id: string;
  name: string;
  root_path: string;
  created_at: number;
}

/** v0.3: Auto-heal task for autonomous self-repair. */
export interface AutoHealTask {
  id: string;
  failure_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  patch_code: string | null;
  test_results: string | null;
  pr_url: string | null;
  error_log: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

/** v0.3: Predictive guard rule — learned failure pattern. */
export interface GuardRule {
  id: string;
  error_pattern: string;
  error_type: string;
  suggestion: string;
  file_pattern: string;
  project_id: string | null;
  hit_count: number;
  created_at: number;
}

/** v0.3: Guard prediction log entry. */
export interface GuardPrediction {
  id: string;
  intent_id: string;
  rule_id: string;
  confidence: number;
  was_accurate: number;
  created_at: number;
}

/** v0.3: Cross-project search result. */
export interface CrossProjectResult {
  project: Project;
  intent: IntentRecord;
  failure: FailureRecord | null;
  resolution: Resolution | null;
  match_context: string;
}

/** v0.3: A single event on the behavioral timeline. */
export interface TimelineEvent {
  timestamp: number;
  type: 'intent_created' | 'runtime_recorded' | 'failure_logged' | 'resolution_logged' | 'auto_heal_triggered' | 'guard_warning';
  summary: string;
  file_path: string;
  detail: Record<string, unknown>;
}

/** v0.3: Aggregated timeline data for the dashboard. */
export interface TimelineData {
  events: TimelineEvent[];
  stats: {
    totalIntents: number;
    totalFailures: number;
    totalResolutions: number;
    totalAutoHeals: number;
    errorRate: number;
    fixRate: number;
    recentTrends: TrendPoint[];
  };
}

/** v0.3: A single data point on a trend line. */
export interface TrendPoint {
  label: string;
  errors: number;
  fixes: number;
}

// ── v0.2 Input/Output types ───────────────────────────────────────────────

export interface CaptureIntentInput {
  prompt: string;
  generated_code: string;
  file_path: string;
  ai_tool: string;
  language: string;
  /** v0.2: Parent intent this replaces, for lineage tracking. */
  parent_intent_id?: string;
  /** v0.2: Why the parent was replaced. */
  replacement_reason?: string;
  /** v0.3: Project identifier for cross-project knowledge. */
  project_name?: string;
}

export interface CaptureIntentOutput {
  memory_id: string;
  status: 'captured';
  /** v0.2.0: true when the intent was already recorded (idempotent duplicate). */
  duplicate: boolean;
}

export interface RecordRuntimeInput {
  memory_id: string;
  function_name: string;
  file_path?: string;
  arguments: unknown[];
  return_value?: unknown;
  duration_ms: number;
  success: boolean;
}

export interface RecordRuntimeOutput {
  snapshot_id: string;
  status: 'recorded';
}

export interface LogFailureInput {
  memory_id: string;
  snapshot_id?: string;
  error_type: string;
  error_message: string;
  stack_trace: string;
  call_chain: string[];
}

export interface LogFailureOutput {
  failure_id: string;
  status: 'logged';
}

export interface RepairBriefOutput {
  original_intent: string;
  generated_code: string;
  runtime_history: RuntimeSnapshot[];
  /** Null when no failure exists yet for the requested memory_id. */
  failure_details: FailureRecord | null;
  repair_context: string;
  confidence: 'high' | 'medium' | 'low';
  /** v0.2: Similar past fixes the agent can learn from. */
  proven_fixes: ProvenanceRecord[];
}

export interface QueryMemoryInput {
  file_path?: string;
  since?: number;
  status?: string;
  limit?: number;
  /** v0.2: Natural-language FTS5 search query. When set, file_path filters within matches. */
  query?: string;
}

export interface QueryMemoryOutput {
  records: IntentRecord[];
  total: number;
  /** v0.2: FTS5 search results when query was used. */
  search_results?: IntentSearchResult[];
}

export interface GetCodeLineageInput {
  memory_id: string;
}

export interface GetCodeLineageOutput {
  /** The root (oldest) intent in the chain. */
  root: CodeLineageEntry;
  /** Number of generations in the lineage. */
  depth: number;
  /** Total failures across all generations. */
  total_failures: number;
}

export interface LogResolutionInput {
  failure_id: string;
  fixing_intent_id: string;
  approach?: string;
  diff_summary?: string;
}

export interface LogResolutionOutput {
  resolution_id: string;
  status: 'resolved';
}

// ── v0.3 Input/Output types ───────────────────────────────────────────────

export interface PredictIssueInput {
  /** The proposed code or approach the AI is about to generate. */
  proposed_code?: string;
  /** Natural language description of what's being attempted. */
  description?: string;
  /** Target file path for context-aware predictions. */
  file_path?: string;
  /** Project name for cross-project rule matching. */
  project_name?: string;
}

export interface PredictIssueOutput {
  warnings: GuardWarning[];
  /** Overall risk level based on matching patterns. */
  risk_level: 'high' | 'medium' | 'low' | 'none';
  /** Total number of matching guard rules found. */
  match_count: number;
}

export interface GuardWarning {
  rule_id: string;
  error_type: string;
  pattern: string;
  suggestion: string;
  confidence: number;
  /** Whether this warning came from another project's experience. */
  from_cross_project: boolean;
}

export interface CrossProjectSearchInput {
  /** Error pattern or description to search across projects. */
  query: string;
  /** Limit results per project (default 5). */
  limit?: number;
}

export interface CrossProjectSearchOutput {
  results: CrossProjectResult[];
  total: number;
  /** Which projects had matches. */
  matched_projects: string[];
}

export interface AutoHealTriggerInput {
  /** The failure_id to auto-heal. */
  failure_id: string;
}

export interface AutoHealTriggerOutput {
  task_id: string;
  /** The current status of the auto-heal task after immediate execution. */
  status: AutoHealTask['status'];
  /** Estimated time to complete (ms). */
  estimated_ms: number;
}

export interface AutoHealStatusInput {
  /** The auto-heal task ID. */
  task_id: string;
}

export interface AutoHealStatusOutput {
  task: AutoHealTask;
  /** The original failure this task is fixing. */
  failure: FailureRecord;
}

export interface TimelineQueryInput {
  /** Start of time range (epoch ms). */
  since?: number;
  /** End of time range (epoch ms). */
  until?: number;
  /** Filter to specific file. */
  file_path?: string;
  /** Max events to return (default 100). */
  limit?: number;
}

export interface TimelineQueryOutput {
  timeline: TimelineData;
}

/** Structured MCP error payload (Rule 14). */
export interface ToolErrorPayload {
  error: {
    code: string;
    message: string;
  };
}

// ── v0.3.5 Relay types ───────────────────────────────────────────────────

/** v0.3.5: Share brief request input. */
export interface ShareBriefInput {
  failure_id: string;
  error_type: string;
  error_pattern: string;
  suggestion: string;
  approach?: string;
  diff_summary?: string;
}

/** v0.3.5: Share brief response. */
export interface ShareBriefOutput {
  shared_id: string;
  peers_reached: number;
}

/** v0.3.5: Broadcast rule request input. */
export interface BroadcastRuleInput {
  error_type: string;
  error_pattern: string;
  suggestion: string;
}

/** v0.3.5: Broadcast rule response. */
export interface BroadcastRuleOutput {
  rule_id: string;
  peers_reached: number;
}

/** v0.3.5: Relay status MCP output. */
export interface RelayStatusOutput {
  status: {
    enabled: boolean;
    running: boolean;
    port: number;
    pairing_configured: boolean;
    peers_online: number;
    peers_total: number;
    briefs_shared: number;
    briefs_received: number;
    last_sync_at: number | null;
  };
  peers: Array<{
    id: string;
    hostname: string;
    address: string;
    port: number;
    last_seen_at: number;
    last_sync_at: number | null;
    is_online: number;
    project_name: string | null;
    discovered_at: number;
  }>;
  recent_briefs: Array<{
    id: string;
    peer_id: string;
    failure_id: string;
    error_type: string;
    error_pattern: string;
    suggestion: string;
    approach: string | null;
    diff_summary: string | null;
    project_name: string | null;
    shared_at: number;
    applied: number;
  }>;
}
