// @ci: contract
/**
 * P0 完整 Engine 接入 —— 桥接契约测试
 *
 * 四向锁：
 *   `client/http-client.ts` 的 typed 方法 ↔ `desktop/src/shared/ipc-channels.ts` 的常量
 *                            ↔ `desktop/src/main/ipc-handlers.ts` 的 handler 注册
 *                            ↔ `desktop/src/preload/index.ts` 的 renderer 门面暴露
 *
 * 目的：任何一侧悄悄漂走（client 加新方法没桥、IPC_CHANNELS 加了没 handler、
 * preload 加了但 ipc-handlers 缺、ipc-handlers 加了但 preload 忘桥）都会让这条测试红。
 * 对应 docs/core/core-3-invariants.md 的 G-1 现有形状（client ↔ server REST 双向）的自然延伸。
 *
 * config 域（models/keys/tuning/validate/version/agent-patch 里非 P0 部分）
 * 由 EXEMPT 表显式豁免并写原因，等 P1 renderer 有 ConfigPanel 时补桥 + 移出豁免。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { IPC_CHANNELS } from "../src/shared/ipc-channels.js";

const here = dirname(fileURLToPath(import.meta.url));
// 仓库根：desktop/tests → ../../..
const repoRoot = resolve(here, "../../..");

const clientSrc = readFileSync(join(repoRoot, "packages/client/src/http-client.ts"), "utf-8");
const handlersSrc = readFileSync(join(repoRoot, "packages/desktop/src/main/ipc-handlers.ts"), "utf-8");
const preloadSrc = readFileSync(join(repoRoot, "packages/desktop/src/preload/index.ts"), "utf-8");

/** 从 http-client.ts 抓出全部 `async <name>(` public 方法（下划线开头的私有工具跳过）。 */
function extractClientMethods(src: string): string[] {
  const re = /\basync\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    if (!name || name.startsWith("_")) continue;
    set.add(name);
  }
  return [...set].sort();
}

/**
 * 已桥映射：CortexHttpClient 方法 → IPC_CHANNELS 常量键。
 * 修改此表 = 修改契约。加/删条目须同步 handler 注册 + preload 门面暴露。
 */
const BRIDGED: Record<string, keyof typeof IPC_CHANNELS> = {
  searchMemory: "CORTEX_MEMORY_SEARCH",
  writeMemory: "CORTEX_MEMORY_WRITE",
  deleteMemory: "CORTEX_MEMORY_DELETE",
  getSchedulerSnapshot: "CORTEX_SCHEDULER_SNAPSHOT",
  executeScheduler: "CORTEX_SCHEDULER_EXECUTE",
  submitNode: "CORTEX_NODE_SUBMIT",
  getNodes: "CORTEX_NODE_LIST",
  getNode: "CORTEX_NODE_GET",
  getConfig: "CORTEX_CONFIG_GET",
  setConfig: "CORTEX_CONFIG_SET",
  getSessions: "CORTEX_SESSIONS_LIST",
  createSession: "CORTEX_SESSIONS_CREATE",
  deleteSession: "CORTEX_SESSIONS_DELETE",
  getState: "CORTEX_STATE_GET",
  getHealth: "CORTEX_HEALTH_GET",
  getDaemonHealth: "CORTEX_DAEMON_HEALTH_GET",
  getCapabilities: "CORTEX_CAPABILITIES_GET",
  execute: "CORTEX_EXECUTE",
  getEvents: "CORTEX_EVENTS_LIST",
  patchAgentConfig: "CORTEX_AGENT_PATCH",
};

/**
 * 明确不桥的方法（每条必写原因，防空口豁免）。
 * renderer 无对应消费者 → 不建"没消费者的通道"（记忆 I-4 词汇闭合精神）。
 */
const EXEMPT: Record<string, string> = {
  chat: "走 CORTEX_CHAT 的 cortex.chat 便利方法（历史通道，未直连 .http.chat）",
  getAgents: "走 CORTEX_GET_AGENTS 的 cortex.getAgents（同上，历史便利通道）",
  // config 域——P1 renderer 有 ConfigPanel 时补桥 + 移出豁免；不建"没消费者的通道"
  getModels: "P1 ConfigPanel 出现时补桥（config 域整组一起）",
  createModel: "P1 ConfigPanel",
  patchModel: "P1 ConfigPanel",
  deleteModel: "P1 ConfigPanel",
  getKeys: "P1 ConfigPanel（密钥管理面）",
  createKey: "P1 ConfigPanel（密钥管理面）",
  deleteKey: "P1 ConfigPanel（密钥管理面）",
  getTuning: "P1 ConfigPanel（tuning 面）",
  patchTuning: "P1 ConfigPanel（tuning 面）",
  validateConfig: "P1 ConfigPanel 的『校验』按钮触发时补",
  getConfigVersion: "P1 ConfigPanel 显示版本戳时补",
};

describe("P0 IPC 桥接契约：client typed ↔ IPC_CHANNELS ↔ handlers ↔ preload", () => {
  // ── 前向：每个已桥的 client 方法必须真实存在于 http-client.ts ──
  it("BRIDGED 表里的每个方法在 client/http-client.ts 存在（防 client 改名/删除）", () => {
    const clientMethods = new Set(extractClientMethods(clientSrc));
    const missing = Object.keys(BRIDGED).filter((m) => !clientMethods.has(m));
    expect(missing, `client 侧已消失或改名: ${missing.join(", ")}`).toEqual([]);
  });

  // ── 后向：每个 client public async 方法必须被显式处理（桥或豁免）──
  it("client 每个 public async 方法：要么已桥、要么显式豁免（无静默漏网）", () => {
    const clientMethods = extractClientMethods(clientSrc);
    const bridged = new Set(Object.keys(BRIDGED));
    const exempt = new Set(Object.keys(EXEMPT));
    const leaked = clientMethods.filter((m) => !bridged.has(m) && !exempt.has(m));
    expect(leaked, `未桥未豁免（会成为静默缺口）: ${leaked.join(", ")}`).toEqual([]);
  });

  // ── 每桥都必须在 handler 与 preload 双侧真出现 ──
  it("每个 BRIDGED channel 在 ipc-handlers.ts 有 ipcMain.handle 注册", () => {
    const unhandled = Object.entries(BRIDGED)
      .filter(([, channelKey]) => !handlersSrc.includes(`IPC_CHANNELS.${channelKey}`))
      .map(([m, k]) => `${m}→${k}`);
    expect(unhandled, `handler 缺失: ${unhandled.join(", ")}`).toEqual([]);
  });

  it("每个 BRIDGED channel 在 preload/index.ts 有 ipcRenderer.invoke 暴露", () => {
    const unexposed = Object.entries(BRIDGED)
      .filter(([, channelKey]) => !preloadSrc.includes(`IPC_CHANNELS.${channelKey}`))
      .map(([m, k]) => `${m}→${k}`);
    expect(unexposed, `preload 门面未桥: ${unexposed.join(", ")}`).toEqual([]);
  });

  // ── 反向：IPC_CHANNELS 里每个 CORTEX_* 都必有 handler（防孤儿通道）──
  it("IPC_CHANNELS 里每个 CORTEX_* 常量都有对应 handler 注册（无孤儿通道）", () => {
    const cortexKeys = Object.keys(IPC_CHANNELS).filter((k) => k.startsWith("CORTEX_"));
    const orphans = cortexKeys.filter((k) => !handlersSrc.includes(`IPC_CHANNELS.${k}`));
    expect(orphans, `加了通道却没实现 handler: ${orphans.join(", ")}`).toEqual([]);
  });

  // ── 豁免纪律：每条豁免必附实质理由 ──
  it("EXEMPT 每条都写明原因（防空口豁免）", () => {
    const empty = Object.entries(EXEMPT).filter(([, r]) => !r || r.trim().length < 4).map(([k]) => k);
    expect(empty, `豁免未写原因: ${empty.join(", ")}`).toEqual([]);
  });

  // ── 形状稳定：确认 client 至少有 20 个 public async 方法（防重构意外裁剪）──
  it("client 公共方法总数 >= 20（本轮实测基线，防被静默削薄）", () => {
    expect(extractClientMethods(clientSrc).length).toBeGreaterThanOrEqual(20);
  });
});
