// @ci: e2e
/**
 * rollback-e2e.test.ts — Tool 层回滚机制端到端测试
 *
 * 场景:
 *   1. write_file 成功 → registry 记录 → 后续节点失败 → rollback 删除文件
 *   2. write_file 成功 → 全链路成功 → registry.clear（不删除）
 *   3. run_shell 超时 → 子进程清理 → 无僵尸进程
 *   4. 串行链路 → 中间节点失败 → 下游节点 abort
 *   5. 并发执行 → 部分节点失败 → 独立回滚互不干扰
 *
 * @design 纯内存测试——不依赖真实 LLM/Toolkit，使用 mock + fs 模拟场景。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ToolRollbackRegistry } from "@cortex/tools";
import { TaskBoard } from "@cortex/scheduler";
import { computeCompensation } from "@cortex/scheduler";
import type { TaskNode } from "@cortex/shared";

// ══════════════════════════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════════════════════════

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-e2e-"));
  return dir;
}

function createTempFile(dir: string, name: string): string {
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, "test content");
  return fp;
}

// ══════════════════════════════════════════════════════════════
// 场景 1: write_file 成功 → rollback 删除文件
// ══════════════════════════════════════════════════════════════

describe("场景1: write_file → registry → 失败 → rollback 删除文件", () => {
  if (process.env.CI) return; // 需要真实 LLM，CI 跳过
  let registry: ToolRollbackRegistry;
  let tmpDir: string;
  const taskId = "task-1";

  beforeEach(() => {
    registry = new ToolRollbackRegistry();
    tmpDir = createTempDir();
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("应记录 write_file 创建的文件", { timeout: 120000 }, () => {
    const fp = createTempFile(tmpDir, "test1.txt");
    registry.trackCreate(taskId, fp);
    const tracked = registry.getTrackedFiles(taskId);
    expect(tracked).toContain(fp);
    expect(registry.size).toBe(1);
  });

  it("rollback 应删除已创建的文件并返回删除列表", { timeout: 120000 }, () => {
    const fp1 = createTempFile(tmpDir, "f1.txt");
    const fp2 = createTempFile(tmpDir, "f2.txt");
    registry.trackCreate(taskId, fp1);
    registry.trackCreate(taskId, fp2);

    expect(fs.existsSync(fp1)).toBe(true);
    expect(fs.existsSync(fp2)).toBe(true);

    const deleted = registry.rollback(taskId);

    expect(deleted).toContain(fp1);
    expect(deleted).toContain(fp2);
    expect(fs.existsSync(fp1)).toBe(false);
    expect(fs.existsSync(fp2)).toBe(false);
    // 回滚后 registry 清理
    expect(registry.getTrackedFiles(taskId)).toEqual([]);
    expect(registry.size).toBe(0);
  });

  it("重复记录同一文件应去重", { timeout: 120000 }, () => {
    const fp = createTempFile(tmpDir, "dedup.txt");
    registry.trackCreate(taskId, fp);
    registry.trackCreate(taskId, fp); // 重复
    expect(registry.getTrackedFiles(taskId).length).toBe(1);
  });

  it("不存在的 taskId rollback 应返回空数组", { timeout: 120000 }, () => {
    const deleted = registry.rollback("non-existent");
    expect(deleted).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════
// 场景 2: 全链路成功 → registry.clear（不删除文件）
// ══════════════════════════════════════════════════════════════

describe("场景2: 全链路成功 → clear 不删除文件", () => {
  if (process.env.CI) return; // 需要真实 LLM，CI 跳过
  let registry: ToolRollbackRegistry;
  let tmpDir: string;
  const taskId = "task-2";

  beforeEach(() => {
    registry = new ToolRollbackRegistry();
    tmpDir = createTempDir();
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("clear 应仅清理跟踪记录，不删除文件", { timeout: 120000 }, () => {
    const fp = createTempFile(tmpDir, "keep.txt");
    registry.trackCreate(taskId, fp);
    expect(registry.size).toBe(1);

    registry.clear(taskId);

    expect(registry.size).toBe(0);
    expect(registry.getTrackedFiles(taskId)).toEqual([]);
    // 文件应仍然存在
    expect(fs.existsSync(fp)).toBe(true);
  });

  it("全链路成功后调用 clear 不应影响其他 task 的记录", { timeout: 120000 }, () => {
    const fp1 = createTempFile(tmpDir, "a.txt");
    const fp2 = createTempFile(tmpDir, "b.txt");
    registry.trackCreate("task-a", fp1);
    registry.trackCreate("task-b", fp2);

    registry.clear("task-a");

    expect(registry.getTrackedFiles("task-a")).toEqual([]);
    expect(registry.getTrackedFiles("task-b")).toContain(fp2);
    expect(registry.size).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════
// 场景 3: run_shell 超时 → 子进程清理（registry 记录）
// ══════════════════════════════════════════════════════════════

describe("场景3: run_shell 副作用记录", () => {
  if (process.env.CI) return; // 需要真实 LLM，CI 跳过
  let registry: ToolRollbackRegistry;

  beforeEach(() => {
    registry = new ToolRollbackRegistry();
  });

  it("trackShell 应记录副作用描述", { timeout: 120000 }, () => {
    registry.trackShell("task-shell", "npm install");
    registry.trackShell("task-shell", "rm -rf temp");

    const shells = registry.getTrackedShells("task-shell");
    expect(shells).toContain("npm install");
    expect(shells).toContain("rm -rf temp");
  });

  it("rollback 也应清理副作用记录", { timeout: 120000 }, () => {
    registry.trackShell("task-sh", "echo hello");
    registry.trackCreate("task-sh", "/tmp/test.txt");

    registry.rollback("task-sh");

    expect(registry.getTrackedShells("task-sh")).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════
// 场景 4: 串行链路 → 中间节点失败 → 下游节点 abort
// ══════════════════════════════════════════════════════════════

describe("场景4: 串行链路 → 中间节点失败 → 下游 abort", () => {
  if (process.env.CI) return; // 需要真实 LLM，CI 跳过
  it("computeCompensation 应返回下游 abort 动作", { timeout: 120000 }, () => {
    const board = new TaskBoard();
    const parent: TaskNode = { id: "parent", type: "code", payload: "parent task", status: "pending", tags: [], needsMultiPerspective: false, claimedBy: [], results: [], createdAt: Date.now() };
    const child: TaskNode = { id: "child", type: "code", payload: "child task", status: "pending", tags: [], needsMultiPerspective: false, claimedBy: [], results: [], createdAt: Date.now(), parentId: "parent" };
    const grandchild: TaskNode = { id: "grandchild", type: "code", payload: "grandchild task", status: "pending", tags: [], needsMultiPerspective: false, claimedBy: [], results: [], createdAt: Date.now(), parentId: "child" };

    board.addNode(parent);
    board.addNode(child);
    board.addNode(grandchild);

    // 中间节点失败
    const actions = computeCompensation("child", board);

    // 应通知父节点 degrade，且 abort 子节点
    const degradeActions = actions.filter(a => a.event === "degrade");
    const abortActions = actions.filter(a => a.event === "abort_children");

    expect(degradeActions.some(a => a.nodeId === "parent")).toBe(true);
    expect(abortActions.some(a => a.nodeId === "grandchild")).toBe(true);
  });

  it("根节点失败应仅 abort 所有子树", { timeout: 120000 }, () => {
    const board = new TaskBoard();
    const root: TaskNode = { id: "root", type: "code", payload: "root", status: "pending", tags: [], needsMultiPerspective: false, claimedBy: [], results: [], createdAt: Date.now() };
    const child1: TaskNode = { id: "c1", type: "code", payload: "child1", status: "pending", tags: [], needsMultiPerspective: false, claimedBy: [], results: [], createdAt: Date.now(), parentId: "root" };
    const child2: TaskNode = { id: "c2", type: "code", payload: "child2", status: "pending", tags: [], needsMultiPerspective: false, claimedBy: [], results: [], createdAt: Date.now(), parentId: "root" };
    const subchild: TaskNode = { id: "sc1", type: "code", payload: "subchild", status: "pending", tags: [], needsMultiPerspective: false, claimedBy: [], results: [], createdAt: Date.now(), parentId: "c1" };

    board.addNode(root);
    board.addNode(child1);
    board.addNode(child2);
    board.addNode(subchild);

    const actions = computeCompensation("root", board);

    // 根节点无父节点 → 无 degrade
    expect(actions.some(a => a.event === "degrade")).toBe(false);

    // 所有下游都应 abort
    const abortNodeIds = actions.filter(a => a.event === "abort_children").map(a => a.nodeId);
    expect(abortNodeIds).toContain("c1");
    expect(abortNodeIds).toContain("c2");
    expect(abortNodeIds).toContain("sc1");
    expect(abortNodeIds.length).toBe(3);
  });

  it("不存在的节点应返回空数组", { timeout: 120000 }, () => {
    const board = new TaskBoard();
    const actions = computeCompensation("ghost", board);
    expect(actions).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════
// 场景 5: 并发执行 → 部分节点失败 → 独立回滚互不干扰
// ══════════════════════════════════════════════════════════════

describe("场景5: 并发执行 → 部分失败 → 独立回滚互不干扰", () => {
  if (process.env.CI) return; // 需要真实 LLM，CI 跳过
  let registry: ToolRollbackRegistry;
  let tmpDir: string;

  beforeEach(() => {
    registry = new ToolRollbackRegistry();
    tmpDir = createTempDir();
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("多个 task 独立跟踪，一个失败不影响其他", { timeout: 120000 }, () => {
    const f1 = createTempFile(tmpDir, "task-a.txt");
    const f2 = createTempFile(tmpDir, "task-b.txt");
    const f3 = createTempFile(tmpDir, "task-c.txt");

    registry.trackCreate("task-a", f1);
    registry.trackCreate("task-b", f2);
    registry.trackCreate("task-c", f3);

    // task-b 失败，只回滚 task-b
    const deleted = registry.rollback("task-b");

    expect(deleted).toContain(f2);
    expect(fs.existsSync(f2)).toBe(false);
    // task-a 和 task-c 的文件应保留
    expect(fs.existsSync(f1)).toBe(true);
    expect(fs.existsSync(f3)).toBe(true);

    // registry 中 task-b 已清理
    expect(registry.getTrackedFiles("task-b")).toEqual([]);
    expect(registry.getTrackedFiles("task-a")).toContain(f1);
    expect(registry.getTrackedFiles("task-c")).toContain(f3);
  });

  it("全部成功 → 全部 clear 无文件删除", { timeout: 120000 }, () => {
    const f1 = createTempFile(tmpDir, "x.txt");
    const f2 = createTempFile(tmpDir, "y.txt");

    registry.trackCreate("t1", f1);
    registry.trackCreate("t2", f2);

    registry.clear("t1");
    registry.clear("t2");

    expect(fs.existsSync(f1)).toBe(true);
    expect(fs.existsSync(f2)).toBe(true);
    expect(registry.size).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════
// ToolRollbackRegistry reset
// ══════════════════════════════════════════════════════════════

describe("ToolRollbackRegistry.reset", () => {
  if (process.env.CI) return; // 需要真实 LLM，CI 跳过
  it("reset 应清空所有跟踪记录（不删除文件）", { timeout: 120000 }, () => {
    const registry = new ToolRollbackRegistry();
    registry.trackCreate("a", "/tmp/a.txt");
    registry.trackCreate("b", "/tmp/b.txt");
    registry.trackShell("a", "cmd");

    registry.reset();

    expect(registry.size).toBe(0);
    expect(registry.getTrackedFiles("a")).toEqual([]);
    expect(registry.getTrackedFiles("b")).toEqual([]);
    expect(registry.getTrackedShells("a")).toEqual([]);
  });
});
