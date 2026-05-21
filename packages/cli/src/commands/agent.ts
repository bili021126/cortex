/**
 * commands/agent.ts — `cortex agent` Agent 管理命令
 *
 * 管理 Agent 类型的注册、实例的生命周期、查看运行时状态。
 * 对接 AgentPool API（通过引擎桥接器）。
 *
 * @see CLI 设计文档 §4.1
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import type { EngineBridge } from "../services/engine-bridge.js";
import { AgentType, AgentStatus, getAgentTags, getAgentToolPermissions, AGENT_CHINESE_ROLE, CHINESE_NAME_TO_TYPE } from "@cortex/shared";

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

export function createAgentHandler(bridge: EngineBridge): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      return {
        success: true,
        output: [
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
        ].join("\n"),
        exitCode: 0,
      };
    }

    const subcommand = args[0];

    try {
      // 优先走配置驱动模式（有 API key 时），回退轻量模式
      if (bridge.isBootstrapConfigured) {
        await bridge.ensureBootstrapped();
      } else {
        await bridge.ensureInitialized();
      }
      const pool = bridge.agentPool;

      switch (subcommand) {
        case "list":
          return await handleAgentList(pool, options, context, bridge);
        case "inspect":
          return await handleAgentInspect(pool, args[1], options, context, bridge);
        case "spawn":
          return await handleAgentSpawn(pool, args[1], options, context);
        case "destroy":
          return await handleAgentDestroy(pool, args[1], options, context);
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
  };
}

/**
 * 获取 AgentPool 的兼容接口。
 * AgentPool 是 engine 内部模块，通过 any 类型桥接。
 */
interface PoolLike {
  count(type: string): number;
  getStatuses(type: string): string[];
  hasAwake(type: string): boolean;
  spawn(type: string, instanceId: string): boolean;
  destroy(type: string, instanceId: string): void;
  register(config: any): void;
}

/** 安全地获取 pool 方法 */
function safePool(pool: any): PoolLike {
  return {
    count: (type: string) => pool?.count?.(type) ?? 0,
    getStatuses: (type: string) => pool?.getStatuses?.(type) ?? [],
    hasAwake: (type: string) => pool?.hasAwake?.(type) ?? false,
    spawn: (type: string, instanceId: string) => pool?.spawn?.(type, instanceId) ?? false,
    destroy: (type: string, instanceId: string) => pool?.destroy?.(type, instanceId),
    register: (config: any) => pool?.register?.(config),
  };
}

async function handleAgentList(
  pool: any,
  options: Record<string, unknown>,
  context: CommandContext,
  bridge: EngineBridge,
): Promise<CommandResult> {
  const p = safePool(pool);
  const statusFilter = options["status"] as string | undefined;
  const verbose = options["verbose"] || options["v"];

  const agentTypes = Object.values(AgentType);
  const rows: string[][] = [];
  let totalInstances = 0;
  let totalAwake = 0;

  // ── 常规 Agent（从 AgentPool 查询）──
  for (const type of agentTypes) {
    // strategist 不走 AgentPool，单独查询（见下方）
    if (type === AgentType.Strategist) continue;
    const count = p.count(type);
    const statuses = p.getStatuses(type);
    const hasAwake = p.hasAwake(type);
    const tags = getAgentTags()[type as AgentType] ?? [];

    const displayStatus = statuses.length > 0 ? statuses[0] : (count > 0 ? "awake" : "-");

    // 过滤
    if (statusFilter && displayStatus !== statusFilter) continue;

    const statusStr = count > 0 ? String(displayStatus) : "-";
    const instanceStr = String(count);
    const role = getChineseRole(type);

    if (verbose) {
      const permissions = (getAgentToolPermissions()[type as AgentType] ?? []).join(", ");
      rows.push([type, role, statusStr, instanceStr, tags.join(", "), permissions || "(无)"]);
    } else {
      rows.push([type, role, statusStr, instanceStr, tags.join(", ")]);
    }

    totalInstances += count;
    if (hasAwake) totalAwake++;
  }

  // ── Strategist Agent（从 bootstrapResult 查询，不注册 AgentPool）──
  const strategists = bridge.getStrategists();
  if (strategists && strategists.size > 0) {
    for (const [id, agent] of strategists) {
      const type = "strategist";
      const statusStr = agent.status === AgentStatus.Awake ? "awake" : String(agent.status);
      const tags = getAgentTags()[AgentType.Strategist] ?? [];

      if (statusFilter && statusStr !== statusFilter) continue;

      if (verbose) {
        const permissions = (getAgentToolPermissions()[AgentType.Strategist] ?? []).join(", ");
        const role = id === "zhongli" ? "契约守护者" : id === "shuangning" ? "方向监理" : id;
        const idTags = id === "zhongli" ? "strategy, contract" : id === "shuangning" ? "strategy, direction" : tags.join(", ");
        rows.push([`${type}:${id}`, role, statusStr, "1", idTags, permissions || "(无)"]);
      } else {
        const displayType = id === "zhongli" ? "钟离" : id === "shuangning" ? "霜凝" : id;
        const role = id === "zhongli" ? "契约守护者" : "方向监理";
        const idTags = id === "zhongli" ? "strategy, contract" : "strategy, direction";
        rows.push([displayType, role, statusStr, "1", idTags]);
      }

      totalInstances += 1;
      if (statusStr === "awake") totalAwake++;
    }
  }

  return {
    success: true,
    data: {
      agents: rows.map((r) => ({
        type: r[0],
        role: r[1],
        status: r[2],
        instances: parseInt(r[3], 10),
        tags: r[4],
        ...(verbose ? { permissions: r[5] } : {}),
      })),
      total: rows.length,
      awake: totalAwake,
      instances: totalInstances,
    },
    output: `Agent 列表: ${totalInstances} 实例, ${totalAwake} awake`,
    exitCode: 0,
  };
}

async function handleAgentInspect(
  pool: any,
  typeName: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
  bridge: EngineBridge,
): Promise<CommandResult> {
  if (!typeName) {
    return { success: false, error: "请指定 Agent 类型。用法: cortex agent inspect <type>", exitCode: 1 };
  }

  const agentType = resolveAgentType(typeName);
  if (!agentType) {
    return { success: false, error: `未知 Agent 类型或名称: "${typeName}"。可用英文字类型名或中文名（如 甘雨/阿贝多/刻晴...）`, exitCode: 1 };
  }

  // Strategist 特殊处理：按 ID 区分 钟离/霜凝
  let role: string;
  let tags: readonly string[];
  let count: number;
  let statuses: readonly string[];
  let permissions: readonly string[];

  if (agentType === AgentType.Strategist) {
    const strategists = bridge.getStrategists();
    const id = typeName === "钟离" || typeName === "zhongli" ? "zhongli" : "shuangning";
    const strategist = strategists?.get(id);

    if (strategist) {
      count = 1;
      statuses = [strategist.status === AgentStatus.Awake ? "awake" : String(strategist.status)];
    } else {
      count = 0;
      statuses = [];
    }

    role = id === "zhongli" ? "契约守护者" : "方向监理";
    tags = id === "zhongli" ? ["strategy", "contract"] : ["strategy", "direction"];
    permissions = getAgentToolPermissions()[AgentType.Strategist] ?? [];
  } else {
    const p = safePool(pool);
    count = p.count(agentType);
    statuses = p.getStatuses(agentType);
    tags = getAgentTags()[agentType as AgentType] ?? [];
    permissions = getAgentToolPermissions()[agentType as AgentType] ?? [];
    role = getChineseRole(agentType);
  }

  return {
    success: true,
    data: {
      type: agentType,
      role,
      instances: count,
      statuses,
      tags,
      permissions,
    },
    output: [
      `Agent: ${agentType}（${role}）`,
      `实例数: ${count}`,
      `状态: ${statuses.join(", ") || "未注册"}`,
      `标签: ${tags.join(", ")}`,
      `工具权限: ${permissions.join(", ")}`,
    ].join("\n"),
    exitCode: 0,
  };
}

async function handleAgentSpawn(
  pool: any,
  typeName: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  if (!typeName) {
    return { success: false, error: "请指定 Agent 类型。用法: cortex agent spawn <type>", exitCode: 1 };
  }

  const p = safePool(pool);
  const count = parseInt(String(options["count"] ?? "1"), 10);
  const agentType = resolveAgentType(typeName);
  if (!agentType) {
    return { success: false, error: `未知 Agent 类型或名称: "${typeName}"`, exitCode: 1 };
  }
  let spawned = 0;

  for (let i = 0; i < count; i++) {
    const instanceId = `${typeName}-${Date.now()}-${i}`;
    const ok = p.spawn(agentType, instanceId);
    if (ok) spawned++;
  }

  return {
    success: true,
    output: `✓ 已启动 ${spawned}/${count} 个 ${typeName} 实例`,
    data: { agentType, requested: count, spawned },
    exitCode: 0,
  };
}

async function handleAgentDestroy(
  pool: any,
  typeName: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
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
    return {
      success: true,
      output: `✓ 已回收实例 ${instanceId}`,
      exitCode: 0,
    };
  }

  return {
    success: true,
    output: `⚠️ 请使用 --id <instanceId> 指定要回收的实例，或直接指定类型`,
    exitCode: 0,
  };
}
