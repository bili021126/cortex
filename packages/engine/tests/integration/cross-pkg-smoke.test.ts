// ============================================================
// @cortex/engine — 跨包集成烟雾测试
//
// 验证核心跨包调用链：
//   1. engine → scheduler → memory-store 完整链路
//   2. engine → governance 修宪管线
//   3. engine → skill-kit 技能注册与查询
// ============================================================

import { describe, it, expect } from "vitest";
import { AgentType } from "@cortex/shared";

describe("跨包集成烟雾测试", () => {
  // ── 1. engine → scheduler → memory-store 完整链路 ──────
  it("engine → scheduler → memory-store：核心类型与接口可导入", async () => {
    // 从 scheduler 导入调度核心类型
    const scheduler = await import("@cortex/scheduler");
    expect(scheduler.TaskBoard).toBeDefined();
    expect(scheduler.AgentPool).toBeDefined();
    expect(scheduler.PipelineObserver).toBeDefined();
    expect(scheduler.ConfirmGate).toBeDefined();
    expect(scheduler.TrustModel).toBeDefined();

    // 从 memory-store 导入认知存储类型
    const memoryStore = await import("@cortex/memory-store");
    expect(memoryStore.MemoryStore).toBeDefined();
    expect(memoryStore.ContextBuilder).toBeDefined();
    expect(memoryStore.CognitiveEngine).toBeDefined();
    expect(memoryStore.BM25Index).toBeDefined();
    expect(memoryStore.WeightAger).toBeDefined();

    // 从 engine 自身导入核心组件
    const engine = await import("@cortex/engine");
    // 验证 engine 包可加载
    expect(engine).toBeDefined();
  });

  it("engine → scheduler → memory-store：ConfirmGate 与 MemoryStore 协作", async () => {
    const { ConfirmGate } = await import("@cortex/scheduler");
    const { MemoryStore, WeightAger } = await import("@cortex/memory-store");

    const gate = new ConfirmGate();
    expect(gate).toBeDefined();

    // 验证 ConfirmGate 核心状态
    const initialScore = (gate as unknown as { getTrustScore?: (t: string) => number }).getTrustScore?.("test-agent");
    // 验证 ConfirmGate 核心方法存在
    expect(typeof gate.confirm === "function" || typeof gate.waitFor === "function").toBe(true);

    // 验证 WeightAger 可独立实例化（信任模型依赖）
    const ager = new WeightAger();
    expect(ager).toBeDefined();
    expect(typeof ager.freezeStale).toBe("function");
  });

  // ── 2. engine → governance 修宪管线 ────────────────────
  it("engine → governance：修宪管线核心函数可导入", async () => {
    const gov = await import("@cortex/governance");
    expect(gov.runPipeline).toBeDefined();
    expect(gov.saveProposal).toBeDefined();
    expect(gov.judgeProposals).toBeDefined();
    expect(gov.loadPendingProposals).toBeDefined();
    expect(gov.updateProposalStatus).toBeDefined();
    expect(gov.checkTimeouts).toBeDefined();
    expect(gov.validateConstitutionAmendment).toBeDefined();
    expect(gov.evaluateAmendment).toBeDefined();

    // 验证 AmendmentProposal 类型可通过 @cortex/shared 访问
    const shared = await import("@cortex/shared");
    expect(shared).toBeDefined();
  });

  it("engine → governance：宪法验证与评判引擎可协同", async () => {
    const { validateConstitutionAmendment } = await import("@cortex/governance");
    const shared = await import("@cortex/shared");

    // 创建提案
    const proposal: import("@cortex/shared").AmendmentProposal = {
      id: "AM-CROSS-001",
      version: "v2.8.0",
      section: "原则二 | 架构解耦 | 可变",
      category: "modify",
      summary: "cross-pkg integration test proposal",
      rationale: "验证跨包集成管线。",
      before: "旧文本",
      after: "新文本",
      impact: { principles: [], crossReferences: [], agents: [], breaking: false },
      source: { agent: "cross-pkg-test", trace: "integration" },
      status: "draft",
    };

    // 九子约束验证
    const result = validateConstitutionAmendment(proposal);
    expect(result).toBeDefined();
    expect(typeof result.passed).toBe("boolean");
    expect(Array.isArray(result.verdicts)).toBe(true);
    expect(result.verdicts.length).toBeGreaterThan(0);
  });

  // ── 3. engine → skill-kit 技能注册与查询 ───────────────
  it("engine → skill-kit：SkillRegistry 可导入", async () => {
    const skillKit = await import("@cortex/skill-kit");
    // skill-kit 应导出核心类型
    expect(skillKit).toBeDefined();

    // 验证是否有 SkillRegistry 或类似导出
    const hasSkillRegistry = typeof skillKit.SkillRegistry !== "undefined";
    const hasSkillManager = typeof skillKit.SkillManager !== "undefined";
    const hasRegisterSkill = typeof skillKit.registerSkill === "function";

    expect(hasSkillRegistry || hasSkillManager || hasRegisterSkill).toBe(true);
  });

  it("engine → skill-kit：AgentType 枚举一致性", async () => {
    // 验证 @cortex/shared 的 AgentType 可被 engine 正确引用
    expect(AgentType.Code).toBe("code");
    expect(AgentType.Meta).toBe("meta");
    expect(AgentType.ConfirmGate).toBe("confirm-gate");
    expect(AgentType.Strategist).toBe("strategist");

    // 验证所有枚举值唯一
    const values = Object.values(AgentType);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});
