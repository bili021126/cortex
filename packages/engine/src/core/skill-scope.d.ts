import type { SkillTemplate } from "@cortex/shared";
/** 技能作用域 */
export interface SkillScope {
    /** 跨域技能目录（用户级，跨项目） */
    crossDomainDir?: string;
    /** 当前包名（task 涉及该包文件时激活包级技能） */
    packageName?: string;
    /** 目标 Agent 类型 */
    agentType?: string;
}
/**
 * resolveByScope —— 按四级作用域裁剪技能列表。
 *
 * 1. 从全部技能中筛选 L0 跨域 + L1 项目（始终候选）
 * 2. 追加 L2 包级（仅当 packageName 匹配）
 * 3. L3 agentType 过滤
 * 4. 同名去重——窄作用域覆盖宽作用域
 */
export declare function resolveByScope(allSkills: SkillTemplate[], scope: SkillScope): SkillTemplate[];
/** 为技能标注作用域元数据 */
export declare function tagSkillScope(skill: SkillTemplate, scope: "cross-domain" | "project" | "package", packageName?: string): SkillTemplate;
//# sourceMappingURL=skill-scope.d.ts.map