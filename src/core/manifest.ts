import fs from 'fs';
import path from 'path';
import os from 'os';
import mime from 'mime-types';
import { FileItem, PublicFileItem, TransferManifest } from './types';
import {
  generateFileId,
  generatePairingCode,
  generateSecureToken,
  generateTransferId,
  sanitizeFilename
} from './crypto';

export interface PreparedTransfer {
  manifest: TransferManifest;
  internalFiles: Map<string, FileItem>; // Maps fileId -> FileItem (with local absolute path)
}

/**
 * Validates an array of filesystem paths, computes sizes, and builds a secure transfer session.
 */
export async function createTransferManifest(
  filePaths: string[],
  idleTimeoutMs: number = 10 * 60 * 1000, // 10 minutes default
  customPairingCode?: string
): Promise<PreparedTransfer> {
  if (!filePaths || filePaths.length === 0) {
    throw new Error('No files provided for transfer.');
  }

  const internalFiles = new Map<string, FileItem>();
  const publicFiles: PublicFileItem[] = [];
  let totalBytes = 0;

  for (const rawPath of filePaths) {
    const resolvedPath = path.resolve(rawPath);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(resolvedPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Cannot access file "${resolvedPath}": ${msg}`);
    }

    if (!stat.isFile()) {
      throw new Error(`Path is not a regular file: "${resolvedPath}"`);
    }

    const originalName = path.basename(resolvedPath);
    const safeName = sanitizeFilename(originalName);
    const mimeType = mime.lookup(safeName) || 'application/octet-stream';
    const id = generateFileId();

    const fileItem: FileItem = {
      id,
      name: safeName,
      size: stat.size,
      type: mimeType,
      path: resolvedPath
    };

    const publicItem: PublicFileItem = {
      id,
      name: safeName,
      size: stat.size,
      type: mimeType
    };

    internalFiles.set(id, fileItem);
    publicFiles.push(publicItem);
    totalBytes += stat.size;
  }

  const transferId = generateTransferId();
  const token = generateSecureToken(32);
  const pairingCode = customPairingCode || generatePairingCode();
  const senderName = os.hostname() || 'LAN Device';
  const now = Date.now();

  const manifest: TransferManifest = {
    transferId,
    token,
    pairingCode,
    files: publicFiles,
    totalBytes,
    fileCount: publicFiles.length,
    senderName,
    createdAt: now,
    expiresAt: now + idleTimeoutMs
  };

  return { manifest, internalFiles };
}
