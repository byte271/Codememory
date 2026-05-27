import { RepairBriefOutput } from '../../types/index.js';
import { RepairAssembler } from '../../engines/repair/assembler.js';
import { logger } from '../../utils/logger.js';
import { CodememoryError, CODEMEMORY_ERROR_CODES } from '../../utils/errors.js';

/**
 * Tool to retrieve a repair brief for AI.
 * Follows Rule 14: Every MCP tool must return structured JSON. No plain text responses.
 */
export class GetRepairBriefTool {
  private assembler: RepairAssembler;

  /**
   * Initializes the tool with a repair assembler.
   * @param assembler The assembler to use for building briefs.
   */
  constructor(assembler: RepairAssembler) {
    this.assembler = assembler;
  }

  /**
   * Executes the get_repair_brief tool.
   * @param input The input containing failure_id or memory_id.
   * @returns The repair brief output.
   */
  public async execute(input: { failure_id?: string; memory_id?: string }): Promise<RepairBriefOutput> {
    try {
      if (input.failure_id) {
        return await this.assembler.assemble(input.failure_id);
      }
      
      if (input.memory_id) {
        return await this.assembler.assemble_by_memory_id(input.memory_id);
      }

      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.MISSING_REPAIR_TARGET,
        'Either failure_id or memory_id must be provided'
      );
    } catch (error) {
      logger.error('Failed to get repair brief', error, { 
        input,
        timestamp: Date.now(),
        rule: 'Rule 06 compliance'
      });
      throw error;
    }
  }
}
