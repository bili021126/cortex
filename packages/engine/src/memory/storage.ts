import type { MemoryEntry, MemoryLink, MemoryWriteInput, AgentType, MemorySource, MemoryKind, SemanticState } from "@cortex/shared";
import { PipelineEventType, PipelinePriority } from "@cortex/shared";
import type { IPipelineObserver } from "@cortex/shared";
import * as crypto from "node:crypto";
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

  private _observer?: IPipelineObserver;

  constructor(observer?: IPipelineObserver) {
    this._observer = observer;
  }

  // ── 构造 ─────────────────────────────────────

  /** 从输入参数构造 MemoryEntry 并写入 Map。返回 entry。 */
  insert(input: MemoryWriteInput, contentHash?: string): MemoryEntry {
    const now = Date.now();
    const id = `mem-${crypto.randomUUID()}`;
    const entry: MemoryEntry = {
      id,
      source: input.source,
      kind: input.kind,
      summary: input.summary,
      semantic_gist: input.semantic_gist,
      content_blob: input.content_blob,
      semantic_state: "Active",
      weight: input.weight ?? 1.0,
      accessCount: 0,
      lastAccessedAt: now,
      createdAt: input.createdAt ?? now,
      embedding: input.embedding,
      content_hash: contentHash ?? input.content_hash ?? "",
      expires_at: input.expires_at,
    };
    this.memories.set(id, entry);
    return entry;
  }

  /**
   * 按 SHA256 内容哈希查找 Active 态重复记忆。
   */
  findByContentHash(hash: string): MemoryEntry | undefined {
    for (const [, m] of this.memories) {
      if (m.content_hash === hash && m.semantic_state === "Active") {
        return m;
      }
    }
    return undefined;
  }

  /**
   * 按向量余弦相似度查找语义重复记忆。
   */
  findBySimilarity(embedding: number[], threshold: number): MemoryEntry | undefined {
    if (embedding.length !== EMBEDDING_DIM) return undefined;
    const q = new Float32Array(embedding);
    let best: MemoryEntry | undefined;
    let bestScore = threshold;
    for (const [, m] of this.memories) {
      if (m.semantic_state !== "Active" || m.embedding?.length !== EMBEDDING_DIM) continue;
      const e = new Float32Array(m.embedding);
      let dot = 0;
      for (let i = 0; i < EMBEDDING_DIM; i++) dot += q[i] * e[i];
      if (dot >= bestScore) {
        bestScore = dot;
        best = m;
      }
    }
    return best;
  }

  /** 从 DB 行反序列化为 MemoryEntry。损坏/非 JSON/null content 返回 null。 */
  deserializeRow(raw: Record<string, unknown>): MemoryEntry | null {
    const contentBlobStr = raw.content_blob as string;
    if (contentBlobStr === null || contentBlobStr === undefined) {
      this._emitDeserializeFailed(raw.id as string, "null content_blob");
      return null;
    }

    try {
      const entry: MemoryEntry = {
        id: raw.id as string,
        source: _parseSource(raw.source as string),
        kind: (raw.kind as MemoryKind) || "TaskLog",
        summary: (raw.summary as string) || "",
        semantic_gist: (raw.semantic_gist as string) || "",
        content_blob: JSON.parse(contentBlobStr),
        semantic_state: (raw.semantic_state as SemanticState) || "Active",
        weight: (raw.weight as number) ?? 1.0,
        accessCount: (raw.access_count as number) ?? 0,
        lastAccessedAt: (raw.last_accessed_at as number) ?? 0,
        createdAt: (raw.created_at as number) ?? 0,
        embedding: _parseEmbeddingBlob(raw.embedding),
        content_hash: (raw.content_hash as string) || "",
        expires_at: (raw.expires_at as number) || undefined,
      };
      return entry;
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

  values(): IterableIterator<MemoryEntry> {
    return this.memories.values();
  }

  // ── 关联边 ───────────────────────────────────

  addLink(sourceId: string, link: MemoryLink): void {
    let existing = this.links.get(sourceId);
    if (!existing) {
      existing = [];
      this.links.set(sourceId, existing);
    }
    existing.push(link);
  }

  removeLastLink(sourceId: string): void {
    const existing = this.links.get(sourceId);
    if (existing && existing.length > 0) {
      existing.pop();
    }
  }

  getLinks(sourceId: string): MemoryLink[] {
    return this.links.get(sourceId) ?? [];
  }

  // ── 快照 ─────────────────────────────────────

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

  // ── 批量加载 ────────────────────────────────

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

  /**
   * 清理孤儿边：移除指向不存在记忆或已湮灭记忆的关联边。
   */
  cleanOrphanedLinks(): number {
    let cleaned = 0;
    for (const [sourceId, linkList] of this.links) {
      const before = linkList.length;
      const filtered = linkList.filter((link) => {
        const target = this.memories.get(link.targetId);
        return target && target.semantic_state !== "Obliterated";
      });
      cleaned += before - filtered.length;
      if (filtered.length === 0) {
        this.links.delete(sourceId);
      } else if (filtered.length !== before) {
        this.links.set(sourceId, filtered);
      }
    }
    return cleaned;
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

/** 从 SQL source JSON 列反序列化为 MemorySource */
function _parseSource(raw: string): MemorySource {
  if (!raw || raw === "{}") return { agentType: "unknown" as AgentType, taskId: "" };
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return {
      agentType: (parsed.agentType || parsed.agent_type || "unknown") as AgentType,
      taskId: parsed.taskId || parsed.task_id || "",
    };
  } catch {
    return { agentType: "unknown" as AgentType, taskId: "" };
  }
}
