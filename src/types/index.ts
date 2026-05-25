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

export interface CaptureIntentInput {
  prompt: string;
  generated_code: string;
  file_path: string;
  ai_tool: string;
  language: string;
}

export interface CaptureIntentOutput {
  memory_id: string;
  status: 'captured';
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
}

export interface QueryMemoryInput {
  file_path?: string;
  since?: number;
  status?: string;
  limit?: number;
}

export interface QueryMemoryOutput {
  records: IntentRecord[];
  total: number;
}

/** Structured MCP error payload (Rule 14). */
export interface ToolErrorPayload {
  error: {
    code: string;
    message: string;
  };
}
