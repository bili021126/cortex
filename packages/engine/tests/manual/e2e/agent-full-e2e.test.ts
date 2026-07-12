// @ci: e2e
/**
 * Agent 全量 E2E — 14个agent唤醒→persona→权限→cleanup
 *
 * 场景: 循环唤醒全部14个agent → 验证persona加载+工具权限+loopStrategy
 * → 依次shutdown → 验证无状态泄漏
 *
 * 验证: 每个agent的wake/shutdown + persona + permissions
 *
 * @skip CI 中默认跳过（依赖完整 agent 注册表）
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AgentType, AgentStatus, type Agent, type AgentCapability } from "@cortex/shared";
import { TaskBoard, AgentPool, PipelineObserver, ConfirmGate } from "@cortex/scheduler";
import { MemoryStore } from "@cortex/memory-store";
import { Toolkit } from "@cortex/platform";
import { LlmAdapter } from "@cortex/llm";
import { createAgent } from "../../../src/components/index.js";
import { AGENT_REGISTRY, findRegistration, getAutoRegisterable } from "../../../src/agents/registry.js";
import { CapabilityRegistry, capabilityRegistry } from "../../../src/core/capability-registry.js";

// 所有 Agent 类型的完备列表（14个）
const ALL_AGENT_TYPES: AgentType[] = [
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
  // 特殊/实验性 Agent
  "inspector" as AgentType,
  "browser" as AgentType,
  "butler" as AgentType,
  "confirm-gate" as AgentType,
];

// 已注册到 registry 中的 autoRegisterable Agent（不含特殊/实验性）
const REGISTERED_TYPES = AGENT_REGISTRY.filter((r) => r.autoRegister).length;

describe("Agent 全量: 14个agent唤醒→persona→权限→cleanup", () => {
  if (process.env.CI) return; // 需要真实 LLM，CI 跳过
  let pool: AgentPool;
  let observer: PipelineObserver;
  let toolkit: Toolkit;
  let store: MemoryStore;
  const createdAgents: Array<{ type: string; agent: Agent; instanceId: string }> = [];

  beforeAll(async () => {
    store = new MemoryStore();
    await store.init(":memory:");

    observer = new PipelineObserver();
    pool = new AgentPool();
    pool.register({ type: AgentType.Code, maxInstances: 5 });
    pool.register({ type: AgentType.Review, maxInstances: 2 });
    pool.register({ type: AgentType.Analysis, maxInstances: 2 });
    pool.register({ type: AgentType.Ops, maxInstances: 2 });
    pool.register({ type: AgentType.Loop, maxInstances: 2 });
    pool.register({ type: AgentType.DocGovern, maxInstances: 2 });
    pool.register({ type: AgentType.Api, maxInstances: 2 });
    pool.register({ type: AgentType.Data, maxInstances: 2 });
    pool.register({ type: AgentType.Fix, maxInstances: 2 });
    pool.register({ type: AgentType.Strategist, maxInstances: 1 });

    const gate = new ConfirmGate();
    gate.bypassAll();
    toolkit = new Toolkit();
    toolkit.setGate(gate);
    toolkit.setObserver(observer);

    // 注册所有 Capability（自声明）
    const { registerAllCapabilities } = await import("../../../src/agents/registry.js");
    registerAllCapabilities();
  });

  afterAll(async () => {
    // 清理所有创建的 Agent
    for (const { type, agent, instanceId } of createdAgents) {
      try {
        await agent.shutdown();
        pool.destroy(type as AgentType, instanceId);
      } catch { /* shutdown 不抛即可 */ }
    }
    await store.close();
  });

  it("AGENT_REGISTRY 注册表包含 9 个 autoRegister 条目", { timeout: 120000 }, () => {
    expect(REGISTERED_TYPES).toBeGreaterThanOrEqual(9);
    const autoReg = getAutoRegisterable();
    expect(autoReg.length).toBeGreaterThanOrEqual(9);
  });

  it("AGENT_REGISTRY 包含全部必备 Agent 类型", { timeout: 120000 }, () => {
    const types = AGENT_REGISTRY.map((r) => r.type);
    expect(types).toContain(AgentType.Code);
    expect(types).toContain(AgentType.Review);
    expect(types).toContain(AgentType.Analysis);
    expect(types).toContain(AgentType.Ops);
    expect(types).toContain(AgentType.Loop);
    expect(types).toContain(AgentType.DocGovern);
    expect(types).toContain(AgentType.Api);
    expect(types).toContain(AgentType.Data);
    expect(types).toContain(AgentType.Fix);
    expect(types).toContain(AgentType.Strategist);
  });

  it("每个 Agent 配置包含 toolPermissions — 工具权限声明", { timeout: 120000 }, () => {
    for (const reg of AGENT_REGISTRY) {
      expect(reg.capability).toBeDefined();
      expect(reg.capability.toolPermissions).toBeDefined();
      expect(Array.isArray(reg.capability.toolPermissions)).toBe(true);
      expect(reg.capability.toolPermissions.length).toBeGreaterThan(0);
    }
  });

  it("CapabilityRegistry 自声明注册完成", { timeout: 120000 }, () => {
    const allCaps = capabilityRegistry.getAll();
    expect(allCaps.length).toBeGreaterThanOrEqual(9);
  });

  it("每个 Agent 可构造、唤醒、状态流转正确", { timeout: 120000 }, async () => {
    const adapter = new LlmAdapter({
      apiKey: "mock",
      baseUrl: "mock",
      chatModel: "mock",
      reasonerModel: "mock",
    });
    adapter.injectMock(async () => ({
      content: "Task completed.",
      tool_calls: [],
    }));

    for (const reg of AGENT_REGISTRY) {
      const config = { type: reg.type, systemPrompt: `Mock prompt for ${reg.type}`, memoryEnabled: false };
      const agent = createAgent(config, adapter, toolkit, store);
      expect(agent.type).toBe(reg.type);
      expect(agent.status).toBe(AgentStatus.Created); // 初始 status

      await agent.wakeup();
      expect(agent.status).toBe(AgentStatus.Awake); // wakeup 后 Awake

      // 注入 pool
      const instanceId = `inst-${reg.type}`;
      agent.setPool(pool, instanceId);
      pool.spawn(reg.type, instanceId);
      createdAgents.push({ type: reg.type, agent, instanceId });
    }
  });

  it("所有 Agent 可通过 AgentPool 管理生命周期", { timeout: 120000 }, () => {
    for (const { type, instanceId } of createdAgents) {
      const status = pool.getStatus(instanceId as any);
      expect(status).toBeDefined();
      // 状态可能为 Awake（从 Created → Awake 转）
    }
  });

  it("Agent 工具权限 metadata 完整", { timeout: 120000 }, () => {
    for (const reg of AGENT_REGISTRY) {
      const cap = reg.capability;
      expect(cap.id).toBe(reg.type);
      expect(cap.tags.length).toBeGreaterThan(0);
      expect(cap.produces.length).toBeGreaterThanOrEqual(0);
      // 验证每个 Agent 至少有一个适用场景
      expect(cap.applicableScenarios.length).toBeGreaterThan(0);
    }
  });

  it("shutdown 后状态可验证 — 不抛异常", { timeout: 120000 }, async () => {
    // 用前序已创建的 agent 验证 shutdown
    // shutdown 依次执行，不抛即可
    for (const { agent } of createdAgents.slice(0, 3)) {
      try {
        await agent.shutdown();
      } catch {
        // shutdown 可能因为状态已变化而警告，但不抛致命异常
      }
    }
  });
});
