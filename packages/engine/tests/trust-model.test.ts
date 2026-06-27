// @ci: unit
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { TrustModel } from "@cortex/scheduler";
import { TrustLevel, type AgentType } from "@cortex/shared";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const TMP_DIR = path.join(os.tmpdir(), "cortex-trust-test");
const STATE_PATH = path.join(TMP_DIR, "trust-state.json");

function cleanTemp(): void {
  try { fs.rmSync(TMP_DIR, { recursive: true }); } catch { /* ok */ }
}

afterAll(() => cleanTemp());

describe("TrustModel", () => {
  let tm: TrustModel;

  beforeEach(() => {
    tm = new TrustModel();
  });

  // ── 冷启动 ──────────────────────────────────────

  it("首次访问返回 L1（冷启动）", () => {
    const level = tm.getTrustLevel("ganyu" as AgentType, "file_write");
    expect(level).toBe(TrustLevel.L1);
  });

  it("未知工具 getTrustLevelForTool 返回 L1", () => {
    const level = tm.getTrustLevelForTool("ganyu" as AgentType, "unknown_tool");
    expect(level).toBe(TrustLevel.L1);
  });

  // ── 晋升 L1 → L2 ────────────────────────────────

  it("连续 5 次接受后晋升 L2", () => {
    for (let i = 0; i < 5; i++) {
      tm.recordDecision("ganyu" as AgentType, "write_file", true);
    }
    const level = tm.getTrustLevel("ganyu" as AgentType, "file_write");
    expect(level).toBe(TrustLevel.L2);
  });

  it("连续 4 次接受不晋升，仍为 L1", () => {
    for (let i = 0; i < 4; i++) {
      tm.recordDecision("ganyu" as AgentType, "write_file", true);
    }
    const level = tm.getTrustLevel("ganyu" as AgentType, "file_write");
    expect(level).toBe(TrustLevel.L1);
  });

  // ── 晋升 L2 → L3 ────────────────────────────────

  it("连续 15 次以上接受后晋升 L3", () => {
    for (let i = 0; i < 15; i++) {
      tm.recordDecision("ganyu" as AgentType, "write_file", true);
    }
    const level = tm.getTrustLevel("ganyu" as AgentType, "file_write");
    expect(level).toBe(TrustLevel.L3);
  });

  // ── 拒绝重置 ────────────────────────────────────

  it("拒绝后立即重置为 L1", () => {
    // 先晋升到 L2
    for (let i = 0; i < 5; i++) {
      tm.recordDecision("ganyu" as AgentType, "write_file", true);
    }
    expect(tm.getTrustLevel("ganyu" as AgentType, "file_write")).toBe(TrustLevel.L2);

    // 一次拒绝
    tm.recordDecision("ganyu" as AgentType, "write_file", false);
    expect(tm.getTrustLevel("ganyu" as AgentType, "file_write")).toBe(TrustLevel.L1);
  });

  it("拒绝后连续接受计数归零", () => {
    for (let i = 0; i < 3; i++) {
      tm.recordDecision("ganyu" as AgentType, "write_file", true);
    }
    tm.recordDecision("ganyu" as AgentType, "write_file", false); // 拒绝，重置
    for (let i = 0; i < 4; i++) {
      tm.recordDecision("ganyu" as AgentType, "write_file", true);
    }
    // 第 4 次还不该晋升（需要连续 5 次）
    expect(tm.getTrustLevel("ganyu" as AgentType, "file_write")).toBe(TrustLevel.L1);
  });

  // ── 二维隔离 ────────────────────────────────────

  it("不同域独立追踪", () => {
    // ganyu file_write 晋升 L2
    for (let i = 0; i < 5; i++) {
      tm.recordDecision("ganyu" as AgentType, "write_file", true);
    }
    expect(tm.getTrustLevel("ganyu" as AgentType, "file_write")).toBe(TrustLevel.L2);

    // ganyu shell_exec 仍为 L1
    expect(tm.getTrustLevel("ganyu" as AgentType, "shell_exec")).toBe(TrustLevel.L1);
  });

  it("不同 Agent 独立追踪", () => {
    for (let i = 0; i < 5; i++) {
      tm.recordDecision("ganyu" as AgentType, "write_file", true);
    }
    expect(tm.getTrustLevel("ganyu" as AgentType, "file_write")).toBe(TrustLevel.L2);
    expect(tm.getTrustLevel("keqing" as AgentType, "file_write")).toBe(TrustLevel.L1);
  });

  // ── resetAll ────────────────────────────────────

  it("resetAll 清空所有信任", () => {
    for (let i = 0; i < 10; i++) {
      tm.recordDecision("ganyu" as AgentType, "write_file", true);
    }
    expect(tm.getTrustLevel("ganyu" as AgentType, "file_write")).toBe(TrustLevel.L2);

    tm.resetAll();
    expect(tm.getTrustLevel("ganyu" as AgentType, "file_write")).toBe(TrustLevel.L1);
  });

  // ── 快照 ────────────────────────────────────────

  it("snapshot 返回当前信任条目", () => {
    tm.recordDecision("ganyu" as AgentType, "write_file", true);
    const snap = tm.snapshot();
    expect(snap.size).toBe(1);

    const entry = snap.get("ganyu:file_write");
    expect(entry).toBeDefined();
    if (entry) {
      expect(entry.consecutiveAccepts).toBe(1);
      expect(entry.totalConfirmations).toBe(1);
    }
  });

  // ── getTrustLevelForTool ─────────────────────────

  it("getTrustLevelForTool 正确映射工具名", () => {
    for (let i = 0; i < 5; i++) {
      tm.recordDecision("ganyu" as AgentType, "write_file", true);
    }

    // write_file → file_write
    expect(tm.getTrustLevelForTool("ganyu" as AgentType, "write_file")).toBe(TrustLevel.L2);

    // delete_file → file_write (same domain)
    expect(tm.getTrustLevelForTool("ganyu" as AgentType, "delete_file")).toBe(TrustLevel.L2);

    // run_shell → shell_exec (different domain, still L1)
    expect(tm.getTrustLevelForTool("ganyu" as AgentType, "run_shell")).toBe(TrustLevel.L1);
  });

  // ── 衰减（时间旅行） ─────────────────────────────

  it("衰减检查逻辑：7天后降级", () => {
    for (let i = 0; i < 10; i++) {
      tm.recordDecision("ganyu" as AgentType, "write_file", true);
    }
    // 晋升到 L2
    expect(tm.getTrustLevel("ganyu" as AgentType, "file_write")).toBe(TrustLevel.L2);

    // 访问 snapshot 获取 entry 并手动推进 lastAcceptedAt
    const snap = tm.snapshot();
    const entry = snap.get("ganyu:file_write");
    if (entry) {
      // 模拟 8 天前最后一次接受
      (
        entry as { lastAcceptedAt: number }
      ).lastAcceptedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    }

    // 再次查询触发衰减检测
    const level = tm.getTrustLevel("ganyu" as AgentType, "file_write");
    expect(level).toBe(TrustLevel.L1);
  });

  // ── High: 信任模型无持久化——重启后信任状态丢失 ──

  it("should warn on trust state loss after restart", () => {
    // 建立信任
    for (let i = 0; i < 5; i++) {
      tm.recordDecision("ganyu" as AgentType, "write_file", true);
    }
    expect(tm.getTrustLevel("ganyu" as AgentType, "file_write")).toBe(TrustLevel.L2);

    // 模拟重启：创建新 TrustModel 实例
    const freshTm = new TrustModel();

    // 新实例冷启动——所有信任状态丢失，回到 L1
    const level = freshTm.getTrustLevel("ganyu" as AgentType, "file_write");
    expect(level).toBe(TrustLevel.L1);

    // 旧实例状态不受影响
    expect(tm.getTrustLevel("ganyu" as AgentType, "file_write")).toBe(TrustLevel.L2);
  });

  // ── 持久化 save/load ────────────────────────────

  it("save 后 load 恢复信任状态", async () => {
    const tm1 = new TrustModel(STATE_PATH);
    for (let i = 0; i < 5; i++) {
      tm1.recordDecision("ganyu" as AgentType, "write_file", true);
    }
    expect(tm1.getTrustLevel("ganyu" as AgentType, "file_write")).toBe(TrustLevel.L2);

    // 显式持久化
    await tm1.save();

    const tm2 = new TrustModel(STATE_PATH);
    await tm2.load();
    expect(tm2.getTrustLevel("ganyu" as AgentType, "file_write")).toBe(TrustLevel.L2);
  });

  it("load 时文件不存在不抛出", async () => {
    const nonexistent = path.join(TMP_DIR, "nonexistent.json");
    const tm = new TrustModel(nonexistent);
    await expect(tm.load()).resolves.toBeUndefined();
  });

  it("未设 statePath 时 save/load 静默跳过", async () => {
    const tm = new TrustModel();
    await expect(tm.save()).resolves.toBeUndefined();
    await expect(tm.load()).resolves.toBeUndefined();
  });

  it("recordDecision 自动触发持久化", async () => {
    const tm1 = new TrustModel(STATE_PATH);
    for (let i = 0; i < 5; i++) {
      tm1.recordDecision("ganyu" as AgentType, "write_file", true);
    }
    // 等待异步 save 完成
    await new Promise((r) => setTimeout(r, 200));

    const tm2 = new TrustModel(STATE_PATH);
    await tm2.load();
    expect(tm2.getTrustLevel("ganyu" as AgentType, "file_write")).toBe(TrustLevel.L2);
  });
});
