import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
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
  return path.join(currentDir, '..', '..', '.pm-data', 'vault.enc');
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
  } catch {
    console.error('警告：存储文件读取失败，可能密钥已变更或文件已损坏');
    return { version: 1, entries: [] };
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
