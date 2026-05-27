import { DatabaseManager } from '../../store/database.js';
import {
  IntentRecord,
  FailureRecord,
  Resolution,
  CodeLineageEntry,
  GetCodeLineageOutput,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { CodememoryError, CODEMEMORY_ERROR_CODES } from '../../utils/errors.js';

/**
 * Code evolution lineage engine — traces the full generational history of
 * AI-generated code.
 *
 * Starting from any intent, walks up the `parent_intent_id` chain to build
 * a linked list of generations. Each entry includes:
 *   - The intent that was generated.
 *   - Failures that triggered the next generation.
 *   - The resolution that linked the failures to the fixing intent.
 *
 * This allows AI agents to see what was tried before, why it failed, and
 * what approach was taken to fix it — preventing code-looping.
 *
 * Follows Rule 03: every function has a JSDoc comment.
 */
export class LineageEngine {
  private manager: DatabaseManager;

  /**
   * @param manager DatabaseManager providing the connection + statement cache.
   */
  constructor(manager: DatabaseManager) {
    this.manager = manager;
  }

  /**
   * Traces the full lineage chain for a given memory_id.
   *
   * Walks up the `parent_intent_id` chain, building a linked list from the
   * root (oldest generation) down to the given intent. Each node includes
   * the trigger failures and resolution that caused the next generation.
   *
   * @param memoryId The intent to trace lineage for.
   * @returns        The full lineage tree rooted at the oldest ancestor.
   */
  public trace(memoryId: string): GetCodeLineageOutput {
    // Build the chain bottom-up
    const chain: CodeLineageEntry[] = [];
    let totalFailures = 0;
    let currentId: string | null = memoryId;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) {
        logger.warn('Circular parent_intent_id detected, stopping lineage trace', { memoryId, currentId });
        break;
      }
      visited.add(currentId);

      const intent = this.getIntent(currentId);
      if (!intent) break;

      const failures = this.getFailuresForIntent(currentId);
      totalFailures += failures.length;

      const resolution = this.getResolutionForFixingIntent(currentId);

      chain.unshift({
        intent,
        trigger_failures: failures,
        trigger_resolution: resolution,
        parent: null, // linked below
      });

      currentId = intent.parent_intent_id;
    }

    // Link parent pointers top-down
    for (let i = 0; i < chain.length - 1; i++) {
      chain[i].parent = chain[i + 1];
    }

    if (chain.length === 0) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.INTENT_NOT_FOUND,
        `No intent record found for memory_id: ${memoryId}`
      );
    }

    logger.info('Traced code lineage', {
      memoryId,
      depth: chain.length,
      totalFailures,
    });

    return {
      root: chain[0],
      depth: chain.length,
      total_failures: totalFailures,
    };
  }

  /**
   * Retrieves a single intent by ID.
   */
  private getIntent(id: string): IntentRecord | undefined {
    return this.manager.prepare(
      'SELECT * FROM intent_records WHERE id = ?'
    ).get(id) as IntentRecord | undefined;
  }

  /**
   * Retrieves all failures for an intent, newest first.
   */
  private getFailuresForIntent(intentId: string): FailureRecord[] {
    return this.manager.prepare(
      'SELECT * FROM failures WHERE intent_id = ? ORDER BY failed_at DESC'
    ).all(intentId) as FailureRecord[];
  }

  /**
   * Finds the resolution (if any) that points to this intent as the fix.
   */
  private getResolutionForFixingIntent(
    fixingIntentId: string
  ): Resolution | null {
    const row = this.manager.prepare(
      'SELECT * FROM resolutions WHERE fixing_intent_id = ? ORDER BY resolved_at DESC LIMIT 1'
    ).get(fixingIntentId) as Resolution | undefined;
    return row ?? null;
  }
}
