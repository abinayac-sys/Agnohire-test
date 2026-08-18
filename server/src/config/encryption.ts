import crypto from 'node:crypto';
import { env } from './env.js';

/**
 * AES-256-GCM encryption for secrets at rest (integration credentials,
 * secret SystemConfiguration values). The key comes from the ENCRYPTION_KEY
 * env var (32 bytes, base64). Output format: base64(iv).base64(tag).base64(ct)
 */
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKey(): Buffer {
  const key = Buffer.from(env.encryptionKey, 'base64');
  if (key.length !== 32) {
    // Allow a raw 32-char string as a dev fallback.
    const raw = Buffer.from(env.encryptionKey, 'utf8');
    if (raw.length === 32) return raw;
    throw new Error(
      'ENCRYPTION_KEY must decode to 32 bytes (base64) — run: openssl rand -base64 32',
    );
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed ciphertext');
  }
  const decipher = crypto.createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]);
  return pt.toString('utf8');
}

/** Returns true if a string looks like our ciphertext envelope. */
export function isEncrypted(value: string): boolean {
  return /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(value);
}

/**
 * Validate ENCRYPTION_KEY at boot. The key is otherwise only read lazily on the
 * first encrypt/decrypt, so a bad key stays hidden until someone saves a secret
 * (e.g. an API key in System Config) and gets a cryptic 500. Calling this at
 * startup surfaces the same actionable message immediately instead.
 */
export function assertEncryptionKey(): void {
  getKey();
}
