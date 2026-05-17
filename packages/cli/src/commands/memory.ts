/**
 * commands/memory.ts — `cortex memory` 记忆系统命令
 *
 * 直接与 MemoryStore 交互——读写记忆、建立关联、管理生命周期。
 *
 * @see CLI 设计文档 §4.5
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import type { EngineBridge } from "../services/engine-bridge.js";
import { MemoryType, MemoryState, LinkType, AgentType } from "@cortex/shared";

export function createMemoryHandler(bridge: EngineBridge): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      return {
        success: true,
        output: [
          "用法: cortex memory <子命令> [选项]",
          "",
          "子命令:",
          "  write <key> <val>    写入记忆条目",
          "  read <key>           读取记忆条目",
          "  search <query>       搜索记忆",
          "  link <src> <tgt>     建立记忆关联",
          "  archive <id>         归档记忆",
          "  freeze <id>          冻结记忆",
          "  obliterate <id>      湮灭记忆",
          "  flush                强制刷新持久化",
          "  stats                记忆系统统计",
          "",
          "选项:",
          "  --type <t>           记忆类型 (episodic/knowledge/conceptual)",
          "  --agent <type>       关联的 Agent 类型",
          "  --weight <n>         权重（1-10，默认 5）",
          "  --mode <m>           查询模式 (hca/csa)",
          "  --limit <n>          最大返回数",
          "  --detail, -d         详细统计",
        ].join("\n"),
        exitCode: 0,
      };
    }

    const subcommand = args[0];

    try {
      const memory = await bridge.getMemoryStore();

      switch (subcommand) {
        case "write":
          return await handleMemoryWrite(memory, args[1], args.slice(2).join(" "), options, context);
        case "read":
          return await handleMemoryRead(memory, args[1], options, context);
        case "search":
          return await handleMemorySearch(memory, args.slice(1).join(" "), options, context);
        case "link":
          return await handleMemoryLink(memory, args[1], args[2], options, context);
        case "archive":
          return await handleMemoryArchive(memory, args[1], context);
        case "freeze":
          return await handleMemoryFreeze(memory, args[1], context);
        case "obliterate":
          return await handleMemoryObliterate(memory, args[1], context);
        case "flush":
          return await handleMemoryFlush(memory, context);
        case "stats":
          return await handleMemoryStats(memory, options, context);
        default:
          return {
            success: false,
            error: `未知子命令: "${subcommand}"。可用子命令: write, read, search, link, archive, freeze, obliterate, flush, stats`,
            exitCode: 1,
          };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `记忆操作失败: ${msg}`, exitCode: 2 };
    }
  };
}

async function handleMemoryWrite(
  memory: any,
  key: string | undefined,
  value: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  if (!key || !value) {
    return { success: false, error: "请指定 key 和 value。用法: cortex memory write <key> <value>", exitCode: 1 };
  }

  const memoryType = (options["type"] as string)?.toUpperCase() ?? "EPISODIC";
  const agentType = (options["agent"] as string) ?? "butler";
  const weight = parseInt(String(options["weight"] ?? "5"), 10);

  const id = memory.write({
    memoryType: MemoryType[memoryType as keyof typeof MemoryType] ?? MemoryType.Episodic,
    content: { key, value },
    summary: key,
    agentType: agentType as AgentType,
    creatorId: "cli",
    weight,
  });

  return {
    success: true,
    output: `✓ 记忆已写入: ${id}`,
    data: { id, key, memoryType },
    exitCode: 0,
  };
}

async function handleMemoryRead(
  memory: any,
  key: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  if (!key) {
    return { success: false, error: "请指定 key。用法: cortex memory read <key>", exitCode: 1 };
  }

  const mode = (options["mode"] as string) ?? "csa";
  const entries = memory.read({ keywords: [key], queryMode: mode, limit: 5 });

  return {
    success: true,
    data: entries,
    output: entries.length > 0
      ? entries.map((e: any) => `[${e.id}] ${e.summary} (weight: ${e.weight})`).join("\n")
      : `未找到匹配 "${key}" 的记忆`,
    exitCode: 0,
  };
}

async function handleMemorySearch(
  memory: any,
  query: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  if (!query) {
    return { success: false, error: "请指定搜索关键词。用法: cortex memory search <query>", exitCode: 1 };
  }

  const memoryType = options["type"] as string | undefined;
  const agentType = options["agent"] as string | undefined;
  const limit = parseInt(String(options["limit"] ?? "10"), 10);
  const mode = (options["mode"] as string) ?? "hca";

  const searchQuery: any = {
    keywords: query.split(/\s+/),
    queryMode: mode,
    limit,
  };

  if (memoryType) {
    searchQuery.memoryTypes = [MemoryType[memoryType.toUpperCase() as keyof typeof MemoryType]].filter(Boolean);
  }
  if (agentType) {
    searchQuery.agentTypes = [agentType as AgentType];
  }

  const entries = memory.read(searchQuery);

  return {
    success: true,
    data: entries,
    output: entries.length > 0
      ? entries.map((e: any) => `[${e.id}] ${e.summary} (${e.memoryType}, w:${e.weight})`).join("\n")
      : `未找到匹配 "${query}" 的记忆`,
    exitCode: 0,
  };
}

async function handleMemoryLink(
  memory: any,
  srcId: string | undefined,
  tgtId: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  if (!srcId || !tgtId) {
    return { success: false, error: "请指定源和目标 ID。用法: cortex memory link <src> <tgt>", exitCode: 1 };
  }

  const linkType = (options["type"] as string)?.toUpperCase() ?? "DERIVED_FROM";
  const link = memory.link(srcId, tgtId, LinkType[linkType as keyof typeof LinkType] ?? LinkType.DerivedFrom);

  if (!link) {
    return { success: false, error: `建立关联失败: 源或目标不存在`, exitCode: 1 };
  }

  return {
    success: true,
    output: `✓ 关联已建立: ${srcId} → ${tgtId} (${linkType})`,
    data: link,
    exitCode: 0,
  };
}

async function handleMemoryArchive(memory: any, id: string | undefined, context: CommandContext): Promise<CommandResult> {
  if (!id) return { success: false, error: "请指定记忆 ID。用法: cortex memory archive <id>", exitCode: 1 };
  const ok = memory.archive(id);
  return { success: ok, output: ok ? `✓ 记忆已归档: ${id}` : `归档失败: ${id}`, exitCode: ok ? 0 : 1 };
}

async function handleMemoryFreeze(memory: any, id: string | undefined, context: CommandContext): Promise<CommandResult> {
  if (!id) return { success: false, error: "请指定记忆 ID。用法: cortex memory freeze <id>", exitCode: 1 };
  const ok = memory.freeze(id);
  return { success: ok, output: ok ? `✓ 记忆已冻结: ${id}` : `冻结失败: ${id}`, exitCode: ok ? 0 : 1 };
}

async function handleMemoryObliterate(memory: any, id: string | undefined, context: CommandContext): Promise<CommandResult> {
  if (!id) return { success: false, error: "请指定记忆 ID。用法: cortex memory obliterate <id>", exitCode: 1 };
  const ok = memory.obliterate(id);
  return { success: ok, output: ok ? `✓ 记忆已湮灭: ${id}` : `湮灭失败: ${id}`, exitCode: ok ? 0 : 1 };
}

async function handleMemoryFlush(memory: any, context: CommandContext): Promise<CommandResult> {
  await memory.flush();
  return { success: true, output: "✓ 持久化已刷新", exitCode: 0 };
}

async function handleMemoryStats(
  memory: any,
  options: Record<string, unknown>,
  context: CommandContext,
): Promise<CommandResult> {
  const detail = options["detail"] || options["d"];
  const entries = memory.read({ limit: 0 }); // 获取全部

  const byType: Record<string, number> = {};
  const byState: Record<string, number> = {};
  let totalWeight = 0;

  for (const e of entries) {
    byType[e.memoryType] = (byType[e.memoryType] ?? 0) + 1;
    byState[e.state] = (byState[e.state] ?? 0) + 1;
    totalWeight += e.weight;
  }

  const stats: any = {
    total: memory.size,
    byType,
    byState,
    avgWeight: entries.length > 0 ? +(totalWeight / entries.length).toFixed(2) : 0,
    persisted: memory.isPersisted,
  };

  return {
    success: true,
    data: stats,
    output: [
      `记忆系统统计:`,
      `  总数: ${stats.total}`,
      `  持久化: ${stats.persisted ? "是" : "否"}`,
      ...Object.entries(byType).map(([k, v]) => `  类型 ${k}: ${v}`),
      ...(detail ? Object.entries(byState).map(([k, v]) => `  状态 ${k}: ${v}`) : []),
      `  平均权重: ${stats.avgWeight}`,
    ].join("\n"),
    exitCode: 0,
  };
}
