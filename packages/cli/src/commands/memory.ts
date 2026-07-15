/**
 * commands/memory.ts — `cortex memory` 记忆系统命令
 *
 * 直接与 MemoryStore 交互——读写记忆、建立关联、管理生命周期。
 *
 * @see CLI 设计文档 §4.5
 */

import type { CommandHandler, CommandResult } from "../types.js";
import { isHelpRequest } from "../utils.js";
import { LinkType, type AgentType, type ICortexApi, type IMemoryStore, type MemoryEntry, type MemoryQuery } from "@cortex/shared";

/** 记忆操作键值参数聚合——消除 write/search 的多参数传递 */
interface MemoryKeyValArgs {
  rawKey: string | undefined;
  rawValue: string | undefined;
  options: Record<string, unknown>;
}

/** 记忆关联参数聚合 */
interface MemoryLinkArgs {
  src: string | undefined;
  tgt: string | undefined;
  options: Record<string, unknown>;
}

const MEMORY_HELP = [
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
].join("\n");

export function createMemoryHandler(bridge: ICortexApi): CommandHandler {
  const handler: CommandHandler = async (args, options, _context): Promise<CommandResult> => {
    if (isHelpRequest(args)) {
      return { success: true, output: MEMORY_HELP, exitCode: 0 };
    }

    const subcommand = args[0];
    try {
      const memory = await bridge.getMemoryStore();
      switch (subcommand) {
        case "write":      return await handleMemoryWrite(memory, { rawKey: args[1], rawValue: args.slice(2).join(" "), options });
        case "read":       return await handleMemoryRead(memory, args[1], options);
        case "search":     return await handleMemorySearch(memory, args.slice(1).join(" "), options);
        case "link":       return handleMemoryLink(memory, { src: args[1], tgt: args[2], options });
        case "archive":    return handleMemoryArchive(memory, args[1]);
        case "freeze":     return handleMemoryFreeze(memory, args[1]);
        case "obliterate": return handleMemoryObliterate(memory, args[1]);
        case "flush":      return await handleMemoryFlush(memory);
        case "stats":      return await handleMemoryStats(memory, options);
        default:
          return { success: false, error: `未知子命令: "${subcommand}"。可用子命令: write, read, search, link, archive, freeze, obliterate, flush, stats`, exitCode: 1 };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `记忆操作失败: ${msg}`, exitCode: 2 };
    }
  };
  return handler;
}

async function handleMemoryWrite(
  memory: IMemoryStore,
  args: MemoryKeyValArgs,
): Promise<CommandResult> {
  const { rawKey, rawValue, options } = args;
  if (!rawKey || !rawValue) {
    return { success: false, error: "请指定 key 和 value。用法: cortex memory write <key> <value>", exitCode: 1 };
  }

  const memoryType = (options["type"] as string)?.toUpperCase() ?? "EPISODIC";
  const agentType = (options["agent"] as string) ?? "butler";
  const weight = parseInt(String(options["weight"] ?? "5"), 10);

  const id = await memory.write({
    kind: "TaskLog",
    content_blob: { key: rawKey, value: rawValue },
    summary: rawKey,
    semantic_gist: rawKey,
    source: { agentType: agentType as AgentType, taskId: "" },
    weight,
    content_hash: "",
  });

  return {
    success: true,
    output: `✓ 记忆已写入: ${id}`,
    data: { id, key: rawKey, memoryType },
    exitCode: 0,
  };
}

async function handleMemoryRead(
  memory: IMemoryStore,
  key: string | undefined,
  options: Record<string, unknown>,
): Promise<CommandResult> {
  if (!key) {
    return { success: false, error: "请指定 key。用法: cortex memory read <key>", exitCode: 1 };
  }

  const mode = ((options["mode"] as string)?.toUpperCase() ?? "CSA") as "HCA" | "CSA" | undefined;
  const entries = await memory.read({ keywords: [key], limit: 5 }, mode);

  return {
    success: true,
    data: entries,
    output: entries.length > 0
      ? entries.map((e: MemoryEntry) => `[${e.id}] ${e.summary} (weight: ${e.weight})`).join("\n")
      : `未找到匹配 "${key}" 的记忆`,
    exitCode: 0,
  };
}

/** 从 options 构建 MemoryQuery 搜索条件 */
function _buildSearchQuery(query: string, options: Record<string, unknown>): MemoryQuery {
  const limit = parseInt(String(options["limit"] ?? "10"), 10);
  const searchQuery: MemoryQuery = { keywords: query.split(/\s+/), limit };

  const memoryType = options["type"] as string | undefined;
  if (memoryType) {
    searchQuery.kind = memoryType.toUpperCase() === "KNOWLEDGE" ? "Insight" : "TaskLog";
  }
  const agentType = options["agent"] as string | undefined;
  if (agentType) {
    searchQuery.agentTypes = [agentType as AgentType];
  }
  return searchQuery;
}

async function handleMemorySearch(
  memory: IMemoryStore,
  query: string | undefined,
  options: Record<string, unknown>,
): Promise<CommandResult> {
  if (!query) {
    return { success: false, error: "请指定搜索关键词。用法: cortex memory search <query>", exitCode: 1 };
  }

  const mode = ((options["mode"] as string)?.toUpperCase() ?? "HCA") as "HCA" | "CSA" | undefined;
  const searchQuery = _buildSearchQuery(query, options);
  const entries = await memory.read(searchQuery, mode);

  return {
    success: true,
    data: entries,
    output: entries.length > 0
      ? entries.map((e: MemoryEntry) => `[${e.id}] ${e.summary} (${e.kind}, w:${e.weight})`).join("\n")
      : `未找到匹配 "${query}" 的记忆`,
    exitCode: 0,
  };
}

function handleMemoryLink(
  memory: IMemoryStore,
  args: MemoryLinkArgs,
): CommandResult {
  const { src, tgt, options } = args;
  if (!src || !tgt) {
    return { success: false, error: "请指定源和目标 ID。用法: cortex memory link <src> <tgt>", exitCode: 1 };
  }

  const linkType = (options["type"] as string)?.toUpperCase() ?? "DERIVED_FROM";
  const link = memory.link(src, tgt, LinkType[linkType as keyof typeof LinkType] ?? LinkType.DerivedFrom);

  if (!link) {
    return { success: false, error: `建立关联失败: 源或目标不存在`, exitCode: 1 };
  }

  return {
    success: true,
    output: `✓ 关联已建立: ${src} → ${tgt} (${linkType})`,
    data: link,
    exitCode: 0,
  };
}

function handleMemoryArchive(memory: IMemoryStore, id: string | undefined): CommandResult {
  if (!id) return { success: false, error: "请指定记忆 ID。用法: cortex memory archive <id>", exitCode: 1 };
  const ok = memory.archive(id);
  return { success: ok, output: ok ? `✓ 记忆已归档: ${id}` : `归档失败: ${id}`, exitCode: ok ? 0 : 1 };
}

function handleMemoryFreeze(memory: IMemoryStore, id: string | undefined): CommandResult {
  if (!id) return { success: false, error: "请指定记忆 ID。用法: cortex memory freeze <id>", exitCode: 1 };
  const ok = memory.freeze(id);
  return { success: ok, output: ok ? `✓ 记忆已冻结: ${id}` : `冻结失败: ${id}`, exitCode: ok ? 0 : 1 };
}

function handleMemoryObliterate(memory: IMemoryStore, id: string | undefined): CommandResult {
  if (!id) return { success: false, error: "请指定记忆 ID。用法: cortex memory obliterate <id>", exitCode: 1 };
  const ok = memory.obliterate(id);
  return { success: ok, output: ok ? `✓ 记忆已湮灭: ${id}` : `湮灭失败: ${id}`, exitCode: ok ? 0 : 1 };
}

async function handleMemoryFlush(memory: IMemoryStore): Promise<CommandResult> {
  await memory.flush();
  return { success: true, output: "✓ 持久化已刷新", exitCode: 0 };
}

/** 聚合记忆条目统计——按类型、状态分组并计算平均权重 */
function _aggregateStats(entries: MemoryEntry[], memorySize: number, isPersisted: boolean) {
  const byType: Record<string, number> = {};
  const byState: Record<string, number> = {};
  let totalWeight = 0;

  for (const e of entries) {
    byType[e.kind] = (byType[e.kind] ?? 0) + 1;
    byState[e.semantic_state] = (byState[e.semantic_state] ?? 0) + 1;
    totalWeight += e.weight;
  }

  return {
    total: memorySize,
    byType,
    byState,
    avgWeight: entries.length > 0 ? +(totalWeight / entries.length).toFixed(2) : 0,
    persisted: isPersisted,
  };
}

async function handleMemoryStats(
  memory: IMemoryStore,
  options: Record<string, unknown>,
): Promise<CommandResult> {
  const detail = options["detail"] || options["d"];
  const entries = await memory.read({ limit: 0 });
  const stats = _aggregateStats(entries, memory.size, memory.isPersisted);

  return {
    success: true,
    data: stats,
    output: [
      `记忆系统统计:`,
      `  总数: ${stats.total}`,
      `  持久化: ${stats.persisted ? "是" : "否"}`,
      ...Object.entries(stats.byType).map(([k, v]) => `  类型 ${k}: ${v}`),
      ...(detail ? Object.entries(stats.byState).map(([k, v]) => `  状态 ${k}: ${v}`) : []),
      `  平均权重: ${stats.avgWeight}`,
    ].join("\n"),
    exitCode: 0,
  };
}
