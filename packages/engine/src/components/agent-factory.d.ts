import type { Agent, TaskNode, AgentType, MemoryQuery, SafeErrorReporter, MemoryEntry, ReadMode } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "@cortex/platform";
import type { MemoryStore } from "@cortex/memory-store";
import type { AgentPool } from "@cortex/scheduler";
/**
 * Agent 工厂配置——组合式替代 BaseAgent 继承。
 *
 * 与 abstract class 不同，此配置是纯数据：
 *   - 不要求子类覆写方法
 *   - 不依赖 this 隐式耦合
 *   - 每个字段都是显式声明
 */
export interface AgentFactoryConfig {
    /** Agent 类型 */
    type: AgentType;
    /** 系统提示词 */
    systemPrompt: string;
    /** ReAct 循环上限。默认 64 */
    maxLoops?: number;
    /** 是否需要记忆支持 */
    memoryEnabled?: boolean;
    /** 自定义记忆检索策略。不提供则用 CJK bigram 默认策略 */
    getMemoryQuery?: (node: TaskNode) => MemoryQuery;
    /** 执行前钩子——如 InspectorAgent 的 tsc 编译事实采集 */
    preExecuteHook?: (node: TaskNode) => TaskNode | Promise<TaskNode>;
    /** 记忆 BFS 深度覆写——不提供则由 getMemoryQuery 决定 */
    memoryBfsDepth?: number;
    /** 记忆检索条数覆写——不提供则由 getMemoryQuery 决定 */
    memoryLimit?: number;
    /** P0-六层防御：读路径 Intent 过滤回调 */
    filterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[];
    /** 创建后钩子——执行额外注入（如 setWorkspaceRoot）。返回增强后的 Agent */
    postCreateHook?: (agent: Agent) => Agent;
}
/**
 * 创建 Agent 实例——组合工厂。
 *
 * 替代 `abstract class BaseAgent` 的继承模式。
 * 每个 Agent 类型调用此工厂，传入配置即可产出符合 Agent 接口的对象。
 *
 * 内部组件：
 *   - PoolAwareState（状态管理，方案B 归一）
 *   - ReActContext（LLM + Toolkit + MemoryStore 依赖注入）
 *   - executeWithMemoryPipeline（记忆检索 → 执行 → 记忆写入）
 *
 * @param config Agent 工厂配置
 * @param llm LLM 适配器
 * @param toolkit 工具箱
 * @param memory 记忆存储（可选，memoryEnabled 为 true 时必需）
 */
export declare function createAgent(config: AgentFactoryConfig, llm: LlmAdapter, toolkit: Toolkit, memory?: MemoryStore): Agent & {
    setPool(pool: AgentPool, instanceId: string): void;
    setSafeReporter(reporter: SafeErrorReporter): void;
};
//# sourceMappingURL=agent-factory.d.ts.map