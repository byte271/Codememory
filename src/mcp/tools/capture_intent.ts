import { CaptureIntentInput, CaptureIntentOutput, IntentRecord } from '../../types/index.js';
import { IntentQueries } from '../../store/queries/intent.js';
import { IntentExtractor } from '../../engines/intent/extractor.js';
import { IntentBinder } from '../../engines/intent/binder.js';
import { hash } from '../../utils/hash.js';
import { logger } from '../../utils/logger.js';
import { isSqliteUniqueConstraint } from '../../utils/sqlite.js';
import { CodememoryError, CODEMEMORY_ERROR_CODES } from '../../utils/errors.js';
import {
  MAX_PROMPT_LENGTH,
  MAX_CODE_LENGTH,
  MAX_PATH_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_REPLACEMENT_REASON_LENGTH,
} from '../../config.js';

/**
 * Tool to capture AI code generation intent.
 * Follows Rule 14: Every MCP tool must return structured JSON. No plain text responses.
 */
export class CaptureIntentTool {
  private queries: IntentQueries;
  private extractor: IntentExtractor;
  private binder: IntentBinder;

  /**
   * Initializes the tool with intent queries.
   * @param queries The queries to use for database operations.
   */
  constructor(queries: IntentQueries) {
    this.queries = queries;
    this.extractor = new IntentExtractor();
    this.binder = new IntentBinder();
  }

  /**
   * Executes the capture_intent tool.
   * @param input The input parameters for the tool.
   * @returns The output containing the memory_id.
   */
  public async execute(input: CaptureIntentInput): Promise<CaptureIntentOutput> {
    try {
      // ── Input size validation (DoS guard) ─────────────────────────
      this.validateInput(input);

      const timestamp = Date.now();
      const intent = this.extractor.extract(input.prompt);
      const memoryId = hash.generateMemoryId(
        `${input.file_path}:${input.prompt}:${input.generated_code}`
      );
      const boundCode = this.binder.bind(input.generated_code, memoryId);

      // v0.2 lineage: validate parent intent exists BEFORE inserting the
      // child, so we never create a dangling parent_intent_id reference.
      if (input.parent_intent_id) {
        const parent = this.queries.getById(input.parent_intent_id);
        if (!parent) {
          throw new CodememoryError(
            CODEMEMORY_ERROR_CODES.INTENT_NOT_FOUND,
            `Parent intent not found: ${input.parent_intent_id}`
          );
        }
        // v0.2.0: Verify parent intent belongs to the same file_path to
        // prevent cross-file lineage poisoning (e.g. linking an intent for
        // auth.ts as replacing one from payment.ts).
        if (parent.file_path !== input.file_path) {
          throw new CodememoryError(
            CODEMEMORY_ERROR_CODES.INVALID_QUERY,
            `Parent intent ${input.parent_intent_id} belongs to file "${parent.file_path}", not "${input.file_path}"`
          );
        }
      }

      const record: IntentRecord = {
        id: memoryId,
        created_at: timestamp,
        file_path: input.file_path,
        prompt: intent,
        generated: boundCode,
        ai_tool: input.ai_tool,
        language: input.language,
        status: 'active',
        parent_intent_id: input.parent_intent_id ?? null,
        replacement_reason: input.replacement_reason ?? '',
      };

      // v0.2 lineage: wrap insert + markReplaced in a transaction so
      // the child never exists without the parent being marked replaced.
      const db = this.queries.getDb();
      const doInsert = db.transaction(() => {
        this.queries.insert(record);
        if (input.parent_intent_id) {
          const replaced = this.queries.markReplaced(input.parent_intent_id);
          if (!replaced) {
            // Another concurrent caller already replaced this parent.
            // Roll back the transaction so we don't create a second active
            // child for the same parent_intent_id.
            throw new CodememoryError(
              CODEMEMORY_ERROR_CODES.DUPLICATE_INTENT,
              `Parent intent ${input.parent_intent_id} was already replaced by a concurrent capture_intent call`
            );
          }
        }
      });

      try {
        doInsert();
      } catch (error) {
        if (isSqliteUniqueConstraint(error) && this.queries.exists(memoryId)) {
          logger.info('Intent already captured (idempotent)', { memoryId });
          return { memory_id: memoryId, status: 'captured', duplicate: true };
        }
        throw error;
      }

      if (input.parent_intent_id) {
        logger.info('Marked parent intent as replaced', {
          parentId: input.parent_intent_id,
          childId: memoryId,
        });
      }

      logger.info('Captured intent', { memoryId, filePath: input.file_path });

      return {
        memory_id: memoryId,
        status: 'captured',
        duplicate: false
      };
    } catch (error) {
      logger.error('Failed to capture intent', error, {
        input,
        timestamp: Date.now(),
        rule: 'Rule 06 compliance',
      });
      throw error;
    }
  }

  /**
   * Validates input sizes to prevent DoS via massive payloads.
   * @throws CodememoryError(INPUT_TOO_LARGE) when any field exceeds its limit.
   */
  private validateInput(input: CaptureIntentInput): void {
    if (input.prompt.length > MAX_PROMPT_LENGTH) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.INPUT_TOO_LARGE,
        `prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`
      );
    }
    if (input.generated_code.length > MAX_CODE_LENGTH) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.INPUT_TOO_LARGE,
        `generated_code exceeds maximum length of ${MAX_CODE_LENGTH} characters`
      );
    }
    if (input.file_path.length > MAX_PATH_LENGTH) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.INPUT_TOO_LARGE,
        `file_path exceeds maximum length of ${MAX_PATH_LENGTH} characters`
      );
    }
    if (input.ai_tool.length > MAX_LABEL_LENGTH) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.INPUT_TOO_LARGE,
        `ai_tool exceeds maximum length of ${MAX_LABEL_LENGTH} characters`
      );
    }
    if (input.language.length > MAX_LABEL_LENGTH) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.INPUT_TOO_LARGE,
        `language exceeds maximum length of ${MAX_LABEL_LENGTH} characters`
      );
    }
    if (input.replacement_reason && input.replacement_reason.length > MAX_REPLACEMENT_REASON_LENGTH) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.INPUT_TOO_LARGE,
        `replacement_reason exceeds maximum length of ${MAX_REPLACEMENT_REASON_LENGTH} characters`
      );
    }
  }
}
