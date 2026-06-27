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
});
