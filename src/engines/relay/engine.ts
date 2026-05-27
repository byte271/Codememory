import { DatabaseManager } from '../../store/database.js';
import { RelayDiscovery, DiscoveredPeer } from './discovery.js';
import { RelayServer } from './relay.js';
import {
  PeerNode,
  SharedBrief,
  SharedBriefData,
  BroadcastRuleData,
  SyncPayload,
  RelayStatus,
} from './types.js';
import {
  generatePairingKey,
  getPairingFingerprint,
  generatePeerId,
} from './encryption.js';
import { hash } from '../../utils/hash.js';
import { logger } from '../../utils/logger.js';

/**
 * Codememory Relay Engine — LAN Neural Link (v0.3.5).
 *
 * Ties together mDNS discovery, encrypted WebSocket relay, and data
 * synchronization to create a zero-config team intelligence layer.
 *
 * Architecture:
 *   - Discovery: mDNS advertises and finds peers on the LAN.
 *   - Relay: WebSocket server + client for encrypted P2P communication.
 *   - Sync: automatically shares repair briefs and guard rules with peers.
 *   - Pairing: auto-generated key with `codememory relay pair` for sharing.
 *
 * Lifecycle:
 *   1. On first run, generates a pairing key and stores it in relay_config.
 *   2. Starts mDNS discovery to find peers on the LAN.
 *   3. For each discovered peer, opens an encrypted WebSocket connection.
 *   4. When a failure is resolved, automatically shares the brief.
 *   5. When a guard rule is learned, broadcasts it to all peers.
 *   6. Received briefs/rules are persisted and surfaced to the local AI.
 *
 * Follows Rule 02: all local — SQLite + mDNS + WebSockets, no cloud.
 * Follows Rule 03: every function has a JSDoc comment.
 */
export class RelayEngine {
  private manager: DatabaseManager;
  private discovery: RelayDiscovery | null = null;
  private relay: RelayServer | null = null;
  private pairingKey: string | null = null;
  private port: number;
  private hostname: string;
  private projectName: string;
  private version: string;
  private running = false;
  private seq = 0;

  /**
   * @param manager     DatabaseManager for persistence.
   * @param port        Relay port to listen on.
   * @param hostname    Local machine hostname.
   * @param projectName Current project name for peer display.
   * @param version     Codememory version string.
   */
  constructor(
    manager: DatabaseManager,
    port: number,
    hostname: string,
    projectName: string,
    version: string,
  ) {
    this.manager = manager;
    this.port = port;
    this.hostname = hostname;
    this.projectName = projectName;
    this.version = version;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Starts the relay engine: loads/creates pairing key, starts
   * mDNS discovery and WebSocket relay server.
   */
  public start(): void {
    if (this.running) return;

    // Load or generate pairing key
    this.pairingKey = this.getOrCreatePairingKey();
    logger.info('RelayEngine: pairing key fingerprint', {
      fingerprint: getPairingFingerprint(this.pairingKey),
    });

    // Start mDNS discovery
    this.discovery = new RelayDiscovery(
      this.port,
      this.version,
      this.projectName,
      this.hostname,
    );

    this.discovery.on('peer:discovered', (peer: DiscoveredPeer) => {
      this.onPeerDiscovered(peer);
    });

    this.discovery.on('peer:expired', (peer: DiscoveredPeer) => {
      this.onPeerExpired(peer);
    });

    this.discovery.start();

    // Start WebSocket relay
    this.relay = new RelayServer({
      port: this.port,
      pairingKey: this.pairingKey,
      hostname: this.hostname,
      projectName: this.projectName,
      version: this.version,
    });

    this.relay.on('message', (payload: SyncPayload) => {
      this.onPeerMessage(payload);
    });

    this.relay.start();

    this.running = true;
    logger.info('RelayEngine: started — Neural Link active', {
      port: this.port,
      fingerprint: getPairingFingerprint(this.pairingKey),
    });
  }

  /**
   * Stops the relay engine gracefully.
   */
  public async stop(): Promise<void> {
    if (!this.running) return;

    this.discovery?.stop();
    this.discovery = null;

    await this.relay?.stop();
    this.relay = null;

    this.running = false;
    logger.info('RelayEngine: stopped');
  }

  // ── Pairing ────────────────────────────────────────────────────────────

  /**
   * Returns the pairing key for manual sharing.
   * Call `codememory relay pair` to display this to the user.
   *
   * @returns The hex-encoded pairing key, or null if relay not started.
   */
  public getPairingKey(): string | null {
    return this.pairingKey;
  }

  /**
   * Returns the pairing key fingerprint for display.
   */
  public getFingerprint(): string | null {
    return this.pairingKey ? getPairingFingerprint(this.pairingKey) : null;
  }

  // ── Peer Management ────────────────────────────────────────────────────

  /**
   * Returns all known peers (from discovery + database).
   */
  public getPeers(): PeerNode[] {
    return this.manager.prepare(
      'SELECT * FROM peer_nodes ORDER BY last_seen_at DESC'
    ).all() as PeerNode[];
  }

  /**
   * Returns the number of currently connected peers.
   */
  public getConnectedPeerCount(): number {
    return this.relay?.getConnectedPeerCount() ?? 0;
  }

  // ── Sharing ────────────────────────────────────────────────────────────

  /**
   * Shares a repair brief with all connected peers.
   *
   * Called automatically when a failure is resolved. The brief
   * contains the error pattern, suggested fix, and approach so
   * teammates' AI agents can learn from this fix.
   *
   * @param brief  The repair brief to share.
   * @returns      Number of peers the brief was shared with.
   */
  public shareBrief(brief: SharedBriefData): number {
    if (!this.relay || !this.pairingKey) return 0;

    // Persist locally first
    const briefId = hash.generateUniqueId(`shared-self-${brief.failure_id}`);
    const now = Date.now();

    this.manager.prepare(`
      INSERT INTO shared_briefs (id, peer_id, failure_id, error_type, error_pattern, suggestion, approach, diff_summary, project_name, shared_at)
      VALUES (?, 'self', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      briefId,
      brief.failure_id,
      brief.error_type,
      brief.error_pattern,
      brief.suggestion,
      brief.approach ?? null,
      brief.diff_summary ?? null,
      brief.project_name ?? null,
      now,
    );

    // Broadcast to peers
    const payload: SyncPayload = {
      type: 'share_brief',
      sender_fingerprint: getPairingFingerprint(this.pairingKey),
      seq: ++this.seq,
      data: { briefs: [brief] },
    };

    return this.relay.broadcast(payload);
  }

  /**
   * Broadcasts a guard rule to all connected peers.
   *
   * When one developer creates a guard rule for a dangerous pattern,
   * that rule is instantly shared with the entire team — providing
   * collective immunity against reintroduced bugs.
   *
   * @param rule The guard rule to broadcast.
   * @returns    Number of peers reached.
   */
  public broadcastRule(rule: BroadcastRuleData): number {
    if (!this.relay || !this.pairingKey) return 0;

    const payload: SyncPayload = {
      type: 'broadcast_rule',
      sender_fingerprint: getPairingFingerprint(this.pairingKey),
      seq: ++this.seq,
      data: { rules: [rule] },
    };

    return this.relay.broadcast(payload);
  }

  // ── Status ─────────────────────────────────────────────────────────────

  /**
   * Returns the current relay status for the MCP tool and dashboard.
   */
  public getStatus(): RelayStatus {
    const peers = this.getPeers();
    const briefs = this.manager.prepare(
      'SELECT COUNT(*) as count FROM shared_briefs'
    ).get() as { count: number };
    const received = this.manager.prepare(
      'SELECT COUNT(*) as count FROM shared_briefs WHERE peer_id != \'self\''
    ).get() as { count: number };
    const lastSync = this.manager.prepare(
      'SELECT MAX(last_sync_at) as last FROM peer_nodes'
    ).get() as { last: number | null };

    return {
      enabled: true,
      running: this.running,
      port: this.port,
      pairing_configured: this.pairingKey !== null,
      peers_online: peers.filter((p) => p.is_online === 1).length,
      peers_total: peers.length,
      briefs_shared: briefs.count - received.count,
      briefs_received: received.count,
      last_sync_at: lastSync.last,
    };
  }

  /**
   * Returns recent shared briefs.
   */
  public getRecentBriefs(limit = 20): SharedBrief[] {
    return this.manager.prepare(
      'SELECT * FROM shared_briefs ORDER BY shared_at DESC LIMIT ?'
    ).all(limit) as SharedBrief[];
  }

  // ── Private: Event Handlers ────────────────────────────────────────────

  /**
   * Called when a new peer is discovered via mDNS.
   */
  private onPeerDiscovered(peer: DiscoveredPeer): void {
    const peerId = generatePeerId(peer.hostname, peer.port);
    const now = Date.now();

    // Upsert peer in database
    const existing = this.manager.prepare(
      'SELECT * FROM peer_nodes WHERE id = ?'
    ).get(peerId) as PeerNode | undefined;

    if (existing) {
      this.manager.prepare(`
        UPDATE peer_nodes
        SET last_seen_at = ?, is_online = 1, project_name = ?
        WHERE id = ?
      `).run(now, peer.projectName, peerId);
    } else {
      this.manager.prepare(`
        INSERT INTO peer_nodes (id, hostname, address, port, last_seen_at, is_online, project_name, discovered_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).run(peerId, peer.hostname, peer.address, peer.port, now, peer.projectName, now);
    }

    // Connect to this peer's relay
    this.relay?.connectToPeer(peer.address, peer.port);
  }

  /**
   * Called when a peer expires (not seen within TTL).
   */
  private onPeerExpired(peer: DiscoveredPeer): void {
    const peerId = generatePeerId(peer.hostname, peer.port);
    this.manager.prepare(
      'UPDATE peer_nodes SET is_online = 0 WHERE id = ?'
    ).run(peerId);
    this.relay?.disconnectPeer(peer.address, peer.port);
  }

  /**
   * Called when an encrypted message is received from a peer.
   */
  private onPeerMessage(payload: SyncPayload): void {
    try {
      switch (payload.type) {
        case 'share_brief':
          this.handleSharedBrief(payload);
          break;
        case 'broadcast_rule':
          this.handleBroadcastRule(payload);
          break;
        case 'sync_request':
          this.handleSyncRequest(payload);
          break;
        case 'sync_response':
          this.handleSyncResponse(payload);
          break;
        default:
          logger.warn('RelayEngine: unknown payload type', { type: payload.type });
      }
    } catch (err) {
      logger.error('RelayEngine: failed to process peer message', err);
    }
  }

  /**
   * Handles a shared brief from a peer.
   */
  private handleSharedBrief(payload: SyncPayload): void {
    if (!payload.data.briefs) return;

    for (const brief of payload.data.briefs) {
      const briefId = hash.generateUniqueId(`shared-ext-${brief.failure_id}`);
      const now = Date.now();

      // Deduplicate
      const existing = this.manager.prepare(
        'SELECT id FROM shared_briefs WHERE failure_id = ?'
      ).get(brief.failure_id);

      if (existing) continue;

      this.manager.prepare(`
        INSERT INTO shared_briefs (id, peer_id, failure_id, error_type, error_pattern, suggestion, approach, diff_summary, project_name, shared_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        briefId, 'external', brief.failure_id, brief.error_type,
        brief.error_pattern, brief.suggestion, brief.approach ?? null,
        brief.diff_summary ?? null, brief.project_name ?? null, now,
      );

      logger.info('RelayEngine: received shared brief from peer', {
        errorType: brief.error_type,
        projectName: brief.project_name,
      });
    }
  }

  /**
   * Handles a broadcast guard rule from a peer.
   */
  private handleBroadcastRule(payload: SyncPayload): void {
    if (!payload.data.rules) return;

    for (const rule of payload.data.rules) {
      // Check for existing rule to avoid duplicates
      const existing = this.manager.prepare(
        'SELECT id FROM guard_rules WHERE error_type = ? AND error_pattern = ?'
      ).get(rule.error_type, rule.error_pattern);

      if (existing) continue;

      const ruleId = hash.generateUniqueId(`guard-${rule.error_type}`);
      const now = Date.now();

      this.manager.prepare(`
        INSERT INTO guard_rules (id, error_pattern, error_type, suggestion, file_pattern, project_id, hit_count, created_at)
        VALUES (?, ?, ?, ?, '', NULL, 1, ?)
      `).run(ruleId, rule.error_pattern, rule.error_type, rule.suggestion, now);

      logger.info('RelayEngine: received broadcast rule from peer', {
        errorType: rule.error_type,
        projectName: rule.project_name,
      });
    }
  }

  /**
   * Handles a sync request from a peer — sends our recent briefs back.
   */
  private handleSyncRequest(_payload: SyncPayload): void {
    if (!this.relay || !this.pairingKey) return;

    // Get recent briefs to share
    const recent = this.manager.prepare(
      'SELECT * FROM shared_briefs WHERE peer_id = \'self\' ORDER BY shared_at DESC LIMIT 20'
    ).all() as SharedBrief[];

    if (recent.length === 0) return;

    const briefs: SharedBriefData[] = recent.map((b) => ({
      failure_id: b.failure_id,
      error_type: b.error_type,
      error_pattern: b.error_pattern,
      suggestion: b.suggestion,
      approach: b.approach,
      diff_summary: b.diff_summary,
      project_name: b.project_name,
    }));

    const response: SyncPayload = {
      type: 'sync_response',
      sender_fingerprint: getPairingFingerprint(this.pairingKey),
      seq: ++this.seq,
      data: { briefs },
    };

    this.relay.broadcast(response);
  }

  /**
   * Handles a sync response from a peer — stores received briefs.
   */
  private handleSyncResponse(payload: SyncPayload): void {
    if (!payload.data.briefs) return;

    for (const brief of payload.data.briefs) {
      // Deduplicate by failure_id
      const existing = this.manager.prepare(
        'SELECT id FROM shared_briefs WHERE failure_id = ?'
      ).get(brief.failure_id);

      if (existing) continue;

      const briefId = hash.generateUniqueId(`shared-sync-${brief.failure_id}`);
      const now = Date.now();

      this.manager.prepare(`
        INSERT INTO shared_briefs (id, peer_id, failure_id, error_type, error_pattern, suggestion, approach, diff_summary, project_name, shared_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        briefId, 'external', brief.failure_id, brief.error_type,
        brief.error_pattern, brief.suggestion, brief.approach ?? null,
        brief.diff_summary ?? null, brief.project_name ?? null, now,
      );

      logger.info('RelayEngine: received sync brief from peer', {
        errorType: brief.error_type,
        projectName: brief.project_name,
      });
    }
  }

  // ── Private: Pairing Key Management ────────────────────────────────────

  /**
   * Gets or creates the pairing key from relay_config table.
   * On first run, generates a new random key.
   */
  private getOrCreatePairingKey(): string {
    const row = this.manager.prepare(
      "SELECT value FROM relay_config WHERE key = 'pairing_key'"
    ).get() as { value: string } | undefined;

    if (row?.value) return row.value;

    const newKey = generatePairingKey();
    this.manager.prepare(
      "INSERT INTO relay_config (key, value) VALUES ('pairing_key', ?)"
    ).run(newKey);

    logger.info('RelayEngine: generated new pairing key');
    return newKey;
  }
}
