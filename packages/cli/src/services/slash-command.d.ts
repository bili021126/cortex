import type { SkillRegistry } from "@cortex/skill-kit";
import type { SkillTemplate } from "@cortex/shared";
/** 斜杠命令解析结果 */
export interface SlashCommandResult {
    /** 是否为斜杠命令（/ 开头） */
    isSlash: boolean;
    /** 命令名（/ 后面的部分） */
    commandName?: string;
    /** 匹配的技能模板 */
    skill?: SkillTemplate;
    /** 错误信息（命令不存在等） */
    error?: string;
}
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
export declare class SlashCommandParser {
    private readonly skillRegistry;
    constructor(skillRegistry: SkillRegistry);
    /**
     * 解析用户输入。
     *
     * @param input 用户原始输入
     * @returns 解析结果——非 / 开头时 isSlash=false
     */
    parse(input: string): SlashCommandResult;
    /**
     * 列出所有用户可调用的技能。
     */
    listInvocable(): SkillTemplate[];
}
//# sourceMappingURL=slash-command.d.ts.map