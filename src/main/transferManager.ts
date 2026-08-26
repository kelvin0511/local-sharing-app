import { BrowserWindow } from 'electron';
import { TransferServer } from '../core/server';
import { createTransferManifest } from '../core/manifest';
import { getNetworkInterfaces } from '../core/network';
import { StateChangeEvent } from '../core/state';
import { UDPDiscoveryListener } from '../core/discovery';
import { ReceiverClient } from '../core/client';
import {
  DiscoveredSender,
  NetworkInterfaceInfo,
  ProgressUpdate,
  ReceiverDownloadResult,
  ReceiverProgressUpdate,
  ServerConfig,
  TransferManifest,
  TransferSessionInfo,
  WSMessage
} from '../core/types';

export class TransferManager {
  private currentServer: TransferServer | null = null;
  private discoveryListener: UDPDiscoveryListener | null = null;
  private receiverClient: ReceiverClient | null = null;
  private window: BrowserWindow | null = null;

  public setWindow(window: BrowserWindow): void {
    this.window = window;
  }

  public getNetworkInterfaces(): NetworkInterfaceInfo[] {
    return getNetworkInterfaces();
  }

  // ===================== SENDER METHODS =====================

  public async startTransfer(
    filePaths: string[],
    config: ServerConfig = {}
  ): Promise<TransferSessionInfo> {
    if (this.currentServer) {
      await this.cancelTransfer('Starting new transfer');
    }

    const prepared = await createTransferManifest(filePaths);
    this.currentServer = new TransferServer(prepared, config);

    // Forward state changes to renderer window
    this.currentServer.state.on('stateChange', (event: StateChangeEvent) => {
      this.sendToRenderer('transfer:stateChange', event);
    });

    // Hook server WebSocket broadcasts to forward progress to renderer
    const originalBroadcast = this.currentServer.broadcast.bind(this.currentServer);
    this.currentServer.broadcast = <T>(msg: WSMessage<T>) => {
      originalBroadcast(msg);
      if (msg.type === 'TRANSFER_PROGRESS') {
        this.sendToRenderer('transfer:progress', msg.payload as ProgressUpdate);
      } else if (msg.type === 'TRANSFER_COMPLETED') {
        this.sendToRenderer('transfer:completed', msg.payload);
      } else if (msg.type === 'RECEIVER_JOINED') {
        this.sendToRenderer('transfer:receiverJoined', msg.payload);
      } else if (msg.type === 'RECEIVER_CONFIRMED') {
        this.sendToRenderer('transfer:receiverConfirmed', msg.payload);
      }
    };

    const sessionInfo = await this.currentServer.start();
    return sessionInfo;
  }

  public async cancelTransfer(reason: string = 'Cancelled by user'): Promise<void> {
    if (this.currentServer) {
      await this.currentServer.close(reason);
      this.currentServer = null;
    }
  }

  // ===================== RECEIVER METHODS =====================

  public async startDiscovery(): Promise<void> {
    if (!this.discoveryListener) {
      this.discoveryListener = new UDPDiscoveryListener();
      this.discoveryListener.on('sendersUpdate', (senders: DiscoveredSender[]) => {
        this.sendToRenderer('receiver:discoveredSenders', senders);
      });
      await this.discoveryListener.start();
    }
    this.sendToRenderer('receiver:discoveredSenders', this.discoveryListener.getDiscoveredSenders());
  }

  public async stopDiscovery(): Promise<void> {
    if (this.discoveryListener) {
      await this.discoveryListener.stop();
      this.discoveryListener = null;
    }
  }

  public getDiscoveredSenders(): DiscoveredSender[] {
    return this.discoveryListener ? this.discoveryListener.getDiscoveredSenders() : [];
  }

  public async resolveCode(code: string): Promise<DiscoveredSender | null> {
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) return null;

    // 1. Check active UDP beacons first
    if (this.discoveryListener) {
      const match = this.discoveryListener.findSenderByCode(cleanCode);
      if (match) return match;
    }

    return null;
  }

  public async fetchSenderManifest(ip: string, port: number, token: string): Promise<TransferManifest> {
    return ReceiverClient.fetchManifest(ip, port, token);
  }

  public async startDownload(
    sender: DiscoveredSender,
    saveDirectory: string
  ): Promise<ReceiverDownloadResult> {
    if (this.receiverClient) {
      this.receiverClient.cancel();
    }

    this.receiverClient = new ReceiverClient();
    this.receiverClient.on('progress', (progress: ReceiverProgressUpdate) => {
      this.sendToRenderer('receiver:progress', progress);
    });

    try {
      const result = await this.receiverClient.downloadAll(
        sender.ip,
        sender.port,
        sender.token,
        saveDirectory
      );
      this.receiverClient = null;
      this.sendToRenderer('receiver:completed', result);
      return result;
    } catch (err: unknown) {
      this.receiverClient = null;
      const msg = err instanceof Error ? err.message : String(err);
      this.sendToRenderer('receiver:error', { error: msg });
      throw err;
    }
  }

  public cancelDownload(): void {
    if (this.receiverClient) {
      this.receiverClient.cancel();
      this.receiverClient = null;
      this.sendToRenderer('receiver:cancelled');
    }
  }

  // ===================== CLEANUP =====================

  public async cleanup(): Promise<void> {
    if (this.currentServer) {
      await this.currentServer.close('App shutting down');
      this.currentServer = null;
    }
    if (this.discoveryListener) {
      await this.discoveryListener.stop();
      this.discoveryListener = null;
    }
    if (this.receiverClient) {
      this.receiverClient.cancel();
      this.receiverClient = null;
    }
  }

  private sendToRenderer(channel: string, ...args: unknown[]): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args);
    }
  }
}
