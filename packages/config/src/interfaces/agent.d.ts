/**
 * @cortex/config — Agent 配置接口
 *
 * 定义 cortex-agents.json（拆分后为 agents.json）的 Agent 声明结构。
 * 使用 string 类型替代 @cortex/shared 中的具体 AgentType，
 * 保持 config 包零依赖约束。
 *
 * @module interfaces/agent
 * @layer root — 零依赖，纯类型层
 */
/** 单个 Agent 定义 */
export interface AgentDefinition {
    /** Agent 标识（如 "ganyu", "albedo"） */
    id: string;
    /** Agent 类型 */
    type: string;
    /** 角色名（人类可读，格式："短名 — 头衔"） */
    role: string;
    /** 系统提示词（内联字符串，与 systemPromptFile 二选一） */
    systemPrompt?: string;
    /** 系统提示词文件路径（相对项目根，与 systemPrompt 二选一） */
    systemPromptFile?: string;
    /** 展示信息——统一的 emoji + 短名 + 头衔 */
    display?: AgentDisplay;
    /** 圆桌会议 Persona——仅参与圆桌的 Agent 有此字段 */
    roundtable?: AgentRoundtable;
    /** 生产的事件类型列表 */
    produces: string[];
    /** 使用的模型 */
    model: string;
    /** API key 分组 */
    key: string;
    /** 最大实例数（默认 1） */
    maxInstances?: number;
    /** 认领标签（用于 Scheduler 匹配分发） */
    tags?: string[];
    /** 工具权限列表（用于 Toolkit 权限校验） */
    toolPermissions?: string[];
    /** 记忆查询策略名（如 "code", "review", "analysis"） */
    memoryQueryStrategy?: string;
    /** 规划系统提示词（仅 meta agent 使用） */
    planningPrompt?: string;
    /** 规划系统提示词文件路径（相对项目根） */
    planningPromptFile?: string;
    /** 重规划系统提示词（仅 meta agent 使用） */
    replanPrompt?: string;
    /** 重规划系统提示词文件路径（相对项目根） */
    replanPromptFile?: string;
}
/** Agent 展示信息 */
export interface AgentDisplay {
    emoji: string;
    shortName: string;
    title: string;
}
/** Agent 圆桌会议 Persona */
export interface AgentRoundtable {
    personaPrompt?: string;
    personaPromptFile?: string;
    roundtableTitle: string;
}
/** agents.json 顶层结构 */
export interface AgentsConfig {
    agents: Record<string, AgentDefinition>;
}
//# sourceMappingURL=agent.d.ts.map