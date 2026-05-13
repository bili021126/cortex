// @ci: unit
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentPool } from "../src/agent-pool";
import { AgentType } from "@cortex/shared";
import { AgentStatus, PipelinePriority } from "@cortex/shared";
import { PipelineObserver } from "../src/pipeline-observer";

describe("AgentPool", () => {
  it("spawn 在配额内返回 true", () => {
    const pool = new AgentPool();
    pool.register({
      type: AgentType.Code,
      maxInstances: 2,
    });
    expect(pool.spawn(AgentType.Code, "inst-1")).toBe(true);
    expect(pool.count(AgentType.Code)).toBe(1);
  });

  it("超配额 spawn 返回 false", () => {
    const pool = new AgentPool();
    pool.register({
      type: AgentType.Code,
      maxInstances: 1,
    });
    pool.spawn(AgentType.Code, "inst-1");
    expect(pool.spawn(AgentType.Code, "inst-2")).toBe(false);
  });

  it("destroy 回收配额后可再 spawn", () => {
    const pool = new AgentPool();
    pool.register({
      type: AgentType.Code,
      maxInstances: 1,
    });
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
        maxInstances: 2,
      });
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
      expect(violations[0].payload.instanceId).toBe("inst-1");
      expect(violations[0].payload.current).toBe(AgentStatus.Created);
      expect(violations[0].payload.attempted).toBe(AgentStatus.Active);
    });

    it("无 observer 也无 onInvariant 时 console.error 兜底", () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      // vitest 环境下静默 console 回退，需临时解除以验证 fallback 行为
      const prevVitest = process.env.VITEST;
      delete process.env.VITEST;

      const ok = pool.setStatus("inst-1", AgentStatus.Active);
      expect(ok).toBe(false);

      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("[invariant] AgentPool.setStatus")
      );
      errSpy.mockRestore();
      process.env.VITEST = prevVitest;
    });

    it("onInvariant 静态回调优先于 observer", () => {
      pool.setObserver(observer);
      const onInvariantCalls: any[] = [];
      AgentPool.onInvariant = (v) => { onInvariantCalls.push(v); };

      const emitted: any[] = [];
      observer.on(PipelinePriority.CRITICAL, (event) => { emitted.push(event); });

      pool.setStatus("inst-1", AgentStatus.Active);

      // onInvariant 应被调用，observer 不应被调用（onInvariant 优先）
      expect(onInvariantCalls.length).toBe(1);
      expect(onInvariantCalls[0].source).toBe("AgentPool.setStatus");
      expect(emitted.length).toBe(0);
    });
  });
});
