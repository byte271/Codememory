import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer, createServer } from 'node:http';
import { logger } from '../../utils/logger.js';
import { encrypt, decrypt, getPairingFingerprint } from './encryption.js';
import { SyncPayload } from './types.js';

/**
 * P2P Relay Server & Client over encrypted WebSockets (v0.3.5).
 *
 * Each Codememory instance runs both:
 *   1. A WebSocket **server** on the relay port to accept peer connections.
 *   2. A WebSocket **client** to connect to discovered peers.
 *
 * All messages are AES-256-GCM encrypted with the pre-shared pairing key.
 * Peers with mismatched keys cannot decrypt each other's messages.
 *
 * Protocol:
 *   - Handshake: exchange pairing key fingerprints to verify same key.
 *   - Messages: encrypted JSON payloads (SyncPayload).
 *   - Heartbeat: ping/pong every 15 seconds to detect dead peers.
 *   - Reconnection: exponential backoff up to 60 seconds.
 *
 * Follows Rule 02: local-only P2P — no cloud relay.
 */

const HEARTBEAT_INTERVAL_MS = 15_000;
const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000, 60_000];

export interface RelayServerOptions {
  port: number;
  pairingKey: string;
  hostname: string;
  projectName: string;
  version: string;
}

/**
 * WebSocket-based P2P relay for Codememory team instances.
 *
 * Emits events:
 *   - `peer:connected` — new peer WebSocket connection established.
 *   - `peer:disconnected` — peer disconnected or timed out.
 *   - `message` — decrypted SyncPayload received from a peer.
 */
export class RelayServer extends EventEmitter {
  private server: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private peerConnections = new Map<string, WebSocket>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pairingKey: string;
  private port: number;
  private running = false;

  constructor(options: RelayServerOptions) {
    super();
    this.port = options.port;
    this.pairingKey = options.pairingKey;
  }

  /**
   * Starts the WebSocket relay server.
   */
  public start(): void {
    if (this.running) return;

    this.httpServer = createServer();
    this.server = new WebSocketServer({ server: this.httpServer });

    this.server.on('connection', (ws: WebSocket, req) => {
      const peerAddr = req.socket.remoteAddress ?? 'unknown';
      logger.info('RelayServer: incoming peer connection', { peerAddr });

      // Handshake: expect fingerprint first
      let handshakeDone = false;

      ws.on('message', (data: Buffer) => {
        try {
          if (!handshakeDone) {
            const fingerprint = data.toString('utf8');
            const ourFingerprint = getPairingFingerprint(this.pairingKey);

            if (fingerprint === ourFingerprint) {
              handshakeDone = true;
              ws.send(ourFingerprint); // Echo back for mutual verification
              logger.info('RelayServer: handshake successful', { peerAddr });
            } else {
              logger.warn('RelayServer: pairing key mismatch — closing', { peerAddr });
              ws.close(4001, 'Pairing key mismatch');
            }
            return;
          }

          // Decrypt and process message
          const plaintext = decrypt(data.toString('utf8'), this.pairingKey);
          const payload: SyncPayload = JSON.parse(plaintext);
          this.emit('message', payload);
        } catch (err) {
          logger.error('RelayServer: failed to process peer message', err);
        }
      });

      ws.on('close', () => {
        this.removePeerConnection(ws);
      });

      ws.on('error', (err: Error) => {
        logger.error('RelayServer: peer connection error', err);
        this.removePeerConnection(ws);
      });
    });

    this.httpServer.listen(this.port, '0.0.0.0', () => {
      logger.info(`RelayServer: WebSocket relay listening on port ${this.port}`);
    });

    // Heartbeat to detect dead peers
    this.heartbeatTimer = setInterval(() => {
      for (const ws of this.peerConnections.values()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    this.running = true;
  }

  /**
   * Connects to a peer's relay server.
   *
   * @param address Peer IP address.
   * @param port    Peer relay port.
   */
  public connectToPeer(address: string, port: number): void {
    if (!this.running) return;
    const peerId = `${address}:${port}`;
    if (this.peerConnections.has(peerId)) return;

    this.attemptConnection(address, port, 0);
  }

  /**
   * Broadcasts an encrypted payload to all connected peers.
   *
   * @param payload The sync payload to broadcast.
   * @returns       Number of peers the message was sent to.
   */
  public broadcast(payload: SyncPayload): number {
    const encrypted = encrypt(JSON.stringify(payload), this.pairingKey);
    let sent = 0;

    for (const [peerId, ws] of this.peerConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(encrypted);
          sent++;
        } catch (err) {
          logger.error('RelayServer: failed to send to peer', { peerId, err });
        }
      }
    }

    return sent;
  }

  /**
   * Sends an encrypted payload to a specific peer.
   */
  public sendToPeer(peerId: string, payload: SyncPayload): void {
    const ws = this.peerConnections.get(peerId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const encrypted = encrypt(JSON.stringify(payload), this.pairingKey);
    try {
      ws.send(encrypted);
    } catch (err) {
      logger.error('RelayServer: failed to send to peer', { peerId, err });
    }
  }

  /**
   * Disconnects from a specific peer.
   */
  public disconnectPeer(address: string, port: number): void {
    const peerId = `${address}:${port}`;
    const ws = this.peerConnections.get(peerId);
    if (ws) {
      ws.close();
      this.peerConnections.delete(peerId);
    }
  }

  /**
   * Returns the number of connected peers.
   */
  public getConnectedPeerCount(): number {
    let count = 0;
    for (const ws of this.peerConnections.values()) {
      if (ws.readyState === WebSocket.OPEN) count++;
    }
    return count;
  }

  /**
   * Stops the relay server and disconnects all peers.
   */
  public async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Clear all reconnection timers
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // Close all peer connections
    for (const ws of this.peerConnections.values()) {
      ws.close();
    }
    this.peerConnections.clear();

    // Close server
    return new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.httpServer?.close(() => {
            logger.info('RelayServer: stopped');
            resolve();
          });
        });
      } else {
        resolve();
      }
    });
  }

  // ── Private: Connection management ─────────────────────────────────────

  private attemptConnection(address: string, port: number, attempt: number): void {
    const peerId = `${address}:${port}`;
    const ws = new WebSocket(`ws://${address}:${port}`);
    let handshakeDone = false;

    ws.on('open', () => {
      logger.info('RelayServer: connected to peer', { address, port });
      this.peerConnections.set(peerId, ws);

      // Send handshake
      ws.send(getPairingFingerprint(this.pairingKey));
    });

    ws.on('message', (data: Buffer) => {
      try {
        if (!handshakeDone) {
          const fingerprint = data.toString('utf8');
          const ourFingerprint = getPairingFingerprint(this.pairingKey);
          if (fingerprint !== ourFingerprint) {
            logger.warn('RelayServer: peer pairing key mismatch', { address, port });
            ws.close(4001, 'Pairing key mismatch');
            return;
          }
          handshakeDone = true;
          return;
        }

        // Encrypted payload after handshake
        const plaintext = decrypt(data.toString('utf8'), this.pairingKey);
        const payload: SyncPayload = JSON.parse(plaintext);
        this.emit('message', payload);
      } catch (err) {
        logger.error('RelayServer: failed to process peer message', err instanceof Error ? err.message : String(err));
      }
    });

    ws.on('close', () => {
      this.peerConnections.delete(peerId);
      this.reconnectTimers.delete(peerId);
      logger.info('RelayServer: peer disconnected', { address, port });

      // Reconnect with backoff (only if relay is still running)
      if (this.running && attempt < RECONNECT_BACKOFF_MS.length) {
        const delay = RECONNECT_BACKOFF_MS[attempt];
        const timer = setTimeout(() => {
          this.reconnectTimers.delete(peerId);
          this.attemptConnection(address, port, attempt + 1);
        }, delay);
        this.reconnectTimers.set(peerId, timer);
      }
    });

    ws.on('error', (err: Error) => {
      logger.warn('RelayServer: peer connection failed', { address, port, error: err.message });
      this.peerConnections.delete(peerId);
    });
  }

  private removePeerConnection(ws: WebSocket): void {
    for (const [peerId, peerWs] of this.peerConnections) {
      if (peerWs === ws) {
        this.peerConnections.delete(peerId);
        break;
      }
    }
  }
}
