// ============================================================
// @cortex/memory — FileBasedMemoryStore JSON 文件持久化实现
//
// 基于 AbstractMemoryStore 抽象基类，仅覆写文件 I/O 后端（~150行）。
// 与 InMemoryMemoryStore 共享同一基类，消除 ~700 行重复代码。
// ============================================================
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PersistenceError } from "../errors/MemoryStoreError.js";
import { AbstractMemoryStore } from "./AbstractMemoryStore.js";
const INDEX_FILE_NAME = "index.json";
const LINKS_FILE_NAME = "links.json";
const STORAGE_VERSION = 1;
// ── 文件后端 ─────────────────────────────────
class FileBackend {
    _entriesDir = "";
    _indexPath = "";
    _linksPath = "";
    _prettyPrint;
    constructor(options) {
        this._prettyPrint = options.prettyPrint ?? false;
    }
    async init(dbPath) {
        const basePath = path.resolve(dbPath);
        this._entriesDir = path.join(basePath, "entries");
        this._indexPath = path.join(basePath, INDEX_FILE_NAME);
        this._linksPath = path.join(basePath, LINKS_FILE_NAME);
        await fs.mkdir(this._entriesDir, { recursive: true }).catch((error) => {
            throw new PersistenceError(`Failed to create storage directory: ${this._entriesDir}`, error instanceof Error ? error : undefined);
        });
    }
    async load(store) {
        // 加载索引
        try {
            const indexData = await fs.readFile(this._indexPath, "utf-8");
            const index = JSON.parse(indexData);
            for (const entryId of Object.keys(index.entries)) {
                const entryPath = path.join(this._entriesDir, `${entryId}.json`);
                try {
                    const raw = await fs.readFile(entryPath, "utf-8");
                    const deserialized = JSON.parse(raw);
                    store._loadEntry(deserialized.id, {
                        ...deserialized,
                        content_blob: deserialized.content_blob,
                    });
                }
                catch {
                    // 文件损坏，跳过
                }
            }
        }
        catch {
            // 索引不存在，空存储
        }
        // 加载链路
        try {
            const linksData = await fs.readFile(this._linksPath, "utf-8");
            const linksFile = JSON.parse(linksData);
            for (const [sourceId, serializedLinks] of Object.entries(linksFile.links)) {
                store._loadLinks(sourceId, serializedLinks.map(l => ({
                    ...l,
                    linkType: l.linkType,
                })));
            }
        }
        catch {
            // 链路文件不存在
        }
    }
    async persist(entry) {
        const filePath = path.join(this._entriesDir, `${entry.id}.json`);
        const tmpPath = filePath + ".tmp";
        const json = JSON.stringify(entry, null, this._prettyPrint ? 2 : undefined);
        await fs.writeFile(tmpPath, json, "utf-8");
        await fs.rename(tmpPath, filePath);
    }
    async remove(id) {
        try {
            await fs.unlink(path.join(this._entriesDir, `${id}.json`));
        }
        catch {
            // 文件不存在，忽略
        }
    }
    async flushIndex(entries) {
        const index = {
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
    }
    async flushLinks(links) {
        const linksFile = { version: STORAGE_VERSION, updatedAt: Date.now(), links: {} };
        for (const [sourceId, linkList] of links) {
            linksFile.links[sourceId] = linkList.map(l => ({ ...l, linkType: l.linkType }));
        }
        const tmpPath = this._linksPath + ".tmp";
        await fs.writeFile(tmpPath, JSON.stringify(linksFile, null, this._prettyPrint ? 2 : undefined), "utf-8");
        await fs.rename(tmpPath, this._linksPath);
    }
    async flushAll(entries, links) {
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
    _fileBackend;
    _autoFlush;
    get isPersisted() { return true; }
    constructor(options) {
        const backend = new FileBackend(options ?? {});
        super(backend);
        this._fileBackend = backend;
        this._autoFlush = options?.autoFlush !== false;
    }
    async write(input) {
        const id = await super.write(input);
        if (this._autoFlush)
            await this._fileBackend.flushIndex(this._entries);
        return id;
    }
    async set(id, entry) {
        await super.set(id, entry);
        if (this._autoFlush)
            await this._fileBackend.flushIndex(this._entries);
    }
    async delete(id) {
        const result = await super.delete(id);
        if (result && this._autoFlush) {
            await this._fileBackend.flushIndex(this._entries);
            await this._fileBackend.flushLinks(this._links);
        }
        return result;
    }
}
//# sourceMappingURL=FileBasedMemoryStore.js.map