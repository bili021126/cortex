/**
 * pm.test.ts — @cortex/pm 冒烟测试
 *
 * 验证加密、解密、存储基础功能
 */

import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../src/crypto.js';

describe('@cortex/pm', () => {
  describe('crypto', () => {
    it('encrypt 返回 base64 字符串', () => {
      const result = encrypt('hello world');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('decrypt(encrypt(text)) === text', () => {
      const original = '测试密码内容 ABC123!@#';
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it('encrypt 每次产生不同密文（随机 salt/iv）', () => {
      const text = 'same text';
      const a = encrypt(text);
      const b = encrypt(text);
      expect(a).not.toBe(b);
    });

    it('处理空字符串', () => {
      const original = '';
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it('处理中文/Unicode', () => {
      const original = '🎆 烟花测试 🔥 密码管理器';
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });
  });
});
