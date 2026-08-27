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

export type FileEntryInput = string | { path: string; relativePath?: string };

/**
 * Normalizes and sanitizes a relative path (e.g., "Folder/sub/file.txt")
 */
function sanitizeRelativePath(relPath: string): string {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(p => p && p !== '.' && p !== '..');
  const safeParts = parts.map(p => sanitizeFilename(p));
  return safeParts.join('/');
}

/**
 * Validates an array of filesystem paths or file entries, computes sizes, and builds a secure transfer session.
 */
export async function createTransferManifest(
  fileEntries: FileEntryInput[],
  idleTimeoutMs: number = 10 * 60 * 1000, // 10 minutes default
  customPairingCode?: string
): Promise<PreparedTransfer> {
  if (!fileEntries || fileEntries.length === 0) {
    throw new Error('No files provided for transfer.');
  }

  const internalFiles = new Map<string, FileItem>();
  const publicFiles: PublicFileItem[] = [];
  let totalBytes = 0;

  for (const entry of fileEntries) {
    const rawPath = typeof entry === 'string' ? entry : entry.path;
    const customRelPath = typeof entry === 'string' ? undefined : entry.relativePath;

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
    const safeRelativePath = customRelPath ? sanitizeRelativePath(customRelPath) : undefined;
    const mimeType = mime.lookup(safeName) || 'application/octet-stream';
    const id = generateFileId();

    const fileItem: FileItem = {
      id,
      name: safeName,
      relativePath: safeRelativePath,
      size: stat.size,
      type: mimeType,
      path: resolvedPath
    };

    const publicItem: PublicFileItem = {
      id,
      name: safeName,
      relativePath: safeRelativePath,
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
