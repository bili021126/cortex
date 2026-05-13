// @ci: unit
/**
 * 测试文件: AgentPool 状态所有权测试 (方案B)
 *
 * 测试范围:
 * - AgentPool.getStatus() 单实例查询
 * - BaseAgent.status getter 委托到 AgentPool
 * - BaseAgent._setStatus() 走 Pool 写路径
 * - ButlerAgent.status getter 同样委托模式
 * - 无 Pool 时降级为 _localStatus（测试环境兼容）
 * - AgentPool.setStatus() 非法流转拒绝
 *
 * 治理判例: 方案B——AgentPool 为状态唯一权威源
 *
 * 测试数据用例:
 *   用例1: AgentPool.getStatus() 查询已注册实例状态
 *   用例2: BaseAgent.setPool() 后 status getter 委托到 Pool
 *   用例3: BaseAgent.wakeup() 通过 Pool 变更为 Awake
 *   用例4: BaseAgent.shutdown() 通过 Pool 变更为 Draining→Destroyed
 *   用例5: BaseAgent 无 Pool 时降级为 _localStatus
 *   用例6: AgentPool.setStatus() 非法流转拒绝
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AgentPool } from "../src/agent-pool";
import { PipelineObserver } from "../src/pipeline-observer";
import { BaseAgent } from "../src/base-agent";
import { ButlerAgent } from "../src/agents/butler-agent";
import type { TaskNode, NodeResult, AgentType as AT } from "@cortex/shared";
import { AgentType, AgentStatus as AS } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "../src/toolkit";

// 测试用具体 Agent 子类
class TestAgent extends BaseAgent {
  readonly type = AgentType.Code;
  readonly systemPrompt = "test";
}

describe("AgentPool 状态所有权 (方案B)", () => {
  let pool: AgentPool;

  beforeEach(() => {
    pool = new AgentPool();
    pool.register({ type: AgentType.Code, maxInstances: 5 });
  });

  // ─── 用例1: getStatus() 查询 ─────────────────────────

  it("用例1: AgentPool.getStatus() 查询已注册实例状态", () => {
    pool.spawn(AgentType.Code, "inst-1");
    expect(pool.getStatus("inst-1")).toBe(AS.Created);

    pool.setStatus("inst-1", AS.Awake);
    expect(pool.getStatus("inst-1")).toBe(AS.Awake);

    // 不存在的实例
    expect(pool.getStatus("inst-nonexistent")).toBeUndefined();
  });

  // ─── 用例2: status getter 委托 Pool ────────────────

  it("用例2: BaseAgent.setPool() 后 status getter 委托到 Pool", () => {
    const agent = new TestAgent(
      {} as LlmAdapter,
      {} as Toolkit,
    );

    // 无 Pool 时：使用 _localStatus
    expect(agent.status).toBe(AS.Created);

    // 注入 Pool
    pool.spawn(AgentType.Code, "test-inst");
    agent.setPool(pool, "test-inst");

    // Pool 中初始为 Created
    expect(agent.status).toBe(AS.Created);

    // Pool 侧变更
    pool.setStatus("test-inst", AS.Awake);
    expect(agent.status).toBe(AS.Awake);
  });

  // ─── 用例3: wakeup() 走 Pool ──────────────────────

  it("用例3: BaseAgent.wakeup() 通过 Pool.setStatus() 变更为 Awake", () => {
    const agent = new TestAgent(
      {} as LlmAdapter,
      {} as Toolkit,
    );

    pool.spawn(AgentType.Code, "wakeup-test");
    agent.setPool(pool, "wakeup-test");

    // Act: wakeup
    agent.wakeup();

    // Assert: Pool 中为 Awake
    expect(pool.getStatus("wakeup-test")).toBe(AS.Awake);
    expect(agent.status).toBe(AS.Awake);
  });

  // ─── 用例4: shutdown() 走 Pool ────────────────────

  it("用例4: BaseAgent.shutdown() 通过 Pool 变更 Draining→Destroyed", async () => {
    const agent = new TestAgent(
      {} as LlmAdapter,
      {} as Toolkit,
    );

    pool.spawn(AgentType.Code, "shutdown-test");
    agent.setPool(pool, "shutdown-test");
    agent.wakeup();

    // Act: shutdown
    await agent.shutdown();

    // Assert: Pool 中为 Destroyed
    expect(pool.getStatus("shutdown-test")).toBe(AS.Destroyed);
    expect(agent.status).toBe(AS.Destroyed);
  });

  // ─── 用例5: 无 Pool 降级 _localStatus ────────────

  it("用例5: BaseAgent 无 Pool 时降级为 _localStatus（测试环境兼容）", () => {
    const agent = new TestAgent(
      {} as LlmAdapter,
      {} as Toolkit,
    );

    // 无 Pool
    expect(agent.status).toBe(AS.Created);

    agent.wakeup();
    expect(agent.status).toBe(AS.Awake);

    // 无 Pool 时仍可正常读写 _localStatus（已迁移至 PoolAwareState）
    expect((agent as any)._state._localStatus).toBe(AS.Awake);
  });

  // ─── 用例6: 非法流转拒绝 ─────────────────────────

  it("用例6: AgentPool.setStatus() 非法流转拒绝 + onInvariant 触发", () => {
    const violations: any[] = [];
    AgentPool.onInvariant = (v) => violations.push(v);

    pool.spawn(AgentType.Code, "illegal-trans");
    // Created → Active 非法（必须经过 Awake）
    pool.setStatus("illegal-trans", AS.Active);

    // 状态未变
    expect(pool.getStatus("illegal-trans")).toBe(AS.Created);

    // invariant 被调用
    expect(violations.length).toBe(1);
    expect(violations[0].source).toBe("AgentPool.setStatus");
    expect(violations[0].message).toContain("非法流转");

    AgentPool.onInvariant = null;
  });

  // ─── 用例7: ButlerAgent 兼容 ─────────────────────

  it("用例7: ButlerAgent.setPool() 后 status getter 委托到 Pool", () => {
    // 注册 ButlerAgent 类型
    pool.register({ type: AgentType.Butler, maxInstances: 1 });

    const observer = new PipelineObserver();
    const butler = new ButlerAgent(observer);

    pool.spawn(AgentType.Butler, "butler-test");
    butler.setPool(pool, "butler-test");

    // 初始为 Created
    expect(butler.status).toBe(AS.Created);

    // Pool 侧变更
    pool.setStatus("butler-test", AS.Awake);
    expect(butler.status).toBe(AS.Awake);
  });
});
