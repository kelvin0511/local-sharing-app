import http from 'http';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { pipeline, Transform } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import mime from 'mime-types';
import {
  FileItem,
  PublicFileItem,
  ProgressUpdate,
  ServerConfig,
  TransferManifest,
  TransferSessionInfo,
  WSMessage,
  WSMessageType
} from './types';
import { TransferStateMachine } from './state';
import { ProgressTracker } from './progress';
import { secureCompare } from './crypto';
import { getPrimaryLocalIp } from './network';
import { PreparedTransfer } from './manifest';
import { UDPBroadcaster } from './discovery';

export class TransferServer {
  private prepared: PreparedTransfer;
  private config: ServerConfig;
  private stateMachine: TransferStateMachine;
  private progressTracker: ProgressTracker;

  private httpServer: http.Server | null = null;
  private activeSockets: Set<net.Socket> = new Set();
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  private port: number = 0;
  private localIp: string = '';
  private shareUrl: string = '';
  private qrCodeDataUrl: string = '';
  private idleTimeoutTimer: NodeJS.Timeout | null = null;
  private broadcaster: UDPBroadcaster | null = null;

  constructor(prepared: PreparedTransfer, config: ServerConfig = {}) {
    this.prepared = prepared;
    this.config = config;
    this.stateMachine = new TransferStateMachine('IDLE');
    this.progressTracker = new ProgressTracker(
      prepared.manifest.transferId,
      prepared.manifest.totalBytes,
      prepared.manifest.fileCount,
      prepared.manifest.files
    );
  }

  public get state(): TransferStateMachine {
    return this.stateMachine;
  }

  public get manifest(): TransferManifest {
    return this.prepared.manifest;
  }

  public get sessionInfo(): TransferSessionInfo {
    return {
      transferId: this.prepared.manifest.transferId,
      token: this.prepared.manifest.token,
      pairingCode: this.prepared.manifest.pairingCode,
      shareUrl: this.shareUrl,
      qrCodeDataUrl: this.qrCodeDataUrl,
      files: this.prepared.manifest.files,
      totalBytes: this.prepared.manifest.totalBytes,
      ip: this.localIp,
      port: this.port,
      senderName: this.prepared.manifest.senderName || 'LAN Device',
      expiresAt: this.prepared.manifest.expiresAt
    };
  }

  /**
   * Starts the temporary LAN HTTP and WebSocket server
   */
  public async start(): Promise<TransferSessionInfo> {
    this.stateMachine.transitionTo('SERVER_STARTING');

    this.localIp = this.config.selectedIp || getPrimaryLocalIp();
    const bindAddr = this.config.bindAddress || '0.0.0.0';
    const targetPort = this.config.port || 0;

    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });

      this.httpServer.on('connection', (socket: net.Socket) => {
        this.activeSockets.add(socket);
        socket.on('close', () => {
          this.activeSockets.delete(socket);
        });
      });

      this.httpServer.on('error', (err: Error) => {
        this.stateMachine.transitionTo('FAILED', {
          reason: err.message,
          errorCode: 'SERVER_START_FAILED'
        });
        reject(err);
      });

      this.httpServer.listen(targetPort, bindAddr, async () => {
        try {
          const addr = this.httpServer!.address();
          if (typeof addr === 'object' && addr !== null) {
            this.port = addr.port;
          } else {
            throw new Error('Unable to retrieve assigned port.');
          }

          this.shareUrl = `http://${this.localIp}:${this.port}/share/${this.prepared.manifest.token}`;
          // QR code stores the connection payload JSON for instant mobile/app scanner decoding
          const qrPayload = JSON.stringify({
            code: this.prepared.manifest.pairingCode,
            ip: this.localIp,
            port: this.port,
            token: this.prepared.manifest.token
          });
          this.qrCodeDataUrl = await QRCode.toDataURL(qrPayload, {
            margin: 2,
            width: 280,
            color: { dark: '#000000', light: '#ffffff' }
          });

          // Initialize WebSocket Server
          this.wss = new WebSocketServer({ server: this.httpServer! });
          this.setupWebSocketServer();

          // Start UDP discovery beacon
          this.broadcaster = new UDPBroadcaster({
            code: this.prepared.manifest.pairingCode,
            ip: this.localIp,
            port: this.port,
            token: this.prepared.manifest.token,
            fileCount: this.prepared.manifest.fileCount,
            totalBytes: this.prepared.manifest.totalBytes,
            senderName: this.prepared.manifest.senderName || 'LAN Device'
          });
          await this.broadcaster.start();

          // Setup idle expiration timer
          const timeoutMs = this.config.idleTimeoutMs || 10 * 60 * 1000;
          this.idleTimeoutTimer = setTimeout(() => {
            this.handleExpiration();
          }, timeoutMs);

          this.stateMachine.transitionTo('WAITING_FOR_RECEIVER');
          resolve(this.sessionInfo);
        } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.stateMachine.transitionTo('FAILED', {
            reason: error.message,
            errorCode: 'SERVER_START_FAILED'
          });
          reject(error);
        }
      });
    });
  }

  /**
   * Closes the server and cleans up resources
   */
  public async close(reason?: string): Promise<void> {
    if (this.idleTimeoutTimer) {
      clearTimeout(this.idleTimeoutTimer);
      this.idleTimeoutTimer = null;
    }

    if (this.broadcaster) {
      try {
        await this.broadcaster.stop();
      } catch {}
      this.broadcaster = null;
    }

    // Broadcast cancellation if closing before completion
    if (
      this.stateMachine.state !== 'COMPLETED' &&
      this.stateMachine.state !== 'SHUTDOWN'
    ) {
      this.broadcast({
        type: 'TRANSFER_CANCELLED',
        payload: { reason: reason || 'Server shutdown' },
        timestamp: Date.now()
      });
    }

    // 1. Destroy all active HTTP and TCP sockets immediately
    for (const socket of this.activeSockets) {
      try {
        socket.destroy();
      } catch {}
    }
    this.activeSockets.clear();

    // 2. Terminate WebSocket clients
    for (const client of this.clients) {
      try {
        client.terminate();
      } catch {}
    }
    this.clients.clear();

    if (this.wss) {
      try {
        this.wss.close();
      } catch {}
      this.wss = null;
    }

    // 3. Close HTTP server with quick fallback
    if (this.httpServer) {
      if (typeof (this.httpServer as unknown as { closeAllConnections?: () => void }).closeAllConnections === 'function') {
        try {
          (this.httpServer as unknown as { closeAllConnections: () => void }).closeAllConnections();
        } catch {}
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 300);
        this.httpServer!.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.httpServer = null;
    }

    if (this.stateMachine.state !== 'COMPLETED' && this.stateMachine.state !== 'FAILED' && this.stateMachine.state !== 'EXPIRED') {
      this.stateMachine.transitionTo('SHUTDOWN');
    }
  }

  private handleExpiration(): void {
    if (this.stateMachine.state === 'WAITING_FOR_RECEIVER') {
      this.stateMachine.transitionTo('EXPIRED', {
        reason: 'Transfer link expired without receiver connection.',
        errorCode: 'TRANSFER_EXPIRED'
      });
      this.close('Transfer expired');
    }
  }

  private setupWebSocketServer(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      // Validate token from query string or URL (e.g., /ws?token=...)
      const url = new URL(req.url || '', `http://localhost:${this.port}`);
      const token = url.searchParams.get('token');

      if (!token || !secureCompare(token, this.prepared.manifest.token)) {
        ws.close(4001, 'Unauthorized: Invalid token');
        return;
      }

      this.clients.add(ws);

      // Transition state to RECEIVER_CONNECTED if in WAITING_FOR_RECEIVER
      if (this.stateMachine.state === 'WAITING_FOR_RECEIVER') {
        this.stateMachine.transitionTo('RECEIVER_CONNECTED');
      }

      this.broadcast({
        type: 'RECEIVER_JOINED',
        payload: { transferId: this.prepared.manifest.transferId },
        timestamp: Date.now()
      });

      ws.on('message', (data: Buffer | string) => {
        this.handleWebSocketMessage(ws, data);
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });
  }

  private handleWebSocketMessage(ws: WebSocket, data: Buffer | string): void {
    try {
      const msg: WSMessage = JSON.parse(data.toString());
      if (msg.type === 'HEARTBEAT') {
        this.send(ws, {
          type: 'HEARTBEAT_ACK',
          payload: {},
          timestamp: Date.now()
        });
      } else if (msg.type === 'RECEIVER_CONFIRMED') {
        if (this.stateMachine.canTransitionTo('RECEIVER_CONFIRMED')) {
          this.stateMachine.transitionTo('RECEIVER_CONFIRMED');
        }
        this.broadcast({
          type: 'RECEIVER_CONFIRMED',
          payload: msg.payload,
          timestamp: Date.now()
        });
      } else if (msg.type === 'SKIP_FILE') {
        const fileId = (msg.payload as { fileId?: string })?.fileId;
        if (fileId) {
          const updatedProgress = this.progressTracker.skipFile(fileId);
          this.broadcast<ProgressUpdate>({
            type: 'TRANSFER_PROGRESS',
            payload: updatedProgress,
            timestamp: Date.now()
          });
        }
      }
    } catch {
      // Ignore malformed message
    }
  }

  public broadcast<T>(msg: WSMessage<T>): void {
    const payloadStr = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payloadStr);
      }
    }
  }

  public send<T>(ws: WebSocket, msg: WSMessage<T>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Main HTTP Request Router
   */
  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Add standard security and CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    try {
      // 0. Static Receiver Assets: /assets/... or /share/assets/...
      if (pathname.startsWith('/assets/') || pathname.includes('/assets/')) {
        const assetRel = pathname.substring(pathname.indexOf('/assets/'));
        const safeAssetPath = path.normalize(assetRel).replace(/^(\.\.[/\\])+/, '');
        const assetDiskPath = path.join(process.cwd(), 'dist-receiver', safeAssetPath);
        if (fs.existsSync(assetDiskPath) && fs.statSync(assetDiskPath).isFile()) {
          const contentType = mime.lookup(assetDiskPath) || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable'
          });
          fs.createReadStream(assetDiskPath).pipe(res);
          return;
        }
      }

      // 1. Share UI Route: /share/:token
      if (pathname.startsWith('/share/')) {
        const token = pathname.replace('/share/', '').split('/')[0];
        if (!secureCompare(token, this.prepared.manifest.token)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Access Denied: Invalid or expired transfer link.');
          return;
        }
        this.serveReceiverApp(res, token);
        return;
      }

      // 2. Transfer Metadata Route: /api/transfer/:token
      const apiManifestMatch = pathname.match(/^\/api\/transfer\/([^/]+)$/);
      if (apiManifestMatch && req.method === 'GET') {
        const token = apiManifestMatch[1];
        if (!secureCompare(token, this.prepared.manifest.token)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.prepared.manifest));
        return;
      }

      // 3. File Streaming Route: /api/transfer/:token/file/:fileId
      const fileStreamMatch = pathname.match(/^\/api\/transfer\/([^/]+)\/file\/([^/]+)$/);
      if (fileStreamMatch && req.method === 'GET') {
        const token = fileStreamMatch[1];
        const fileId = fileStreamMatch[2];

        if (!secureCompare(token, this.prepared.manifest.token)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' }));
          return;
        }

        const fileItem = this.prepared.internalFiles.get(fileId);
        if (!fileItem) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found', code: 'FILE_NOT_FOUND' }));
          return;
        }

        await this.streamFile(req, res, fileItem);
        return;
      }

      // 4. Transfer Complete Route: POST /api/transfer/:token/complete
      const completeMatch = pathname.match(/^\/api\/transfer\/([^/]+)\/complete$/);
      if (completeMatch && req.method === 'POST') {
        const token = completeMatch[1];
        if (!secureCompare(token, this.prepared.manifest.token)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid token', code: 'INVALID_TOKEN' }));
          return;
        }

        this.stateMachine.transitionTo('COMPLETED');
        const finalProgress = this.progressTracker.complete();

        this.broadcast({
          type: 'TRANSFER_COMPLETED',
          payload: { transferId: this.prepared.manifest.transferId, progress: finalProgress },
          timestamp: Date.now()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Transfer marked as completed.' }));
        return;
      }

      // 404 for unknown endpoints
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: msg, code: 'UNKNOWN_ERROR' }));
      }
    }
  }

  /**
   * High-Performance Zero-RAM File Streaming with Range Support
   */
  private async streamFile(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    fileItem: FileItem
  ): Promise<void> {
    const filePath = fileItem.path;

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File disappeared from disk', code: 'FILE_NOT_FOUND' }));
      return;
    }

    const fileSize = stat.size;
    const rangeHeader = req.headers.range;

    // Transition state to TRANSFERRING
    if (this.stateMachine.canTransitionTo('TRANSFERRING')) {
      this.stateMachine.transitionTo('TRANSFERRING');
    }

    const fileIndex = this.prepared.manifest.files.findIndex((f: PublicFileItem) => f.id === fileItem.id);
    this.progressTracker.startFile(fileIndex >= 0 ? fileIndex + 1 : 1, fileItem.id, fileItem.name, fileSize);

    let start = 0;
    let end = fileSize - 1;
    let statusCode = 200;

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || isNaN(end) || start > end || start >= fileSize) {
        res.writeHead(416, {
          'Content-Range': `bytes */${fileSize}`,
          'Content-Type': 'text/plain'
        });
        res.end('Requested Range Not Satisfiable');
        return;
      }
      statusCode = 206;
    }

    const contentLength = end - start + 1;
    const safeAsciiName = (fileItem.name || 'download')
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\\]/g, '_');
    const encodedUtf8Name = encodeURIComponent(fileItem.name || 'download');

    const headers: http.OutgoingHttpHeaders = {
      'Content-Type': fileItem.type || 'application/octet-stream',
      'Content-Length': contentLength,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodedUtf8Name}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    };

    if (statusCode === 206) {
      headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
    }

    res.writeHead(statusCode, headers);

    const stream = fs.createReadStream(filePath, { start, end });
    let lastProgressBroadcast = 0;

    const trackerTransform = new Transform({
      transform: (chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: Buffer) => void) => {
        const byteLen = chunk.length;
        const progress = this.progressTracker.recordBytes(byteLen);
        const now = Date.now();

        if (now - lastProgressBroadcast >= 100) {
          lastProgressBroadcast = now;
          this.broadcast<ProgressUpdate>({
            type: 'TRANSFER_PROGRESS',
            payload: progress,
            timestamp: now
          });
        }

        callback(null, chunk);
      }
    });

    req.on('aborted', () => {
      if (!stream.destroyed) stream.destroy();
      if (!trackerTransform.destroyed) trackerTransform.destroy();
    });

    pipeline(stream, trackerTransform, res, (err) => {
      if (err) {
        if (!res.writableEnded && !res.destroyed && this.stateMachine.state === 'TRANSFERRING') {
          this.stateMachine.transitionTo('FAILED', {
            reason: err.message,
            errorCode: 'FILE_READ_FAILED'
          });
          this.broadcast({
            type: 'TRANSFER_FAILED',
            payload: { error: err.message, code: 'FILE_READ_FAILED' },
            timestamp: Date.now()
          });
        }
      } else {
        this.progressTracker.finishCurrentFile();
        const progress = this.progressTracker.getProgress();
        this.broadcast<ProgressUpdate>({
          type: 'TRANSFER_PROGRESS',
          payload: progress,
          timestamp: Date.now()
        });
      }
    });
  }

  /**
   * Serves the built Receiver Web Application or fallback lightweight client
   */
  private serveReceiverApp(res: http.ServerResponse, token: string): void {
    // Check if built receiver HTML bundle exists
    const distReceiverPath = path.resolve(process.cwd(), 'dist-receiver', 'index.html');
    if (fs.existsSync(distReceiverPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(distReceiverPath).pipe(res);
      return;
    }

    // Default built-in standalone HTML receiver page
    const html = this.getEmbeddedReceiverHtml(token);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  /**
   * Generates a modern, self-contained, responsive Receiver Web page
   */
  private getEmbeddedReceiverHtml(token: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LAN File Transfer — Receive Files</title>
  <style>
    :root {
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --border: #334155;
      --success: #10b981;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 2rem;
      max-width: 580px;
      width: 100%;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }
    .header h1 { font-size: 1.35rem; font-weight: 700; }
    .badge {
      font-size: 0.75rem;
      background: #1e3a8a;
      color: #93c5fd;
      padding: 0.25rem 0.6rem;
      border-radius: 9999px;
      font-weight: 600;
    }
    .file-list {
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      max-height: 240px;
      overflow-y: auto;
      margin-bottom: 1.5rem;
    }
    .file-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
    }
    .file-item:last-child { border-bottom: none; }
    .file-name {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 320px;
    }
    .file-size { color: var(--text-muted); font-size: 0.85rem; }
    .summary {
      display: flex;
      justify-content: space-between;
      font-size: 0.9rem;
      color: var(--text-muted);
      margin-bottom: 1.5rem;
    }
    .progress-bar-container {
      background: #334155;
      border-radius: 9999px;
      height: 10px;
      overflow: hidden;
      margin-bottom: 0.75rem;
    }
    .progress-bar {
      background: linear-gradient(90deg, #3b82f6, #60a5fa);
      height: 100%;
      width: 0%;
      transition: width 0.2s ease;
    }
    .status-text {
      font-size: 0.85rem;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
      margin-bottom: 1.5rem;
    }
    .btn {
      background: var(--primary);
      color: #fff;
      border: none;
      border-radius: 0.5rem;
      padding: 0.85rem 1.5rem;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 0.5rem;
      transition: background 0.15s;
    }
    .btn:hover { background: var(--primary-hover); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .status-box {
      padding: 1rem;
      border-radius: 0.5rem;
      margin-top: 1rem;
      display: none;
      font-size: 0.9rem;
    }
    .status-box.success { background: rgba(16, 185, 129, 0.15); border: 1px solid var(--success); color: #34d399; }
    .status-box.error { background: rgba(239, 68, 68, 0.15); border: 1px solid var(--danger); color: #f87171; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Incoming LAN Transfer</h1>
      <span class="badge">Direct P2P</span>
    </div>

    <div class="summary">
      <span id="file-count">Loading files...</span>
      <span id="total-size">--</span>
    </div>

    <div class="file-list" id="file-list">
      <div style="padding: 1.5rem; text-align: center; color: var(--text-muted);">
        Fetching transfer manifest...
      </div>
    </div>

    <div id="transfer-section" style="display: none;">
      <div class="progress-bar-container">
        <div class="progress-bar" id="progress-bar"></div>
      </div>
      <div class="status-text">
        <span id="current-file-text">Preparing transfer...</span>
        <span id="speed-eta-text">-- MB/s</span>
      </div>
    </div>

    <button class="btn" id="start-btn" onclick="startDownload()">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      Save Files to Folder
    </button>

    <div class="status-box" id="status-box"></div>
  </div>

  <script>
    const token = ${JSON.stringify(token)};
    let manifest = null;
    let ws = null;

    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async function init() {
      try {
        const res = await fetch('/api/transfer/' + token);
        if (!res.ok) throw new Error('Invalid or expired transfer token.');
        manifest = await res.json();

        document.getElementById('file-count').innerText = manifest.fileCount + ' file(s)';
        document.getElementById('total-size').innerText = 'Total: ' + formatBytes(manifest.totalBytes);

        const listEl = document.getElementById('file-list');
        listEl.innerHTML = '';
        manifest.files.forEach(f => {
          const item = document.createElement('div');
          item.className = 'file-item';
          item.innerHTML = \`<span class="file-name">\${f.name}</span><span class="file-size">\${formatBytes(f.size)}</span>\`;
          listEl.appendChild(item);
        });

        connectWebSocket();
      } catch (err) {
        showStatus('error', err.message);
        document.getElementById('start-btn').disabled = true;
      }
    }

    function connectWebSocket() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + location.host + '/ws?token=' + token);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'TRANSFER_PROGRESS') {
            updateProgress(msg.payload);
          } else if (msg.type === 'TRANSFER_COMPLETED') {
            showStatus('success', 'All files transferred and verified successfully!');
          } else if (msg.type === 'TRANSFER_CANCELLED') {
            showStatus('error', 'Transfer was cancelled by the sender.');
            document.getElementById('start-btn').disabled = true;
          }
        } catch (e) {}
      };
    }

    function updateProgress(p) {
      document.getElementById('progress-bar').style.width = p.percentage + '%';
      document.getElementById('current-file-text').innerText = \`(\${p.currentFileIndex + 1}/\${p.totalFiles}) \${p.currentFileName}\`;
      const speedMB = (p.speedBps / (1024 * 1024)).toFixed(1);
      document.getElementById('speed-eta-text').innerText = \`\${speedMB} MB/s | ETA: \${p.etaSeconds}s\`;
    }

    function showStatus(type, text) {
      const box = document.getElementById('status-box');
      box.className = 'status-box ' + type;
      box.innerText = text;
      box.style.display = 'block';
    }

    async function startDownload() {
      const btn = document.getElementById('start-btn');
      btn.disabled = true;
      document.getElementById('transfer-section').style.display = 'block';

      if (window.showDirectoryPicker) {
        try {
          const dirHandle = await window.showDirectoryPicker();
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'RECEIVER_CONFIRMED', payload: {}, timestamp: Date.now() }));
          }

          for (let i = 0; i < manifest.files.length; i++) {
            const f = manifest.files[i];
            document.getElementById('current-file-text').innerText = 'Downloading ' + f.name + '...';
            const fileRes = await fetch('/api/transfer/' + token + '/file/' + f.id);
            if (!fileRes.ok) throw new Error('Failed to download ' + f.name);

            const fileHandle = await dirHandle.getFileHandle(f.name, { create: true });
            const writable = await fileHandle.createWritable();
            await fileRes.body.pipeTo(writable);
          }

          // Complete
          await fetch('/api/transfer/' + token + '/complete', { method: 'POST' });
          showStatus('success', 'Transfer complete! All files saved directly to chosen folder.');
          btn.innerText = 'Completed';
        } catch (err) {
          if (err.name !== 'AbortError') {
            showStatus('error', 'Download error: ' + err.message);
            btn.disabled = false;
          } else {
            btn.disabled = false;
          }
        }
      } else {
        // Fallback standard download trigger
        for (const f of manifest.files) {
          const a = document.createElement('a');
          a.href = '/api/transfer/' + token + '/file/' + f.id;
          a.download = f.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          await new Promise(r => setTimeout(r, 400));
        }
        await fetch('/api/transfer/' + token + '/complete', { method: 'POST' });
        showStatus('success', 'Files downloaded successfully.');
      }
    }

    window.addEventListener('DOMContentLoaded', init);
  </script>
</body>
</html>`;
  }
}
