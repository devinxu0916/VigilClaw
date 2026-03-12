import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export function encrypt(plaintext: string, masterKey: Buffer): { encrypted: Buffer; iv: Buffer } {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encrypted: Buffer.concat([encrypted, authTag]),
    iv,
  };
}

export function decrypt(encrypted: Buffer, iv: Buffer, masterKey: Buffer): string {
  const authTag = encrypted.subarray(encrypted.length - AUTH_TAG_LENGTH);
  const ciphertext = encrypted.subarray(0, encrypted.length - AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}

export function parseMasterKey(envKey: string | undefined): Buffer {
  if (envKey) {
    if (envKey.length !== 64) {
      throw new Error('VIGILCLAW_MASTER_KEY must be 64 hex characters (32 bytes)');
    }
    return Buffer.from(envKey, 'hex');
  }

  const keyPath = path.join(os.homedir(), '.config', 'vigilclaw', 'master.key');

  if (fs.existsSync(keyPath)) {
    const hex = fs.readFileSync(keyPath, 'utf-8').trim();
    return Buffer.from(hex, 'hex');
  }

  const newKey = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, newKey.toString('hex'), { mode: 0o600 });

  return newKey;
}
