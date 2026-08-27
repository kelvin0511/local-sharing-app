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

  it('handles multi-file batch transfers without hanging or event loop starvation', async () => {
    const files: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const p = path.join(tempDir, `batch_file_${i}.dat`);
      fs.writeFileSync(p, Buffer.alloc(256 * 1024, i));
      files.push(p);
    }

    const prepared = await createTransferManifest(files);
    server = new TransferServer(prepared, { bindAddress: '127.0.0.1', selectedIp: '127.0.0.1' });
    const session = await server.start();

    const client = new ReceiverClient();
    const result = await client.downloadAll('127.0.0.1', session.port, session.token, saveDir);

    expect(result.success).toBe(true);
    expect(result.totalFiles).toBe(6);

    for (let i = 1; i <= 6; i++) {
      const target = path.join(saveDir, `batch_file_${i}.dat`);
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.statSync(target).size).toBe(256 * 1024);
    }
  });

  it('preserves nested folder hierarchies and subfolder file structures', async () => {
    const subDir1 = path.join(tempDir, 'FolderA', 'Sub1');
    fs.mkdirSync(subDir1, { recursive: true });
    const subFile1 = path.join(subDir1, 'nested_doc.pdf');
    fs.writeFileSync(subFile1, 'Nested PDF document contents');

    const subDir2 = path.join(tempDir, 'FolderA', 'Sub2');
    fs.mkdirSync(subDir2, { recursive: true });
    const subFile2 = path.join(subDir2, 'photo.png');
    fs.writeFileSync(subFile2, 'PNG binary data');

    const prepared = await createTransferManifest([
      { path: subFile1, relativePath: 'FolderA/Sub1/nested_doc.pdf' },
      { path: subFile2, relativePath: 'FolderA/Sub2/photo.png' }
    ]);

    server = new TransferServer(prepared, { bindAddress: '127.0.0.1', selectedIp: '127.0.0.1' });
    const session = await server.start();

    const client = new ReceiverClient();
    const result = await client.downloadAll('127.0.0.1', session.port, session.token, saveDir);

    expect(result.success).toBe(true);
    expect(result.totalFiles).toBe(2);

    const target1 = path.join(saveDir, 'FolderA', 'Sub1', 'nested_doc.pdf');
    const target2 = path.join(saveDir, 'FolderA', 'Sub2', 'photo.png');

    expect(fs.existsSync(target1)).toBe(true);
    expect(fs.readFileSync(target1, 'utf8')).toBe('Nested PDF document contents');

    expect(fs.existsSync(target2)).toBe(true);
    expect(fs.readFileSync(target2, 'utf8')).toBe('PNG binary data');
  });

  it('allows skipping a single file in batch download and continues with next files', async () => {
    const fileA = path.join(tempDir, 'fileA.dat');
    const fileB = path.join(tempDir, 'fileB.dat');
    const fileC = path.join(tempDir, 'fileC.dat');
    fs.writeFileSync(fileA, 'Content A');
    fs.writeFileSync(fileB, 'Content B');
    fs.writeFileSync(fileC, 'Content C');

    const prepared = await createTransferManifest([fileA, fileB, fileC]);
    const fileBId = prepared.manifest.files[1].id;

    server = new TransferServer(prepared, { bindAddress: '127.0.0.1', selectedIp: '127.0.0.1' });
    const session = await server.start();

    const client = new ReceiverClient();
    client.skipFile(fileBId); // Skip second file

    const result = await client.downloadAll('127.0.0.1', session.port, session.token, saveDir);

    expect(result.success).toBe(true);
    expect(result.skippedFiles).toBe(1);

    expect(fs.existsSync(path.join(saveDir, 'fileA.dat'))).toBe(true);
    expect(fs.existsSync(path.join(saveDir, 'fileB.dat'))).toBe(false);
    expect(fs.existsSync(path.join(saveDir, 'fileC.dat'))).toBe(true);
  });
});
