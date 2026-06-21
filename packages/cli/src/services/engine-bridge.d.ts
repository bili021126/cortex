/**
 * engine-bridge.ts — 引擎组件惰性初始化桥接
 *
 * 管理 Scheduler、MemoryStore、TaskBoard、PipelineObserver、
 * ConfirmGate 等引擎组件的生命周期。
 *
 * AgentPool 是 engine 内部组件（非公开 API），CLI 通过
 * Scheduler 间接与其交互。对于需要直接查询 Agent 状态的
 * 命令（cortex agent list），我们直接构建最小 AgentPool 实例。
 *
 * @see CLI 设计文档 §5.2（单次模式资源管理策略）
 */
import { type MetaAgent, type StrategistAgent, type BootstrapEngineResult } from "@cortex/engine";
import { SlashCommandParser } from "./slash-command.js";
import type { IScheduler, ITaskBoard, IAgentPool } from "@cortex/scheduler";
import { ConfirmGate } from "@cortex/scheduler";
import { CLIAdapter, type Toolkit } from "@cortex/platform";
import type { EngineConfig } from "@cortex/config";
import { MemoryStore } from "@cortex/memory-store";
import { AgentType, type ChatOptions, type ExecutionReport, type IConfirmGate, type ICortexApi, type IMemoryStore, type IPipelineObserver, type LlmMessage, type MemoryEntry, type MemoryQuery, type MemoryWriteInput, type TaskNode } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { ConfigManager } from "./config-manager.js";
import type { TuiEvent } from "@cortex/tui";
export interface BridgeContext {
    scheduler?: IScheduler;
    memoryStore?: IMemoryStore;
    taskBoard?: ITaskBoard;
    pipelineObserver?: IPipelineObserver;
    confirmGate?: ConfirmGate;
    cliAdapter?: CLIAdapter;
    initialized: boolean;
    /** 是否为配置驱动模式（bootstrapEngine 初始化） */
    bootstrapped?: boolean;
    /** bootstrapEngine 完整结果 */
    bootstrapResult?: BootstrapEngineResult;
    /** 昔涟独立记忆数据库——仅 talk 模式使用，与主 MemoryStore 物理隔离 */
    talkMemoryStore?: MemoryStore;
    /** 斜杠命令解析器（Core-2） */
    slashCommandParser?: SlashCommandParser;
}
import { MiniAgentPool } from "./mini-agent-pool.js";
/** Bootstrap 配置——使用 bootstrapEngine 的必需参数 */
export interface BootstrapConfig {
    llms: Map<string, LlmAdapter>;
    toolkit: Toolkit;
    projectRoot: string;
    /** 工作区根目录（Agent 文件操作沙箱），默认等于 projectRoot */
    workspaceRoot?: string;
    dbPath?: string;
    engineConfig?: EngineConfig;
}
/**
 * EngineBridge — 引擎组件生命周期管理器。
 *
 * 支持两种初始化模式：
 * 1. 轻量模式（ensureInitialized）—— 使用 MiniAgentPool，无 Agent 注册
 * 2. 配置驱动模式（ensureBootstrapped）—— 使用 bootstrapEngine，
 *    从 cortex-agents.json 加载所有 Agent 定义并注册
 */
export declare class EngineBridge implements ICortexApi {
    private ctx;
    private _pool;
    private config;
    private dbPath?;
    private engineConfig?;
    private _bootstrapConfig?;
    constructor(config: ConfigManager, dbPath?: string, engineConfig?: EngineConfig);
    /**
     * 设置 Bootstrap 配置——启用配置驱动模式。
     * 必须在 ensureBootstrapped() 之前调用。
     */
    setBootstrapConfig(bootstrapConfig: BootstrapConfig): void;
    /**
     * 配置驱动初始化——使用 bootstrapEngine 加载 cortex-agents.json
     * 等配置文件，创建所有 Agent 并注册到 Scheduler。
     *
     * 此方法完全替代硬编码 Agent 创建流程。
     * 必须先调用 setBootstrapConfig() 设置 LlmAdapter 等参数。
     */
    ensureBootstrapped(): Promise<void>;
    /**
     * 以新的工作区根路径重新引导引擎。
     * 用于用户在 intent 中指定了不同的工作区路径（如 "将这个路径作为工作区 D:\\Projects\\xxx"）。
     * 只有 workspaceRoot 与当前不同时才触发实际重引导。
     */
    rebootstrapIfNeeded(workspaceRoot: string): Promise<void>;
    /** 兼容旧调用方——返回 BridgeContext 的具体实现 */
    private _ensureBootstrapped;
    /**
     * 获取 Bootstrap 上下文（EngineBridge 专有，不在 ICortexApi 契约中）。
     * 供 roundtable / agent / task 等命令工厂在需要访问 bootstrapResult 时使用。
     */
    ensureBootstrappedContext(): Promise<BridgeContext>;
    /** 初始化全部引擎组件（轻量模式，惰性，仅首次调用时创建） */
    ensureInitialized(): Promise<BridgeContext>;
    /** 是否已初始化（ICortexApi.ready） */
    get ready(): boolean;
    /** 是否已 Bootstrap（ICortexApi.bootstrapped） */
    get bootstrapped(): boolean;
    /** 确保引擎就绪（轻量模式，ICortexApi） */
    ensureReady(): Promise<void>;
    /**
     * 统一对话接口（ICortexApi.chat）。
     * 等价于 directChat——不经调度器，直连 LLM。
     */
    chat(systemPrompt: string, messages: LlmMessage[], opts?: ChatOptions): Promise<string>;
    /** 获取闲聊模型名（ICortexApi） */
    getChatModelName(): string;
    /** 获取推理模型名（ICortexApi） */
    getReasonerModelName(): string;
    /**
     * 获取 Agent 可用的工具定义——供 TUI queryLoop 注入 LLM function calling。
     * 若 Toolkit 未初始化（轻量模式），返回空数组。
     */
    getToolDefs(agent: AgentType): {
        name: string;
        description: string;
        parameters?: Record<string, unknown>;
    }[];
    /**
     * 执行工具调用——TUI 层通过此方法将 LLM 产出的 tool_call 转发到引擎 Toolkit。
     *
     * 默认以 "code" Agent 身份调用（TUI chat 模式的工具调用权限与 CodeAgent 一致）。
     */
    executeToolCall(name: string, args: Record<string, unknown>): Promise<{
        success: boolean;
        output: string;
    }>;
    /**
     * 流式 LLM 对话——供 TUI queryLoop 使用。
     *
     * 通过 LlmAdapter.chatStream() 实现真正的 SSE 流式回调，
     * 每个 token chunk 即时推送给 TUI 渲染层。
     *
     * @param model 模型名
     * @param messages 完整消息列表（含 system）
     * @param tools 工具定义（可选，用于 function calling）
     * @param onChunk 每次收到文本 chunk 时回调
     * @param opts 推理选项
     * @returns LLM 完整响应
     */
    streamChat(model: string, messages: LlmMessage[], tools: {
        name: string;
        description: string;
        parameters?: Record<string, unknown>;
    }[] | undefined, onChunk: (content: string, reasoning?: string) => void, opts?: {
        reasoningEffort?: "high" | "max";
    }): Promise<{
        content: string | null;
        tool_calls?: {
            id: string;
            name: string;
            arguments: Record<string, unknown>;
        }[];
        usage?: {
            prompt_tokens: number;
            completion_tokens: number;
        };
        reasoning_content?: string;
    }>;
    /** 提交任务节点到 TaskBoard（ICortexApi） */
    submitTask(node: TaskNode): Promise<void>;
    /** 执行 TaskBoard 上所有待处理节点（ICortexApi） */
    executeAll(): Promise<ExecutionReport>;
    /**
     * 流式执行——将 executeAll 的结果拆解为 TUI 事件流。
     *
     * 提交节点 → 发射 node_start → await scheduler.executeAll() →
     * 发射 node_complete/node_failed 事件。
     *
     * @param nodes 要执行的任务节点列表
     * @param onEvent 事件回调——引擎每完成一个节点就调用一次
     * @returns 完整执行报告
     */
    executeWithStream(nodes: TaskNode[], onEvent: (event: TuiEvent) => void): Promise<ExecutionReport>;
    /** 读取 Talk 专属记忆（ICortexApi） */
    readTalkMemory(query: MemoryQuery): Promise<MemoryEntry[]>;
    /** 写入 Talk 专属记忆（ICortexApi） */
    writeTalkMemory(entry: MemoryWriteInput): Promise<void>;
    /** 只读访问主记忆库（ICortexApi，修复原 (bridge as any).ctx hack） */
    readMainMemory(query: MemoryQuery): Promise<MemoryEntry[]>;
    /** 是否已设置 Bootstrap 配置（用于按需选择初始化模式） */
    get isBootstrapConfigured(): boolean;
    /** LLM 适配器（从 llms 映射中取昔涟适配器或第一个可用适配器，用于 directChat/talk） */
    private get llm();
    /**
     * 直接调用 LLM（绕过调度器，用于闲聊等不需要 Agent 的对话模式）。
     * 支持多轮对话——传入完整的 messages 数组（不含 system），
     * system 提示词单独传入并自动插入消息列表头部。
     * @param systemPrompt 系统提示词
     * @param messages 对话历史（user/assistant 交替，不含 system）
     * @param opts.model 可选覆盖模型名（默认使用 chatModel）
     * @param opts.reasoningEffort 推理强度（"high" | "max"），仅 reasoner 模型有效
     * @returns LLM 返回的文本内容
     */
    directChat(systemPrompt: string, messages: LlmMessage[], opts?: {
        model?: string;
        reasoningEffort?: "high" | "max";
    }): Promise<string>;
    /** 获取 AgentPool（轻量模式使用 MiniAgentPool，配置驱动模式使用真实 AgentPool） */
    get agentPool(): IAgentPool | MiniAgentPool;
    /** ICortexApi.getAgentPool() —— 返回 AgentPool 实例（管理命令用） */
    getAgentPool(): unknown;
    getMemoryStore(): Promise<IMemoryStore>;
    getScheduler(): Promise<IScheduler>;
    getTaskBoard(): Promise<ITaskBoard>;
    getObserver(): Promise<IPipelineObserver>;
    getConfirmGate(): Promise<IConfirmGate>;
    /** 获取 MetaAgent（甘雨）—— 用于 Plan Mode 生成任务计划 */
    getMetaAgent(): Promise<MetaAgent | undefined>;
    /** 获取 Strategist Agent 集合（钟离+霜凝）—— 用于 agent list 等查询 */
    getStrategists(): Map<string, StrategistAgent> | undefined;
    /**
     * 初始化昔涟的独立记忆数据库（仅在 talk 模式下调用一次）。
     * 数据库文件：.cortex/cyrene-memory.db（已 gitignored）。
     * 与主 MemoryStore（.cortex/memory.db）物理隔离——昔涟的记忆
     * 不参与 Agent 调度、宪法治理、roundtable 辩论。
     */
    ensureTalkMemory(): Promise<void>;
    /** 兼容旧调用方——返回 MemoryStore 的具体实现 */
    _ensureTalkMemory(): Promise<MemoryStore>;
    /** 暴露 talkMemoryStore 给 repl.ts（懒加载，不强制初始化） */
    private get talkMemoryStore();
    shutdown(): Promise<void>;
    get isInitialized(): boolean;
}
//# sourceMappingURL=engine-bridge.d.ts.map