/**
 * commands/skill.ts — `cortex skill` 技能注册表命令
 *
 * 管理可执行技能的生命周期：注册、搜索、执行、安装、统计。
 * 基于 @cortex/engine 的 DefaultSkillRegistry + 内置技能。
 *
 * @moved-from projects/solo-flight/src/cli/
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import {
  DefaultSkillRegistry,
  BaseSkill,
  EchoSkill,
  CalculatorSkill,
  RegistryInfoSkill,
  SkillCategory,
  createSkillId,
  createSkillVersion,
} from "@cortex/engine";
import type { SkillMeta, SkillInput } from "@cortex/engine";

// ─── 懒加载单例 ──────────────────────────────────────

let _registryCache: DefaultSkillRegistry | null = null;

async function getRegistry(): Promise<DefaultSkillRegistry> {
  if (_registryCache) return _registryCache;

  const registry = new DefaultSkillRegistry({
    defaultTimeout: 30_000,
    defaultMaxRetries: 0,
  });

  // 注册内置技能
  const echo = new EchoSkill();
  const calc = new CalculatorSkill();
  const info = new RegistryInfoSkill();

  await registry.register(echo, { lazy: true });
  await registry.register(calc, { lazy: true });
  await registry.register(info, { lazy: true });

  // 注入注册表引用给 registry-info 技能
  info.setRegistry(registry.registry);

  await registry.start();

  _registryCache = registry;
  return registry;
}

// ─── 命令入口 ────────────────────────────────────────

export function createSkillHandler(): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      return { success: true, output: HELP_TEXT, exitCode: 0 };
    }

    const subcommand = args[0];
    const subArgs = args.slice(1);

    try {
      const registry = await getRegistry();

      switch (subcommand) {
        case "list":
          return await handleList(registry, options, context);
        case "search":
          return await handleSearch(registry, subArgs, options, context);
        case "info":
          return await handleInfo(registry, subArgs, context);
        case "register":
          return await handleRegister(registry, subArgs, options, context);
        case "unregister":
          return await handleUnregister(registry, subArgs, options, context);
        case "execute":
          return await handleExecute(registry, subArgs, options, context);
        case "stats":
          return await handleStats(registry, options, context);
        default:
          return {
            success: false,
            error: `未知子命令: "${subcommand}"。可用: list, search, info, register, unregister, execute, stats`,
            exitCode: 1,
          };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `技能操作失败: ${msg}`, exitCode: 2 };
    }
  };
}

const HELP_TEXT = [
  "用法: cortex skill <子命令> [选项]",
  "",
  "子命令:",
  "  list                  列出所有已注册技能",
  "  search <query>        按关键词搜索技能",
  "  info <id>             查看技能详细信息",
  "  register <选项>        注册新技能",
  "  unregister <id>       注销技能",
  "  execute <id> <json>   执行指定技能",
  "  stats                 注册表统计信息",
  "",
  "选项 (register):",
  "  --id <id>             技能 ID（小写字母开头，2-64 字符）",
  "  --name <name>         技能名称",
  "  --version <ver>       语义化版本 (x.y.z)",
  "  --description <desc>  技能描述",
  "  --category <cat>      技能分类 (data/nlp/tool/reasoning/memory/communication/system)",
  "  --tags <t1,t2,...>    逗号分隔的标签列表",
  "  --author <name>       作者",
  "  --deps <id1,id2,...>  逗号分隔的依赖技能 ID",
  "  --entry <path>        入口文件路径",
  "  --overwrite           覆盖已存在的同名技能",
  "  --lazy                延迟实例化",
  "",
  "选项 (list/search):",
  "  --category <cat>      按分类筛选",
  "  --tags <t1,t2,...>    按标签筛选",
  "  --format <fmt>        输出格式 (table/json/short)",
  "",
  "选项 (execute):",
  "  --timeout <ms>        执行超时（毫秒）",
  "  --trace-id <id>       追踪 ID",
  "",
  "选项 (unregister):",
  "  --force               强制注销（忽略依赖检查）",
].join("\n");

// ─── list ────────────────────────────────────────────

async function handleList(
  registry: DefaultSkillRegistry,
  options: Record<string, unknown>,
  _context: CommandContext,
): Promise<CommandResult> {
  let skills = Array.from(registry.getAll().values());
  const category = options["category"] as string | undefined;
  const tagsStr = options["tags"] as string | undefined;

  if (category) {
    skills = skills.filter((s) => s.category === category);
  }
  if (tagsStr) {
    const filterTags = tagsStr.split(",").map((t) => t.trim());
    skills = skills.filter((s) => filterTags.some((t) => s.tags.includes(t)));
  }

  if (skills.length === 0) {
    return { success: true, output: "(无已注册技能)", exitCode: 0 };
  }

  const format = (options["format"] as string) ?? "table";
  if (format === "json") {
    return { success: true, data: skills, output: JSON.stringify(skills, null, 2), exitCode: 0 };
  }

  const lines = [`已注册技能 (共 ${skills.length} 个):`, ""];
  for (const s of skills) {
    lines.push(`  ${s.id}@${s.version}  ${s.name}  [${s.category}]  tags: ${s.tags.join(", ")}`);
  }
  return { success: true, output: lines.join("\n"), exitCode: 0 };
}

// ─── search ──────────────────────────────────────────

async function handleSearch(
  registry: DefaultSkillRegistry,
  args: string[],
  options: Record<string, unknown>,
  _context: CommandContext,
): Promise<CommandResult> {
  const query = args.join(" ");
  if (!query) {
    return { success: false, error: "请指定搜索关键词。用法: cortex skill search <query>", exitCode: 1 };
  }

  const skills = registry.find({
    search: query,
    category: options["category"] as SkillCategory | undefined,
    tags: options["tags"] ? (options["tags"] as string).split(",").map((t) => t.trim()) : undefined,
  });

  if (skills.length === 0) {
    return { success: true, output: `未找到匹配 "${query}" 的技能`, exitCode: 0 };
  }

  const lines = [`搜索 "${query}" (共 ${skills.length} 个):`, ""];
  for (const s of skills) {
    lines.push(`  ${s.id}@${s.version}  ${s.name}  [${s.category}]`);
    lines.push(`    ${s.description.slice(0, 80)}${s.description.length > 80 ? "…" : ""}`);
  }
  return { success: true, output: lines.join("\n"), exitCode: 0 };
}

// ─── info ────────────────────────────────────────────

async function handleInfo(
  registry: DefaultSkillRegistry,
  args: string[],
  _context: CommandContext,
): Promise<CommandResult> {
  const skillId = args[0];
  if (!skillId) {
    return { success: false, error: "请指定技能 ID。用法: cortex skill info <id>", exitCode: 1 };
  }

  const meta = registry.getMeta(skillId as any);
  if (!meta) {
    return { success: false, error: `技能「${skillId}」未在注册表中找到`, exitCode: 1 };
  }

  const lines = [
    `技能详情: ${meta.id}`,
    `  名称:     ${meta.name}`,
    `  版本:     ${meta.version}`,
    `  描述:     ${meta.description}`,
    `  分类:     ${meta.category}`,
    `  标签:     [${meta.tags.join(", ")}]`,
    `  依赖:     ${meta.dependencies.length > 0 ? meta.dependencies.join(", ") : "(无)"}`,
  ];
  if (meta.author) lines.push(`  作者:     ${meta.author}`);
  if (meta.entry) lines.push(`  入口:     ${meta.entry}`);

  return { success: true, output: lines.join("\n"), exitCode: 0 };
}

// ─── register ────────────────────────────────────────

async function handleRegister(
  registry: DefaultSkillRegistry,
  _args: string[],
  options: Record<string, unknown>,
  _context: CommandContext,
): Promise<CommandResult> {
  const id = options["id"] as string;
  const name = options["name"] as string;
  const version = options["version"] as string;
  const description = options["description"] as string;
  const category = options["category"] as string;

  if (!id || !name || !version || !description || !category) {
    return {
      success: false,
      error: "缺少必要参数。用法: cortex skill register --id <id> --name <name> --version <ver> --description <desc> --category <cat>",
      exitCode: 1,
    };
  }

  let skillId;
  let skillVersion;
  try {
    skillId = createSkillId(id);
    skillVersion = createSkillVersion(version);
  } catch (e) {
    return { success: false, error: `参数校验失败: ${e instanceof Error ? e.message : String(e)}`, exitCode: 1 };
  }

  const tagsStr = (options["tags"] as string) ?? "";
  const depsStr = (options["deps"] as string) ?? "";

  const tags = tagsStr ? tagsStr.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const deps = depsStr ? depsStr.split(",").map((d) => d.trim()).filter(Boolean) : [];

  if (!Object.values(SkillCategory).includes(category as SkillCategory)) {
    return {
      success: false,
      error: `无效分类「${category}」。可用: ${Object.values(SkillCategory).join(", ")}`,
      exitCode: 1,
    };
  }

  const meta: SkillMeta = {
    id: skillId,
    name,
    version: skillVersion,
    description,
    author: options["author"] as string | undefined,
    tags,
    dependencies: deps as any,
    category: category as SkillCategory,
    entry: options["entry"] as string | undefined,
  };

  // 使用占位技能
  class TempSkill extends BaseSkill {
    meta = meta;
    async run(): Promise<any> {
      return { success: false, error: { code: "SKILL_EXECUTION_FAILED", message: `技能「${id}」是通过 CLI 注册的占位技能` } };
    }
  }

  const result = await registry.register(new TempSkill(), {
    overwrite: !!options["overwrite"],
    lazy: options["lazy"] !== false,
  });

  if (result.success) {
    return { success: true, output: `✓ 技能「${id}」注册成功`, exitCode: 0 };
  }
  return { success: false, error: `注册失败: ${result.error}`, exitCode: 1 };
}

// ─── unregister ──────────────────────────────────────

async function handleUnregister(
  registry: DefaultSkillRegistry,
  args: string[],
  options: Record<string, unknown>,
  _context: CommandContext,
): Promise<CommandResult> {
  const skillId = args[0];
  if (!skillId) {
    return { success: false, error: "请指定技能 ID。用法: cortex skill unregister <id>", exitCode: 1 };
  }

  const force = !!options["force"];
  if (!force) {
    const allSkills = Array.from(registry.getAll().values());
    const dependents = allSkills.filter((s) => s.dependencies.includes(skillId as any));
    if (dependents.length > 0) {
      return {
        success: false,
        error: `技能「${skillId}」被依赖: ${dependents.map((d) => d.id).join(", ")}。使用 --force 强制注销`,
        exitCode: 1,
      };
    }
  }

  const result = await registry.unregister(skillId as any);
  if (result.success) {
    return { success: true, output: `✓ 技能「${skillId}」已注销`, exitCode: 0 };
  }
  return { success: false, error: `注销失败: ${result.error}`, exitCode: 1 };
}

// ─── execute ─────────────────────────────────────────

async function handleExecute(
  registry: DefaultSkillRegistry,
  args: string[],
  options: Record<string, unknown>,
  _context: CommandContext,
): Promise<CommandResult> {
  const skillId = args[0];
  const paramsStr = args[1];
  if (!skillId || !paramsStr) {
    return { success: false, error: "用法: cortex skill execute <id> '<json>'", exitCode: 1 };
  }

  let params: unknown;
  try {
    params = JSON.parse(paramsStr);
  } catch {
    return { success: false, error: `参数解析失败: "${paramsStr}" 不是有效 JSON`, exitCode: 1 };
  }

  const input: SkillInput = {
    params,
    traceId: options["trace-id"] as string | undefined,
    timeout: options["timeout"] ? Number(options["timeout"]) : undefined,
  };

  const result = await registry.execute(skillId as any, input);
  if (result.success) {
    return {
      success: true,
      output: `✓ 执行成功\n${JSON.stringify(result.data, null, 2)}`,
      data: result.data,
      exitCode: 0,
    };
  }
  return {
    success: false,
    error: `执行失败: ${result.error.message} (${result.error.code})`,
    exitCode: 1,
  };
}

// ─── stats ───────────────────────────────────────────

async function handleStats(
  registry: DefaultSkillRegistry,
  options: Record<string, unknown>,
  _context: CommandContext,
): Promise<CommandResult> {
  const allSkills = Array.from(registry.getAll().values());
  const byCategory: Record<string, number> = {};
  const byTag: Record<string, number> = {};

  for (const s of allSkills) {
    byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;
    for (const t of s.tags) {
      byTag[t] = (byTag[t] ?? 0) + 1;
    }
  }

  const format = (options["format"] as string) ?? "text";
  if (format === "json") {
    return {
      success: true,
      data: { total: allSkills.length, byCategory, byTag },
      output: JSON.stringify({ total: allSkills.length, byCategory, byTag }, null, 2),
      exitCode: 0,
    };
  }

  const lines = [
    `技能注册表统计:`,
    `  总数: ${allSkills.length}`,
    ``,
    `  按分类:`,
  ];
  for (const [cat, count] of Object.entries(byCategory)) {
    lines.push(`    ${cat.padEnd(14)} ${count}`);
  }
  lines.push(``, `  热门标签:`);
  const topTags = Object.entries(byTag).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [tag, count] of topTags) {
    lines.push(`    ${tag.padEnd(14)} ${count}`);
  }

  return { success: true, output: lines.join("\n"), exitCode: 0 };
}
