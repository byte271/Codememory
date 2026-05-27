import { RuntimeSnapshot } from '../../types/index.js';

/**
 * Snapshot Builder for Codememory.
 * Follows Rule 03: NEVER write a function without a JSDoc comment explaining intent.
 */
export class SnapshotBuilder {
  /**
   * Builds a runtime snapshot object.
   * @param data The raw execution data.
   * @returns A formatted RuntimeSnapshot.
   */
  public build(data: Partial<RuntimeSnapshot>): RuntimeSnapshot {
    return {
      id: data.id || '',
      intent_id: data.intent_id || '',
      recorded_at: data.recorded_at || Date.now(),
      function_name: data.function_name || 'anonymous',
      file_path: data.file_path || 'unknown',
      arguments: data.arguments || null,
      return_value: data.return_value || null,
      duration_ms: data.duration_ms || 0,
      success: data.success === 1 ? 1 : 0
    };
  }
}
