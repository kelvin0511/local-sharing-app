import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { WebSocket } from 'ws';
import { createTransferManifest } from '../../src/core/manifest';
import { TransferServer } from '../../src/core/server';
import { WSMessage } from '../../src/core/types';

function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

describe('End-to-End System Integration', () => {
  const e2eDir = path.join(os.tmpdir(), `lan_e2e_${Date.now()}`);
  const senderDir = path.join(e2eDir, 'sender');
  const receiverDir = path.join(e2eDir, 'receiver');

  const filesToCreate = [
    { name: 'document.pdf', content: Buffer.from('%PDF-1.4 Mock PDF content '.repeat(200)) },
    { name: 'photo.png', content: Buffer.alloc(128 * 1024, 0x89) }, // 128 KB
    { name: 'large_video.mp4', content: Buffer.alloc(5 * 1024 * 1024, 0x33) }, // 5 MB
    { name: 'code.ts', content: Buffer.from('console.log("Hello E2E Test!");\n'.repeat(100)) }
  ];

  const sourcePaths: string[] = [];

  beforeAll(async () => {
    await fs.promises.mkdir(senderDir, { recursive: true });
    await fs.promises.mkdir(receiverDir, { recursive: true });

    for (const f of filesToCreate) {
      const p = path.join(senderDir, f.name);
      await fs.promises.writeFile(p, f.content);
      sourcePaths.push(p);
    }
  });

  afterAll(async () => {
    try {
      await fs.promises.rm(e2eDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('completes full multi-file transfer with 100% SHA-256 byte-for-byte fidelity', async () => {
    // 1. Prepare sender manifest
    const prepared = await createTransferManifest(sourcePaths);
    expect(prepared.manifest.fileCount).toBe(4);
    expect(prepared.manifest.totalBytes).toBe(
      filesToCreate.reduce((sum, f) => sum + f.content.length, 0)
    );

    // 2. Start sender server
    const server = new TransferServer(prepared, { bindAddress: '127.0.0.1' });
    const session = await server.start();
    const baseUrl = `http://127.0.0.1:${session.port}`;

    // 3. Receiver establishes WebSocket connection
    const ws = new WebSocket(`ws://127.0.0.1:${session.port}/ws?token=${session.token}`);
    const messages: WSMessage[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', (err) => reject(err));
    });

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    // Send receiver confirmed
    ws.send(JSON.stringify({ type: 'RECEIVER_CONFIRMED', payload: {}, timestamp: Date.now() }));
    await new Promise((r) => setTimeout(r, 50));

    // 4. Receiver downloads every file in sequence (as in real web app)
    const manifestRes = await fetch(`${baseUrl}/api/transfer/${session.token}`);
    const manifest = await manifestRes.json();

    for (const file of manifest.files) {
      const fileRes = await fetch(`${baseUrl}/api/transfer/${session.token}/file/${file.id}`);
      expect(fileRes.status).toBe(200);

      const arrayBuf = await fileRes.arrayBuffer();
      const downloadedBuf = Buffer.from(arrayBuf);
      const destPath = path.join(receiverDir, file.name);
      await fs.promises.writeFile(destPath, downloadedBuf);

      // Verify SHA-256 matches original exactly
      const originalFile = filesToCreate.find((f) => f.name === file.name);
      expect(originalFile).toBeDefined();
      expect(computeSha256(downloadedBuf)).toBe(computeSha256(originalFile!.content));
    }

    // 5. Receiver reports completion
    const completeRes = await fetch(`${baseUrl}/api/transfer/${session.token}/complete`, {
      method: 'POST'
    });
    expect(completeRes.status).toBe(200);

    // 6. Verify server state is COMPLETED and progress updates arrived
    expect(server.state.state).toBe('COMPLETED');
    const progressMsgs = messages.filter((m) => m.type === 'TRANSFER_PROGRESS');
    expect(progressMsgs.length).toBeGreaterThan(0);

    // Wait for auto shutdown
    await new Promise((r) => setTimeout(r, 1600));
    ws.close();
  });
});
