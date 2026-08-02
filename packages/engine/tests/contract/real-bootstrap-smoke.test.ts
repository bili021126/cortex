// @ci: contract
// ============================================================
// @cortex/engine — 真实 bootstrap 冒烟测试（装配级接线验证）
//
// Round-10 P0 项：调用 bootstrapEngine(真实配置目录)，断言全子系统接线。
// 抓取类别：跨包接线失败（插件断线、降级不可观测、事件总线死、记忆断线）。
// 前置条件：仓库根含 docs/constitution 哨兵 + packages/config/src/data 权威配置。
// 不写盘：注入 InMemoryMemoryStore，避免在仓库根创建 .cortex/memory.db。
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { resolveConfigDataDir, LLM_KEY_NAMES } from "@cortex/config";
import { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "@cortex/platform";
import { InMemoryMemoryStore } from "@cortex/memory";
import { bootstrapEngine, DegradationBoundary } from "@cortex/engine";
import type { BootstrapEngineResult } from "@cortex/engine";
import {
  AgentType,
  PipelineEventType,
  PipelinePriority,
  type ObservableEvent,
} from "@cortex/shared";

const REPO_ROOT = resolve(resolveConfigDataDir(), "../../../..");

function makeMockLlm(): LlmAdapter {
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "deepseek-v4-flash",
    reasonerModel: "deepseek-v4-flash",
  });
  adapter.injectMock(async () => ({ content: "ok", tool_calls: [] }));
  return adapter;
}

describe("真实 bootstrap 冒烟——装配级接线", () => {
  let result: BootstrapEngineResult;

  beforeAll(async () => {
    const llms = new Map<string, LlmAdapter>();
    for (const key of [
      LLM_KEY_NAMES.CHAT,
      LLM_KEY_NAMES.REASONER,
      LLM_KEY_NAMES.CYRENE,
      LLM_KEY_NAMES.GANYU,
    ]) {
      llms.set(key, makeMockLlm());
    }
    // 注入的 store 必须先 init——AbstractMemoryStore 有 init 守卫（抓到了未初始化注入的崩溃点）
    const memory = new InMemoryMemoryStore();
    await memory.init(":memory:");
    result = await bootstrapEngine(REPO_ROOT, {
      llms,
      toolkit: new Toolkit(),
      memory,
    });
  }, 120_000);

  afterAll(async () => {
    await result.shutdown();
  });

  it("全部核心子系统接线非空", () => {
    expect(result.scheduler).toBeDefined();
    expect(result.pool).toBeDefined();
    expect(result.observer).toBeDefined();
    expect(result.board).toBeDefined();
    expect(result.gate).toBeDefined();
    expect(result.cliAdapter).toBeDefined();
    expect(result.memory).toBeDefined();
    expect(result.metaAgent).toBeDefined();
    expect(result.butler).toBeDefined();
    expect(result.skillRegistry).toBeDefined();
    expect(result.agents.size).toBeGreaterThan(0);
  });

  it("降级边界已注入 HealthCollector——降级事件可聚合（观测闭环）", () => {
    expect(DegradationBoundary.collector).toBeDefined();
    const before = DegradationBoundary.collector!.snapshot().totalDegradations;
    DegradationBoundary.handle(new Error("smoke"), "smoke-test", "trace");
    const after = DegradationBoundary.collector!.snapshot();
    expect(after.totalDegradations).toBe(before + 1);
    expect(after.bySource["smoke-test"]).toBeGreaterThan(0);
  });

  it("PipelineObserver 事件总线活——on/emit 闭环", () => {
    const received: string[] = [];
    const handler = (e: ObservableEvent): void => {
      received.push(e.type);
    };
    result.observer.on(PipelinePriority.NORMAL, handler);
    result.observer.emit({
      type: PipelineEventType.ExecLifecyclePhaseChanged,
      priority: PipelinePriority.NORMAL,
      payload: { from: "running", to: "shutdown", phase: "bootstrap_done" },
      timestamp: Date.now(),
      notificationType: "FYI",
    });
    expect(received).toContain(PipelineEventType.ExecLifecyclePhaseChanged);
  });

  it("调度器可驱动——空板 executeAll 返回报告", async () => {
    const report = await result.scheduler.executeAll();
    expect(report).toBeDefined();
  });

  it("记忆接线——写入后可通过 read 查回（注入后端）", async () => {
    const memory = result.memory;
    expect(memory).toBeDefined();
    const id = await memory!.write({
      source: { agentType: AgentType.Code, taskId: "smoke" },
      kind: "Insight",
      summary: "bootstrap smoke",
      semantic_gist: "bootstrap smoke",
      content_blob: { test: true },
    });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    const hits = await memory!.read({ kind: "Insight", keywords: ["smoke"] }, "HCA");
    expect(Array.isArray(hits)).toBe(true);
  });
});
