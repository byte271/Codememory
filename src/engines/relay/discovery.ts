import { createSocket, RemoteInfo } from 'node:dgram';
import { EventEmitter } from 'node:events';
import { networkInterfaces } from 'node:os';
import { logger } from '../../utils/logger.js';

/**
 * LAN Peer Discovery via mDNS (v0.3.5).
 *
 * Uses multicast DNS to advertise the Codememory relay service on the
 * local network and discover other Codememory instances. Zero-config:
 * no central server, no manual IP entry — just enable and discover.
 *
 * Protocol:
 *   - Service type: `_codememory._tcp.local`
 *   - TXT records carry: port, version, project_name, hostname
 *   - Query interval: 30 seconds (keeps network traffic minimal)
 *   - TTL: 60 seconds (peers expire if not re-advertised)
 *
 * Follows Rule 02: local-only — no cloud service discovery.
 */

const MDNS_SERVICE_TYPE = '_codememory._tcp';
const MDNS_SERVICE_NAME = 'Codememory Relay';
const QUERY_INTERVAL_MS = 30_000;
const PEER_TTL_MS = 60_000;

export interface DiscoveredPeer {
  hostname: string;
  address: string;
  port: number;
  version: string;
  projectName: string;
  lastSeen: number;
}

/**
 * mDNS Discovery engine for finding Codememory peers on the LAN.
 *
 * Emits events:
 *   - `peer:discovered` — new peer found or existing peer refreshed.
 *   - `peer:expired` — peer hasn't been seen within TTL.
 *   - `error` — mDNS socket error.
 */
export class RelayDiscovery extends EventEmitter {
  private socket: ReturnType<typeof createSocket> | null = null;
  private queryTimer: ReturnType<typeof setInterval> | null = null;
  private peers = new Map<string, DiscoveredPeer>();
  private port: number;
  private version: string;
  private projectName: string;
  private hostname: string;
  private running = false;

  /**
   * @param port        Relay port to advertise.
   * @param version     Codememory version string.
   * @param projectName Human-readable project name for peer display.
   * @param hostname    Local hostname for peer identification.
   */
  constructor(port: number, version: string, projectName: string, hostname: string) {
    super();
    this.port = port;
    this.version = version;
    this.projectName = projectName;
    this.hostname = hostname;
  }

  /**
   * Starts mDNS advertising and discovery.
   * Binds to all available network interfaces and begins
   * periodic queries for other Codememory instances.
   */
  public start(): void {
    if (this.running) return;

    this.socket = createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('message', (msg: Buffer, rinfo: RemoteInfo) => {
      this.handleMessage(msg, rinfo);
    });

    this.socket.on('error', (err: Error) => {
      logger.error('RelayDiscovery: socket error', err);
      this.emit('error', err);
    });

    // Bind to the mDNS port (5353) on all interfaces
    this.socket.bind(5353, () => {
      this.socket!.setMulticastTTL(255);
      this.socket!.setMulticastLoopback(true);
      logger.info('RelayDiscovery: mDNS socket bound to port 5353');
    });

    // Start periodic queries
    this.broadcastPresence();
    this.queryTimer = setInterval(() => {
      this.queryPeers();
      this.expireStalePeers();
      this.broadcastPresence();
    }, QUERY_INTERVAL_MS);

    this.running = true;
    logger.info('RelayDiscovery: started — advertising as', {
      hostname: this.hostname,
      port: this.port,
      projectName: this.projectName,
    });
  }

  /**
   * Stops discovery, closes the socket, and clears timers.
   */
  public stop(): void {
    if (!this.running) return;

    if (this.queryTimer) {
      clearInterval(this.queryTimer);
      this.queryTimer = null;
    }

    // Send goodbye packet
    this.sendGoodbye();

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.peers.clear();
    this.running = false;
    logger.info('RelayDiscovery: stopped');
  }

  /**
   * Returns all currently known peers.
   */
  public getPeers(): DiscoveredPeer[] {
    return Array.from(this.peers.values());
  }

  /**
   * Returns the count of online peers.
   */
  public getPeerCount(): number {
    return this.peers.size;
  }

  // ── Private: mDNS Protocol ─────────────────────────────────────────────

  /**
   * Handles incoming mDNS messages.
   */
  private handleMessage(msg: Buffer, rinfo: RemoteInfo): void {
    try {
      const text = msg.toString('utf8');

      // Parse mDNS response for our service type
      if (!text.includes(MDNS_SERVICE_TYPE)) return;

      // Extract TXT record data from the mDNS response
      const peer = this.parsePeerFromMdns(text, rinfo.address);
      if (!peer) return;

      // Skip self — compare address (same machine via loopback)
      // plus hostname match as a secondary guard for multi-interface
      // machines where a packet might arrive on a different interface.
      const localAddr = this.getLocalAddress();
      if (peer.address === localAddr && peer.hostname === this.hostname) return;

      const existing = this.peers.get(peer.hostname);
      this.peers.set(peer.hostname, { ...peer, lastSeen: Date.now() });

      if (!existing) {
        logger.info('RelayDiscovery: peer discovered', {
          hostname: peer.hostname,
          address: peer.address,
          port: peer.port,
          projectName: peer.projectName,
        });
        this.emit('peer:discovered', peer);
      }
    } catch {
      // Malformed mDNS packets are common — ignore silently
    }
  }

  /**
   * Parses a discovered peer from an mDNS response string.
   */
  private parsePeerFromMdns(text: string, address: string): DiscoveredPeer | null {
    // mDNS responses contain KEY=VALUE pairs in the answer section
    const portMatch = text.match(/port=(\d+)/);
    const versionMatch = text.match(/version=([\w.]+)/);
    const projectMatch = text.match(/project=([\w\s-]+)/);
    const hostnameMatch = text.match(/hostname=([\w-]+)/);

    if (!portMatch || !hostnameMatch) return null;

    return {
      hostname: hostnameMatch[1],
      address,
      port: parseInt(portMatch[1], 10),
      version: versionMatch?.[1] ?? 'unknown',
      projectName: projectMatch?.[1] ?? 'unknown',
      lastSeen: Date.now(),
    };
  }

  /**
   * Broadcasts this instance's presence via mDNS.
   * Sends a multicast DNS response advertising our service.
   */
  private broadcastPresence(): void {
    if (!this.socket) return;

    const localAddr = this.getLocalAddress();
    if (!localAddr) return;

    const response = [
      // mDNS response header
      `Codememory ${MDNS_SERVICE_NAME}`,
      `${MDNS_SERVICE_TYPE}.local`,
      // TXT record data
      `port=${this.port}`,
      `version=${this.version}`,
      `project=${this.projectName}`,
      `hostname=${this.hostname}`,
    ].join('\n');

    const message = Buffer.from(response, 'utf8');

    // Send to mDNS multicast address
    this.socket.send(message, 0, message.length, 5353, '224.0.0.251', (err) => {
      if (err) logger.warn('RelayDiscovery: failed to broadcast presence', { error: err.message });
    });
  }

  /**
   * Queries for other Codememory instances on the network.
   */
  private queryPeers(): void {
    if (!this.socket) return;

    const query = Buffer.from(
      `_services._dns-sd._udp.local\n${MDNS_SERVICE_TYPE}.local`,
      'utf8'
    );

    this.socket.send(query, 0, query.length, 5353, '224.0.0.251', (err) => {
      if (err) logger.warn('RelayDiscovery: failed to query peers', { error: err.message });
    });
  }

  /**
   * Sends a goodbye packet to inform peers we're leaving.
   */
  private sendGoodbye(): void {
    if (!this.socket) return;

    // mDNS goodbye: TTL=0
    const goodbye = Buffer.from(
      `Codememory ${MDNS_SERVICE_NAME}\n${MDNS_SERVICE_TYPE}.local\nttl=0`,
      'utf8'
    );

    this.socket.send(goodbye, 0, goodbye.length, 5353, '224.0.0.251');
  }

  /**
   * Removes peers that haven't been seen within the TTL.
   */
  private expireStalePeers(): void {
    const now = Date.now();
    for (const [hostname, peer] of this.peers) {
      if (now - peer.lastSeen > PEER_TTL_MS) {
        this.peers.delete(hostname);
        logger.info('RelayDiscovery: peer expired', { hostname });
        this.emit('peer:expired', peer);
      }
    }
  }

  /**
   * Gets the local machine's IPv4 address from network interfaces.
   */
  private getLocalAddress(): string | null {
    const interfaces = networkInterfaces();
    for (const [, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          return addr.address;
        }
      }
    }
    return null;
  }
}
