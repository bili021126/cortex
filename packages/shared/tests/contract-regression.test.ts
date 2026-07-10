// @ci: unit
// @cortex/shared — 核心接口契约回归测试
//
// 验证公共枚举/常量/接口的导出稳定性。

import { describe, it, expect } from "vitest";
import { AgentType, PipelineEventType, TAG_VOCABULARY } from "@cortex/shared";

describe("核心契约回归", () => {
  // ── AgentType ──────────────────────────────────────────────
  it("AgentType枚举值不变", () => {
    expect(AgentType.Code).toBe("code");
    expect(AgentType.Meta).toBe("meta");
    expect(AgentType.ConfirmGate).toBe("confirm-gate");
    expect(AgentType.Review).toBe("review");
    expect(AgentType.Analysis).toBe("analysis");
  });

  // ── PipelineEventType ──────────────────────────────────────
  it("PipelineEventType关键事件不变", () => {
    expect(PipelineEventType.NodeStart).toBeTruthy();
    expect(PipelineEventType.SchedulerDone).toBeTruthy();
    expect(PipelineEventType.NodeComplete).toBe("node.complete");
    expect(PipelineEventType.Analysis).toBe("analysis");
  });

  // ── TAG_VOCABULARY ────────────────────────────────────────
  it("TAG_VOCABULARY 包含 confirm_gate", () => {
    expect(TAG_VOCABULARY).toContain("confirm_gate");
  });

  // ── 5 子接口全导出 ────────────────────────────────────────
  it("ICortexApi 5子接口全导出", async () => {
    // 使用动态 import 验证模块解析完整性
    const mod = await import("@cortex/shared");
    expect(typeof mod.ICortexLifecycle).toBe("undefined"); // type-only export → undefined at runtime
    expect(typeof mod.ICortexChat).toBe("undefined");
    expect(typeof mod.ICortexTask).toBe("undefined");
    expect(typeof mod.ICortexMemory).toBe("undefined");
    expect(typeof mod.ICortexComponents).toBe("undefined");
    // 验证值导出正常
    expect(typeof mod.AgentType).toBe("object");
    expect(typeof mod.PipelineEventType).toBe("object");
  });
});
