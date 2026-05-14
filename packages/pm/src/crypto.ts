/**
 * crypto.ts — AES-256-GCM 加密模块
 *
 * 使用主密钥派生加密密钥，确保存储安全。
 * 原位于 projects/solo-flight/src/crypto.ts
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const KEYDERIV_OPTIONS = { N: 2 ** 14, r: 8, p: 1 };

function getMasterKey(): string {
  const envKey = process.env.PM_MASTER_KEY;
  if (envKey && envKey.length >= 8) {
    return envKey;
  }
  return 'password-manager-default-master-key-2024';
}

function deriveKey(master: string, salt: Buffer): Buffer {
  return crypto.scryptSync(master, salt, KEY_LENGTH, KEYDERIV_OPTIONS);
}

/**
 * 加密明文，返回 base64 编码的密文
 * 格式: salt(16) + iv(12) + authTag(16) + ciphertext
 */
export function encrypt(plaintext: string): string {
  const master = getMasterKey();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(master, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

/**
 * 解密 base64 编码的密文，返回明文字符串
 */
export function decrypt(ciphertext: string): string {
  const master = getMasterKey();
  const raw = Buffer.from(ciphertext, 'base64');

  const salt = raw.subarray(0, SALT_LENGTH);
  const iv = raw.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = raw.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + TAG_LENGTH,
  );
  const encrypted = raw.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = deriveKey(master, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf-8');
}
