import http from 'http';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { pipeline, Transform } from 'stream';
import WebSocket from 'ws';
import {
  PublicFileItem,
  ReceiverDownloadResult,
  ReceiverProgressUpdate,
  TransferManifest,
  WSMessage
} from './types';

function getUniqueFilePath(dir: string, baseName: string): string {
  let target = path.join(dir, baseName);
  if (!fs.existsSync(target)) {
    return target;
  }

  const ext = path.extname(baseName);
  const nameWithoutExt = path.basename(baseName, ext);
  let counter = 1;

  while (fs.existsSync(path.join(dir, `${nameWithoutExt} (${counter})${ext}`))) {
    counter++;
  }

  return path.join(dir, `${nameWithoutExt} (${counter})${ext}`);
}

export class ReceiverClient extends EventEmitter {
  private isCancelled: boolean = false;
  private currentRequest: http.ClientRequest | null = null;
  private currentWriteStream: fs.WriteStream | null = null;
  private currentFilePath: string | null = null;
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private httpAgent: http.Agent = new http.Agent({
    keepAlive: true,
    maxSockets: 1,
    keepAliveMsecs: 10000
  });

  public static async fetchManifest(ip: string, port: number, token: string): Promise<TransferManifest> {
    return new Promise((resolve, reject) => {
      const url = `http://${ip}:${port}/api/transfer/${token}`;
      const req = http.get(url, { timeout: 5000 }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Server returned status ${res.statusCode}`));
          return;
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const manifest: TransferManifest = JSON.parse(body);
            resolve(manifest);
          } catch (e) {
            reject(new Error('Failed to parse transfer manifest.'));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timed out while fetching manifest.'));
      });
    });
  }

  public async downloadAll(
    ip: string,
    port: number,
    token: string,
    saveDirectory: string
  ): Promise<ReceiverDownloadResult> {
    this.isCancelled = false;

    // 1. Fetch manifest
    const manifest = await ReceiverClient.fetchManifest(ip, port, token);

    // 2. Ensure target directory exists
    await fs.promises.mkdir(saveDirectory, { recursive: true });

    // 3. Connect WebSocket for live sync & signaling
    this.connectWebSocket(ip, port, token);

    const totalFiles = manifest.files.length;
    const totalBytes = manifest.totalBytes;
    let totalBytesDownloaded = 0;
    let lastBytesSample = 0;
    let lastTimeSample = Date.now();
    let lastProgressEmitTime = 0;
    let currentSpeed = 0;

    try {
      for (let i = 0; i < totalFiles; i++) {
        if (this.isCancelled) {
          throw new Error('Download cancelled by user.');
        }

        const file = manifest.files[i];
        const targetPath = getUniqueFilePath(saveDirectory, file.name);
        this.currentFilePath = targetPath;

        let fileBytesDownloaded = 0;

        await this.downloadSingleFile(
          ip,
          port,
          token,
          file,
          targetPath,
          (chunkLen) => {
            fileBytesDownloaded += chunkLen;
            totalBytesDownloaded += chunkLen;

            const now = Date.now();
            const timeDelta = (now - lastTimeSample) / 1000;
            if (timeDelta >= 0.5) {
              const bytesDelta = totalBytesDownloaded - lastBytesSample;
              currentSpeed = bytesDelta / timeDelta;
              lastBytesSample = totalBytesDownloaded;
              lastTimeSample = now;
            }

            // Throttle progress updates to avoid saturating Electron IPC and event loop
            if (now - lastProgressEmitTime >= 100) {
              lastProgressEmitTime = now;
              const remainingBytes = Math.max(0, totalBytes - totalBytesDownloaded);
              const etaSeconds = currentSpeed > 0 ? Math.ceil(remainingBytes / currentSpeed) : 0;
              const percentage = totalBytes > 0 ? Math.min(100, (totalBytesDownloaded / totalBytes) * 100) : 100;

              const progress: ReceiverProgressUpdate = {
                currentFileIndex: i + 1,
                totalFiles,
                currentFileName: file.name,
                currentFileBytesDownloaded: fileBytesDownloaded,
                currentFileTotalBytes: file.size,
                totalBytesDownloaded,
                totalBytes,
                speedBps: currentSpeed,
                etaSeconds,
                percentage
              };

              this.emit('progress', progress);
            }
          }
        );

        // Always emit progress event on file completion
        const remainingBytes = Math.max(0, totalBytes - totalBytesDownloaded);
        const etaSeconds = currentSpeed > 0 ? Math.ceil(remainingBytes / currentSpeed) : 0;
        const percentage = totalBytes > 0 ? Math.min(100, (totalBytesDownloaded / totalBytes) * 100) : 100;
        this.emit('progress', {
          currentFileIndex: i + 1,
          totalFiles,
          currentFileName: file.name,
          currentFileBytesDownloaded: fileBytesDownloaded,
          currentFileTotalBytes: file.size,
          totalBytesDownloaded,
          totalBytes,
          speedBps: currentSpeed,
          etaSeconds,
          percentage
        });
      }

      // Notify sender completion
      await this.notifyCompletion(ip, port, token);

      this.cleanup();
      return {
        success: true,
        saveDirectory,
        totalFiles,
        totalBytes
      };
    } catch (err) {
      this.cleanup();
      if (this.currentFilePath && fs.existsSync(this.currentFilePath) && this.isCancelled) {
        try {
          fs.unlinkSync(this.currentFilePath);
        } catch {
          // Ignore partial cleanup error
        }
      }
      throw err;
    }
  }

  private downloadSingleFile(
    ip: string,
    port: number,
    token: string,
    file: PublicFileItem,
    targetPath: string,
    onChunk: (chunkLength: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `http://${ip}:${port}/api/transfer/${token}/file/${file.id}`;
      const writeStream = fs.createWriteStream(targetPath, {
        flags: 'w',
        highWaterMark: 1024 * 1024 // 1MB buffer for fast 100MB+/s disk writes
      });
      this.currentWriteStream = writeStream;

      const progressTransform = new Transform({
        transform(chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: Buffer) => void) {
          onChunk(chunk.length);
          callback(null, chunk);
        }
      });

      const req = http.get(url, { agent: this.httpAgent }, (res) => {
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          writeStream.destroy();
          progressTransform.destroy();
          reject(new Error(`Download failed with HTTP ${res.statusCode} for file ${file.name}`));
          return;
        }

        pipeline(res, progressTransform, writeStream, (err) => {
          this.currentWriteStream = null;
          this.currentRequest = null;
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      req.on('socket', (socket) => {
        socket.setNoDelay(true);
        socket.setKeepAlive(true);
      });

      req.setTimeout(60000, () => {
        req.destroy(new Error(`Download timed out for file ${file.name}`));
      });

      this.currentRequest = req;

      req.on('error', (err) => {
        writeStream.destroy();
        progressTransform.destroy();
        this.currentWriteStream = null;
        this.currentRequest = null;
        reject(err);
      });
    });
  }

  private connectWebSocket(ip: string, port: number, token: string): void {
    try {
      const wsUrl = `ws://${ip}:${port}/ws?token=${token}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        const confirmMsg: WSMessage = {
          type: 'RECEIVER_CONFIRMED',
          payload: {},
          timestamp: Date.now()
        };
        this.ws?.send(JSON.stringify(confirmMsg));

        this.heartbeatTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'HEARTBEAT', payload: {}, timestamp: Date.now() }));
          }
        }, 3000);
      });

      this.ws.on('error', () => {
        // Non-fatal, download proceeds via HTTP
      });
    } catch {
      // Non-fatal
    }
  }

  private notifyCompletion(ip: string, port: number, token: string): Promise<void> {
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: ip,
          port,
          path: `/api/transfer/${token}/complete`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          timeout: 3000
        },
        () => resolve()
      );
      req.on('error', () => resolve()); // don't fail client if completion notify has network blip
      req.end(JSON.stringify({ complete: true }));
    });
  }

  public cancel(): void {
    this.isCancelled = true;
    if (this.currentRequest) {
      this.currentRequest.destroy();
      this.currentRequest = null;
    }
    if (this.currentWriteStream) {
      this.currentWriteStream.destroy();
      this.currentWriteStream = null;
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }
  }
}
