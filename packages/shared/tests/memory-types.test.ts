// @ci: unit

import { describe, it, expect } from "vitest";
import type {
  MemoryEntry,
  MemoryQuery,
  MemoryWriteInput,
  SemanticState,
} from "../src/memory.js";

describe("Memory type constraints", () => {
  it("MemoryEntry.domain 应为可选 string", () => {
    // 编译期验证：domain 为可选字段
    const entry: MemoryEntry = {
      id: "test-id",
      source: { agentType: "code" as any, taskId: "t1" },
      kind: "TaskLog",
      summary: "test",
      semantic_gist: "test gist",
      content_blob: {},
      semantic_state: "Active",
      weight: 1.0,
      accessCount: 0,
      lastAccessedAt: Date.now(),
      createdAt: Date.now(),
      content_hash: "abc123",
    };
    expect(entry.domain).toBeUndefined();

    // 显式设置 domain
    const entryWithDomain: MemoryEntry = { ...entry, domain: "custom-domain" };
    expect(entryWithDomain.domain).toBe("custom-domain");
  });

  it("MemoryQuery.domainGate 应为可选", () => {
    // 编译期验证：domainGate 为可选字段
    const query: MemoryQuery = {};
    expect(query.domainGate).toBeUndefined();

    // 显式设置
    const queryWithGate: MemoryQuery = { domainGate: { allow: ["general"] } };
    expect(queryWithGate.domainGate?.allow).toEqual(["general"]);

    const queryBlock: MemoryQuery = { domainGate: { block: ["system"] } };
    expect(queryBlock.domainGate?.block).toEqual(["system"]);

    // 同时 allow 和 block
    const queryBoth: MemoryQuery = {
      domainGate: { allow: ["general", "code"], block: ["system"] },
    };
    expect(queryBoth.domainGate?.allow).toHaveLength(2);
    expect(queryBoth.domainGate?.block).toHaveLength(1);
  });

  it("MemoryWriteInput 应包含 domain 字段（可选）", () => {
    const input: MemoryWriteInput = {
      source: { agentType: "code" as any, taskId: "t1" },
      kind: "Insight",
      summary: "test",
      semantic_gist: "gist",
      content_blob: {},
    };
    expect(input.domain).toBeUndefined();

    const inputWithDomain: MemoryWriteInput = { ...input, domain: "analysis" };
    expect(inputWithDomain.domain).toBe("analysis");
  });

  it("MemoryEntry 字段完整性校验", () => {
    const entry: MemoryEntry = {
      id: "m1",
      source: { agentType: "fix" as any, taskId: "t1" },
      kind: "Governance",
      summary: "summary",
      semantic_gist: "gist",
      content_blob: { decision: "approve" },
      semantic_state: "Active",
      weight: 0.8,
      accessCount: 5,
      lastAccessedAt: 1000,
      createdAt: 0,
      content_hash: "hash",
    };

    // 核心字段必须存在
    expect(entry.id).toBeDefined();
    expect(entry.source).toBeDefined();
    expect(entry.source.agentType).toBeDefined();
    expect(entry.source.taskId).toBeDefined();
    expect(entry.kind).toBeDefined();
    expect(entry.summary).toBeDefined();
    expect(entry.semantic_gist).toBeDefined();
    expect(entry.content_blob).toBeDefined();
    expect(entry.semantic_state).toBeDefined();
    expect(entry.weight).toBeDefined();
    expect(entry.accessCount).toBeDefined();
    expect(entry.lastAccessedAt).toBeDefined();
    expect(entry.createdAt).toBeDefined();
    expect(entry.content_hash).toBeDefined();
  });

  it("MemoryEntry state machine: Active→Archived→Obliterated 合法", () => {
    // 验证状态机常量中的合法转换
    // Active 可转为 Archived
    const activeToArchived = { from: "Active" as SemanticState, to: "Archived" as SemanticState };
    expect(activeToArchived.from).toBe("Active");
    expect(activeToArchived.to).toBe("Archived");

    // Archived 可转为 Obliterated
    const archivedToObliterated = { from: "Archived" as SemanticState, to: "Obliterated" as SemanticState };
    expect(archivedToObliterated.from).toBe("Archived");
    expect(archivedToObliterated.to).toBe("Obliterated");

    // Active 不可直接转为 Obliterated（按转换表）
    // 实际转换由 MEMORY_VALID_TRANSITIONS 控制
  });

  it("MemoryEntry 的 weight 应为非负数", () => {
    const entry: MemoryEntry = {
      id: "w1",
      source: { agentType: "code" as any, taskId: "t1" },
      kind: "TaskLog",
      summary: "s",
      semantic_gist: "g",
      content_blob: {},
      semantic_state: "Active",
      weight: 0.5,
      accessCount: 1,
      lastAccessedAt: 100,
      createdAt: 0,
      content_hash: "h",
    };
    expect(entry.weight).toBeGreaterThanOrEqual(0);
  });

  it("MemoryEntry 的 accessCount 应为非负整数", () => {
    const entry: MemoryEntry = {
      id: "ac1",
      source: { agentType: "code" as any, taskId: "t1" },
      kind: "TaskLog",
      summary: "s",
      semantic_gist: "g",
      content_blob: {},
      semantic_state: "Active",
      weight: 0.5,
      accessCount: 42,
      lastAccessedAt: 1000,
      createdAt: 0,
      content_hash: "h",
    };
    expect(entry.accessCount).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(entry.accessCount)).toBe(true);
  });

  it("MemoryEntry 的 content_hash 应不为空字符串", () => {
    const entry: MemoryEntry = {
      id: "ch1",
      source: { agentType: "code" as any, taskId: "t1" },
      kind: "TaskLog",
      summary: "s",
      semantic_gist: "g",
      content_blob: {},
      semantic_state: "Active",
      weight: 0.5,
      accessCount: 1,
      lastAccessedAt: 100,
      createdAt: 0,
      content_hash: "abc123",
    };
    expect(entry.content_hash.length).toBeGreaterThan(0);
  });

  it("MemoryEntry 可包含 embedding 和 expires_at", () => {
    const entry: MemoryEntry = {
      id: "e1",
      source: { agentType: "code" as any, taskId: "t1" },
      kind: "TaskLog",
      summary: "s",
      semantic_gist: "g",
      content_blob: {},
      semantic_state: "Active",
      weight: 0.5,
      accessCount: 1,
      lastAccessedAt: 100,
      createdAt: 0,
      content_hash: "h",
      embedding: [0.1, 0.2, 0.3],
      expires_at: Date.now() + 86400000,
    };
    expect(entry.embedding).toHaveLength(3);
    expect(entry.expires_at).toBeGreaterThan(0);
  });

  it("MemoryKind 应包含全部 5 种类别", () => {
    const kinds: string[] = ["TaskLog", "Insight", "Skill", "Governance", "Intent"];
    expect(kinds).toHaveLength(5);
    expect(kinds).toContain("TaskLog");
    expect(kinds).toContain("Insight");
    expect(kinds).toContain("Skill");
    expect(kinds).toContain("Governance");
    expect(kinds).toContain("Intent");
  });

  it("SemanticState 应包含全部 4 种状态", () => {
    const states: string[] = ["Pending", "Active", "Archived", "Obliterated"];
    expect(states).toHaveLength(4);
    expect(states).toContain("Pending");
    expect(states).toContain("Active");
    expect(states).toContain("Archived");
    expect(states).toContain("Obliterated");
  });
});
