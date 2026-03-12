import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../../src/crypto.js';
import crypto from 'node:crypto';

describe('AES-256-GCM encryption', () => {
  const masterKey = crypto.randomBytes(32);

  it('should encrypt and decrypt a string roundtrip', () => {
    const plaintext = 'sk-ant-api03-test-key-12345';
    const { encrypted, iv } = encrypt(plaintext, masterKey);
    const decrypted = decrypt(encrypted, iv, masterKey);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'same-key-twice';
    const result1 = encrypt(plaintext, masterKey);
    const result2 = encrypt(plaintext, masterKey);
    expect(result1.encrypted).not.toEqual(result2.encrypted);
    expect(result1.iv).not.toEqual(result2.iv);
  });

  it('should fail with wrong master key', () => {
    const plaintext = 'secret';
    const { encrypted, iv } = encrypt(plaintext, masterKey);
    const wrongKey = crypto.randomBytes(32);
    expect(() => decrypt(encrypted, iv, wrongKey)).toThrow();
  });

  it('should fail with tampered ciphertext', () => {
    const plaintext = 'secret';
    const { encrypted, iv } = encrypt(plaintext, masterKey);
    encrypted[0] = (encrypted[0]! + 1) % 256;
    expect(() => decrypt(encrypted, iv, masterKey)).toThrow();
  });

  it('should handle empty string', () => {
    const { encrypted, iv } = encrypt('', masterKey);
    const decrypted = decrypt(encrypted, iv, masterKey);
    expect(decrypted).toBe('');
  });

  it('should handle unicode content', () => {
    const plaintext = '密钥测试 🔑 key-тест';
    const { encrypted, iv } = encrypt(plaintext, masterKey);
    const decrypted = decrypt(encrypted, iv, masterKey);
    expect(decrypted).toBe(plaintext);
  });
});
