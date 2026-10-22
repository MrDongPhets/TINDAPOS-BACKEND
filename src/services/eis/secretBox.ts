// src/services/eis/secretBox.ts
// Encrypts ESP credentials (TaxTrail API key / webhook secret) before they're stored — AES-256-GCM.
// Key: EIS_ENCRYPTION_KEY = 32 random bytes as 64 hex chars or base64 (e.g. `openssl rand -hex 32`).
// Stored format: "v1:<iv b64>:<auth tag b64>:<ciphertext b64>". Never log the plaintext.
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function loadKey(): Buffer {
  const raw = (process.env.EIS_ENCRYPTION_KEY || '').trim();
  if (!raw) throw new Error('EIS_ENCRYPTION_KEY is not set — e-invoicing credentials cannot be stored');
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('EIS_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64)');
  return key;
}

export const encryptionConfigured = (): boolean => {
  try { loadKey(); return true; } catch { return false; }
};

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', loadKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
