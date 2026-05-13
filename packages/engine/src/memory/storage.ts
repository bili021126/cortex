import type { MemoryEntry, MemoryLink, MemoryType, AgentType } from "@cortex/shared";
import { MemoryState, PipelineEventType, PipelinePriority } from "@cortex/shared";
import type { PipelineObserver } from "../pipeline-observer.js";
import * as crypto from "node:crypto";
import type { MemoryWriteInput } from "../memory-store.js";
import { EMBEDDING_DIM } from "./schema.js";

/**
 * MemoryStorage —— 纯内存 Map 存储引擎。
 *
 * 职责：
 * - memories Map<id, MemoryEntry> 增删查
 * - links Map<sourceId, MemoryLink[]> 增查
 * - DB 行的反序列化（JSON.parse 防护）
 * - 快照（peek / structuredClone）
 *
 * 不负责：持久化、查询逻辑、状态机。
 */
export class MemoryStorage {
  readonly memories = new Map<string, MemoryEntry>();
  readonly links = new Map<string, MemoryLink[]>();

  private _observer?: PipelineObserver;

  constructor(observer?: PipelineObserver) {
    this._observer = observer;
  }

  // ── 构造 ─────────────────────────────────────

  /** 从输入参数构造 MemoryEntry 并写入 Map。返回 entry。 */
  insert(input: MemoryWriteInput): MemoryEntry {
    const now = Date.now();
    const id = `mem-${crypto.randomUUID()}`;
    const entry: MemoryEntry = {
      id,
      memoryType: input.memoryType,
      state: MemoryState.Active,
      content: input.content,
      summary: input.summary,
      agentType: input.agentType,
      creatorId: input.creatorId,
      createdAt: input.createdAt ?? now,
      lastAccessedAt: now,
      accessCount: 0,
      weight: input.weight ?? 1.0,
      projectFingerprint: input.projectFingerprint,
      metadata: input.metadata,
      isPrivate: input.isPrivate ?? false,
      embedding: input.embedding,
    };
    this.memories.set(id, entry);
    return entry;
  }

  /** 从 DB 行反序列化为 MemoryEntry。损坏/非 JSON/null content 返回 null。 */
  deserializeRow(raw: Record<string, unknown>): MemoryEntry | null {
    const contentStr = raw.content as string;
    if (contentStr === null || contentStr === undefined) {
      this._emitDeserializeFailed(raw.id as string, "null content");
      return null;
    }
    if (typeof contentStr === 'string' && contentStr.trim().length > 0 && !contentStr.trimStart().startsWith('{') && !contentStr.trimStart().startsWith('[')) {
      this._emitDeserializeFailed(raw.id as string, "non-json content", contentStr.slice(0, 100));
      return null;
    }

    try {
      return {
        id: raw.id as string,
        memoryType: raw.memory_type as MemoryType,
        state: raw.state as MemoryState,
        content: JSON.parse(contentStr),
        summary: raw.summary as string,
        agentType: raw.agent_type as AgentType,
        creatorId: raw.creator_id as string,
        createdAt: raw.created_at as number,
        lastAccessedAt: raw.last_accessed_at as number,
        accessCount: raw.access_count as number,
        weight: raw.weight as number,
        projectFingerprint: raw.project_fingerprint as string | undefined,
        metadata: raw.metadata ? JSON.parse(raw.metadata as string) : undefined,
        isPrivate: (raw.is_private as number) === 1,
        embedding: _parseEmbeddingBlob(raw.embedding),
      };
    } catch (e) {
      this._emitDeserializeFailed(raw.id as string, String(e).slice(0, 200));
      return null;
    }
  }

  private _emitDeserializeFailed(id: string, reason: string, preview?: string): void {
    if (this._observer) {
      this._observer.emit({
        type: PipelineEventType.MemoryDeserializeFailed,
        priority: PipelinePriority.HIGH,
        payload: { id, reason, ...(preview ? { preview } : {}) },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    } else {
      console.error(`[MemoryStore] ${reason}，跳过行 ${id}${preview ? `: ${preview}` : ""}`);
    }
  }

  // ── 基础访问 ─────────────────────────────────

  /**
   * 解析 BLOB → number[] (Float32Array → Array.from)。
   * 长度校验：必须为 EMBEDDING_DIM * 4 字节，否则返回 undefined。
   */
  static parseEmbeddingBlob(raw: unknown): number[] | undefined {
    return _parseEmbeddingBlob(raw);
  }

  get(id: string): MemoryEntry | undefined {
    return this.memories.get(id);
  }

  has(id: string): boolean {
    return this.memories.has(id);
  }

  delete(id: string): void {
    this.memories.delete(id);
  }

  get size(): number {
    return this.memories.size;
  }

  /** values 迭代器（供全量扫描使用） */
  values(): IterableIterator<MemoryEntry> {
    return this.memories.values();
  }

  // ── 关联边 ───────────────────────────────────

  /** 添加一条关联边到 sourceId 的出边列表。Power 等去重逻辑由调用方处理。 */
  addLink(sourceId: string, link: MemoryLink): void {
    let existing = this.links.get(sourceId);
    if (!existing) {
      existing = [];
      this.links.set(sourceId, existing);
    }
    existing.push(link);
  }

  /** 移除 sourceId 的最后一条出边（DB 回滚用） */
  removeLastLink(sourceId: string): void {
    const existing = this.links.get(sourceId);
    if (existing && existing.length > 0) {
      existing.pop();
    }
  }

  /** 获取某记忆的所有出边 */
  getLinks(sourceId: string): MemoryLink[] {
    return this.links.get(sourceId) ?? [];
  }

  // ── 快照 ─────────────────────────────────────

  /** 只读快照（深拷贝 + 递归冻结） */
  peek(id: string): Readonly<MemoryEntry> | undefined {
    const m = this.memories.get(id);
    if (!m) return undefined;
    const copy = structuredClone(m) as MemoryEntry;
    const deepFreeze = (obj: unknown): void => {
      if (obj === null || typeof obj !== "object") return;
      Object.freeze(obj);
      Object.values(obj as Record<string, unknown>).forEach(deepFreeze);
    };
    deepFreeze(copy);
    return copy;
  }

  // ── 批量加载（供 persistence.init 使用）───────

  loadAll(entries: MemoryEntry[]): void {
    for (const e of entries) {
      this.memories.set(e.id, e);
    }
  }

  loadAllLinks(linkList: MemoryLink[]): void {
    for (const link of linkList) {
      this.addLink(link.sourceId, link);
    }
  }
}

// ── 模块内辅助 ─────────────────────────────────

function _parseEmbeddingBlob(raw: unknown): number[] | undefined {
  if (!(raw instanceof Buffer) && !ArrayBuffer.isView(raw)) return undefined;
  const buf: Buffer = raw instanceof Buffer ? raw : Buffer.from(raw as unknown as ArrayBuffer);
  if (buf.length !== EMBEDDING_DIM * 4) return undefined;
  const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(arr);
}
