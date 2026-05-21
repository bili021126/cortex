// @ci: unit
import { describe, it, expect } from "vitest";
import { MemoryType, MemoryState, AgentType, MemorySubType } from "@cortex/shared";
import type { MemoryEntry, MemoryWriteInput } from "@cortex/shared";
import { IntentFactWall } from "@cortex/engine";

/** 创建测试用 MemoryEntry 辅助函数 */
function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: "mem-test-1",
    memoryType: MemoryType.Episodic,
    state: MemoryState.Active,
    content: { test: true },
    summary: "测试记忆",
    agentType: AgentType.Code,
    creatorId: "code-agent-1",
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    accessCount: 0,
    weight: 5,
    isPrivate: false,
    ...overrides,
  };
}

/** 创建测试用 MemoryWriteInput 辅助函数 */
function makeInput(overrides: Partial<MemoryWriteInput> = {}): MemoryWriteInput {
  return {
    memoryType: MemoryType.Episodic,
    content: { test: true },
    summary: "测试输入",
    agentType: AgentType.Code,
    creatorId: "code-agent-1",
    ...overrides,
  };
}

describe("IntentFactWall", () => {
  const wall = new IntentFactWall();

  // ════════════════════════════════════════════════════════
  // filterRead —— 读路径 Intent 过滤
  // ════════════════════════════════════════════════════════

  describe("filterRead", () => {
    it("HCA 模式下不过滤——MetaAgent 需要全局视图（含半成品 Intent）", () => {
      const entries = [
        makeEntry({ id: "mem-1", summary: "事实记忆", subType: MemorySubType.Fact }),
        makeEntry({ id: "mem-2", summary: "意图记忆", subType: MemorySubType.Intent }),
      ];

      const result = wall.filterRead(entries, "hca");
      expect(result).toHaveLength(2);
      expect(result.map((e: MemoryEntry) => e.id)).toEqual(["mem-1", "mem-2"]);
    });

    it("CSA 模式下过滤 Intent 半成品记忆——Agent 只看事实", () => {
      const entries = [
        makeEntry({ id: "mem-1", summary: "事实记忆", subType: MemorySubType.Fact }),
        makeEntry({ id: "mem-2", summary: "意图记忆", subType: MemorySubType.Intent }),
      ];

      const result = wall.filterRead(entries, "csa");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("mem-1");
      expect(result[0].summary).toBe("事实记忆");
    });

    it("CSA 模式下——所有 Intent 被排除，仅保留 Fact", () => {
      const entries = [
        makeEntry({ id: "mem-1", summary: "事实A", subType: MemorySubType.Fact }),
        makeEntry({ id: "mem-2", summary: "意图X", subType: MemorySubType.Intent }),
        makeEntry({ id: "mem-3", summary: "意图Y", subType: MemorySubType.Intent }),
        makeEntry({ id: "mem-4", summary: "事实B", subType: MemorySubType.Fact }),
      ];

      const result = wall.filterRead(entries, "csa");
      expect(result).toHaveLength(2);
      expect(result.map((e: MemoryEntry) => e.id)).toEqual(["mem-1", "mem-4"]);
    });

    it("CSA 模式下——subType 为 undefined 的记忆不被过滤（保守策略：不误杀无标签记忆）", () => {
      const entries = [
        makeEntry({ id: "mem-1", summary: "无标签记忆", subType: undefined }),
        makeEntry({ id: "mem-2", summary: "意图记忆", subType: MemorySubType.Intent }),
      ];

      const result = wall.filterRead(entries, "csa");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("mem-1");
    });

    it("空列表——返回空数组不抛异常", () => {
      const result = wall.filterRead([], "csa");
      expect(result).toHaveLength(0);
    });

    it("全 Intent 列表 CSA 模式——返回空数组", () => {
      const entries = [
        makeEntry({ id: "mem-1", summary: "意图1", subType: MemorySubType.Intent }),
        makeEntry({ id: "mem-2", summary: "意图2", subType: MemorySubType.Intent }),
      ];

      const result = wall.filterRead(entries, "csa");
      expect(result).toHaveLength(0);
    });

    it("原始数组不被修改（不可变语义）", () => {
      const entries = [
        makeEntry({ id: "mem-1", summary: "事实", subType: MemorySubType.Fact }),
        makeEntry({ id: "mem-2", summary: "意图", subType: MemorySubType.Intent }),
      ];

      const snapshot = [...entries];
      wall.filterRead(entries, "csa");
      expect(entries).toEqual(snapshot); // 原始数组不变
    });
  });

  // ════════════════════════════════════════════════════════
  // ensureSubType —— 写前 subType 默认值注入
  // ════════════════════════════════════════════════════════

  describe("ensureSubType", () => {
    it("未指定 subType → 默认标记为 Fact", () => {
      const input = makeInput({ subType: undefined });
      const result = wall.ensureSubType(input);
      expect(result.subType).toBe(MemorySubType.Fact);
    });

    it("已指定 subType 为 Intent → 保持不变", () => {
      const input = makeInput({ subType: MemorySubType.Intent });
      const result = wall.ensureSubType(input);
      expect(result.subType).toBe(MemorySubType.Intent);
    });

    it("已指定 subType 为 Fact → 保持不变", () => {
      const input = makeInput({ subType: MemorySubType.Fact });
      const result = wall.ensureSubType(input);
      expect(result.subType).toBe(MemorySubType.Fact);
    });

    it("不修改原始输入对象（不可变语义）", () => {
      const input = makeInput({ subType: undefined });
      const result = wall.ensureSubType(input);
      expect(input.subType).toBeUndefined(); // 原始不变
      expect(result).not.toBe(input); // 返回新对象
    });

    it("已有 subType 时直接返回原始引用", () => {
      const input = makeInput({ subType: MemorySubType.Fact });
      const result = wall.ensureSubType(input);
      expect(result).toBe(input); // 无需修改时返回原引用（性能优化）
    });
  });

  // ════════════════════════════════════════════════════════
  // stats —— 过滤统计
  // ════════════════════════════════════════════════════════

  describe("stats", () => {
    it("部分过滤——返回正确的过滤比例", () => {
      const entries = [
        makeEntry({ subType: MemorySubType.Fact }),
        makeEntry({ subType: MemorySubType.Intent }),
        makeEntry({ subType: MemorySubType.Fact }),
        makeEntry({ subType: MemorySubType.Intent }),
      ];
      const filtered = wall.filterRead(entries, "csa");

      const s = wall.stats(entries, filtered);
      expect(s.total).toBe(4);
      expect(s.filtered).toBe(2); // 2 个 Intent 被过滤
      expect(s.ratio).toBe(0.5);
    });

    it("无过滤——返回 ratio 为 0", () => {
      const entries = [
        makeEntry({ subType: MemorySubType.Fact }),
        makeEntry({ subType: MemorySubType.Fact }),
      ];
      const filtered = wall.filterRead(entries, "csa");

      const s = wall.stats(entries, filtered);
      expect(s.total).toBe(2);
      expect(s.filtered).toBe(0);
      expect(s.ratio).toBe(0);
    });

    it("全部过滤——返回 ratio 为 1", () => {
      const entries = [
        makeEntry({ subType: MemorySubType.Intent }),
        makeEntry({ subType: MemorySubType.Intent }),
      ];
      const filtered = wall.filterRead(entries, "csa");

      const s = wall.stats(entries, filtered);
      expect(s.total).toBe(2);
      expect(s.filtered).toBe(2);
      expect(s.ratio).toBe(1);
    });

    it("空列表——total 为 0，ratio 为 0（无除零错误）", () => {
      const s = wall.stats([], []);
      expect(s.total).toBe(0);
      expect(s.filtered).toBe(0);
      expect(s.ratio).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════
  // 集成场景：HCA vs CSA 对比
  // ════════════════════════════════════════════════════════

  describe("HCA vs CSA 场景对比", () => {
    it("同一个记忆列表在 HCA 和 CSA 下返回不同结果", () => {
      const entries = [
        makeEntry({ id: "f1", summary: "已执行的重构", subType: MemorySubType.Fact }),
        makeEntry({ id: "i1", summary: "计划重构 A 模块", subType: MemorySubType.Intent }),
        makeEntry({ id: "f2", summary: "CI 通过验证", subType: MemorySubType.Fact }),
        makeEntry({ id: "i2", summary: "考虑引入缓存层", subType: MemorySubType.Intent }),
      ];

      const hcaResult = wall.filterRead(entries, "hca");
      const csaResult = wall.filterRead(entries, "csa");

      // HCA: 全部可见
      expect(hcaResult).toHaveLength(4);
      expect(hcaResult.map((e: MemoryEntry) => e.id)).toEqual(["f1", "i1", "f2", "i2"]);

      // CSA: 仅事实可见
      expect(csaResult).toHaveLength(2);
      expect(csaResult.map((e: MemoryEntry) => e.id)).toEqual(["f1", "f2"]);
    });
  });
});
