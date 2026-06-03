/**
 * store.ts — 密码条目存储层
 *
 * 使用 AES-256-GCM 加密存储密码条目。
 * 原位于 projects/solo-flight/src/store.ts
 *
 * @fix N-07 — 解密失败时抛出带详细信息的错误，防止静默返回空 store 导致 saveStore 覆盖加密数据
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { encrypt, decrypt } from './crypto.js';

/**
 * 密码条目数据结构
 */
export interface PasswordEntry {
  id: string;
  name: string;
  username: string;
  password: string;
  createdAt: string;
  updatedAt: string;
}

interface StoreData {
  version: 1;
  entries: PasswordEntry[];
}

function getStorePath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  // 存储到 .pm-data/vault.enc（相对于项目根）
  return path.join(currentDir, '..', '..', '..', '.pm-data', 'vault.enc');
}

function ensureStoreDir(): string {
  const storePath = getStorePath();
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return storePath;
}

function loadStore(): StoreData {
  const storePath = ensureStoreDir();
  if (!fs.existsSync(storePath)) {
    return { version: 1, entries: [] };
  }
  try {
    const encrypted = fs.readFileSync(storePath, 'utf-8').trim();
    if (!encrypted) {
      return { version: 1, entries: [] };
    }
    const raw = decrypt(encrypted);
    return JSON.parse(raw) as StoreData;
  } catch (e) {
    // @fix N-07 — 抛出错误而非返回空 store，防止 saveStore 不可逆覆盖原加密数据
    throw new Error(
      `密码存储文件解密失败：密钥可能已变更或文件已损坏。\n` +
      `文件路径: ${storePath}\n` +
      `原错误: ${(e as Error).message}\n` +
      `提示：如果已更换 PM_MASTER_KEY，请先使用旧密钥导出数据。`,
      { cause: e },
    );
  }
}

function saveStore(data: StoreData): void {
  const storePath = ensureStoreDir();
  const raw = JSON.stringify(data, null, 2);
  const encrypted = encrypt(raw);
  fs.writeFileSync(storePath, encrypted, 'utf-8');
}

export function addEntry(
  name: string,
  username: string,
  password: string,
): PasswordEntry {
  const store = loadStore();
  const existing = store.entries.find((e) => e.name === name);
  if (existing) {
    throw new Error(`条目 "${name}" 已存在，请使用不同名称或先删除旧条目`);
  }

  const entry: PasswordEntry = {
    id: crypto.randomUUID(),
    name,
    username,
    password,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  store.entries.push(entry);
  saveStore(store);
  return entry;
}

export function getEntry(name: string): PasswordEntry | undefined {
  const store = loadStore();
  return store.entries.find((e) => e.name === name);
}

export function listEntries(): Pick<PasswordEntry, 'id' | 'name' | 'createdAt'>[] {
  const store = loadStore();
  return store.entries.map((e) => ({
    id: e.id,
    name: e.name,
    createdAt: e.createdAt,
  }));
}
