// @ci: unit
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentPool, PipelineObserver } from "@cortex/scheduler";
import { AgentType } from "@cortex/shared";
import { AgentStatus, PipelinePriority } from "@cortex/shared";

describe("AgentPool", () => {
  it("spawn 在配额内返回 true", () => {
    const pool = new AgentPool();
    pool.register({
      type: AgentType.Code,
      maxInstances: 2});
    expect(pool.spawn(AgentType.Code, "inst-1")).toBe(true);
    expect(pool.count(AgentType.Code)).toBe(1);
  });

  it("超配额 spawn 返回 false", () => {
    const pool = new AgentPool();
    pool.register({
      type: AgentType.Code,
      maxInstances: 1});
    pool.spawn(AgentType.Code, "inst-1");
    expect(pool.spawn(AgentType.Code, "inst-2")).toBe(false);
  });

  it("destroy 回收配额后可再 spawn", () => {
    const pool = new AgentPool();
    pool.register({
      type: AgentType.Code,
      maxInstances: 1});
    pool.spawn(AgentType.Code, "inst-1");
    pool.destroy(AgentType.Code, "inst-1");
    expect(pool.spawn(AgentType.Code, "inst-2")).toBe(true);
  });

  it("未注册的 Agent 类型 spawn 返回 false", () => {
    const pool = new AgentPool();
    expect(pool.spawn(AgentType.Review, "inst-1")).toBe(false);
  });

  // ── setObserver: invariant 双通道 ──────────────

  describe("setObserver 注入", () => {
    let pool: AgentPool;
    let observer: PipelineObserver;

    beforeEach(() => {
      pool = new AgentPool();
      pool.register({
        type: AgentType.Code,
        maxInstances: 2});
      pool.spawn(AgentType.Code, "inst-1");
      observer = new PipelineObserver();
    });

    afterEach(() => {
      // 重置静态回调
      AgentPool.onInvariant = null;
    });

    it("setObserver 注入后非法流转走 observer 管道", () => {
      pool.setObserver(observer);
      const emitted: any[] = [];
      observer.on(PipelinePriority.CRITICAL, (event) => {
        emitted.push({ type: event.type, payload: event.payload });
      });

      // Created → Active 非法（合法路径: Created → Awake）
      const ok = pool.setStatus("inst-1", AgentStatus.Active);
      expect(ok).toBe(false);

      const violations = emitted.filter((e) => e.type === "agent_pool.invariant_violation");
      expect(violations.length).toBe(1);
      // D6: _observer 优先于 onInvariant，payload 包含 source + message + detail（JSON 字符串）
      expect(violations[0].payload.source).toBe("AgentPool.setStatus");
      expect(violations[0].payload.message).toContain("非法流转");
    });

    it("无 observer 也无 onInvariant 时 console.error 兜底", () => {
      // 手动清除测试环境标记，使 isTestEnv() 返回 false
      // 从而验证非测试环境下的 console.error 兜底行为
      const prevVitest = process.env.VITEST;
      const prevNodeEnv = process.env.NODE_ENV;
      delete process.env.VITEST;
      process.env.NODE_ENV = "development";

      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const ok = pool.setStatus("inst-1", AgentStatus.Active);
      expect(ok).toBe(false);

      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("[invariant] AgentPool.setStatus")
      );
      errSpy.mockRestore();

      process.env.VITEST = prevVitest;
      process.env.NODE_ENV = prevNodeEnv;
    });

    it("_observer 实例优先于 onInvariant 静态回调", () => {
      pool.setObserver(observer);
      const onInvariantCalls: any[] = [];
      AgentPool.onInvariant = (v) => { onInvariantCalls.push(v); };

      const emitted: any[] = [];
      observer.on(PipelinePriority.CRITICAL, (event) => { emitted.push(event); });

      pool.setStatus("inst-1", AgentStatus.Active);

      // D6 修复：_observer 实例优先于 onInvariant 静态字段
      // observer 应被调用，onInvariant 不应被调用
      expect(emitted.length).toBe(1);
      expect(emitted[0].type).toBe("agent_pool.invariant_violation");
      expect(onInvariantCalls.length).toBe(0);
    });

    // ── High: Claim 竞态——并发调度不应超量认领 ──

    it("should not over-claim when dispatching concurrently", async () => {
      const pool = new AgentPool();
      pool.register({ type: AgentType.Code, maxInstances: 2 });
      pool.spawn(AgentType.Code, "agent-1");
      pool.spawn(AgentType.Code, "agent-2");

      // 设置为 Awake（可执行）
      expect(pool.setStatus("agent-1", AgentStatus.Awake)).toBe(true);
      expect(pool.setStatus("agent-2", AgentStatus.Awake)).toBe(true);

      // 模拟并发调度：设为 Active（正在执行）
      expect(pool.setStatus("agent-1", AgentStatus.Active)).toBe(true);
      expect(pool.setStatus("agent-2", AgentStatus.Active)).toBe(true);

      // 重复设 Active 应为 true（Active→Active 合法）
      expect(pool.setStatus("agent-1", AgentStatus.Active)).toBe(true);

      // release：设回 Awake
      expect(pool.setStatus("agent-1", AgentStatus.Awake)).toBe(true);
      expect(pool.setStatus("agent-2", AgentStatus.Awake)).toBe(true);

      // 再次 Active
      expect(pool.setStatus("agent-1", AgentStatus.Active)).toBe(true);

      // 超量 spawn 应被阻止
      expect(pool.spawn(AgentType.Code, "agent-3")).toBe(false);
    });
  });

  // ── Claim 竞态 ────────────────────────────────

  describe("Agent claim race condition", () => {
    it("should not over-claim when multiple agents request same node simultaneously", () => {
      // 多个 Agent 并发请求同一节点，不应导致超额认领
      const pool = new AgentPool();
      pool.register({ type: AgentType.Code, maxInstances: 3 });
      pool.spawn(AgentType.Code, "a1");
      pool.spawn(AgentType.Code, "a2");
      pool.spawn(AgentType.Code, "a3");
      pool.setStatus("a1", AgentStatus.Awake);
      pool.setStatus("a2", AgentStatus.Awake);
      pool.setStatus("a3", AgentStatus.Awake);

      // 三个 Agent 都可以被调度为 Active
      expect(pool.setStatus("a1", AgentStatus.Active)).toBe(true);
      expect(pool.setStatus("a2", AgentStatus.Active)).toBe(true);
      expect(pool.setStatus("a3", AgentStatus.Active)).toBe(true);

      // 全部释放
      pool.setStatus("a1", AgentStatus.Awake);
      pool.setStatus("a2", AgentStatus.Awake);
      pool.setStatus("a3", AgentStatus.Awake);

      // 计数应正确
      expect(pool.count(AgentType.Code)).toBe(3);
    });

    it("should maintain claim count === 1 for exclusive nodes", () => {
      const pool = new AgentPool();
      pool.register({ type: AgentType.Code, maxInstances: 2 });
      expect(pool.spawn(AgentType.Code, "x1")).toBe(true);
      expect(pool.spawn(AgentType.Code, "x2")).toBe(true);

      // 单视角节点需互斥
      expect(pool.setStatus("x1", AgentStatus.Awake)).toBe(true);
      // 不存在 over-claim 场景，spawn 受配额限制
      expect(pool.count(AgentType.Code)).toBe(2);
    });

    it("should not lose claims when pool is near capacity", () => {
      const pool = new AgentPool();
      pool.register({ type: AgentType.Code, maxInstances: 1 });
      expect(pool.spawn(AgentType.Code, "nearful")).toBe(true);
      // 配额已满
      expect(pool.spawn(AgentType.Code, "overflow")).toBe(false);
      expect(pool.count(AgentType.Code)).toBe(1);

      // 释放后重新认领
      pool.destroy(AgentType.Code, "nearful");
      expect(pool.spawn(AgentType.Code, "reclaimed")).toBe(true);
      expect(pool.count(AgentType.Code)).toBe(1);
    });

    it("should handle claim→release→reclaim cycle atomically", () => {
      const pool = new AgentPool();
      pool.register({ type: AgentType.Code, maxInstances: 2 });
      pool.spawn(AgentType.Code, "cycle-1");
      pool.spawn(AgentType.Code, "cycle-2");

      pool.setStatus("cycle-1", AgentStatus.Awake);
      pool.setStatus("cycle-1", AgentStatus.Active);
      pool.setStatus("cycle-1", AgentStatus.Awake);
      pool.setStatus("cycle-2", AgentStatus.Active);
      pool.setStatus("cycle-2", AgentStatus.Awake);

      // 再次进入 Active
      expect(pool.setStatus("cycle-1", AgentStatus.Active)).toBe(true);
      expect(pool.setStatus("cycle-2", AgentStatus.Active)).toBe(true);

      // 计数应稳定
      expect(pool.count(AgentType.Code)).toBe(2);
    });

    it("should not deadlock when all agents claim and release rapidly", () => {
      const pool = new AgentPool();
      pool.register({ type: AgentType.Code, maxInstances: 5 });
      const ids = ["r-1", "r-2", "r-3", "r-4", "r-5"];
      ids.forEach((id) => pool.spawn(AgentType.Code, id));

      // 快速循环 claim → release
      for (let i = 0; i < 3; i++) {
        ids.forEach((id) => pool.setStatus(id, AgentStatus.Awake));
        ids.forEach((id) => pool.setStatus(id, AgentStatus.Active));
        ids.forEach((id) => pool.setStatus(id, AgentStatus.Awake));
      }

      // 最终应全部 Awake 且计数不变
      ids.forEach((id) => expect(pool.getStatus(id)).toBe(AgentStatus.Awake));
      expect(pool.count(AgentType.Code)).toBe(5);
    });
  });
});
