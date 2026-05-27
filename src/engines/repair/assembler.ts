import { IntentRecord, RuntimeSnapshot, FailureRecord, RepairBriefOutput, ProvenanceRecord } from '../../types/index.js';
import { IntentQueries } from '../../store/queries/intent.js';
import { RuntimeQueries } from '../../store/queries/runtime.js';
import { logger } from '../../utils/logger.js';
import { RepairFormatter } from './formatter.js';
import { RepairProvenance } from './provenance.js';
import { CodememoryError, CODEMEMORY_ERROR_CODES } from '../../utils/errors.js';
import { truncate, MAX_PROVENANCE_FIELD_LENGTH } from '../../config.js';

/** Maximum chars for error_type in repair briefs to prevent prompt injection. */
const MAX_BRIEF_ERROR_TYPE = 200;
/** Maximum chars for error_message in repair briefs. */
const MAX_BRIEF_ERROR_MESSAGE = 2_000;
/** Maximum chars for stack_trace in repair briefs. */
const MAX_BRIEF_STACK_TRACE = 8_000;
/** Maximum chars for error_message in proven fix entries. */
const MAX_PROVENANCE_ERROR_MESSAGE = 200;
/** Maximum chars for intent.prompt in proven fix entries. */
const MAX_PROVENANCE_INTENT_PROMPT = 120;

/**
 * Assembler to build repair briefs for AI.
 * Follows Rule 03: NEVER write a function without a JSDoc comment explaining intent.
 */
export class RepairAssembler {
  private intentQueries: IntentQueries;
  private runtimeQueries: RuntimeQueries;
  private formatter: RepairFormatter;
  private provenance: RepairProvenance;

  /**
   * Initializes the assembler with intent and runtime queries.
   * @param intentQueries The queries for intent records.
   * @param runtimeQueries The queries for runtime records.
   * @param provenance    Shared RepairProvenance instance (v0.2).
   */
  constructor(intentQueries: IntentQueries, runtimeQueries: RuntimeQueries, provenance: RepairProvenance) {
    this.intentQueries = intentQueries;
    this.runtimeQueries = runtimeQueries;
    this.formatter = new RepairFormatter();
    this.provenance = provenance;
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
        proven_fixes: [],
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
        throw new CodememoryError(
          CODEMEMORY_ERROR_CODES.FAILURE_NOT_FOUND,
          `Failure record not found: ${failureId}`
        );
      }

      // 2. Get original intent
      const intent = this.intentQueries.getById(failure.intent_id);
      if (!intent) {
        throw new CodememoryError(
          CODEMEMORY_ERROR_CODES.INTENT_NOT_FOUND,
          `Intent record not found: ${failure.intent_id}`
        );
      }

      // 3. Get runtime history
      const snapshots = this.runtimeQueries.getSnapshotsByIntentId(failure.intent_id);

      // 4. Format repair context
      const repairContext = this.formatRepairContext(intent, failure, snapshots);
      const aiOptimizedBrief = this.formatter.formatForAI(repairContext, failure.error_type);

      // 5. Calculate confidence score based on information completeness (Rule 20)
      const confidence = this.calculateConfidence(intent, failure, snapshots);

      // v0.2: Search for proven fixes with similar error shape
      const provenFixes = this.provenance.findSimilarFixes(
        failure.error_type,
        failure.error_message,
        3
      );

      // Append proven fix context to the repair brief
      const briefWithProvenance = this.appendProvenance(aiOptimizedBrief, provenFixes);

      return {
        original_intent: intent.prompt,
        generated_code: intent.generated,
        runtime_history: snapshots,
        failure_details: failure,
        repair_context: briefWithProvenance,
        confidence,
        proven_fixes: provenFixes,
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
    context += `- Error Type: ${truncate(failure.error_type, MAX_BRIEF_ERROR_TYPE)}\n`;
    context += `- Message: ${truncate(failure.error_message, MAX_BRIEF_ERROR_MESSAGE)}\n`;
    context += `- Failed At: ${new Date(failure.failed_at).toISOString()}\n`;
    context += `- Stack Trace:\n\`\`\`\n${truncate(failure.stack_trace ?? '', MAX_BRIEF_STACK_TRACE)}\n\`\`\`\n`;
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
   * Appends proven fix suggestions to the repair context when available.
   * Gives the AI agent concrete examples of what worked for similar errors.
   *
   * v0.2.0: All user-originated strings are truncated to prevent prompt injection
   * attacks via crafted approach/diff_summary/error_message values that could
   * override system instructions when fed to the AI.
   *
   * @param brief     The existing AI-optimized repair context.
   * @param fixes     Provenance records from past resolved failures.
   * @returns         The augmented repair context.
   */
  private appendProvenance(
    brief: string,
    fixes: ProvenanceRecord[]
  ): string {
    if (fixes.length === 0) return brief;

    let section = '\n\n### PROVEN FIXES (similar errors resolved before)\n';
    section += 'The following fixes resolved failures with a similar error shape. Use these as a starting point.\n\n';

    fixes.forEach((fix, i) => {
      const errorMsg = truncate(fix.failure.error_message, MAX_PROVENANCE_ERROR_MESSAGE);
      const approach = truncate(fix.resolution.approach || '(no approach recorded)', MAX_PROVENANCE_FIELD_LENGTH);
      const diff = truncate(fix.resolution.diff_summary || '(no diff recorded)', MAX_PROVENANCE_FIELD_LENGTH);
      const intentPrompt = truncate(fix.intent.prompt, MAX_PROVENANCE_INTENT_PROMPT);

      section += `**Fix #${i + 1}** (${fix.match_context})\n`;
      section += `- Original error: ${fix.failure.error_type}: ${errorMsg}\n`;
      section += `- Fix approach: ${approach}\n`;
      section += `- Fix diff summary: ${diff}\n`;
      section += `- Fixing intent: ${intentPrompt}\n`;
      section += `- Resolved at: ${new Date(fix.resolution.resolved_at).toISOString()}\n\n`;
    });

    return brief + section;
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
    } catch (err) {
      // JSON parse error — fall through to return raw string below.
      // Malformed call_chain JSON is non-critical; the raw string
      // is still useful for debugging.
      logger.warn('Failed to parse call_chain JSON, returning raw string', { err: err instanceof Error ? err.message : String(err) });
    }
    return callChain;
  }
}
