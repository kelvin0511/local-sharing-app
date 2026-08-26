import crypto from 'crypto';
import path from 'path';

// Unambiguous characters (omitting 0, O, 1, I, L)
const PAIRING_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Generates a memorable, unambiguous 5-character pairing code (e.g. "X2KTV")
 */
export function generatePairingCode(length: number = 5): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    const index = bytes[i] % PAIRING_CHARSET.length;
    code += PAIRING_CHARSET[index];
  }
  return code;
}

/**
 * Generates a high-entropy URL-safe cryptographic token.
 * Uses 32 bytes (256 bits) of randomness.
 */
export function generateSecureToken(byteLength: number = 32): string {
  return crypto.randomBytes(byteLength).toString('base64url');
}

/**
 * Generates a unique transfer session ID.
 */
export function generateTransferId(): string {
  return `tx_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Generates a unique internal file ID.
 */
export function generateFileId(): string {
  return `f_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function secureCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Sanitizes a filename to prevent directory traversal or invalid OS characters.
 */
export function sanitizeFilename(filename: string): string {
  // Strip null bytes and directory separators
  const base = path.basename(filename).replace(/\0/g, '');
  // Remove dangerous Windows/Unix filesystem characters (< > : " / \ | ? *)
  const cleaned = base.replace(/[<>:"/\\|?*]/g, '_').trim();
  return cleaned.length > 0 ? cleaned : 'unnamed_file';
}
