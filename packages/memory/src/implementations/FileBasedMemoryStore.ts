// ============================================================
// @cortex/memory — FileBasedMemoryStore JSON 文件持久化实现
//
// 基于 AbstractMemoryStore 抽象基类，仅覆写文件 I/O 后端（~150行）。
// 与 InMemoryMemoryStore 共享同一基类，消除 ~700 行重复代码。
// ============================================================

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { MemoryEntry, MemoryLink, LinkType } from "@cortex/shared";
import { PersistenceError } from "../errors/MemoryStoreError.js";
import { AbstractMemoryStore, type MemoryStoreBackend } from "./AbstractMemoryStore.js";

// ── 内部类型 ──────────────────────────────────

interface IndexFile {
  version: number;
  updatedAt: number;
  entries: Record<string, EntryIndex>;
}

interface EntryIndex {
  id: string;
  kind: string;
  summary: string;
  semantic_state: string;
  createdAt: number;
  weight: number;
}

interface SerializedMemoryEntry extends Omit<MemoryEntry, "content_blob"> {
  content_blob: Record<string, unknown>;
}

interface LinksFile {
  version: number;
  updatedAt: number;
  links: Record<string, Array<Omit<MemoryLink, "linkType"> & { linkType: string }>>;
}

const INDEX_FILE_NAME = "index.json";
const LINKS_FILE_NAME = "links.json";
const STORAGE_VERSION = 1;

// ── 文件后端 ─────────────────────────────────

class FileBackend implements MemoryStoreBackend {
  private _entriesDir = "";
  private _indexPath = "";
  private _linksPath = "";
  private _prettyPrint: boolean;
  private _flushQueue: Promise<unknown> = Promise.resolve();
  /** per-entry persist 锁：防止同一 id 的并发 persist 产生 .tmp 竞争（Linux ext4 无强制文件锁）
   *  commitMemory 的 fire-and-forget persist 与 close/flushAll 的同步 persist
   *  可能对同一 entry 同时写 .tmp → rename，先完成者消费掉 tmp 后第二方 ENOENT。
   *  key=entryId, value=进行中 persist Promise，同 id 的后续 persist 排队等待。 */
  private _persistLocks = new Map<string, Promise<void>>();

  /** 串行化 flush 操作，防止并发 rename 竞争 */
  private _serializedFlush<T>(fn: () => Promise<T>): Promise<T> {
    this._flushQueue = this._flushQueue.then(fn, fn);
    return this._flushQueue as Promise<T>;
  }

  constructor(options: FileBasedMemoryStoreOptions) {
    this._prettyPrint = options.prettyPrint ?? false;
  }

  async init(dbPath: string): Promise<void> {
    const basePath = path.resolve(dbPath);
    this._entriesDir = path.join(basePath, "entries");
    this._indexPath = path.join(basePath, INDEX_FILE_NAME);
    this._linksPath = path.join(basePath, LINKS_FILE_NAME);

    await fs.mkdir(this._entriesDir, { recursive: true }).catch((error) => {
      throw new PersistenceError(
        `Failed to create storage directory: ${this._entriesDir}`,
        error instanceof Error ? error : undefined,
      );
    });
  }

  async load(store: AbstractMemoryStore): Promise<void> {
    // 加载索引
    try {
      const indexData = await fs.readFile(this._indexPath, "utf-8");
      const index: IndexFile = JSON.parse(indexData);
      for (const entryId of Object.keys(index.entries)) {
        const entryPath = path.join(this._entriesDir, `${entryId}.json`);
        try {
          const raw = await fs.readFile(entryPath, "utf-8");
          const deserialized: SerializedMemoryEntry = JSON.parse(raw);
          store._loadEntry(deserialized.id, {
            ...deserialized,
            content_blob: deserialized.content_blob as unknown as Record<string, unknown>,
          });
        } catch {
          // 文件损坏，跳过
        }
      }
    } catch (_e) {
      // 检查索引文件是否存在以区分首次使用和文件损坏
      try {
        await fs.access(this._indexPath);
        console.warn(`[memory] 索引文件损坏，从空存储启动: ${this._indexPath}`);
      } catch { /* empty */ }
      // 索引不存在 = 首次使用，静默
    }

    // 加载链路
    try {
      const linksData = await fs.readFile(this._linksPath, "utf-8");
      const linksFile: LinksFile = JSON.parse(linksData);
      for (const [sourceId, serializedLinks] of Object.entries(linksFile.links)) {
        store._loadLinks(sourceId, serializedLinks.map(l => ({
          ...l,
          linkType: l.linkType as LinkType,
        })));
      }
    } catch {
      // 链路文件不存在
    }
  }

  async persist(entry: MemoryEntry): Promise<void> {
    // per-entry 串行化：同一 id 的并发 persist 排队执行，消除 .tmp rename 竞态
    const id = entry.id;
    const existing = this._persistLocks.get(id) ?? Promise.resolve();
    const next = existing.then(async () => {
      const filePath = path.join(this._entriesDir, `${id}.json`);
      const tmpPath = filePath + ".tmp";
      const json = JSON.stringify(entry, null, this._prettyPrint ? 2 : undefined);
      await fs.writeFile(tmpPath, json, "utf-8");
      await fs.rename(tmpPath, filePath);
    }).catch((err) => {
      // 失败上报，仍继续向上抛出供调用方处理
      console.error(`[memory] persist failed: id=${id} err=${err instanceof Error ? err.message : String(err)}`);
      throw err;
    });
    this._persistLocks.set(id, next);
    // 清理已完成/已失败锁——finally 语义：rejected Promise 也必须删锁，
    // 否则该 id 永久无法再落盘（P1-1 锁毒化）
    void next.then(
      () => { if (this._persistLocks.get(id) === next) this._persistLocks.delete(id); },
      () => { if (this._persistLocks.get(id) === next) this._persistLocks.delete(id); },
    );
    return await next;
  }

  async remove(id: string): Promise<void> {
    try {
      await fs.unlink(path.join(this._entriesDir, `${id}.json`));
    } catch (err) {
      // 只忽略文件不存在的 ENOENT，其他错误（权限/IO）必须抛出（P1-4）
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return;
      throw err;
    }
  }

  async flushIndex(entries: Map<string, MemoryEntry>): Promise<void> {
    return await this._serializedFlush(async () => {
      const index: IndexFile = {
        version: STORAGE_VERSION,
        updatedAt: Date.now(),
        entries: {},
      };
      for (const [id, entry] of entries) {
        index.entries[id] = { id, kind: entry.kind, summary: entry.summary, semantic_state: entry.semantic_state, createdAt: entry.createdAt, weight: entry.weight };
      }
      const tmpPath = this._indexPath + ".tmp";
      await fs.writeFile(tmpPath, JSON.stringify(index, null, this._prettyPrint ? 2 : undefined), "utf-8");
      await fs.rename(tmpPath, this._indexPath);
    });
  }

  async flushLinks(links: Map<string, MemoryLink[]>): Promise<void> {
    return await this._serializedFlush(async () => {
      const linksFile: LinksFile = { version: STORAGE_VERSION, updatedAt: Date.now(), links: {} };
      for (const [sourceId, linkList] of links) {
        linksFile.links[sourceId] = linkList.map(l => ({ ...l, linkType: l.linkType }));
      }
      const tmpPath = this._linksPath + ".tmp";
      await fs.writeFile(tmpPath, JSON.stringify(linksFile, null, this._prettyPrint ? 2 : undefined), "utf-8");
      await fs.rename(tmpPath, this._linksPath);
    });
  }

  async flushAll(entries: Map<string, MemoryEntry>, links: Map<string, MemoryLink[]>): Promise<void> {
    for (const entry of entries.values()) {
      await this.persist(entry);
    }
    await this.flushIndex(entries);
    await this.flushLinks(links);
  }
}

// ── FileBasedMemoryStore ─────────────────────

/**
 * FileBasedMemoryStore —— 基于 JSON 文件持久化的 MemoryStore 实现。
 *
 * 继承 AbstractMemoryStore 的全部 36 个共享方法，注入 FileBackend，
 * 并覆写 write/set/delete 以支持 autoFlush。
 */
export class FileBasedMemoryStore extends AbstractMemoryStore {
  private readonly _fileBackend: FileBackend;
  private readonly _autoFlush: boolean;

  override get isPersisted(): boolean { return true; }

  constructor(options?: FileBasedMemoryStoreOptions) {
    const backend = new FileBackend(options ?? {});
    super(backend);
    this._fileBackend = backend;
    this._autoFlush = options?.autoFlush !== false;
  }

  override async write(input: Parameters<AbstractMemoryStore["write"]>[0]): ReturnType<AbstractMemoryStore["write"]> {
    const id = await super.write(input);
    if (this._autoFlush) await this._fileBackend.flushIndex(this._entries);
    return id;
  }

  override async set(id: string, entry: MemoryEntry): Promise<void> {
    await super.set(id, entry);
    if (this._autoFlush) await this._fileBackend.flushIndex(this._entries);
  }

  override async delete(id: string): Promise<boolean> {
    const result = await super.delete(id);
    if (result && this._autoFlush) {
      await this._fileBackend.flushIndex(this._entries);
      await this._fileBackend.flushLinks(this._links);
    }
    return result;
  }
}

// ── 公开类型 ──────────────────────────────────

export interface FileBasedMemoryStoreOptions {
  autoFlush?: boolean;
  prettyPrint?: boolean;
}
