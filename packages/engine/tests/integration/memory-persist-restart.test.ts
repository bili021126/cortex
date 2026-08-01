// @ci: contract
// ============================================================
// @cortex/engine —— SQLite 记忆持久化集成测试（spec S2-2 验收）
//
// 守护装配事实：bootstrapEngine 未注入 memory 时，MemoryStorePlugin
// 默认走 SqliteMemoryStore（WAL + FTS5），而非 InMemoryMemoryStore。
//
// 验收标准：
//   1. `.cortex/memory.db` 文件真实生成（SQLite 魔数头验证）
//   2. 重启进程（重新 bootstrap）后记忆可读回——写 → 关 → 重开 → 读
//   3. 未指定 dbPath 时回退默认路径 `${workspaceRoot}/.cortex/memory.db`
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mockLlmAdapter } from "../fixtures/mock-adapter.js";
import { bootstrapEngine } from "@cortex/engine";
import { Toolkit } from "@cortex/platform";
import type { IMemoryStore, MemoryEntry } from "@cortex/shared";
import { AgentType } from "@cortex/shared";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── 辅助 ────────────────────────────────────────

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const TEMP_DB_DIR = path.join(REPO_ROOT, ".cortex", "test");
const TEMP_DB = path.join(TEMP_DB_DIR, "memory-persist-restart.db");

/** SQLite 文件魔数头（16 字节） */
const SQLITE_MAGIC = "SQLite format 3\u0000";

function makeMockLLM(): Map<string, unknown> {
  const adapter = mockLlmAdapter("Task completed successfully.");
  return new Map([["default", adapter]]);
}

/** 写入一条可辨识的记忆并返回其 id */
async function writeMarker(memory: IMemoryStore, tag: string): Promise<string> {
  const id = await memory.write({
    kind: "EPISODIC" as never,
    content_blob: { marker: tag },
    summary: `持久化标记-${tag}`,
    semantic_gist: `持久化标记-${tag}`,
    content_hash: "",
    source: { agentType: AgentType.Code, taskId: `restart-${tag}` },
  });
  return id;
}

async function boot(dbPath?: string, workspaceRoot?: string) {
  return bootstrapEngine(REPO_ROOT, {
    llms: makeMockLLM(),
    toolkit: new Toolkit(),
    dbPath,
    workspaceRoot,
  });
}

function cleanup(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEMP_DB + suffix;
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
  }
}

/** Windows 下 better-sqlite3 句柄释放有延迟——重试删除目录 */
function rmDirRetry(dir: string, retries = 5): void {
  for (let i = 0; i < retries; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      if (i === retries - 1) throw new Error(`rmDirRetry 重试耗尽: ${dir}`);
      // 等待句柄释放后重试
      const deadline = Date.now() + 200;
      while (Date.now() < deadline) { /* busy-wait */ }
    }
  }
}

// ── 设置/清理 ───────────────────────────────────

beforeAll(() => {
  if (!fs.existsSync(TEMP_DB_DIR)) fs.mkdirSync(TEMP_DB_DIR, { recursive: true });
  cleanup();
});

// 每个用例从干净库开始（用例间不共享数据）
beforeEach(() => {
  cleanup();
});

afterAll(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════
// T1: 装配事实——bootstrap 默认走 SQLite 后端
// ═══════════════════════════════════════════════════════

describe("T1: bootstrap 默认装配 SqliteMemoryStore", () => {
  it("未注入 memory 时后端为持久化实现（isPersisted=true）且可读写", async () => {
    const result = await boot(TEMP_DB);
    const memory = result.memory!;
    expect(memory.isPersisted).toBe(true);

    const id = await writeMarker(memory, "t1");
    expect(id).toBeDefined();

    const entries = await memory.read({});
    const found = entries.find((e: MemoryEntry) => e.summary === "持久化标记-t1");
    expect(found).toBeDefined();

    await memory.close();
  });
});

// ═══════════════════════════════════════════════════════
// T2: 重启读回——写 → 关 → 重开 → 读
// ═══════════════════════════════════════════════════════

describe("T2: 重启进程后记忆可读回（spec 验收标准 1）", () => {
  it("关闭后重新 bootstrap 同一 dbPath 能读回条目", async () => {
    // 第一次启动：写入
    const first = await boot(TEMP_DB);
    const memoryA = first.memory!;
    const idA = await writeMarker(memoryA, "restart-A");
    const idB = await writeMarker(memoryA, "restart-B");
    await memoryA.close();

    // 第二次启动：同一 dbPath，读回
    const second = await boot(TEMP_DB);
    const memoryB = second.memory!;
    const all = await memoryB.read({});
    const entryA = all.find((e: MemoryEntry) => e.id === idA);
    expect(entryA).toBeDefined();
    expect(entryA!.summary).toBe("持久化标记-restart-A");
    expect(entryA!.content_blob).toEqual({ marker: "restart-A" });
    expect(entryA!.source.taskId).toBe("restart-restart-A");
    expect(all.some((e: MemoryEntry) => e.id === idB)).toBe(true);

    // 跨重启的条目数应等于写入数（无丢失、无重复）
    const markers = all.filter((e: MemoryEntry) => e.summary.startsWith("持久化标记-"));
    expect(markers.length).toBe(2);

    await memoryB.close();
  });
});

// ═══════════════════════════════════════════════════════
// T3: 文件证据——.db 真实落盘
// ═══════════════════════════════════════════════════════

describe("T3: `.cortex/memory.db` 文件生成（spec 验收标准 1）", () => {
  it("dbPath 指向的 SQLite 文件存在且带魔数头", async () => {
    const result = await boot(TEMP_DB);
    await result.memory!.close();

    expect(fs.existsSync(TEMP_DB)).toBe(true);
    const header = fs.readFileSync(TEMP_DB).subarray(0, 16).toString("utf-8");
    expect(header).toBe(SQLITE_MAGIC);
  });
});

// ═══════════════════════════════════════════════════════
// T4: 默认路径回退——未指定 dbPath 时用 workspaceRoot/.cortex/memory.db
// ═══════════════════════════════════════════════════════

describe("T4: 未指定 dbPath 时默认路径（spec 验收标准 3）", () => {
  it("使用 `${workspaceRoot}/.cortex/memory.db` 且可写读回", async () => {
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-mem-ws-"));
    const defaultDb = path.join(wsRoot, ".cortex", "memory.db");

    const result = await boot(undefined, wsRoot);
    const memory = result.memory!;
    const id = await writeMarker(memory, "default-path");
    // S2-10：bootstrap 注入 NotificationPersistence 持有 wsRoot/.cortex/notifications.db 连接——
    // 必须走 engine.shutdown() 释放全部句柄（仅 memory.close() 会残留 → Windows 删目录 EPERM）
    await result.shutdown();

    expect(fs.existsSync(defaultDb)).toBe(true);
    const header = fs.readFileSync(defaultDb).subarray(0, 16).toString("utf-8");
    expect(header).toBe(SQLITE_MAGIC);

    // 读回验证
    const again = await boot(undefined, wsRoot);
    const entries = await again.memory!.read({});
    const entry = entries.find((e: MemoryEntry) => e.id === id);
    expect(entry).toBeDefined();
    expect(entry!.summary).toBe("持久化标记-default-path");
    await again.shutdown();

    rmDirRetry(wsRoot);
  });
});
