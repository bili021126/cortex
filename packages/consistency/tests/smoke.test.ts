import { describe, it, expect } from "vitest";
import { SchemaEnforcer } from "../src/schema-enforcer.js";
import { IntentFactWall } from "../src/intent-fact-wall.js";
import { createDefaultConflictDetector } from "../src/conflict-detector.js";

describe("@cortex/consistency smoke", () => {
  it("SchemaEnforcer 可实例化", () => {
    const enforcer = new SchemaEnforcer();
    expect(enforcer).toBeInstanceOf(SchemaEnforcer);
  });

  it("校验合法 MemoryWriteInput", () => {
    const enforcer = new SchemaEnforcer();
    const result = enforcer.validate({
      source: { agentType: "test" as any },
      kind: "test-kind" as any,
      summary: "test summary",
      semantic_gist: "test gist",
      content_blob: { data: 1 },
    });
    expect(result.valid).toBe(true);
  });

  it("校验拒绝缺少 kind", () => {
    const enforcer = new SchemaEnforcer();
    const result = enforcer.validate({
      source: { agentType: "test" as any },
      kind: undefined as any,
      summary: "test summary",
      semantic_gist: "test gist",
      content_blob: { data: 1 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("校验拒绝缺少 summary", () => {
    const enforcer = new SchemaEnforcer();
    const result = enforcer.validate({
      source: { agentType: "test" as any },
      kind: "test-kind" as any,
      summary: "",
      semantic_gist: "test gist",
      content_blob: { data: 1 },
    });
    expect(result.valid).toBe(false);
  });

  // ── 新增：格式一致性校验 ──────────────────────

  it("校验拒绝缺少 source.agentType", () => {
    const enforcer = new SchemaEnforcer();
    const result = enforcer.validate({
      source: { agentType: undefined as any },
      kind: "test-kind" as any,
      summary: "test",
      content_blob: { data: 1 },
    } as any);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("agentType"))).toBe(true);
  });

  it("校验拒绝缺少 content_blob", () => {
    const enforcer = new SchemaEnforcer();
    const result = enforcer.validate({
      source: { agentType: "test" as any },
      kind: "test-kind" as any,
      summary: "test",
      content_blob: undefined as any,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("content_blob"))).toBe(true);
  });

  // ── IntentFactWall 测试 ────────────────────────

  it("IntentFactWall — ensureSubType 默认 isFact=true", () => {
    const wall = new IntentFactWall();
    const result = wall.ensureSubType({
      source: { agentType: "test" as any },
      kind: "Insight" as any,
      summary: "test",
      content_blob: { data: 1 },
    });
    expect(result.isFact).toBe(true);
  });

  it("IntentFactWall — kind=Intent 时默认 isFact=false", () => {
    const wall = new IntentFactWall();
    const result = wall.ensureSubType({
      source: { agentType: "test" as any },
      kind: "Intent" as any,
      summary: "test intent",
      content_blob: { data: 1 },
    });
    expect(result.isFact).toBe(false);
  });

  it("IntentFactWall — 显式设置 isFact 时保留调用方值", () => {
    const wall = new IntentFactWall();
    const result = wall.ensureSubType({
      source: { agentType: "test" as any },
      kind: "Insight" as any,
      summary: "test",
      isFact: false,
      content_blob: { data: 1 },
    });
    expect(result.isFact).toBe(false);
  });

  it("IntentFactWall — filterRead CSA 模式过滤 isFact=false", () => {
    const wall = new IntentFactWall();
    const entries = [
      { id: "1", summary: "事实", isFact: true, semantic_state: "Active" as const, kind: "Insight" },
      { id: "2", summary: "意图", isFact: false, semantic_state: "Active" as const, kind: "Intent" },
    ] as any[];
    const filtered = wall.filterRead(entries, "CSA");
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("1");
  });

  it("IntentFactWall — filterRead HCA 模式不过滤", () => {
    const wall = new IntentFactWall();
    const entries = [
      { id: "1", summary: "事实", isFact: true, semantic_state: "Active" as const, kind: "Insight" },
      { id: "2", summary: "意图", isFact: false, semantic_state: "Active" as const, kind: "Intent" },
    ] as any[];
    const filtered = wall.filterRead(entries, "HCA");
    expect(filtered.length).toBe(2);
  });

  it("IntentFactWall — filterRead 过滤 Pending 和非 Active 记忆", () => {
    const wall = new IntentFactWall();
    const entries = [
      { id: "1", summary: "已激活", isFact: true, semantic_state: "Active" as const },
      { id: "2", summary: "待提交", isFact: true, _pending: true, semantic_state: "Active" as const },
      { id: "3", summary: "归档", isFact: true, semantic_state: "Archived" as const },
    ] as any[];
    const filtered = wall.filterRead(entries, "CSA");
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("1");
  });

  // ── ConflictDetector 测试 ──────────────────────

  it("ConflictDetector — 无冲突时返回 null", () => {
    const detector = createDefaultConflictDetector();
    const entries = [
      { id: "1", kind: "Insight", summary: "代码质量良好", weight: 0.8 },
      { id: "2", kind: "TaskLog", summary: "构建通过", weight: 0.7 },
    ] as any[];
    expect(detector.detect(entries)).toBeNull();
  });

  it("ConflictDetector — 检测矛盾冲突", () => {
    const detector = createDefaultConflictDetector();
    // 高相似度 + 否定 vs 肯定 → contradiction
    const entries = [
      { id: "1", kind: "CodeReview", summary: "这个模块代码正确没有问题", weight: 0.8 },
      { id: "2", kind: "CodeReview", summary: "这个模块代码错误有问题", weight: 0.7 },
    ] as any[];
    const report = detector.detect(entries);
    expect(report).not.toBeNull();
    if (report) {
      expect(report.type).toBe("contradiction");
      expect(report.conflictingIds).toContain("1");
    }
  });
});
import { describe, it, expect } from "vitest";
import { SchemaEnforcer } from "../src/schema-enforcer.js";

describe("@cortex/consistency smoke", () => {
  it("SchemaEnforcer 可实例化", () => {
    const enforcer = new SchemaEnforcer();
    expect(enforcer).toBeInstanceOf(SchemaEnforcer);
  });

  it("校验合法 MemoryWriteInput", () => {
    const enforcer = new SchemaEnforcer();
    const result = enforcer.validate({
      source: { agentType: "test" as any },
      kind: "test-kind" as any,
      summary: "test summary",
      semantic_gist: "test gist",
      content_blob: { data: 1 },
    });
    expect(result.valid).toBe(true);
  });

  it("校验拒绝缺少 kind", () => {
    const enforcer = new SchemaEnforcer();
    const result = enforcer.validate({
      source: { agentType: "test" as any },
      kind: undefined as any,
      summary: "test summary",
      semantic_gist: "test gist",
      content_blob: { data: 1 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("校验拒绝缺少 summary", () => {
    const enforcer = new SchemaEnforcer();
    const result = enforcer.validate({
      source: { agentType: "test" as any },
      kind: "test-kind" as any,
      summary: "",
      semantic_gist: "test gist",
      content_blob: { data: 1 },
    });
    expect(result.valid).toBe(false);
  });
});
