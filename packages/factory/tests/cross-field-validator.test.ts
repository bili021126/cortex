// @ci: unit
// ============================================================
// @cortex/factory — 跨字段校验器功能测试
//
// 覆盖三合一联验的五个维度：
//   1. 生产端：produces 有但 routeTable 无 → error
//   2. 消费端：channel 非法 / 孤儿路由 → error+warning
//   3. 冲突检测：多 Agent 同事件无 mergeRule → warning
//   4. tag/toolPermissions 校验
//   5. roundtableTemplates 校验
// ============================================================

import { describe, it, expect } from "vitest";
import { validateCrossField } from "../src/schemas/cross-field.validator.js";
import type { CortexAgentsConfig, AgentDefinition } from "../src/types.js";
import { AgentType } from "@cortex/shared";
import { NotificationChannel } from "@cortex/notification";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 辅助：构造最小合法配置
function makeConfig(overrides?: Partial<CortexAgentsConfig>): CortexAgentsConfig {
  return {
    agents: {},
    eventRouting: { routeTable: {} },
    ...overrides,
  } as CortexAgentsConfig;
}

function makeAgent(id: string, produces: string[] = [], overrides?: Record<string, unknown>): AgentDefinition {
  return {
    id,
    type: AgentType.Code,
    role: `${id} — 测试角色`,
    systemPrompt: `你是 ${id}`,
    produces,
    model: "deepseek-chat",
    key: "DEEPSEEK_CHAT",
    ...overrides,
  } as AgentDefinition;
}

// ════════════════════════════════════════════════════════
// 维度一：生产端校验
// ════════════════════════════════════════════════════════

describe("跨字段校验 — 维度一：生产端 produces → routeTable", () => {
  it("produces 有对应 routeTable 条目 → 通过", () => {
    const config = makeConfig({
      agents: {
        albedo: makeAgent("albedo", ["code_changed"]),
      },
      eventRouting: {
        routeTable: {
          code_changed: { channel: NotificationChannel.Routine, ackRequired: false },
        },
      },
    });

    const r = validateCrossField(config);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("produces 声明了但 routeTable 无对应路由 → error", () => {
    const config = makeConfig({
      agents: {
        albedo: makeAgent("albedo", ["code_changed", "build_failed"]),
      },
      eventRouting: {
        routeTable: {
          code_changed: { channel: NotificationChannel.Routine, ackRequired: false },
        },
      },
    });

    const r = validateCrossField(config);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("build_failed"))).toBe(true);
  });

  it("Agent 无 produces → 不影响校验（不应该存在，但校验器应容忍）", () => {
    const config = makeConfig({
      agents: {
        cyrene: makeAgent("cyrene", []),
      },
      eventRouting: { routeTable: {} },
    });

    const r = validateCrossField(config);
    expect(r.valid).toBe(true);
  });
});

// ════════════════════════════════════════════════════════
// 维度二：消费端校验
// ════════════════════════════════════════════════════════

describe("跨字段校验 — 维度二：消费端 routeTable → channel 合法性", () => {
  it("channel 值合法 → 通过", () => {
    const config = makeConfig({
      agents: {
        albedo: makeAgent("albedo", ["code_changed"]),
      },
      eventRouting: {
        routeTable: {
          code_changed: { channel: NotificationChannel.Urgent, ackRequired: true },
        },
      },
    });

    const r = validateCrossField(config);
    expect(r.valid).toBe(true);
  });

  it("channel 值不合法 → error", () => {
    const config = makeConfig({
      agents: {
        albedo: makeAgent("albedo", ["code_changed"]),
      },
      eventRouting: {
        routeTable: {
          code_changed: { channel: "nuclear" as any, ackRequired: false },
        },
      },
    });

    const r = validateCrossField(config);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("nuclear"))).toBe(true);
  });

  it("routeTable 有路由但无 Agent produces → warning", () => {
    const config = makeConfig({
      agents: {
        albedo: makeAgent("albedo", ["code_changed"]),
      },
      eventRouting: {
        routeTable: {
          code_changed: { channel: NotificationChannel.Routine, ackRequired: false },
          orphan_event: { channel: NotificationChannel.Routine, ackRequired: false },
        },
      },
    });

    const r = validateCrossField(config);
    // 孤儿路由不影响 valid
    expect(r.warnings.some((w) => w.includes("orphan_event"))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════
// 维度三：冲突检测
// ════════════════════════════════════════════════════════

describe("跨字段校验 — 维度三：多 Agent 同事件冲突检测", () => {
  it("同一事件仅一个 Agent 生产 → 无警告", () => {
    const config = makeConfig({
      agents: {
        albedo: makeAgent("albedo", ["code_changed"]),
        keqing: makeAgent("keqing", ["review_completed"]),
      },
      eventRouting: {
        routeTable: {
          code_changed: { channel: NotificationChannel.Routine, ackRequired: false },
          review_completed: { channel: NotificationChannel.Important, ackRequired: false },
        },
      },
    });

    const r = validateCrossField(config);
    expect(r.warnings).toHaveLength(0);
  });

  it("同一事件被多个 Agent 声明 produces 但无 mergeRule → warning", () => {
    const config = makeConfig({
      agents: {
        albedo: makeAgent("albedo", ["code_changed"]),
        keqing: makeAgent("keqing", ["code_changed"]),
      },
      eventRouting: {
        routeTable: {
          code_changed: { channel: NotificationChannel.Routine, ackRequired: false },
        },
        mergeRules: [],
      },
    });

    const r = validateCrossField(config);
    expect(r.warnings.some((w) => w.includes("code_changed") && w.includes("mergeRule"))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════
// 维度四：tag / toolPermissions
// ════════════════════════════════════════════════════════

describe("跨字段校验 — 维度四：tag / toolPermissions 校验", () => {
  it("有效 tag → 通过", () => {
    const config = makeConfig({
      agents: {
        albedo: makeAgent("albedo", ["code_changed"], { tags: ["implementation"] }),
      },
      eventRouting: {
        routeTable: {
          code_changed: { channel: NotificationChannel.Routine, ackRequired: false },
        },
      },
    });

    const r = validateCrossField(config);
    expect(r.valid).toBe(true);
  });

  it("空字符串 tag → error", () => {
    const config = makeConfig({
      agents: {
        albedo: makeAgent("albedo", ["code_changed"], { tags: ["", "  "] }),
      },
      eventRouting: {
        routeTable: {
          code_changed: { channel: NotificationChannel.Routine, ackRequired: false },
        },
      },
    });

    const r = validateCrossField(config);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("无效标签"))).toBe(true);
  });

  it("未知 tool → warning", () => {
    const config = makeConfig({
      agents: {
        albedo: makeAgent("albedo", ["code_changed"], { toolPermissions: ["read_file", "nuclear_button"] }),
      },
      eventRouting: {
        routeTable: {
          code_changed: { channel: NotificationChannel.Routine, ackRequired: false },
        },
      },
    });

    const r = validateCrossField(config);
    expect(r.warnings.some((w) => w.includes("nuclear_button"))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════
// 维度五：roundtableTemplates
// ════════════════════════════════════════════════════════

describe("跨字段校验 — 维度五：roundtableTemplates 校验", () => {
  it("合法模板 → 通过", () => {
    const config = makeConfig({
      agents: {},
      eventRouting: { routeTable: {} },
      roundtableTemplates: [
        { name: "code-review", description: "代码审阅", personas: 4, rounds: 3, agents: ["刻晴"] },
      ],
    });

    const r = validateCrossField(config);
    expect(r.valid).toBe(true);
  });

  it("缺少 name → error", () => {
    const config = makeConfig({
      agents: {},
      eventRouting: { routeTable: {} },
      roundtableTemplates: [
        { description: "无名称", personas: 4, rounds: 3, agents: [] } as any,
      ],
    });

    const r = validateCrossField(config);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("缺少 name"))).toBe(true);
  });

  it("agents 不是数组 → error", () => {
    const config = makeConfig({
      agents: {},
      eventRouting: { routeTable: {} },
      roundtableTemplates: [
        { name: "malformed", description: "缺 agents", personas: 4, rounds: 3, agents: "not_an_array" } as any,
      ],
    });

    const r = validateCrossField(config);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("必须为数组"))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════
// 集成：真实 cortex-agents.json 闭环验证
// ════════════════════════════════════════════════════════

describe("跨字段校验 — 集成：真实配置闭环", () => {
  it("当前 cortex-agents.json 应通过所有校验", () => {
    const raw = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "cortex-agents.json"), "utf-8"));
    const r = validateCrossField(raw as CortexAgentsConfig);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });
});
