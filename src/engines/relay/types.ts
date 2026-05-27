/**
 * Relay engine types for Codememory v0.3.5 — LAN Neural Link.
 */

/** A discovered peer on the local network. */
export interface PeerNode {
  id: string;
  hostname: string;
  address: string;
  port: number;
  last_seen_at: number;
  last_sync_at: number | null;
  is_online: number;
  project_name: string | null;
  discovered_at: number;
}

/** A repair brief shared by a peer. */
export interface SharedBrief {
  id: string;
  peer_id: string;
  failure_id: string;
  error_type: string;
  error_pattern: string;
  suggestion: string;
  approach: string | null;
  diff_summary: string | null;
  project_name: string | null;
  shared_at: number;
  applied: number;
}

/** Sync payload sent between peers. */
export interface SyncPayload {
  type: 'sync_request' | 'sync_response' | 'broadcast_rule' | 'share_brief';
  /** Sender's pairing key fingerprint (first 8 hex chars). */
  sender_fingerprint: string;
  /** Sequence number for deduplication. */
  seq: number;
  /** Payload data — encrypted at rest, decrypted by receiver. */
  data: {
    briefs?: SharedBriefData[];
    rules?: BroadcastRuleData[];
    /** Peer info for discovery handshake. */
    peer_info?: {
      hostname: string;
      project_name: string;
      version: string;
    };
  };
}

/** Lightweight shared brief for wire transfer. */
export interface SharedBriefData {
  failure_id: string;
  error_type: string;
  error_pattern: string;
  suggestion: string;
  approach: string | null;
  diff_summary: string | null;
  project_name: string | null;
}

/** Lightweight broadcast rule for wire transfer. */
export interface BroadcastRuleData {
  error_type: string;
  error_pattern: string;
  suggestion: string;
  project_name: string;
}

/** Relay status for MCP tool response. */
export interface RelayStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  pairing_configured: boolean;
  peers_online: number;
  peers_total: number;
  briefs_shared: number;
  briefs_received: number;
  last_sync_at: number | null;
}

/** Share brief request input. */
export interface ShareBriefInput {
  failure_id: string;
  error_type: string;
  error_pattern: string;
  suggestion: string;
  approach?: string;
  diff_summary?: string;
}

/** Share brief response. */
export interface ShareBriefOutput {
  shared_id: string;
  peers_reached: number;
}

/** Broadcast rule request input. */
export interface BroadcastRuleInput {
  error_type: string;
  error_pattern: string;
  suggestion: string;
}

/** Broadcast rule response. */
export interface BroadcastRuleOutput {
  rule_id: string;
  peers_reached: number;
}

/** Relay status MCP output. */
export interface RelayStatusOutput {
  status: RelayStatus;
  peers: PeerNode[];
  recent_briefs: SharedBrief[];
}
