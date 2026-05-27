/**
 * Core type definitions for Codememory.
 * Follows Rule 12: All public APIs must have TypeScript types exported from /src/types/index.ts.
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

/** Structured MCP error payload (Rule 14). */
export interface ToolErrorPayload {
  error: {
    code: string;
    message: string;
  };
}
