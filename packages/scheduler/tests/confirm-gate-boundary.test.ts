// @ci: unit
// @cortex/scheduler — ConfirmGate 边界测试
//
// 验证信任分驱动自动放行的边界条件。

import { describe, it, expect } from "vitest";
import { ConfirmGate } from "@cortex/scheduler";
import { ReversibilityLevel } from "@cortex/config";


describe("ConfirmGate边界", () => {
  it("信任分0时L2需确认", () => {
    const gate = new ConfirmGate();
    // 无信任记录 → 信任分 50，但 L2 需要 ≥70 才自动放行
    const result = gate.check(ReversibilityLevel.L2);
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("manual confirm");
    expect(result.score).toBe(50);
  });

  it("信任分积累后L0始终自动放行", () => {
    const gate = new ConfirmGate();
    // L0 始终自动放行（纯读取，永不确认）
    const result = gate.check(ReversibilityLevel.L0);
    expect(result.approved).toBe(true);
    expect(result.reason).toBe("trust auto");
  });

  it("多轮成功后可提升信任分", () => {
    const gate = new ConfirmGate();
    const ctx = { agentType: "code" as any, toolName: "read_file" };

    // 连续 20 次 L0 自动放行 → 积累信任记录
    for (let i = 0; i < 20; i++) {
      gate.check(ReversibilityLevel.L0, ctx);
    }

    // L0 仍自动放行，且分数应 > 50
    const result = gate.check(ReversibilityLevel.L0, ctx);
    expect(result.approved).toBe(true);
    expect(result.score).toBeGreaterThan(50);
  });

  it("L3始终需确认（信任分上限60 < 阈值85）", () => {
    const gate = new ConfirmGate();
    const ctx = { agentType: "code" as any, toolName: "read_file" };

    // 即使攒满 20 条成功记录，max score = 50 + 20*0.5 = 60
    for (let i = 0; i < 20; i++) {
      gate.check(ReversibilityLevel.L0, ctx);
    }

    // L3 需 score ≥ 85，60 < 85 → 需确认
    const result = gate.check(ReversibilityLevel.L3, ctx);
    // L3 永远需要确认
    expect(result.approved).toBe(false);
  });
});
