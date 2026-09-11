import { createHash, randomBytes } from 'node:crypto';

/**
 * F4.1 — share-link tokens.
 *
 * The raw token travels in the URL; only its SHA-256 digest is stored, so a
 * leaked database dump cannot be used to rebuild working links.
 */

/** 256-bit URL-safe token (43 characters). */
export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest of a token, as stored in `shares.tokenHash`. */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Cheap shape check before touching the database (junk tokens → 404). */
export function isPlausibleShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{20,128}$/.test(token);
}
