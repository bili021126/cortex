/**
 * 测试文件: PipelineObserver SafeErrorReporter 上报测试 (方案A)
 *
 * 测试范围:
 * - createSafeReporter() 返回可调用函数
 * - silent 错误 <3 次连续发生时不 emit 事件
 * - silent 错误 =3 次连续发生时 emit error.silent_upgraded 事件
 * - non-silent 错误立即 emit error.reported 事件
 * - non-silent 错误重置 silent 计数器
 * - fatal 级别以 CRITICAL 优先级发送
 * - degraded 级别以 HIGH 优先级发送
 *
 * 治理判例: NG-2026-0509-Persist-False-Positive
 *
 * 测试数据用例:
 *   用例1: createSafeReporter() 返回可调用 SafeErrorReporter
 *   用例2: silent 错误连续 2 次不触发升级
 *   用例3: silent 错误连续 3 次触发 error.silent_upgraded 事件
 *   用例4: degraded 错误触发 error.reported 事件（HIGH 优先级）
 *   用例5: fatal 错误触发 error.reported 事件（CRITICAL 优先级）
 *   用例6: non-silent 错误重置 silent 计数器
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PipelineObserver } from "../src/pipeline-observer";
import { PipelinePriority } from "@cortex/shared";
import type { SafeErrorContext } from "@cortex/shared";

describe("PipelineObserver SafeErrorReporter 上报 (方案A)", () => {
  let observer: PipelineObserver;

  beforeEach(() => {
    observer = new PipelineObserver();
  });

  // ─── 用例1: createSafeReporter 返回函数 ─────────────

  it("用例1: createSafeReporter() 返回可调用的 SafeErrorReporter", () => {
    const reporter = observer.createSafeReporter();
    expect(typeof reporter).toBe("function");

    // 调用不抛异常
    expect(() => {
      reporter({
        source: "test",
        error: new Error("test"),
        severity: "silent",
      });
    }).not.toThrow();
  });

  // ─── 用例2: silent <3 次不触发 ────────────────────

  it("用例2: silent 错误连续 2 次不触发 error.silent_upgraded 事件", () => {
    const emitted: any[] = [];
    observer.on(PipelinePriority.HIGH, (event) => {
      emitted.push(event);
    });

    const reporter = observer.createSafeReporter();

    // Arrange: 模拟同一 source 连续 2 次 silent 错误
    reporter({ source: "TestSource.ops", error: new Error("silent 1"), severity: "silent" });
    reporter({ source: "TestSource.ops", error: new Error("silent 2"), severity: "silent" });

    // Assert: 无升级事件（2 < 3）
    const upgradeEvents = emitted.filter((e) => e.type === "error.silent_upgraded");
    expect(upgradeEvents).toHaveLength(0);
  });

  // ─── 用例3: silent =3 次触发升级 ─────────────────

  it("用例3: silent 错误连续 3 次触发 error.silent_upgraded 事件", () => {
    const emitted: any[] = [];
    observer.on(PipelinePriority.HIGH, (event) => {
      emitted.push(event);
    });

    const reporter = observer.createSafeReporter();

    // Arrange: 同一 source 连续 3 次 silent 错误
    reporter({ source: "CacheReader.load", error: new Error("corrupted-1"), severity: "silent" });
    reporter({ source: "CacheReader.load", error: new Error("corrupted-2"), severity: "silent" });
    reporter({ source: "CacheReader.load", error: new Error("corrupted-3"), severity: "silent" });

    // Assert: 第 3 次触发升级事件
    const upgradeEvents = emitted.filter((e) => e.type === "error.silent_upgraded");
    expect(upgradeEvents).toHaveLength(1);
    expect(upgradeEvents[0].payload.source).toBe("CacheReader.load");
    expect(upgradeEvents[0].payload.consecutive).toBe(3);
    expect(upgradeEvents[0].payload.threshold).toBe(3);
  });

  // ─── 用例4: degraded 触发 error.reported (HIGH) ──

  it("用例4: degraded 错误触发 error.reported 事件（HIGH 优先级）", () => {
    const emitted: any[] = [];
    observer.on(PipelinePriority.HIGH, (event) => {
      emitted.push(event);
    });

    const reporter = observer.createSafeReporter();

    // Act
    reporter({
      source: "Agent.shutdown",
      error: new Error("cleanup failed"),
      severity: "degraded",
      hint: "non-critical cleanup",
    });

    // Assert
    const reportedEvents = emitted.filter((e) => e.type === "error.reported");
    expect(reportedEvents).toHaveLength(1);
    expect(reportedEvents[0].priority).toBe(PipelinePriority.HIGH);
    expect(reportedEvents[0].payload.source).toBe("Agent.shutdown");
    expect(reportedEvents[0].payload.severity).toBe("degraded");
    expect(reportedEvents[0].payload.hint).toBe("non-critical cleanup");
  });

  // ─── 用例5: fatal 触发 error.reported (CRITICAL) ─

  it("用例5: fatal 错误触发 error.reported 事件（CRITICAL 优先级）", () => {
    const emitted: any[] = [];
    observer.on(PipelinePriority.CRITICAL, (event) => {
      emitted.push(event);
    });

    const reporter = observer.createSafeReporter();

    // Act
    reporter({
      source: "MemoryStore.write",
      error: new Error("disk full"),
      severity: "fatal",
    });

    // Assert
    const reportedEvents = emitted.filter((e) => e.type === "error.reported");
    expect(reportedEvents).toHaveLength(1);
    expect(reportedEvents[0].priority).toBe(PipelinePriority.CRITICAL);
    expect(reportedEvents[0].payload.source).toBe("MemoryStore.write");
    expect(reportedEvents[0].payload.severity).toBe("fatal");
  });

  // ─── 用例6: non-silent 重置计数器 ───────────────

  it("用例6: non-silent（fatal/degraded）错误重置对应 source 的 silent 计数器", () => {
    const emitted: any[] = [];
    observer.on(PipelinePriority.HIGH, (event) => {
      emitted.push(event);
    });
    observer.on(PipelinePriority.CRITICAL, (event) => {
      emitted.push(event);
    });

    const reporter = observer.createSafeReporter();

    // Arrange: 先累积 2 次 silent
    reporter({ source: "NetAdapter.ping", error: new Error("timeout-1"), severity: "silent" });
    reporter({ source: "NetAdapter.ping", error: new Error("timeout-2"), severity: "silent" });

    // 还没到升级阈值
    expect(emitted.filter((e) => e.type === "error.silent_upgraded")).toHaveLength(0);

    // Act: 一次 degraded 错误应该重置计数器
    reporter({ source: "NetAdapter.ping", error: new Error("hard down"), severity: "degraded" });

    // 再发 3 次 silent——计数器从 0 重新计数
    reporter({ source: "NetAdapter.ping", error: new Error("timeout-a"), severity: "silent" });
    reporter({ source: "NetAdapter.ping", error: new Error("timeout-b"), severity: "silent" });
    // 第 3 次（从 degraded 重置后）不应触发升级
    const upgradeBefore = emitted.filter((e) => e.type === "error.silent_upgraded").length;
    reporter({ source: "NetAdapter.ping", error: new Error("timeout-c"), severity: "silent" });

    // 现在应该有 1 次升级（degraded 重置了计数器，所以需要再 3 次）
    // 注意：第 3 次 silent（timeout-c）触发升级
    const upgradeEvents = emitted.filter((e) => e.type === "error.silent_upgraded");
    expect(upgradeEvents.length).toBe(1);
    expect(upgradeEvents[0].payload.consecutive).toBe(3);
  });
});
