/**
 * commands/skill.ts — `cortex skill` 技能注册表命令
 *
 * 管理技能（结构化认知）的生命周期：查询、注册、注销、统计。
 * 基于 @cortex/engine 的 SkillRegistry，技能即记忆，非可执行函数。
 *
 * @since v2.6 — 适配技能系统重构：从可执行函数到结构化记忆
 * @moved-from projects/solo-flight/src/cli/
 */
import { isHelpRequest } from "../utils.js";
import { SkillRegistry } from "@cortex/skill-kit";
// ─── 懒加载单例 ──────────────────────────────────────
let _registryCache = null;
function getRegistry() {
    if (_registryCache)
        return _registryCache;
    const registry = new SkillRegistry();
    _registryCache = registry;
    return registry;
}
// ─── 命令入口 ────────────────────────────────────────
export function createSkillHandler() {
    return async (args, options, context) => {
        if (isHelpRequest(args)) {
            return { success: true, output: HELP_TEXT, exitCode: 0 };
        }
        const subcommand = args[0];
        const subArgs = args.slice(1);
        try {
            const registry = getRegistry();
            switch (subcommand) {
                case "list":
                    return handleList(registry, options, context);
                case "search":
                    return handleSearch(registry, subArgs, options);
                case "info":
                    return handleInfo(registry, subArgs, context);
                case "register":
                    return handleRegister(registry, subArgs, options);
                case "unregister":
                    return handleUnregister(registry, subArgs, options);
                case "stats":
                    return handleStats(registry, options, context);
                default:
                    return {
                        success: false,
                        error: `未知子命令: "${subcommand}"。可用: list, search, info, register, unregister, stats`,
                        exitCode: 1,
                    };
            }
        }
        catch (err) {
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
    "  stats                 注册表统计信息",
    "",
    "选项 (register):",
    "  --id <id>             技能 ID（小写字母开头，2-64 字符）",
    "  --name <name>         技能名称",
    "  --trigger <条件>       触发条件描述",
    "  --kind <kind>         技能种类 (action/thought/workflow，默认 action)",
    "  --tags <t1,t2,...>    逗号分隔的标签列表",
    "  --author <name>       产出者名称（默认 cli）",
    "  --steps <json>        JSON 步骤数组",
    "  --expected-output <s> 预期产出描述",
    "  --overwrite           覆盖已存在的同名技能",
    "",
    "选项 (list/search):",
    "  --category <tag>      按标签筛选",
    "  --tags <t1,t2,...>    按标签筛选",
    "  --format <fmt>        输出格式 (table/json)",
    "",
    "选项 (unregister):",
    "  --force               强制注销（忽略引用检查）",
    "",
    "注: v2.6 重构后，技能由可执行函数变为结构化认知（被参照而非被执行）。",
    "    旧的 execute 子命令已移除。如需执行 Agent，请使用 cortex run。",
].join("\n");
// ─── list ────────────────────────────────────────────
function handleList(registry, options, _context) {
    let skills = registry.getAll();
    const category = options["category"];
    const tagsStr = options["tags"];
    if (category) {
        skills = skills.filter((s) => s.triggerTags.some((t) => t.toLowerCase() === category.toLowerCase()));
    }
    if (tagsStr) {
        const filterTags = tagsStr.split(",").map((t) => t.trim());
        skills = skills.filter((s) => filterTags.some((t) => s.triggerTags.includes(t)));
    }
    if (skills.length === 0) {
        return { success: true, output: "(无已注册技能)", exitCode: 0 };
    }
    const format = options["format"] ?? "table";
    if (format === "json") {
        return { success: true, data: skills, output: JSON.stringify(skills, null, 2), exitCode: 0 };
    }
    const lines = [`已注册技能 (共 ${skills.length} 个):`, ""];
    for (const s of skills) {
        const status = s.status ?? "trial";
        lines.push(`  ${s.id}  ${s.name}  [${s.kind}]  tags: ${s.triggerTags.join(", ")}  weight: ${s.weight}  (${status})`);
    }
    return { success: true, output: lines.join("\n"), exitCode: 0 };
}
// ─── search ──────────────────────────────────────────
function handleSearch(registry, args, options) {
    const query = args.join(" ");
    if (!query) {
        return { success: false, error: "请指定搜索关键词。用法: cortex skill search <query>", exitCode: 1 };
    }
    const categoryFilter = options["category"];
    const tagsFilter = options["tags"] ? options["tags"].split(",").map((t) => t.trim()) : undefined;
    let skills = _filterSkillsBySearch(registry.getAll(), query);
    if (categoryFilter) {
        skills = skills.filter((s) => s.triggerTags.some((t) => t.toLowerCase() === categoryFilter.toLowerCase()));
    }
    if (tagsFilter) {
        skills = skills.filter((s) => tagsFilter.some((t) => s.triggerTags.includes(t)));
    }
    if (skills.length === 0) {
        return { success: true, output: `未找到匹配 "${query}" 的技能`, exitCode: 0 };
    }
    return _formatSearchResults(query, skills);
}
// ─── info ────────────────────────────────────────────
function handleInfo(registry, args, _context) {
    const skillId = args[0];
    if (!skillId) {
        return { success: false, error: "请指定技能 ID。用法: cortex skill info <id>", exitCode: 1 };
    }
    const tmpl = registry.get(skillId);
    if (!tmpl) {
        return { success: false, error: `技能「${skillId}」未在注册表中找到`, exitCode: 1 };
    }
    return { success: true, output: _formatSkillDetail(tmpl), exitCode: 0 };
}
// ─── register ────────────────────────────────────────
function handleRegister(registry, _args, options) {
    const id = options["id"];
    const name = options["name"];
    const trigger = options["trigger"];
    const kind = options["kind"] ?? "action";
    if (!id || !name || !trigger) {
        return { success: false, error: "缺少必要参数。用法: cortex skill register --id <id> --name <name> --trigger <触发条件> [--kind action|thought|workflow] [--tags t1,t2]", exitCode: 1 };
    }
    const validationError = _validateRegisterInput(id, kind);
    if (validationError)
        return validationError;
    if (!options["overwrite"] && registry.get(id)) {
        return { success: false, error: `技能「${id}」已存在。使用 --overwrite 覆盖`, exitCode: 1 };
    }
    const template = _buildSkillTemplate({ id, name, kind, trigger, tagsStr: options["tags"] ?? "", options });
    registry.register(template);
    return { success: true, output: `✓ 技能「${id}」注册成功`, exitCode: 0 };
}
// ─── unregister ──────────────────────────────────────
function handleUnregister(registry, args, options) {
    const skillId = args[0];
    if (!skillId) {
        return { success: false, error: "请指定技能 ID。用法: cortex skill unregister <id>", exitCode: 1 };
    }
    const exists = registry.get(skillId);
    if (!exists) {
        return { success: false, error: `技能「${skillId}」未在注册表中找到`, exitCode: 1 };
    }
    if (!options["force"]) {
        const dependents = registry.getAll().filter((s) => s.trigger.includes(skillId));
        if (dependents.length > 0) {
            return {
                success: false,
                error: `技能「${skillId}」可能被引用: ${dependents.map((d) => d.id).join(", ")}。使用 --force 强制注销`,
                exitCode: 1,
            };
        }
    }
    const ok = registry.unregister(skillId);
    return ok
        ? { success: true, output: `✓ 技能「${skillId}」已注销`, exitCode: 0 }
        : { success: false, error: `注销失败: 技能「${skillId}」不存在`, exitCode: 1 };
}
// ─── execute ─────────────────────────────────────────
// 注：v2.6 重构后，技能不再是可执行函数，而是结构化认知（被参照而非被执行）。
// execute 子命令已移除。如需执行 Agent，请使用 cortex run。
// ─── stats ───────────────────────────────────────────
function handleStats(registry, options, _context) {
    const allSkills = registry.getAll();
    const stats = _groupSkillStats(allSkills);
    const format = options["format"] ?? "text";
    if (format === "json") {
        return {
            success: true,
            data: stats,
            output: JSON.stringify(stats, null, 2),
            exitCode: 0,
        };
    }
    return { success: true, output: _formatSkillStatsText(stats), exitCode: 0 };
}
// ─── helpers ────────────────────────────────────────
function _filterSkillsBySearch(skills, query) {
    const lowerQ = query.toLowerCase();
    return skills.filter((s) => s.id.toLowerCase().includes(lowerQ) ||
        s.name.toLowerCase().includes(lowerQ) ||
        s.trigger.toLowerCase().includes(lowerQ));
}
function _formatSearchResults(query, skills) {
    const lines = [`搜索 "${query}" (共 ${skills.length} 个):`, ""];
    for (const s of skills) {
        lines.push(`  ${s.id}  ${s.name}  [${s.kind}]`);
        lines.push(`    ${s.trigger.slice(0, 80)}${s.trigger.length > 80 ? "…" : ""}`);
    }
    return { success: true, output: lines.join("\n"), exitCode: 0 };
}
function _formatSkillDetail(tmpl) {
    const status = tmpl.status ?? "trial";
    const lines = [
        `技能详情: ${tmpl.id}`,
        `  名称:     ${tmpl.name}`,
        `  种类:     ${tmpl.kind}`,
        `  触发:     ${tmpl.trigger}`,
        `  标签:     [${tmpl.triggerTags.join(", ")}]`,
        `  权重:     ${tmpl.weight}`,
        `  状态:     ${status}`,
        `  产出者:   ${tmpl.discoveredBy}`,
        `  步骤数:   ${tmpl.steps.length}`,
        `  评价数:   ${tmpl.feedbackHistory.length}`,
        `  创建于:   ${new Date(tmpl.createdAt).toISOString()}`,
    ];
    if (tmpl.expectedOutput)
        lines.push(`  预期产出: ${tmpl.expectedOutput}`);
    if (tmpl.outputFile)
        lines.push(`  输出文件: ${tmpl.outputFile}`);
    return lines.join("\n");
}
function _validateRegisterInput(id, kind) {
    if (!/^[a-z][a-z0-9_-]{1,63}$/.test(id)) {
        return { success: false, error: `无效技能 ID「${id}」。需小写字母开头，2-64 字符，字母/数字/连字符/下划线`, exitCode: 1 };
    }
    if (!["action", "thought", "workflow"].includes(kind)) {
        return { success: false, error: `无效技能种类「${kind}」。可用: action, thought, workflow`, exitCode: 1 };
    }
    return null;
}
function _groupSkillStats(allSkills) {
    const byKind = {};
    const byTag = {};
    const byStatus = {};
    for (const s of allSkills) {
        byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
        byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
        for (const t of s.triggerTags) {
            byTag[t] = (byTag[t] ?? 0) + 1;
        }
    }
    return { byKind, byTag, byStatus, total: allSkills.length };
}
/** 从选项构建 SkillTemplate */
function _buildSkillTemplate(opts) {
    const tags = opts.tagsStr ? opts.tagsStr.split(",").map((t) => t.trim()).filter(Boolean) : [];
    return {
        id: opts.id,
        kind: opts.kind,
        name: opts.name,
        triggerTags: tags,
        trigger: opts.trigger,
        steps: opts.options["steps"] ?? [],
        expectedOutput: opts.options["expected-output"] ?? "",
        status: "trial",
        weight: 0,
        feedbackHistory: [],
        discoveredBy: opts.options["author"] ?? "cli",
        createdAt: Date.now(),
    };
}
/** 格式化统计文本 */
function _formatSkillStatsText(stats) {
    const { total, byKind, byTag, byStatus } = stats;
    const lines = [
        `技能注册表统计:`,
        `  总数: ${total}`,
        `  活跃: ${byStatus["active"] ?? 0}`,
        `  试用: ${byStatus["trial"] ?? 0}`,
        `  弃用: ${byStatus["deprecated"] ?? 0}`,
        ``,
        `  按种类:`,
    ];
    for (const [kind, count] of Object.entries(byKind)) {
        lines.push(`    ${kind.padEnd(14)} ${count}`);
    }
    lines.push(``, `  热门标签:`);
    const topTags = Object.entries(byTag).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [tag, count] of topTags) {
        lines.push(`    ${tag.padEnd(14)} ${count}`);
    }
    return lines.join("\n");
}
//# sourceMappingURL=skill.js.map