// @ci: unit
// ============================================================
// @cortex/telemetry —— setTelemetry 接线守护测试（spec S2-5）
//
// 守护：bootstrap 默认注入 FileCollector 后，recordTelemetry 必须
// 走注入实例并最终落盘 JSONL（验收：telemetry.jsonl 出现条目）。
// 测试结束恢复默认采集器，避免模块级单例污染其他用例。
// ============================================================

import { describe, it, expect, afterAll } from "vitest";
import { readFile, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

import {
  FileCollector,
  getTelemetry,
  recordTelemetry,
  setTelemetry,
  shutdownTelemetry,
} from "../src/index.js";

const TEST_DIR = join(tmpdir(), "cortex-set-telemetry-test", randomUUID());
const FILE = join(TEST_DIR, "telemetry.jsonl");

describe("setTelemetry → FileCollector 落盘闭环（spec S2-5）", () => {
  afterAll(async () => {
    await shutdownTelemetry();
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("注入 FileCollector 后 recordTelemetry 走新实例并落盘 JSONL", async () => {
    const collector = new FileCollector(FILE);
    await setTelemetry(collector);

    // getTelemetry 必须返回注入实例（非默认 ConsoleCollector）
    expect(getTelemetry()).toBe(collector);

    await recordTelemetry("engine.bootstrap.ok", 1, [{ key: "phase", value: "s2" }]);

    // 未 flush 前文件不应存在（buffer 语义）
    expect(existsSync(FILE)).toBe(false);

    await collector.flush();

    expect(existsSync(FILE)).toBe(true);
    const lines = (await readFile(FILE, "utf-8")).split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry.name).toBe("engine.bootstrap.ok");
    expect(entry.value).toBe(1);
    expect(entry.tags).toEqual([{ key: "phase", value: "s2" }]);
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it("shutdownTelemetry 刷新残留缓冲区并复位默认采集器", async () => {
    const collector = new FileCollector(FILE);
    await setTelemetry(collector);

    await recordTelemetry("engine.shutdown.flush", 2);
    // 不显式 flush——shutdownTelemetry 应触发最后一刷
    await shutdownTelemetry();

    const lines = (await readFile(FILE, "utf-8")).split("\n").filter(Boolean);
    expect(lines.some((l) => l.includes("engine.shutdown.flush"))).toBe(true);

    // 复位后 getTelemetry 重建默认实例（非已关闭的 FileCollector）
    const next = getTelemetry();
    expect(next).not.toBe(collector);
  });
});
