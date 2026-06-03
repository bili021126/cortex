// @ci: unit
// ============================================================
// @cortex/skill-kit — PipelineExecutor 单元测试
// ============================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  type SkillDefinition,
  type SkillContext,
  SkillCategory,
  SkillErrorCode,
} from "../src/types.js";
import { PipelineExecutor } from "../src/executor.js";

// ── 辅助函数 ──────────────────────────────────────────────────

function makeSkill(id: string, overrides?: Partial<SkillDefinition>): SkillDefinition {
  return {
    meta: {
      id,
      name: `技能 ${id}`,
      version: "1.0.0",
      description: "测试技能",
      category: SkillCategory.TOOL,
      triggerTags: ["test"],
      trigger: "测试触发",
      steps: ["步骤1"],
      expectedOutput: "测试输出",
    },
    async execute(ctx) {
      return { success: true, data: { id, input: ctx.input } };
    },
    ...overrides,
  };
}

// ── 测试 ──────────────────────────────────────────────────────

describe("PipelineExecutor", () => {
  let executor: PipelineExecutor;

  beforeEach(() => {
    executor = new PipelineExecutor({ defaultTimeout: 5_000 });
  });

  it("成功执行技能并返回结果", async () => {
    const skill = makeSkill("success-skill");
    const result = await executor.execute(skill, { foo: "bar" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        id: "success-skill",
        input: { foo: "bar" },
      });
      expect(result.meta).toBeDefined();
      expect(result.meta!.duration).toBeGreaterThanOrEqual(0);
      expect(result.meta!.version).toBe("1.0.0");
      expect(result.meta!.timestamp).toBeGreaterThan(0);
    }
  });

  it("validateInput 失败时返回 VALIDATION_FAILED", async () => {
    const skill = makeSkill("validate-fail", {
      validateInput(input: unknown): input is never {
        return false;
      },
    });

    const result = await executor.execute(skill, { invalid: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(SkillErrorCode.VALIDATION_FAILED);
    }
  });

  it("onInit 在首次执行时被调用", async () => {
    let initCalled = false;

    const skill = makeSkill("init-skill", {
      async onInit() {
        initCalled = true;
      },
    });

    await executor.execute(skill, {});
    expect(initCalled).toBe(true);
  });

  it("onInit 失败时返回 INIT_FAILED", async () => {
    const skill = makeSkill("init-fail", {
      async onInit() {
        throw new Error("初始化失败");
      },
    });

    const result = await executor.execute(skill, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(SkillErrorCode.INIT_FAILED);
    }
  });

  it("超时后返回 TIMEOUT 错误", async () => {
    const fastTimeout = new PipelineExecutor({ defaultTimeout: 10 });

    const skill = makeSkill("timeout-skill", {
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return { success: true, data: "too-late" };
      },
    });

    const result = await fastTimeout.execute(skill, {});
    expect(result.success).toBe(false);
  });

  it("execute 抛出异常时返回 EXECUTION_FAILED", async () => {
    const skill = makeSkill("throw-skill", {
      async execute() {
        throw new Error("执行异常");
      },
    });

    const result = await executor.execute(skill, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(SkillErrorCode.EXECUTION_FAILED);
      expect(result.error.message).toContain("执行异常");
    }
  });

  it("传递执行选项（env, traceId）到上下文", async () => {
    let capturedCtx: SkillContext | undefined;

    const skill = makeSkill("ctx-skill", {
      async execute(ctx) {
        capturedCtx = ctx;
        return { success: true, data: "ok" };
      },
    });

    await executor.execute(skill, { x: 1 }, {
      env: { db: "test" },
      traceId: "custom-trace",
    });

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.env).toEqual({ db: "test" });
    expect(capturedCtx!.traceId).toBe("custom-trace");
    expect(capturedCtx!.input).toEqual({ x: 1 });
    expect(capturedCtx!.store).toBeInstanceOf(Map);
    expect(capturedCtx!.signal).toBeInstanceOf(AbortSignal);
  });

  it("onInit 仅首次执行时调用（默认配置）", async () => {
    let initCount = 0;

    const skill = makeSkill("once-init", {
      async onInit() {
        initCount++;
      },
    });

    await executor.execute(skill, {});
    await executor.execute(skill, {});
    await executor.execute(skill, {});

    expect(initCount).toBe(1);
  });

  it("resetInitialization 后 onInit 再次执行", async () => {
    let initCount = 0;

    const skill = makeSkill("reset-init", {
      async onInit() {
        initCount++;
      },
    });

    await executor.execute(skill, {});
    executor.resetInitialization();
    await executor.execute(skill, {});

    expect(initCount).toBe(2);
  });
});
