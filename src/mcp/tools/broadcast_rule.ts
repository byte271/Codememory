/**
 * MCP Tool: broadcast_rule — share a guard rule with the team (v0.3.5).
 *
 * When a developer identifies a dangerous coding pattern and creates
 * a guard rule, this tool broadcasts it to all connected peers. The
 * entire team gains instant immunity — every AI agent on the network
 * will now warn about this pattern before generating code.
 */

import { RelayEngine } from '../../engines/relay/engine.js';
import { BroadcastRuleInput, BroadcastRuleOutput } from '../../engines/relay/types.js';
import { logger } from '../../utils/logger.js';

export class BroadcastRuleTool {
  private relay: RelayEngine;

  constructor(relay: RelayEngine) {
    this.relay = relay;
  }

  /**
   * Broadcasts a guard rule to all connected peers.
   *
   * @param input The guard rule to broadcast.
   * @returns     Broadcast result with number of peers reached.
   */
  public async execute(input: BroadcastRuleInput): Promise<BroadcastRuleOutput> {
    try {
      const peersReached = this.relay.broadcastRule({
        error_type: input.error_type,
        error_pattern: input.error_pattern,
        suggestion: input.suggestion,
        project_name: 'unknown',
      });

      logger.info('BroadcastRuleTool: rule broadcast', {
        errorType: input.error_type,
        peersReached,
      });

      return {
        rule_id: `broadcast-${input.error_type}`,
        peers_reached: peersReached,
      };
    } catch (error) {
      logger.error('BroadcastRuleTool: failed', error);
      throw error;
    }
  }
}
