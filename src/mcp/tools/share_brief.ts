/**
 * MCP Tool: share_brief — push a repair brief to peer team members (v0.3.5).
 *
 * When a failure is resolved, the AI agent can call this tool to share
 * the fix with the entire team. The repair brief is broadcast to all
 * connected peers via the encrypted relay, so teammates' AI agents
 * learn from this fix without encountering the same bug.
 */

import { RelayEngine } from '../../engines/relay/engine.js';
import { ShareBriefInput, ShareBriefOutput } from '../../engines/relay/types.js';
import { logger } from '../../utils/logger.js';

export class ShareBriefTool {
  private relay: RelayEngine;

  constructor(relay: RelayEngine) {
    this.relay = relay;
  }

  /**
   * Shares a repair brief with all connected peers.
   *
   * @param input The brief data to share.
   * @returns     Sharing result with number of peers reached.
   */
  public async execute(input: ShareBriefInput): Promise<ShareBriefOutput> {
    try {
      const peersReached = this.relay.shareBrief({
        failure_id: input.failure_id,
        error_type: input.error_type,
        error_pattern: input.error_pattern,
        suggestion: input.suggestion,
        approach: input.approach ?? null,
        diff_summary: input.diff_summary ?? null,
        project_name: null,
      });

      logger.info('ShareBriefTool: brief shared', {
        failureId: input.failure_id,
        errorType: input.error_type,
        peersReached,
      });

      return {
        shared_id: `shared-${input.failure_id}`,
        peers_reached: peersReached,
      };
    } catch (error) {
      logger.error('ShareBriefTool: failed', error);
      throw error;
    }
  }
}
