// @ci: unit
/**
 * agent-registry-contract.test.ts —— Agent 注册表契约测试（重写自迭代遗留 agent-full-e2e）
 *
 * 原 e2e 需要真实 LLM（CI 跳过）——重写为纯单元：验证 AGENT_REGISTRY 的
 * 必备类型覆盖、autoRegister 标记与查找行为（不依赖 LLM/运行环境）。
 */
import { describe, it, expect } from "vitest";
import { AgentType } from "@cortex/shared";
import { AGENT_REGISTRY, findRegistration, getAutoRegisterable } from "../src/agents/registry.js";

/** 必备 Agent 类型（生产核心，不含特殊/实验型） */
const CORE_TYPES = [
  AgentType.Code,
  AgentType.Review,
  AgentType.Analysis,
  AgentType.Ops,
  AgentType.Loop,
  AgentType.DocGovern,
  AgentType.Api,
  AgentType.Data,
  AgentType.Fix,
  AgentType.Strategist,
];

describe("AGENT_REGISTRY 契约", () => {
  it("包含全部必备 Agent 类型（去重后）", () => {
    const registered = new Set(AGENT_REGISTRY.map((r) => r.type));
    for (const t of CORE_TYPES) {
      expect(registered.has(t), `缺必备类型 ${t}`).toBe(true);
    }
  });

  it("存在 autoRegister 条目（生产 Agent 可自动注册）", () => {
    const auto = AGENT_REGISTRY.filter((r) => r.autoRegister);
    expect(auto.length).toBeGreaterThan(0);
  });

  it("每个注册项有类型与描述（声明完整性）", () => {
    for (const r of AGENT_REGISTRY) {
      expect(r.type).toBeTruthy();
      expect(r.description?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("findRegistration 命中注册类型、未命中返回 undefined", () => {
    expect(findRegistration(AgentType.Code)).toBeDefined();
    expect(findRegistration("nonexistent" as AgentType)).toBeUndefined();
  });

  it("getAutoRegisterable 返回全部 autoRegister 条目", () => {
    const auto = getAutoRegisterable();
    expect(auto.length).toBe(AGENT_REGISTRY.filter((r) => r.autoRegister).length);
  });
});
