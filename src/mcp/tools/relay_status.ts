/**
 * MCP Tool: relay_status — check LAN relay and peer status (v0.3.5).
 *
 * Returns the current relay status including connected peers,
 * shared briefs count, pairing key fingerprint, and recent activity.
 * The AI agent can use this to check whether team knowledge sharing
 * is active before relying on cross-project or guard rule features.
 */

import { RelayEngine } from '../../engines/relay/engine.js';
import { RelayStatusOutput } from '../../engines/relay/types.js';
import { logger } from '../../utils/logger.js';

export class RelayStatusTool {
  private relay: RelayEngine;

  constructor(relay: RelayEngine) {
    this.relay = relay;
  }

  /**
   * Returns the relay status, peer list, and recent shared briefs.
   *
   * @returns Structured relay status output.
   */
  public async execute(): Promise<RelayStatusOutput> {
    try {
      const status = this.relay.getStatus();
      const peers = this.relay.getPeers();
      const recentBriefs = this.relay.getRecentBriefs(20);

      logger.info('RelayStatusTool: status reported', {
        peersOnline: status.peers_online,
        briefsReceived: status.briefs_received,
      });

      return {
        status,
        peers,
        recent_briefs: recentBriefs,
      };
    } catch (error) {
      logger.error('RelayStatusTool: failed', error);
      throw error;
    }
  }
}
