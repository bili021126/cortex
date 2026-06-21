import { AgentType, type TaskNode, type MemoryQuery, type MemoryKind, type LinkType, type ReadMode, type AgentCapability } from "@cortex/shared";
import type { AgentFactoryConfig } from "../components/agent-factory.js";
export interface MemoryQueryParams {
    kind?: MemoryKind;
    linkTypes: LinkType[];
    bfsDepth: number;
    limit: number;
    /** 可选读取模式 */
    readMode?: ReadMode;
}
export interface AgentRegistration {
    /** Agent 类型枚举值 */
    type: AgentType;
    /** Memory query 参数——通用工厂据此生成 *MemoryQuery + *AgentConfig */
    memoryParams: MemoryQueryParams;
    /** 是否在 bootstrap 时自动注册到 Scheduler */
    autoRegister: boolean;
    /** 简短描述（用于调试/日志） */
    description: string;
    /** 可选的 Agent 类（ApiAgent/DataAgent 等有自定义子类的） */
    AgentClass?: new (...args: unknown[]) => unknown;
    /** Agent 自声明——能力画像 */
    capability: AgentCapability;
}
/** 从参数生成 MemoryQuery 函数 */
export declare function createMemoryQuery(params: MemoryQueryParams): (node: TaskNode) => MemoryQuery;
export declare const AGENT_REGISTRY: AgentRegistration[];
/** 将 AGENT_REGISTRY 中的全部能力声明注册到 CapabilityRegistry */
export declare function registerAllCapabilities(): void;
export declare function findRegistration(type: AgentType): AgentRegistration | undefined;
export declare function getAutoRegisterable(): AgentRegistration[];
export declare const codeMemoryQuery: (node: TaskNode) => MemoryQuery;
export declare const codeAgentConfig: (sp: string) => AgentFactoryConfig;
export declare const reviewMemoryQuery: (node: TaskNode) => MemoryQuery;
export declare const reviewAgentConfig: (sp: string) => AgentFactoryConfig;
export declare const analysisMemoryQuery: (node: TaskNode) => MemoryQuery;
export declare const analysisAgentConfig: (sp: string) => AgentFactoryConfig;
export declare function opsMemoryQuery(node: TaskNode): MemoryQuery;
export declare function opsAgentConfig(systemPrompt: string): AgentFactoryConfig;
export declare const loopMemoryQuery: (node: TaskNode) => MemoryQuery;
export declare const loopAgentConfig: (sp: string) => AgentFactoryConfig;
export declare const docGovernMemoryQuery: (node: TaskNode) => MemoryQuery;
export declare const docGovernAgentConfig: (sp: string) => AgentFactoryConfig;
export declare const apiMemoryQuery: (node: TaskNode) => MemoryQuery;
export declare const apiAgentConfig: (sp: string) => AgentFactoryConfig;
export declare const dataMemoryQuery: (node: TaskNode) => MemoryQuery;
export declare const dataAgentConfig: (sp: string) => AgentFactoryConfig;
export declare const fixMemoryQuery: (node: TaskNode) => MemoryQuery;
export declare const fixAgentConfig: (sp: string) => AgentFactoryConfig;
//# sourceMappingURL=registry.d.ts.map