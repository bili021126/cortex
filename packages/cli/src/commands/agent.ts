/**
 * commands/agent.ts — `cortex agent` Agent 管理命令
 *
 * 管理 Agent 类型的注册、实例的生命周期、查看运行时状态。
 * 对接 AgentPool API（通过引擎桥接器）。
 *
 * @see CLI 设计文档 §4.1
 */

import type { CommandHandler, CommandResult } from "../types.js";
import { isHelpRequest } from "../utils.js";
import { AGENT_CHINESE_ROLE, AgentStatus, AgentType, CHINESE_NAME_TO_TYPE, getAgentTags, getAgentToolPermissions, type AgentConfig, type ICortexApi } from "@cortex/shared";
import type { StrategistAgent } from "@cortex/engine";
import type { IAgentPool } from "@cortex/scheduler";
import * as fs from "node:fs";
import * as path from "node:path";

/** Agent 实例持久化文件（跨进程共享 spawn/list 状态） */
const INSTANCES_FILE = path.join(process.cwd(), ".cortex", "agent-instances.json");

interface PersistedInstances {
  [agentType: string]: number;
}

function readPersistedInstances(): PersistedInstances {
  try {
    if (fs.existsSync(INSTANCES_FILE)) {
      return JSON.parse(fs.readFileSync(INSTANCES_FILE, "utf-8"));
    }
  } catch { /* 文件损坏则忽略 */ }
  return {};
}

function writePersistedInstances(instances: PersistedInstances): void {
  const dir = path.dirname(INSTANCES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INSTANCES_FILE, JSON.stringify(instances, null, 2), "utf-8");
}

/**
 * 解析输入——支持英文 type 名和中文角色名。
 * 返回 AgentType 或 undefined（无效输入）。
 */
function resolveAgentType(input: string): AgentType | undefined {
  // 1. 直接匹配英文 type 名
  const byType = Object.values(AgentType).find((t) => t === input);
  if (byType) return byType;
  // 2. 中文名 → AgentType
  return CHINESE_NAME_TO_TYPE[input];
}

/** 获取中文角色名（AgentType → 中文名，strategist 返回 "钟离/霜凝"） */
function getChineseRole(type: AgentType): string {
  return AGENT_CHINESE_ROLE[type] ?? type;
}

const HELP_TEXT = [
  "用法: cortex agent <子命令> [选项]",
  "",
  "子命令:",
  "  list                 列出所有已注册 Agent 类型",
  "  inspect <type>       查看 Agent 详情",
  "  spawn <type>         手动启动 Agent 实例",
  "  destroy <type>       回收 Agent 实例",
  "",
  "选项:",
  "  --status <s>         按状态过滤 (awake/active/draining/destroyed)",
  "  --format <fmt>       输出格式 (text/json/color)",
  "  --count <n>          启动实例数（默认 1）",
  "  --force, -f          强制销毁",
  "  --verbose, -v        显示详细信息",
].join("\n");

export function createAgentHandler(bridge: ICortexApi): CommandHandler {
  return async (args, options, _context): Promise<CommandResult> => {
    if (isHelpRequest(args)) {
      return { success: true, output: HELP_TEXT, exitCode: 0 };
    }
    return await dispatchAgent(bridge, args, options);
  };
}

async function dispatchAgent(
  bridge: ICortexApi,
  args: string[],
  options: Record<string, unknown>,
): Promise<CommandResult> {
  const subcommand = args[0];
  try {
    const needsBootstrap = subcommand === "spawn" || subcommand === "destroy";
    if (needsBootstrap && bridge.bootstrapped === false) {
      try { await bridge.ensureBootstrapped(); } catch { /* fall through */ }
    }
    await bridge.ensureReady();
    const pool = bridge.getAgentPool() as IAgentPool;

    switch (subcommand) {
      case "list": return handleAgentList(pool, options, bridge);
      case "inspect": return handleAgentInspect(pool, args[1], bridge);
      case "spawn": return handleAgentSpawn(pool, args[1], options);
      case "destroy": return handleAgentDestroy(pool, args[1], options);
      default:
        return {
          success: false,
          error: `未知子命令: "${subcommand}"。可用子命令: list, inspect, spawn, destroy`,
          exitCode: 1,
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Agent 操作失败: ${msg}`, exitCode: 2 };
  }
}

/**
 * 获取 AgentPool 的兼容接口。
 * AgentPool 是 engine 内部模块，通过安全类型桥接。
 */
interface PoolLike {
  count(type: AgentType): number;
  getStatuses(type: AgentType): AgentStatus[];
  hasAwake(type: AgentType): boolean;
  spawn(type: AgentType, instanceId: string): boolean;
  destroy(type: AgentType, instanceId: string): void;
  register(config: AgentConfig): void;
}

/** 安全地获取 pool 方法 */
function safePool(pool: IAgentPool | null | undefined): PoolLike {
  return {
    count: (type: AgentType) => pool?.count?.(type) ?? 0,
    getStatuses: (type: AgentType) => pool?.getStatuses?.(type) ?? [],
    hasAwake: (type: AgentType) => pool?.hasAwake?.(type) ?? false,
    spawn: (type: AgentType, instanceId: string) => pool?.spawn?.(type, instanceId) ?? false,
    destroy: (type: AgentType, instanceId: string) => pool?.destroy?.(type, instanceId),
    register: (config: AgentConfig) => pool?.register?.(config),
  };
}

/** _buildAgentRows 的聚合参数对象 */
interface AgentRowsCtx {
  agentTypes: readonly AgentType[];
  p: PoolLike;
  persisted: PersistedInstances;
  statusFilter: string | undefined;
  verbose: unknown;
  bridge: ICortexApi;
  tally: (instances: number, awake: boolean) => void;
  rows: string[][];
}

/** 将单个 Strategist 实例追加为行 */
function _appendStrategistRow(ctx: AgentRowsCtx, id: string, agent: StrategistAgent): void {
  const statusStr = agent.status === AgentStatus.Awake ? "awake" : String(agent.status);
  const tags = getAgentTags()[AgentType.Strategist] ?? [];

  if (ctx.statusFilter && statusStr !== ctx.statusFilter) return;

  if (ctx.verbose) {
    const permissions = (getAgentToolPermissions()[AgentType.Strategist] ?? []).join(", ");
    const role = id === "zhongli" ? "契约守护者" : id === "shuangning" ? "方向监理" : id;
    const idTags = id === "zhongli" ? "strategy, contract" : id === "shuangning" ? "strategy, direction" : tags.join(", ");
    ctx.rows.push([`strategist:${id}`, role, statusStr, "1", idTags, permissions || "(无)"]);
  } else {
    const displayType = id === "zhongli" ? "钟离" : id === "shuangning" ? "霜凝" : id;
    const role = id === "zhongli" ? "契约守护者" : "方向监理";
    const idTags = id === "zhongli" ? "strategy, contract" : "strategy, direction";
    ctx.rows.push([displayType, role, statusStr, "1", idTags]);
  }

  ctx.tally(1, statusStr === "awake");
}

function _buildAgentRows(ctx: AgentRowsCtx): string[][] {
  const { agentTypes, p, persisted, statusFilter, verbose } = ctx;

  for (const type of agentTypes) {
    if (type === AgentType.Strategist) continue;
    const memCount = p.count(type);
    const persistedCount = persisted[type] ?? 0;
    const count = Math.max(memCount, persistedCount);
    const statuses = p.getStatuses(type);
    const hasAwake = p.hasAwake(type) || persistedCount > 0;
    const tags = getAgentTags()[type as AgentType] ?? [];
    const displayStatus = statuses.length > 0 ? statuses[0] : (count > 0 ? "awake" : "-");

    if (statusFilter && displayStatus !== statusFilter) continue;

    const statusStr = count > 0 ? String(displayStatus) : "-";
    const instanceStr = String(count);
    const role = getChineseRole(type);

    if (verbose) {
      const permissions = (getAgentToolPermissions()[type as AgentType] ?? []).join(", ");
      ctx.rows.push([type, role, statusStr, instanceStr, tags.join(", "), permissions || "(无)"]);
    } else {
      ctx.rows.push([type, role, statusStr, instanceStr, tags.join(", ")]);
    }

    ctx.tally(count, hasAwake);
  }

  const strategists = ctx.bridge.getStrategists() as Map<string, StrategistAgent> | undefined;
  if (strategists && strategists.size > 0) {
    for (const [id, agent] of strategists) 
      _appendStrategistRow(ctx, id, agent);
  }

  return ctx.rows;
}

function handleAgentList(
  pool: IAgentPool,
  options: Record<string, unknown>,
  bridge: ICortexApi,
): CommandResult {
  const p = safePool(pool);
  const statusFilter = options["status"] as string | undefined;
  const verbose = options["verbose"] || options["v"];
  const persisted = readPersistedInstances();
  const agentTypes = Object.values(AgentType);

  let totalInstances = 0;
  let totalAwake = 0;
  const rows = _buildAgentRows({
    agentTypes, p, persisted, statusFilter, verbose, bridge, rows: [],
    tally: (inc: number, awake: boolean) => { totalInstances += inc; if (awake) totalAwake++; },
  });

  return {
    success: true,
    data: {
      agents: rows.map((r) => ({
        type: r[0], role: r[1], status: r[2], instances: parseInt(r[3], 10), tags: r[4],
        ...(verbose ? { permissions: r[5] } : {}),
      })),
      total: rows.length, awake: totalAwake, instances: totalInstances,
    },
    output: `Agent 列表: ${totalInstances} 实例, ${totalAwake} awake`,
    exitCode: 0,
  };
}

/** handleAgentInspect 返回值 */
interface AgentInspectInfo {
  agentType: AgentType;
  role: string;
  count: number;
  statuses: readonly string[];
  tags: readonly string[];
  permissions: readonly string[];
}

/** 解析 Strategist 的 inspect 信息 */
function _resolveStrategistInspect(bridge: ICortexApi, typeName: string): AgentInspectInfo {
  const strategists = bridge.getStrategists() as Map<string, StrategistAgent> | undefined;
  const id = typeName === "钟离" || typeName === "zhongli" ? "zhongli" : "shuangning";
  const strategist = strategists?.get(id);

  return {
    agentType: AgentType.Strategist,
    role: id === "zhongli" ? "契约守护者" : "方向监理",
    count: strategist ? 1 : 0,
    statuses: strategist ? [strategist.status === AgentStatus.Awake ? "awake" : String(strategist.status)] : [],
    tags: id === "zhongli" ? ["strategy", "contract"] : ["strategy", "direction"],
    permissions: getAgentToolPermissions()[AgentType.Strategist] ?? [],
  };
}

/** 构建常规 Agent 的 inspect 信息——非 Strategist 分支 */
function _inspectRegularAgent(pool: IAgentPool, agentType: AgentType): AgentInspectInfo {
  const p = safePool(pool);
  return {
    agentType,
    role: getChineseRole(agentType),
    count: p.count(agentType),
    statuses: p.getStatuses(agentType),
    tags: getAgentTags()[agentType as AgentType] ?? [],
    permissions: getAgentToolPermissions()[agentType as AgentType] ?? [],
  };
}

function handleAgentInspect(
  pool: IAgentPool,
  typeName: string | undefined,
  bridge: ICortexApi,
): CommandResult {
  if (!typeName) {
    return { success: false, error: "请指定 Agent 类型。用法: cortex agent inspect <type>", exitCode: 1 };
  }

  const agentType = resolveAgentType(typeName);
  if (!agentType) {
    return { success: false, error: `未知 Agent 类型或名称: "${typeName}"。可用英文字类型名或中文名（如 甘雨/阿贝多/刻晴...）`, exitCode: 1 };
  }

  const info = agentType === AgentType.Strategist
    ? _resolveStrategistInspect(bridge, typeName)
    : _inspectRegularAgent(pool, agentType);

  return {
    success: true,
    data: { type: info.agentType, role: info.role, instances: info.count, statuses: info.statuses, tags: info.tags, permissions: info.permissions },
    output: [
      `Agent: ${info.agentType}（${info.role}）`,
      `实例数: ${info.count}`,
      `状态: ${info.statuses.join(", ") || "未注册"}`,
      `标签: ${info.tags.join(", ")}`,
      `工具权限: ${info.permissions.join(", ")}`,
    ].join("\n"),
    exitCode: 0,
  };
}

/** Agent 生成配置 */
interface SpawnConfig {
  typeName: string;
  count: number;
}

/** 批量生成 Agent 实例，返回成功生成数 */
function _spawnInstances(p: PoolLike, agentType: AgentType, config: SpawnConfig): number {
  const { typeName, count } = config;
  let spawned = 0;
  for (let i = 0; i < count; i++) {
    const instanceId = `${typeName}-${Date.now()}-${i}`;
    if (p.spawn(agentType, instanceId)) spawned++;
  }
  return spawned;
}

function handleAgentSpawn(
  pool: IAgentPool,
  typeName: string | undefined,
  options: Record<string, unknown>,
): CommandResult {
  if (!typeName) {
    return { success: false, error: "请指定 Agent 类型。用法: cortex agent spawn <type>", exitCode: 1 };
  }

  const p = safePool(pool);
  const count = parseInt(String(options["count"] ?? "1"), 10);
  const agentType = resolveAgentType(typeName);
  if (!agentType) {
    return { success: false, error: `未知 Agent 类型或名称: "${typeName}"`, exitCode: 1 };
  }

  const spawned = _spawnInstances(p, agentType, { typeName, count });
  if (spawned === 0) {
    return { success: false, error: `所有 ${count} 个 spawn 请求均失败：Agent 类型未注册或已达实例上限`, exitCode: 1 };
  }

  const persisted = readPersistedInstances();
  persisted[agentType] = (persisted[agentType] ?? 0) + spawned;
  writePersistedInstances(persisted);

  return {
    success: true,
    output: `✓ 已启动 ${spawned}/${count} 个 ${typeName} 实例`,
    data: { agentType, requested: count, spawned, failed: count - spawned },
    exitCode: 0,
  };
}

function handleAgentDestroy(
  pool: IAgentPool,
  typeName: string | undefined,
  options: Record<string, unknown>,
): CommandResult {
  if (!typeName) {
    return { success: false, error: "请指定 Agent 类型。用法: cortex agent destroy <type>", exitCode: 1 };
  }

  const p = safePool(pool);
  const instanceId = options["id"] as string | undefined;
  const agentType = resolveAgentType(typeName);
  if (!agentType) {
    return { success: false, error: `未知 Agent 类型或名称: "${typeName}"`, exitCode: 1 };
  }

  if (instanceId) {
    p.destroy(agentType, instanceId);
    const persisted = readPersistedInstances();
    if (persisted[agentType] && persisted[agentType] > 0) {
      persisted[agentType]--;
      if (persisted[agentType] === 0) delete persisted[agentType];
      writePersistedInstances(persisted);
    }
    return { success: true, output: `✓ 已回收实例 ${instanceId}`, exitCode: 0 };
  }

  return {
    success: false,
    error: `请使用 --id <instanceId> 指定要回收的实例 ID`,
    exitCode: 1,
  };
}
