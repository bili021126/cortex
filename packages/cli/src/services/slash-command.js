// ============================================================
// @cortex/cli/services/slash-command —— 斜杠命令解析器
//
// @layer 交互层
// @role 命令路由——/ 开头的输入拦截为技能调用，不经过甘雨规划
//
// 职责：
//   1. 识别 /xxx 格式的用户输入
//   2. 从 SkillRegistry 查找匹配的技能模板
//   3. 构造 TaskNode 交给调度器执行
//   4. /list 列出可调用技能
//
// @since Core-2
// ============================================================
/**
 * SlashCommandParser —— 解析 /xxx 输入，路由到技能执行。
 *
 * 典型用法：
 *   const parser = new SlashCommandParser(skillRegistry);
 *   const result = parser.parse("/package-gap-scan");
 *   if (result.isSlash && result.skill) {
 *     scheduler.dispatch(buildSkillTask(result.skill));
 *   }
 */
export class SlashCommandParser {
    skillRegistry;
    constructor(skillRegistry) {
        this.skillRegistry = skillRegistry;
    }
    /**
     * 解析用户输入。
     *
     * @param input 用户原始输入
     * @returns 解析结果——非 / 开头时 isSlash=false
     */
    parse(input) {
        const trimmed = input.trim();
        // 非 / 开头 → 不是斜杠命令
        if (!trimmed.startsWith("/")) {
            return { isSlash: false };
        }
        const commandName = trimmed.slice(1).split(/\s+/)[0];
        // 空命令（只输入了 /）
        if (!commandName) {
            return {
                isSlash: true,
                error: "可用命令：/list（列出技能）",
            };
        }
        // /list 内置命令
        if (commandName === "list") {
            return {
                isSlash: true,
                commandName: "list",
            };
        }
        // 查找技能
        const skill = this.skillRegistry.get(commandName);
        if (!skill) {
            return {
                isSlash: true,
                commandName,
                error: `未知技能「${commandName}」。输入 /list 查看可用技能`,
            };
        }
        // 检查是否可被用户调用
        if (skill.userInvocable === false) {
            return {
                isSlash: true,
                commandName,
                error: `技能「${commandName}」不允许用户直接调用`,
            };
        }
        return {
            isSlash: true,
            commandName,
            skill,
        };
    }
    /**
     * 列出所有用户可调用的技能。
     */
    listInvocable() {
        const all = this.skillRegistry.getAll();
        return all.filter((s) => s.userInvocable !== false);
    }
}
//# sourceMappingURL=slash-command.js.map