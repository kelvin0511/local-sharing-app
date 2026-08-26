import dgram from 'dgram';
import { EventEmitter } from 'events';
import { DiscoveredSender } from './types';

export const DISCOVERY_PORT = 54328;
export const BROADCAST_INTERVAL_MS = 1500;
export const SENDER_EXPIRY_MS = 6000;

export interface BeaconPayload {
  type: 'LAN_SHARE_BEACON';
  code: string;
  ip: string;
  port: number;
  token: string;
  fileCount: number;
  totalBytes: number;
  senderName: string;
  version: number;
}

/**
 * Broadcasts an ephemeral beacon on LAN so nearby receivers can auto-discover this sender.
 */
export class UDPBroadcaster {
  private socket: dgram.Socket | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private payload: BeaconPayload;

  constructor(payload: Omit<BeaconPayload, 'type' | 'version'>) {
    this.payload = {
      type: 'LAN_SHARE_BEACON',
      version: 1,
      ...payload
    };
  }

  public start(port: number = DISCOVERY_PORT): Promise<void> {
    return new Promise((resolve) => {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        // Broadcast socket error shouldn't crash the app
        console.warn('[UDPBroadcaster] error:', err.message);
      });

      this.socket.bind(0, () => {
        try {
          this.socket?.setBroadcast(true);
        } catch (e) {
          // Some network drivers may reject setBroadcast
        }

        this.sendBeacon(port);
        this.intervalTimer = setInterval(() => {
          this.sendBeacon(port);
        }, BROADCAST_INTERVAL_MS);

        resolve();
      });
    });
  }

  private sendBeacon(targetPort: number): void {
    if (!this.socket) return;
    try {
      const msg = Buffer.from(JSON.stringify(this.payload));
      this.socket.send(msg, 0, msg.length, targetPort, '255.255.255.255');
    } catch {
      // Ignore transient broadcast write errors
    }
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.intervalTimer) {
        clearInterval(this.intervalTimer);
        this.intervalTimer = null;
      }
      if (this.socket) {
        try {
          this.socket.close(() => resolve());
        } catch {
          resolve();
        }
        this.socket = null;
      } else {
        resolve();
      }
    });
  }
}

/**
 * Listens on LAN for active sender beacons and maintains a real-time list of discovered senders.
 */
export class UDPDiscoveryListener extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private senders: Map<string, DiscoveredSender> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private listening: boolean = false;

  public start(port: number = DISCOVERY_PORT): Promise<void> {
    if (this.listening) return Promise.resolve();

    return new Promise((resolve) => {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        console.warn('[UDPDiscoveryListener] error:', err.message);
      });

      this.socket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
        this.handleMessage(msg, rinfo);
      });

      this.socket.bind(port, () => {
        this.listening = true;
        this.cleanupTimer = setInterval(() => {
          this.evictExpiredSenders();
        }, 2000);
        resolve();
      });
    });
  }

  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    try {
      const data: BeaconPayload = JSON.parse(msg.toString('utf8'));
      if (data.type !== 'LAN_SHARE_BEACON' || !data.code || !data.port) {
        return;
      }

      const senderIp = data.ip || rinfo.address;
      const key = `${data.code.toUpperCase()}_${senderIp}:${data.port}`;
      const now = Date.now();

      const existing = this.senders.get(key);
      const isNew = !existing;

      this.senders.set(key, {
        code: data.code.toUpperCase(),
        ip: senderIp,
        port: data.port,
        token: data.token,
        fileCount: data.fileCount,
        totalBytes: data.totalBytes,
        senderName: data.senderName || 'LAN Device',
        firstSeen: existing ? existing.firstSeen : now,
        lastSeen: now
      });

      if (isNew) {
        this.emit('senderDiscovered', this.senders.get(key));
      }
      this.emit('sendersUpdate', this.getDiscoveredSenders());
    } catch {
      // Ignore unparseable or malicious packets
    }
  }

  private evictExpiredSenders(): void {
    const now = Date.now();
    let changed = false;

    for (const [key, sender] of this.senders.entries()) {
      if (now - sender.lastSeen > SENDER_EXPIRY_MS) {
        this.senders.delete(key);
        changed = true;
      }
    }

    if (changed) {
      this.emit('sendersUpdate', this.getDiscoveredSenders());
    }
  }

  public getDiscoveredSenders(): DiscoveredSender[] {
    return Array.from(this.senders.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  public findSenderByCode(code: string): DiscoveredSender | undefined {
    const target = code.trim().toUpperCase();
    for (const sender of this.senders.values()) {
      if (sender.code.toUpperCase() === target) {
        return sender;
      }
    }
    return undefined;
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.listening = false;
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
      if (this.socket) {
        try {
          this.socket.close(() => resolve());
        } catch {
          resolve();
        }
        this.socket = null;
      } else {
        resolve();
      }
    });
  }
}
