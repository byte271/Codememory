import { CaptureIntentInput, CaptureIntentOutput, IntentRecord } from '../../types/index.js';
import { IntentQueries } from '../../store/queries/intent.js';
import { IntentExtractor } from '../../engines/intent/extractor.js';
import { IntentBinder } from '../../engines/intent/binder.js';
import { hash } from '../../utils/hash.js';
import { logger } from '../../utils/logger.js';
import { isSqliteUniqueConstraint } from '../../utils/sqlite.js';

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
      const timestamp = Date.now();
      const intent = this.extractor.extract(input.prompt);
      const memoryId = hash.generateMemoryId(
        `${input.file_path}:${input.prompt}:${input.generated_code}`,
        timestamp
      );
      const boundCode = this.binder.bind(input.generated_code, memoryId);

      const record: IntentRecord = {
        id: memoryId,
        created_at: timestamp,
        file_path: input.file_path,
        prompt: intent,
        generated: boundCode,
        ai_tool: input.ai_tool,
        language: input.language,
        status: 'active'
      };

      try {
        this.queries.insert(record);
      } catch (error) {
        if (isSqliteUniqueConstraint(error) && this.queries.exists(memoryId)) {
          logger.info('Intent already captured (idempotent)', { memoryId });
          return { memory_id: memoryId, status: 'captured' };
        }
        throw error;
      }

      logger.info('Captured intent', { memoryId, filePath: input.file_path });

      return {
        memory_id: memoryId,
        status: 'captured'
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
}
