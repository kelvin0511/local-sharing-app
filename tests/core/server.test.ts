import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WebSocket } from 'ws';
import { createTransferManifest } from '../../src/core/manifest';
import { TransferServer } from '../../src/core/server';
import { WSMessage } from '../../src/core/types';

describe('TransferServer Streaming & WebSocket Engine', () => {
  const tempDir = path.join(os.tmpdir(), `lan_srv_test_${Date.now()}`);
  let sample1Path: string;
  let sample2Path: string;
  const sample1Content = 'TransferServer unit test file 1: ' + 'abc123xyz '.repeat(50);
  const sample2Buffer = Buffer.alloc(64 * 1024, 0x5a); // 64 KB

  beforeAll(async () => {
    await fs.promises.mkdir(tempDir, { recursive: true });
    sample1Path = path.join(tempDir, 'document.txt');
    sample2Path = path.join(tempDir, 'binary.dat');

    await fs.promises.writeFile(sample1Path, sample1Content, 'utf-8');
    await fs.promises.writeFile(sample2Path, sample2Buffer);
  });

  afterAll(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('starts server, serves manifest, streams files and handles WebSocket events', async () => {
    const prepared = await createTransferManifest([sample1Path, sample2Path]);
    const server = new TransferServer(prepared, { bindAddress: '127.0.0.1' });

    const session = await server.start();
    expect(session.port).toBeGreaterThan(0);
    expect(session.shareUrl).toBeDefined();
    expect(session.qrCodeDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(server.state.state).toBe('WAITING_FOR_RECEIVER');

    const baseUrl = `http://127.0.0.1:${session.port}`;

    // 1. Test GET /share/:token (Serves HTML receiver)
    const shareRes = await fetch(`${baseUrl}/share/${session.token}`);
    expect(shareRes.status).toBe(200);
    const shareHtml = await shareRes.text();
    expect(shareHtml).toContain('LAN File Transfer');

    // 2. Test Invalid Token on /share (Expect 403)
    const badShareRes = await fetch(`${baseUrl}/share/invalid_token_123`);
    expect(badShareRes.status).toBe(403);

    // 3. Test GET /api/transfer/:token
    const manifestRes = await fetch(`${baseUrl}/api/transfer/${session.token}`);
    expect(manifestRes.status).toBe(200);
    const manifestData = await manifestRes.json();
    expect(manifestData.files.length).toBe(2);
    expect(manifestData.token).toBe(session.token);

    // 4. Test WebSocket Connection
    const wsUrl = `ws://127.0.0.1:${session.port}/ws?token=${session.token}`;
    const ws = new WebSocket(wsUrl);
    const receivedMessages: WSMessage[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', (err) => reject(err));
    });

    ws.on('message', (data) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    // Send receiver confirmed message
    ws.send(JSON.stringify({ type: 'RECEIVER_CONFIRMED', payload: {}, timestamp: Date.now() }));
    await new Promise((r) => setTimeout(r, 100));
    expect(server.state.state).toBe('RECEIVER_CONFIRMED');

    // 5. Test File Streaming for File 1 (Full stream)
    const file1 = manifestData.files[0];
    const file1Res = await fetch(`${baseUrl}/api/transfer/${session.token}/file/${file1.id}`);
    expect(file1Res.status).toBe(200);
    expect(file1Res.headers.get('Content-Disposition')).toContain('document.txt');
    const downloaded1 = await file1Res.text();
    expect(downloaded1).toBe(sample1Content);

    // 6. Test Range Request for File 2 (Partial stream bytes=0-1023 -> 1024 bytes)
    const file2 = manifestData.files[1];
    const file2Res = await fetch(`${baseUrl}/api/transfer/${session.token}/file/${file2.id}`, {
      headers: { Range: 'bytes=0-1023' }
    });
    expect(file2Res.status).toBe(206);
    expect(file2Res.headers.get('Content-Range')).toContain('bytes 0-1023/');
    const downloaded2Buf = Buffer.from(await file2Res.arrayBuffer());
    expect(downloaded2Buf.length).toBe(1024);
    expect(downloaded2Buf.equals(sample2Buffer.subarray(0, 1024))).toBe(true);

    // 7. Verify progress messages were broadcast over WebSocket
    const progressMsgs = receivedMessages.filter((m) => m.type === 'TRANSFER_PROGRESS');
    expect(progressMsgs.length).toBeGreaterThan(0);

    // 8. Test Completion endpoint POST /api/transfer/:token/complete
    const completeRes = await fetch(`${baseUrl}/api/transfer/${session.token}/complete`, {
      method: 'POST'
    });
    expect(completeRes.status).toBe(200);
    expect(server.state.state).toBe('COMPLETED');

    // Wait for server graceful teardown
    await new Promise((r) => setTimeout(r, 1600));
    expect(server.state.state).toBe('COMPLETED');

    ws.close();
  });

  it('handles manual cancellation and cleans up ports', async () => {
    const prepared = await createTransferManifest([sample1Path]);
    const server = new TransferServer(prepared, { bindAddress: '127.0.0.1' });
    const session = await server.start();

    await server.close('User cancelled');
    expect(server.state.state).toBe('SHUTDOWN');

    // Verify port is closed
    await expect(fetch(`http://127.0.0.1:${session.port}/share/${session.token}`)).rejects.toThrow();
  });
});
