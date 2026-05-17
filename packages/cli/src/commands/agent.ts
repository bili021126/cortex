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
import { AgentType, AgentStatus, AGENT_TAGS, AGENT_TOOL_PERMISSIONS } from "@cortex/shared";

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
      // 确保引擎已初始化（lazy init）
      await bridge.ensureInitialized();
      const pool = bridge.agentPool;

      switch (subcommand) {
        case "list":
          return await handleAgentList(pool, options, context);
        case "inspect":
          return await handleAgentInspect(pool, args[1], options, context);
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
): Promise<CommandResult> {
  const p = safePool(pool);
  const statusFilter = options["status"] as string | undefined;
  const verbose = options["verbose"] || options["v"];

  const agentTypes = Object.values(AgentType);
  const rows: string[][] = [];
  let totalInstances = 0;
  let totalAwake = 0;

  for (const type of agentTypes) {
    const count = p.count(type);
    const statuses = p.getStatuses(type);
    const hasAwake = p.hasAwake(type);
    const tags = AGENT_TAGS[type as AgentType] ?? [];

    const displayStatus = statuses.length > 0 ? statuses[0] : (count > 0 ? "awake" : "-");

    // 过滤
    if (statusFilter && displayStatus !== statusFilter) continue;

    const statusStr = count > 0 ? String(displayStatus) : "-";
    const instanceStr = String(count);

    if (verbose) {
      const permissions = (AGENT_TOOL_PERMISSIONS[type as AgentType] ?? []).join(", ");
      rows.push([type, statusStr, instanceStr, tags.join(", "), permissions || "(无)"]);
    } else {
      rows.push([type, statusStr, instanceStr, tags.join(", ")]);
    }

    totalInstances += count;
    if (hasAwake) totalAwake++;
  }

  return {
    success: true,
    data: {
      agents: rows.map((r) => ({
        type: r[0],
        status: r[1],
        instances: parseInt(r[2], 10),
        tags: r[3],
        ...(verbose ? { permissions: r[4] } : {}),
      })),
      total: agentTypes.length,
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
): Promise<CommandResult> {
  if (!typeName) {
    return { success: false, error: "请指定 Agent 类型。用法: cortex agent inspect <type>", exitCode: 1 };
  }

  const p = safePool(pool);
  const agentType = typeName as AgentType;
  const count = p.count(agentType);
  const statuses = p.getStatuses(agentType);
  const tags = AGENT_TAGS[agentType as AgentType] ?? [];
  const permissions = AGENT_TOOL_PERMISSIONS[agentType as AgentType] ?? [];

  return {
    success: true,
    data: {
      type: agentType,
      instances: count,
      statuses,
      tags,
      permissions,
    },
    output: [
      `Agent: ${agentType}`,
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
  const agentType = typeName as AgentType;
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

  if (instanceId) {
    p.destroy(typeName as AgentType, instanceId);
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
