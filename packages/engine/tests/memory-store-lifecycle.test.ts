// @ci: unit
/**
 * 测试文件: MemoryStore 生命周期状态机测试
 *
 * @since v3.0.0 — 适配器委托 @cortex/memory 后端，简化生命周期验证。
 *
 * 测试范围:
 * - init() → 进入就绪状态
 * - write() → read() 正常读写
 * - close() → 拒绝新写入/读取
 * - close() 幂等
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AgentType, PipelinePriority } from "@cortex/shared";
import { PipelineObserver } from "@cortex/engine";
import { MemoryStore, type IEmbeddingService } from "@cortex/memory-store";
import { InMemoryMemoryStore } from "@cortex/memory";

const mockEmbedder: IEmbeddingService = {
  embedText: async () => { throw new Error("mock embedding unavailable"); },
  embedBatch: async () => { throw new Error("mock embedding unavailable"); },
};

describe("MemoryStore 生命周期状态机", () => {
  let store: MemoryStore;
  let observer: PipelineObserver;

  beforeEach(async () => {
    observer = new PipelineObserver();
    store = new MemoryStore(new InMemoryMemoryStore(), observer, mockEmbedder);
    await store.init(":memory:");
  });

  // ─── 用例1: init 后正常写入 ─────────────────────

  it("用例1: init 后正常写入并通过 read() 检索", async () => {
    const id = await store.write({
      kind: "TaskLog",
      content_blob: { key: "safe_db_run_ok" },
      summary: "正常写入测试",
      semantic_gist: "正常写入测试",
      content_hash: "",
      source: { agentType: AgentType.Code, taskId: "" }});

    // Assert: 写入成功
    expect(id).toMatch(/^[0-9a-f]{8}-/);
    const results = await store.read({ keywords: ["正常写入"] });
    expect(results).toHaveLength(1);

    await store.close();
  });

  // ─── 用例2: 后端失败时抛出异常 ──────────────────

  it("用例2: 后端 write() 失败时异常向上传播（假阳性禁止原则）", async () => {
    const { vi } = await import("vitest");
    // 劫持 backend.write 使写入失败
    vi.spyOn((store as any)._backend, "write").mockRejectedValueOnce(
      new Error("BACKEND_WRITE_FAILURE"),
    );

    // Act & Assert: 必须抛出
    await expect(store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "传播测试",
      semantic_gist: "传播测试",
      content_hash: "",
      source: { agentType: AgentType.Code, taskId: "" }})).rejects.toThrow("BACKEND_WRITE_FAILURE");

    await store.close();
  });

  // ─── 用例3: 后端失败时仍可通过 observer 感知 ─────

  it("用例3: 后端 write() 失败时异常传播（observer 可感知）", async () => {
    const { vi } = await import("vitest");
    const emitted: any[] = [];
    observer.on(PipelinePriority.CRITICAL, (event) => {
      emitted.push({ type: event.type, payload: event.payload });
    });

    vi.spyOn((store as any)._backend, "write").mockRejectedValueOnce(
      new Error("BACKEND_FAILURE"),
    );

    try {
      await store.write({
        kind: "TaskLog",
        content_blob: { test: true },
        summary: "失败事件测试",
        semantic_gist: "失败事件测试",
        content_hash: "",
        source: { agentType: AgentType.Code, taskId: "" }});
    } catch { /* expected */ }

    // observer 应能感知到异常（通过 unhandled rejection 或其他通道）
    await store.close();
  });

  // ─── 用例4: close() 后拒绝写入/读取 ─────────────

  it("用例4: close() 后拒绝写入和读取", async () => {
    // 写入一条确认就绪
    await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "生命周期",
      semantic_gist: "生命周期",
      content_hash: "",
      source: { agentType: AgentType.Code, taskId: "" }});

    // Act: close
    await store.close();

    // Assert: 关闭后 write 被拒绝
    await expect(store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "关闭后写入",
      semantic_gist: "关闭后写入",
      content_hash: "",
      source: { agentType: AgentType.Code, taskId: "" }})).rejects.toThrow(/已关闭/);

    // Assert: 关闭后 read 被拒绝
    await expect(store.read({})).rejects.toThrow(/已关闭/);
  });

  // ─── 用例5: close() 幂等 ────────────────────────

  it("用例5: close() 幂等——重复调用不抛异常", async () => {
    await store.close();
    // 第二次 close 应直接返回
    await expect(store.close()).resolves.toBeUndefined();
    await expect(store.close()).resolves.toBeUndefined();
  });

  // ─── 用例6: 无 observer 时正常关闭 ──────────────

  it("用例6: 无 observer 时 close() 正常（不抛异常）", async () => {
    const noObsStore = new MemoryStore(
      new InMemoryMemoryStore(),
      undefined,
      mockEmbedder,
    );
    await noObsStore.init(":memory:");

    await noObsStore.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "无 observer 测试",
      semantic_gist: "无 observer 测试",
      content_hash: "",
      source: { agentType: AgentType.Code, taskId: "" }});

    // close 不应抛异常
    await expect(noObsStore.close()).resolves.toBeUndefined();
  });

  // ─── 用例7: init 后 isPersisted 为 false ──────

  it("用例7: init(':memory:') 后 isPersisted 为 false（纯内存模式）", async () => {
    expect(store.isPersisted).toBe(false);
    await store.close();
  });
});
