/**
 * capability-registry.ts — Agent 自声明注册表
 *
 * @layer 规划-执行层
 * @role 事轴初始化——Agent 自声明 + 自组装
 *
 * 启动时自动收集所有 Agent 的 capability 自声明。
 * MetaAgent 据此进行任务→Agent 匹配和团队自组装。
 *
 * @since v2.7 — Agent 自声明与自组装（Kimi Agent Swarm 对齐）
 */
import type { AgentCapability, AgentType } from "@cortex/shared";
export declare class CapabilityRegistry {
    /** 按 AgentType 索引 */
    private byType;
    /** 按标签索引 */
    private byTag;
    /** 按产出索引 */
    private byProduces;
    /** 注册一个 Agent 的自声明（幂等——同类型重复注册会先清理旧索引） */
    register(cap: AgentCapability): void;
    /** 批量注册 */
    registerAll(caps: AgentCapability[]): void;
    /** 获取所有已注册能力 */
    getAll(): AgentCapability[];
    /** 按类型精确查询 */
    getByType(type: AgentType): AgentCapability | undefined;
    /** 按标签匹配——返回匹配的 Agent 能力列表 */
    queryByTags(tags: string[]): AgentCapability[];
    /** 按产出类型查询 */
    queryByProduces(produces: string[]): AgentCapability[];
    /** 按协作模式筛选 */
    filterByCollaboration(mode: "solo" | "reviewer" | "subordinate"): AgentCapability[];
    /** 输出格式筛选 */
    filterByOutputFormat(format: string): AgentCapability[];
    /**
     * 根据任务需求自动组装 Agent 团队。
     *
     * @param requiredTags 任务需要的标签
     * @param includes 强制包含的 AgentType
     * @returns 组装好的 Agent 能力列表
     */
    assembleTeam(requiredTags: string[], includes?: AgentType[]): AgentCapability[];
    /** 生成人类可读的能力清单（供 MetaAgent prompt 注入） */
    toPromptDescription(): string;
}
/** 全局单例 */
export declare const capabilityRegistry: CapabilityRegistry;
//# sourceMappingURL=capability-registry.d.ts.map