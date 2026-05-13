import type {
  Agent, TaskNode, NodeResult, AgentType, MemoryQuery,
  SafeErrorReporter, AgentStatus,
} from "@cortex/shared";
import { AgentStatus as AS } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "../toolkit.js";
import type { MemoryStore } from "../memory-store.js";
import type { AgentPool } from "../agent-pool.js";
import { PoolAwareState } from "../pool-aware.js";
import { type ReActContext } from "./react-loop.js";
import { executeWithMemoryPipeline } from "../memory/pipeline.js";

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
export function createAgent(
  config: AgentFactoryConfig,
  llm: LlmAdapter,
  toolkit: Toolkit,
  memory?: MemoryStore,
): Agent & {
  setPool(pool: AgentPool, instanceId: string): void;
  setSafeReporter(reporter: SafeErrorReporter): void;
} {
  const maxLoops = config.maxLoops ?? 64;
  const state = new PoolAwareState(config.type);
  let safeReporter: SafeErrorReporter | null = null;

  // ── ReAct 上下文（execution 时构建完整 ctx） ──
  const buildCtx = (): ReActContext => ({
    agentType: config.type,
    llm,
    toolkit,
    systemPrompt: config.systemPrompt,
    maxLoops,
    memory,
    safeReporter: safeReporter ?? undefined,
  });

  const agent = {
    type: config.type,

    get status(): AgentStatus {
      return state.status;
    },

    async wakeup(): Promise<void> {
      state.transition(AS.Awake);
    },

    async execute(node: TaskNode, model: string): Promise<NodeResult> {
      state.transition(AS.Active);
      try {
        const enrichedNode = config.preExecuteHook
          ? await config.preExecuteHook(node)
          : node;

        const ctx = buildCtx();
        const result = config.memoryEnabled && memory
          ? await executeWithMemoryPipeline(
              ctx, enrichedNode, model,
              config.getMemoryQuery,
              safeReporter ?? undefined,
            )
          : await executeWithMemoryPipeline(
              ctx, enrichedNode, model,
              undefined,
              safeReporter ?? undefined,
            );
        return result;
      } finally {
        if (state.status === AS.Active) {
          state.transition(AS.Awake);
        }
      }
    },

    async shutdown(): Promise<void> {
      state.transition(AS.Draining);
      state.transition(AS.Destroyed);
    },

    setPool(pool: AgentPool, instanceId: string): void {
      state.setPool(pool, instanceId);
    },

    setSafeReporter(reporter: SafeErrorReporter): void {
      safeReporter = reporter;
      state.setSafeReporter(reporter);
    },
  };

  return agent;
}
