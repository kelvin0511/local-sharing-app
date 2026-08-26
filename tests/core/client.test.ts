import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { TransferServer } from '../../src/core/server';
import { createTransferManifest } from '../../src/core/manifest';
import { ReceiverClient } from '../../src/core/client';
import { ReceiverProgressUpdate } from '../../src/core/types';

describe('ReceiverClient Stream Downloader', () => {
  let tempDir: string;
  let saveDir: string;
  let testFile1: string;
  let testFile2: string;
  let server: TransferServer | null = null;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanshare_client_test_src_'));
    saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanshare_client_test_dst_'));

    testFile1 = path.join(tempDir, 'sample_doc.txt');
    testFile2 = path.join(tempDir, 'sample_video.mp4');

    fs.writeFileSync(testFile1, 'Hello World! This is a test file for LAN transfer.');
    // Generate a 1MB binary buffer to simulate video stream chunking
    const dummyVideo = Buffer.alloc(1024 * 1024, 0x42);
    fs.writeFileSync(testFile2, dummyVideo);
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(saveDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup
    }
  });

  it('downloads all files from server directly to disk with live progress and completion', async () => {
    const prepared = await createTransferManifest([testFile1, testFile2]);
    server = new TransferServer(prepared, { bindAddress: '127.0.0.1', selectedIp: '127.0.0.1' });
    const session = await server.start();

    const client = new ReceiverClient();
    const progressEvents: ReceiverProgressUpdate[] = [];

    client.on('progress', (p) => {
      progressEvents.push(p);
    });

    const result = await client.downloadAll('127.0.0.1', session.port, session.token, saveDir);

    expect(result.success).toBe(true);
    expect(result.totalFiles).toBe(2);

    // Verify downloaded files exist on disk
    const downloadedFiles = fs.readdirSync(saveDir);
    expect(downloadedFiles).toContain('sample_doc.txt');
    expect(downloadedFiles).toContain('sample_video.mp4');

    // Verify content matches exactly
    const content1 = fs.readFileSync(path.join(saveDir, 'sample_doc.txt'), 'utf8');
    expect(content1).toBe('Hello World! This is a test file for LAN transfer.');

    const content2 = fs.readFileSync(path.join(saveDir, 'sample_video.mp4'));
    expect(content2.length).toBe(1024 * 1024);
    expect(content2[0]).toBe(0x42);

    expect(progressEvents.length).toBeGreaterThan(0);
  });

  it('successfully transfers files with non-ASCII, spaces, Chinese, and Zhuyin characters', async () => {
    const unicodeFile = path.join(tempDir, '260622 ㄇㄆ.mp4');
    fs.writeFileSync(unicodeFile, 'Special character test content: 測試中文與注音 123');

    const prepared = await createTransferManifest([unicodeFile]);
    server = new TransferServer(prepared, { bindAddress: '127.0.0.1', selectedIp: '127.0.0.1' });
    const session = await server.start();

    const client = new ReceiverClient();
    const result = await client.downloadAll('127.0.0.1', session.port, session.token, saveDir);

    expect(result.success).toBe(true);
    expect(result.totalFiles).toBe(1);

    const targetSaved = path.join(saveDir, '260622 ㄇㄆ.mp4');
    expect(fs.existsSync(targetSaved)).toBe(true);
    expect(fs.readFileSync(targetSaved, 'utf8')).toBe('Special character test content: 測試中文與注音 123');
  });
});
