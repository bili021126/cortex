/**
 * @cortex/config — MetaAgent 系统提示词
 *
 * PLANNING_SYSTEM / REPLAN_SYSTEM 是甘雨战术中枢的 prompt 体，
 * 从 engine/core/meta-agent.ts 硬编码中抽离到此，实现单源管理。
 *
 * buildPlanningSystem(workspaceRoot) 允许在运行时注入当前工作区，
 * 解决此前"工作区边界校验"规则有而路径无的脱节问题。
 *
 * @layer root — @cortex/config 常量层
 * @since v2.5.41 提示词配置化
 */
/** 规划系统提示词（含工作区占位符） */
export declare const PLANNING_SYSTEM: string;
/** 工作区占位符标记 */
export declare const WORKSPACE_PLACEHOLDER = "{{WORKSPACE_ROOT}}";
/**
 * 构建规划系统提示词，注入实际工作区根路径。
 * @param workspaceRoot 工作区根路径（绝对路径），如 d:\\cortex
 * @returns 注入了工作区路径的完整系统提示词
 */
export declare function buildPlanningSystem(workspaceRoot: string): string;
/**
 * 构建规划系统提示词（无工作区模式）。
 * 不注入路径，保持占位符原样。用于向后兼容或测试场景。
 */
export declare function buildPlanningSystemBlank(): string;
/** 重规划系统提示词 */
export declare const REPLAN_SYSTEM: string;
//# sourceMappingURL=meta-agent.d.ts.map