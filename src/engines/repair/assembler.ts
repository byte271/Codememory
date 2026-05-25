import { IntentRecord, RuntimeSnapshot, FailureRecord, RepairBriefOutput } from '../../types/index.js';
import { IntentQueries } from '../../store/queries/intent.js';
import { RuntimeQueries } from '../../store/queries/runtime.js';
import { logger } from '../../utils/logger.js';
import { RepairFormatter } from './formatter.js';

/**
 * Assembler to build repair briefs for AI.
 * Follows Rule 03: NEVER write a function without a JSDoc comment explaining intent.
 */
export class RepairAssembler {
  private intentQueries: IntentQueries;
  private runtimeQueries: RuntimeQueries;
  private formatter: RepairFormatter;

  /**
   * Initializes the assembler with intent and runtime queries.
   * @param intentQueries The queries for intent records.
   * @param runtimeQueries The queries for runtime records.
   */
  constructor(intentQueries: IntentQueries, runtimeQueries: RuntimeQueries) {
    this.intentQueries = intentQueries;
    this.runtimeQueries = runtimeQueries;
    this.formatter = new RepairFormatter();
  }

  /**
   * Retrieves the latest failure for a given intent ID.
   * @param intentId The intent ID to query.
   * @returns The latest failure record ID or undefined.
   */
  public getLatestFailureForIntent(intentId: string): { id: string } | undefined {
    const failures = this.runtimeQueries.getFailuresByIntentId(intentId);
    const unresolved = failures.find((f) => f.repair_status === 'unresolved');
    if (unresolved) {
      return { id: unresolved.id };
    }
    return failures.length > 0 ? { id: failures[0].id } : undefined;
  }

  /**
   * Assembles a complete repair brief for a given memory ID (most recent failure).
   * @param memoryId The memory ID of the intent.
   * @returns The assembled repair brief.
   */
  public async assemble_by_memory_id(memoryId: string): Promise<RepairBriefOutput> {
    const failure = this.getLatestFailureForIntent(memoryId);
    if (!failure) {
      // Return a structured low-confidence brief rather than throwing — callers
      // (MCP tools) get a useful response instead of an unhandled exception.
      const intent = this.intentQueries.getById(memoryId);
      const message = intent
        ? `No failures recorded yet for "${intent.prompt.slice(0, 60)}". Run the code to capture runtime data.`
        : `No intent or failure records found for memory_id: ${memoryId}`;
      logger.warn('assemble_by_memory_id: no failures found', { memoryId });
      return {
        original_intent: intent?.prompt ?? '',
        generated_code: intent?.generated ?? '',
        runtime_history: [],
        failure_details: null,
        repair_context: message,
        confidence: 'low',
      };
    }
    return this.assemble(failure.id);
  }

  /**
   * Assembles a complete repair brief for a given failure ID.
   * @param failureId The ID of the failure record.
   * @returns The assembled repair brief.
   */
  public async assemble(failureId: string): Promise<RepairBriefOutput> {
    try {
      // 1. Get failure details
      const failure = this.runtimeQueries.getFailureById(failureId);

      if (!failure) {
        throw new Error(`Failure record not found: ${failureId}`);
      }

      // 2. Get original intent
      const intent = this.intentQueries.getById(failure.intent_id);
      if (!intent) {
        throw new Error(`Intent record not found: ${failure.intent_id}`);
      }

      // 3. Get runtime history
      const snapshots = this.runtimeQueries.getSnapshotsByIntentId(failure.intent_id);

      // 4. Format repair context
      const repairContext = this.formatRepairContext(intent, failure, snapshots);
      const aiOptimizedBrief = this.formatter.formatForAI(repairContext, failure.error_type);

      // 5. Calculate confidence score based on information completeness (Rule 20)
      const confidence = this.calculateConfidence(intent, failure, snapshots);

      return {
        original_intent: intent.prompt,
        generated_code: intent.generated,
        runtime_history: snapshots,
        failure_details: failure,
        repair_context: aiOptimizedBrief,
        confidence
      };
    } catch (error) {
      logger.error('Failed to assemble repair brief', error, { failureId });
      throw error;
    }
  }

  /**
   * Calculates the confidence level of the repair brief based on the
   * completeness of the information available, NOT snapshot count.
   *
   * - high:   prompt + stack trace + snapshots + call chain (AI has all it needs)
   * - medium: prompt + stack trace, but no runtime snapshots
   * - low:    missing intent prompt or stack trace
   *
   * @param intent The captured intent record.
   * @param failure The failure record.
   * @param snapshots Recorded runtime snapshots for the intent.
   * @returns The computed confidence level.
   */
  private calculateConfidence(
    intent: IntentRecord,
    failure: FailureRecord,
    snapshots: RuntimeSnapshot[]
  ): 'high' | 'medium' | 'low' {
    const hasPrompt = intent.prompt.trim().length > 10;
    const hasStackTrace = !!(failure.stack_trace && failure.stack_trace.length > 0);
    const hasSnapshots = snapshots.length > 0;
    const hasCallChain = !!(failure.call_chain && failure.call_chain !== '[]');

    if (hasPrompt && hasStackTrace && hasSnapshots && hasCallChain) return 'high';
    if (hasPrompt && hasStackTrace) return 'medium';
    return 'low';
  }

  /**
   * Formats the context for AI consumption.
   */
  private formatRepairContext(intent: IntentRecord, failure: FailureRecord, snapshots: RuntimeSnapshot[]): string {
    let context = `## REPAIR BRIEF\n\n`;
    context += `### Original Intent\n${intent.prompt}\n\n`;
    context += `### Generated Code\n\`\`\`${intent.language}\n${intent.generated}\n\`\`\`\n\n`;
    context += `### Failure Details\n`;
    context += `- Error Type: ${failure.error_type}\n`;
    context += `- Message: ${failure.error_message}\n`;
    context += `- Failed At: ${new Date(failure.failed_at).toISOString()}\n`;
    context += `- Stack Trace:\n\`\`\`\n${failure.stack_trace}\n\`\`\`\n`;
    const callChain = this.formatCallChain(failure.call_chain ?? '');
    if (callChain) {
      context += `- Call Chain: ${callChain}\n`;
    }
    context += `\n`;

    context += `### Execution History\n`;
    if (snapshots.length > 0) {
      snapshots.forEach((s, i) => {
        context += `${i + 1}. Function: ${s.function_name} | Success: ${s.success === 1 ? 'YES' : 'NO'} | Duration: ${s.duration_ms}ms\n`;
        context += `   Args: ${s.arguments}\n`;
        if (s.return_value) context += `   Returns: ${s.return_value}\n`;
      });
    } else {
      context += `No snapshots recorded prior to failure.\n`;
    }

    return context;
  }

  /**
   * Formats stored call_chain JSON for repair context.
   *
   * @param callChain Serialized JSON array from failures.call_chain.
   * @returns Human-readable chain or empty string when absent.
   */
  private formatCallChain(callChain: string): string {
    if (!callChain || callChain === '[]') {
      return '';
    }
    try {
      const parsed = JSON.parse(callChain) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map(String).join(' → ');
      }
    } catch {
      // fall through to raw string
    }
    return callChain;
  }
}
