// ============================================================
// @cortex/engine/core/skill-scope —— 技能作用域解析
//
// @layer 技能-工具层
// @role 技能路由——四级作用域（跨域/项目/包级/Agent）
//
// 四级作用域模型：
//   L0 跨域 (~/.cortex/skills/) — 用户个人工具包，跨所有项目
//   L1 项目 (skills/)          — 当前项目全局
//   L2 包级 (packages/*/skills/) — 仅包内 Agent 可见
//   L3 Agent (agentType)        — 最细粒度过滤
//
// 覆盖规则：窄覆盖宽 (L3 > L2 > L1 > L0)
// @since Core-2
// ============================================================
/**
 * resolveByScope —— 按四级作用域裁剪技能列表。
 *
 * 1. 从全部技能中筛选 L0 跨域 + L1 项目（始终候选）
 * 2. 追加 L2 包级（仅当 packageName 匹配）
 * 3. L3 agentType 过滤
 * 4. 同名去重——窄作用域覆盖宽作用域
 */
export function resolveByScope(allSkills, scope) {
    const seen = new Set();
    const result = [];
    // L3 agentType filter first (narrowest)
    const candidates = scope.agentType
        ? allSkills.filter((s) => !s.agentType || s.agentType === scope.agentType)
        : allSkills;
    for (const skill of candidates) {
        // 跨域技能优先级最低——只在不冲突时保留
        if (skill._scope === "cross-domain" && seen.has(skill.id))
            continue;
        // 包级技能仅在匹配 packageName 时生效
        if (skill._scope === "package" && skill._packageName !== scope.packageName)
            continue;
        if (!seen.has(skill.id)) {
            seen.add(skill.id);
            result.push(skill);
        }
    }
    return result;
}
/** 为技能标注作用域元数据 */
export function tagSkillScope(skill, scope, packageName) {
    return {
        ...skill,
        _scope: scope,
        _packageName: packageName,
    };
}
//# sourceMappingURL=skill-scope.js.map