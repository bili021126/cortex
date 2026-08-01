// @ci: unit
// ============================================================
// @cortex/engine —— RAG 降级显式化测试（spec S2-3）
//
// 守护：ragReady=false 时 RAG 桥接绝不返回假 id/空数组，
// 而是抛显式错误 + 记录 telemetry 降级数据点（memory.rag.degraded）。
// ============================================================

import { describe, it, expect, afterEach } from "vitest";
import { createRagBridge } from "@cortex/engine";
import { FileCollector, shutdownTelemetry, type ITelemetryCollector } from "@cortex/telemetry";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── 辅助 ────────────────────────────────────────

/** 注入文件采集器，验证降级事件真实落盘（FileCollector 缓冲式——需 flush） */
async function installFileTelemetry(): Promise<{ file: string; flush: () => Promise<void> }> {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "cortex-rag-tel-")),
    "telemetry.jsonl",
  );
  const collector: ITelemetryCollector = new FileCollector(file);
  const { setTelemetry } = await import("@cortex/telemetry");
  await setTelemetry(collector);
  return { file, flush: () => collector.flush() };
}

async function readTelemetry(file: string): Promise<string[]> {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
}

afterEach(async () => {
  await shutdownTelemetry();
});

// ═══════════════════════════════════════════════════════
// T1: 降级桥接抛显式错误（非假 id / 非空数组）
// ═══════════════════════════════════════════════════════

describe("T1: ragReady=false 时桥接抛显式错误", () => {
  it("addMemory 拒绝返回假 id——抛出带上下文的错误", async () => {
    const bridge = createRagBridge(false);
    await expect(bridge.addMemory("文本", "source")).rejects.toThrow(
      /RAG 不可用.*拒绝降级假 id/,
    );
  });

  it("searchMemoryEntries 拒绝返回空数组——抛出带上下文的错误", async () => {
    const bridge = createRagBridge(false);
    await expect(bridge.searchMemoryEntries("查询")).rejects.toThrow(
      /RAG 不可用.*拒绝返回空数组/,
    );
  });

  it("两个函数都不返回假结果（错误路径全覆盖）", async () => {
    const bridge = createRagBridge(false);
    let addRejected = false;
    let searchRejected = false;
    try {
      await bridge.addMemory("x", "y");
    } catch { addRejected = true; }
    try {
      await bridge.searchMemoryEntries("q");
    } catch { searchRejected = true; }
    expect(addRejected).toBe(true);
    expect(searchRejected).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// T2: 降级状态入 telemetry（验收标准 3）
// ═══════════════════════════════════════════════════════

describe("T2: 降级状态记录入 telemetry", () => {
  it("addMemory 降级时落盘 memory.rag.degraded 数据点", async () => {
    const { file, flush } = await installFileTelemetry();
    const bridge = createRagBridge(false);
    await bridge.addMemory("文本", "source").catch(() => undefined);
    await flush();

    const lines = await readTelemetry(file);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => l.includes("memory.rag.degraded") && l.includes("operation") && l.includes("add"))).toBe(true);
  });

  it("searchMemoryEntries 降级时落盘 memory.rag.degraded 数据点", async () => {
    const { file, flush } = await installFileTelemetry();
    const bridge = createRagBridge(false);
    await bridge.searchMemoryEntries("查询").catch(() => undefined);
    await flush();

    const lines = await readTelemetry(file);
    expect(lines.some((l) => l.includes("memory.rag.degraded") && l.includes("operation") && l.includes("search"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// T3: ragReady=true 时直通真实 RAG 实现（无降级包装）
// ═══════════════════════════════════════════════════════

describe("T3: ragReady=true 时直通真实实现", () => {
  it("桥接引用与真实 ragAddMemory/ragSearchMemoryEntries 相同", async () => {
    const bridge = createRagBridge(true);
    // ragAddMemory 是 addMemory 的 re-export 别名——函数名即真实实现名
    expect(bridge.addMemory.name).toBe("addMemory");
    expect(bridge.searchMemoryEntries.name).toBe("searchMemoryEntries");
  });
});
