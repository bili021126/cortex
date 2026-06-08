// @ci: unit
// ============================================================
// @cortex/skill-validator — validateSkillJson 测试
//
// 覆盖场景：
// - 有效技能 JSON → valid: true
// - 无效输入（null、数组、非对象）→ valid: false
// - 缺少必填字段 → valid: false
// - 无效 agentType → valid: false
// - 无效 status → valid: false
// - 负数 adoptionCount → valid: false
// - 空 steps → valid: true（含 warning）
// - 边缘场景：过短步骤、无效标签、可疑时间戳
// ============================================================

import { describe, it, expect } from "vitest";
import { validateSkillJson } from "@cortex/skill-validator";

// ─── 测试夹具 ─────────────────────────────────────────────

/** 有效的技能 JSON（从生产数据抽象） */
function createValidSkill(): Record<string, unknown> {
  return {
    id: "skill-p10-ci-gate-full-cycle-1778962384000",
    agentType: "ops",
    name: "P10: CI 门禁全流程",
    triggerTags: ["test", "deploy", "ops"],
    trigger: "需要执行 CI 门禁检查时",
    steps: [
      "执行 pnpm install 确认依赖已安装",
      "按依赖拓扑顺序执行 pnpm -r build",
      "逐包执行 pnpm -r typecheck",
    ],
    expectedOutput: "CI 门禁结果报告",
    outputFile: ".cortex/ci-output.txt",
    status: "trial",
    adoptionCount: 0,
    rejectionCount: 0,
    discoveredBy: "mona-pattern-scan",
    createdAt: 1778962384000,
  };
}

// ─── 测试用例 ─────────────────────────────────────────────

describe("validateSkillJson", () => {
  // ── 有效输入 ──

  it("接受有效的技能 JSON 并返回 valid: true", () => {
    const result = validateSkillJson(createValidSkill());

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // ── 无效顶层类型 ──

  it("拒绝 null 输入", () => {
    const result = validateSkillJson(null);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe("INVALID_ROOT_TYPE");
  });

  it("拒绝数组输入", () => {
    const result = validateSkillJson([]);

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("INVALID_ROOT_TYPE");
  });

  it("拒绝字符串输入", () => {
    const result = validateSkillJson("not-a-skill");

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("INVALID_ROOT_TYPE");
  });

  // ── 必填字段 ──

  it("拒绝缺少必填字段的输入", () => {
    const result = validateSkillJson({ id: "test" });

    expect(result.valid).toBe(false);
    const missingCodes = result.errors.map((e) => e.code);
    expect(missingCodes.filter((c) => c === "MISSING_REQUIRED_FIELD").length).toBeGreaterThan(0);
  });

  // ── 枚举值校验 ──

  it("拒绝无效的 agentType", () => {
    const skill = createValidSkill();
    skill.agentType = "nonsense-agent";

    const result = validateSkillJson(skill);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_AGENT_TYPE")).toBe(true);
  });

  it("拒绝无效的 status", () => {
    const skill = createValidSkill();
    skill.status = "obsolete";

    const result = validateSkillJson(skill);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_STATUS")).toBe(true);
  });

  // ── 数值范围 ──

  it("拒绝负数的 adoptionCount", () => {
    const skill = createValidSkill();
    skill.adoptionCount = -1;

    const result = validateSkillJson(skill);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_ADOPTION_COUNT")).toBe(true);
  });

  it("拒绝非整数的 rejectionCount", () => {
    const skill = createValidSkill();
    skill.rejectionCount = 1.5;

    const result = validateSkillJson(skill);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_REJECTION_COUNT")).toBe(true);
  });

  // ── Steps 警告 ──

  it("空 steps 数组产生 warning 但不影响 valid 标志", () => {
    const skill = createValidSkill();
    skill.steps = [];

    const result = validateSkillJson(skill);

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === "EMPTY_STEPS")).toBe(true);
  });

  it("过短的步骤描述产生 STEP_TOO_SHORT 警告", () => {
    const skill = createValidSkill();
    skill.steps = ["ab"];

    const result = validateSkillJson(skill);

    expect(result.warnings.some((w) => w.code === "STEP_TOO_SHORT")).toBe(true);
  });

  // ── TriggerTags 警告 ──

  it("空 triggerTags 产生 warning", () => {
    const skill = createValidSkill();
    skill.triggerTags = [];

    const result = validateSkillJson(skill);

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === "EMPTY_TRIGGER_TAGS")).toBe(true);
  });

  it("包含非字符串标签产生 INVALID_TAG_TYPE 警告", () => {
    const skill = createValidSkill();
    skill.triggerTags = [123, "valid-tag"];

    const result = validateSkillJson(skill);

    expect(result.warnings.some((w) => w.code === "INVALID_TAG_TYPE")).toBe(true);
  });

  it("包含空字符串标签产生 EMPTY_TAG 警告", () => {
    const skill = createValidSkill();
    skill.triggerTags = [""];

    const result = validateSkillJson(skill);

    expect(result.warnings.some((w) => w.code === "EMPTY_TAG")).toBe(true);
  });

  // ── 字段类型 ──

  it("字段类型错误应检测到", () => {
    const skill = createValidSkill();
    skill.triggerTags = "not-an-array";

    const result = validateSkillJson(skill);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_FIELD_TYPE")).toBe(true);
  });

  // ── AgentType 全量枚举 ──

  it("所有合法的 AgentType 值都应通过 agentType 校验", () => {
    const validTypes = [
      "meta", "code", "review", "analysis", "ops",
      "loop", "doc-govern", "butler", "inspector",
      "fix", "api", "browser", "data", "strategist",
    ];

    for (const agentType of validTypes) {
      const skill = createValidSkill();
      skill.agentType = agentType;
      const result = validateSkillJson(skill);
      expect(result.valid).toBe(true);
    }
  });

  // ── CreatedAt 边缘 ──

  it("可疑的时间戳产生 SUSPICIOUS_TIMESTAMP 警告", () => {
    const skill = createValidSkill();
    skill.createdAt = 1; // 1970-01-01 的毫秒时间戳，远早于 2000 年

    const result = validateSkillJson(skill);

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === "SUSPICIOUS_TIMESTAMP")).toBe(true);
  });

  // ── 可插拔组件架构验证 ──

  it("组件化架构：多个校验器同时发现问题时，errors 和 warnings 均被收集", () => {
    const skill = createValidSkill();
    skill.agentType = "INVALID";
    skill.status = "nonsense";
    skill.steps = [];

    const result = validateSkillJson(skill);

    // 错误应该包含 agentType 和 status 两项
    expect(result.errors.some((e) => e.code === "INVALID_AGENT_TYPE")).toBe(true);
    expect(result.errors.some((e) => e.code === "INVALID_STATUS")).toBe(true);
    // 警告应该包含空 steps
    expect(result.warnings.some((w) => w.code === "EMPTY_STEPS")).toBe(true);
    // valid 应为 false
    expect(result.valid).toBe(false);
  });

  it("组件化架构：单个校验器故障不影响其他校验器继续执行", () => {
    const result = validateSkillJson({});

    // 即使 root 类型无误，也应该收集所有必填字段缺失的错误
    const missingCount = result.errors.filter(
      (e) => e.code === "MISSING_REQUIRED_FIELD",
    ).length;
    expect(missingCount).toBeGreaterThan(1);
  });
});
