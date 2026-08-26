import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createTransferManifest } from '../../src/core/manifest';

describe('Manifest Creator', () => {
  const tempDir = path.join(os.tmpdir(), `lan_test_${Date.now()}`);
  let file1Path: string;
  let file2Path: string;

  beforeAll(async () => {
    await fs.promises.mkdir(tempDir, { recursive: true });
    file1Path = path.join(tempDir, 'test1.txt');
    file2Path = path.join(tempDir, 'test2.bin');

    await fs.promises.writeFile(file1Path, 'Hello LAN Sharing!'.repeat(10)); // 180 bytes
    await fs.promises.writeFile(file2Path, Buffer.alloc(1024, 0x42)); // 1024 bytes
  });

  afterAll(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('creates a valid manifest from file paths', async () => {
    const prepared = await createTransferManifest([file1Path, file2Path]);

    expect(prepared.manifest.fileCount).toBe(2);
    expect(prepared.manifest.totalBytes).toBe(180 + 1024);
    expect(prepared.manifest.token).toBeDefined();
    expect(prepared.manifest.transferId.startsWith('tx_')).toBe(true);

    expect(prepared.manifest.files.length).toBe(2);
    expect(prepared.manifest.files[0].name).toBe('test1.txt');
    expect(prepared.manifest.files[0].size).toBe(180);
    expect(prepared.manifest.files[1].name).toBe('test2.bin');
    expect(prepared.manifest.files[1].size).toBe(1024);

    expect(prepared.internalFiles.size).toBe(2);
  });

  it('throws an error for non-existent files', async () => {
    const nonExistent = path.join(tempDir, 'ghost_file.xyz');
    await expect(createTransferManifest([nonExistent])).rejects.toThrow('Cannot access file');
  });

  it('throws an error for empty file list', async () => {
    await expect(createTransferManifest([])).rejects.toThrow('No files provided');
  });
});
