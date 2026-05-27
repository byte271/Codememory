import {
  LogResolutionInput,
  LogResolutionOutput,
  Resolution,
} from '../../types/index.js';
import { RepairProvenance } from '../../engines/repair/provenance.js';
import { IntentQueries } from '../../store/queries/intent.js';
import { RuntimeQueries } from '../../store/queries/runtime.js';
import { assertIntentExists } from '../../utils/validate-intent.js';
import { hash } from '../../utils/hash.js';
import { logger } from '../../utils/logger.js';
import { CodememoryError, CODEMEMORY_ERROR_CODES } from '../../utils/errors.js';
import { isSqliteUniqueConstraint } from '../../utils/sqlite.js';
import { MAX_PROVENANCE_FIELD_LENGTH } from '../../config.js';

/**
 * Tool to log a successful resolution (fix) for a failure.
 *
 * Links the resolved failure to the intent that fixed it, recording the
 * approach and diff summary so future repair briefs can surface proven fixes
 * when similar errors occur.
 *
 * @security v0.2.0: This tool does NOT authenticate the MCP client or verify
 *   ownership of the failure/intent being resolved. In multi-tenant scenarios,
 *   any caller can resolve any failure with any intent, which enables provenance
 *   poisoning (crafted fixes surfacing in future get_repair_brief calls). For
 *   single-user local usage this is acceptable; a multi-tenant deployment would
 *   need client identity tracking and ownership scoping.
 *
 * Follows Rule 14: Every MCP tool must return structured JSON. No plain text responses.
 */
export class LogResolutionTool {
  private provenance: RepairProvenance;
  private intentQueries: IntentQueries;
  private runtimeQueries: RuntimeQueries;

  /**
   * @param provenance    Repair provenance engine for recording resolutions.
   * @param intentQueries Validates the fixing intent exists.
   * @param runtimeQueries Validates the failure exists.
   */
  constructor(
    provenance: RepairProvenance,
    intentQueries: IntentQueries,
    runtimeQueries: RuntimeQueries
  ) {
    this.provenance = provenance;
    this.intentQueries = intentQueries;
    this.runtimeQueries = runtimeQueries;
  }

  /**
   * Executes the log_resolution tool.
   *
   * Validates that both the failure and the fixing intent exist, then records
   * the resolution and marks the failure as resolved.
   *
   * @param input The resolution input.
   * @returns     The resolution output with the new resolution_id.
   */
  public async execute(input: LogResolutionInput): Promise<LogResolutionOutput> {
    try {
      // Validate failure exists
      const failure = this.runtimeQueries.getFailureById(input.failure_id);
      if (!failure) {
        throw new CodememoryError(
          CODEMEMORY_ERROR_CODES.FAILURE_NOT_FOUND,
          `Failure record not found: ${input.failure_id}`
        );
      }

      // Guard against duplicate resolutions — each (failure, fixing_intent)
      // pair must be unique (enforced by DB constraint + this check).
      if (failure.repair_status === 'resolved') {
        throw new CodememoryError(
          CODEMEMORY_ERROR_CODES.DUPLICATE_INTENT,
          `Failure ${input.failure_id} is already resolved. Each failure can only be resolved once.`
        );
      }

      // Validate fixing intent exists
      assertIntentExists(this.intentQueries, input.fixing_intent_id);

      const timestamp = Date.now();
      const resolutionId = hash.generateUniqueId(
        `resolution-${input.failure_id}-${input.fixing_intent_id}`
      );

      const resolution: Resolution = {
        id: resolutionId,
        failure_id: input.failure_id,
        fixing_intent_id: input.fixing_intent_id,
        approach: (input.approach ?? '').slice(0, MAX_PROVENANCE_FIELD_LENGTH),
        diff_summary: (input.diff_summary ?? '').slice(0, MAX_PROVENANCE_FIELD_LENGTH),
        resolved_at: timestamp,
      };

      try {
        this.provenance.record(resolution);
      } catch (error) {
        // Race condition guard: two concurrent calls could both pass the
        // repair_status check above. The DB UNIQUE constraint catches the
        // duplicate INSERT — translate it into a clean CodememoryError.
        if (isSqliteUniqueConstraint(error)) {
          throw new CodememoryError(
            CODEMEMORY_ERROR_CODES.DUPLICATE_INTENT,
            `Failure ${input.failure_id} is already resolved by intent ${input.fixing_intent_id}`
          );
        }
        throw error;
      }

      logger.info('Logged resolution', {
        resolutionId,
        failureId: input.failure_id,
        fixingIntentId: input.fixing_intent_id,
      });

      return {
        resolution_id: resolutionId,
        status: 'resolved',
      };
    } catch (error) {
      logger.error('Failed to log resolution', error, {
        input,
        timestamp: Date.now(),
        rule: 'Rule 06 compliance',
      });
      throw error;
    }
  }
}
