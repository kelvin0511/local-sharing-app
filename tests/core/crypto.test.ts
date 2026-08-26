import { describe, it, expect } from 'vitest';
import {
  generateSecureToken,
  generateTransferId,
  generateFileId,
  generatePairingCode,
  secureCompare,
  sanitizeFilename
} from '../../src/core/crypto';

describe('Crypto & Security Utilities', () => {
  it('generates 5-character unambiguous pairing codes', () => {
    const code1 = generatePairingCode();
    const code2 = generatePairingCode();
    expect(code1.length).toBe(5);
    expect(code2.length).toBe(5);
    // Should not contain ambiguous 0, O, 1, I, L
    expect(code1).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);
    expect(code2).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);
  });

  it('generates high-entropy base64url tokens', () => {
    const token1 = generateSecureToken();
    const token2 = generateSecureToken();

    expect(token1).toBeDefined();
    expect(token2).toBeDefined();
    expect(token1).not.toEqual(token2);
    expect(token1.length).toBeGreaterThanOrEqual(40);
    // Ensure base64url characters only (alphanumeric, -, _)
    expect(token1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates unique transfer and file IDs', () => {
    const tId1 = generateTransferId();
    const tId2 = generateTransferId();
    expect(tId1.startsWith('tx_')).toBe(true);
    expect(tId1).not.toEqual(tId2);

    const fId1 = generateFileId();
    const fId2 = generateFileId();
    expect(fId1.startsWith('f_')).toBe(true);
    expect(fId1).not.toEqual(fId2);
  });

  it('performs constant-time string comparison securely', () => {
    const secret = 'super-secret-token-12345';
    expect(secureCompare(secret, 'super-secret-token-12345')).toBe(true);
    expect(secureCompare(secret, 'wrong-token')).toBe(false);
    expect(secureCompare(secret, 'super-secret-token-12346')).toBe(false);
    expect(secureCompare('', '')).toBe(true);
  });

  it('sanitizes unsafe filenames and paths', () => {
    expect(sanitizeFilename('normal_photo.jpg')).toBe('normal_photo.jpg');
    expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('..\\..\\windows\\system32\\calc.exe')).toBe('calc.exe');
    expect(sanitizeFilename('file<bad>:name"test|bar?foo*.zip')).toBe('file_bad__name_test_bar_foo_.zip');
    expect(sanitizeFilename('')).toBe('unnamed_file');
    expect(sanitizeFilename('   ')).toBe('unnamed_file');
  });
});
