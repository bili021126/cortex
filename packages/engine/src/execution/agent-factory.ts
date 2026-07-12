// @layer 规划-执行层
// @role Agent 工厂——替代 BaseAgent 继承模式

import {
  AgentStatus as AS,
} from "@cortex/shared";
import type {
  Agent,
  TaskNode,
  NodeResult,
  AgentType,
  MemoryQuery,
  SafeErrorReporter,
  AgentStatus,
  MemoryEntry,
  ReadMode,
} from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "@cortex/platform";
import type { MemoryStore } from "@cortex/memory-store";
import type { AgentPool } from "@cortex/scheduler";
import { PoolAwareState } from "./pool-aware.js";
import type { ReActContext } from "./react-loop.js";
import { executeWithMemoryPipeline, resolvePipeline } from "../memory-bridge/pipeline.js";
import { loopStrategyRegistry } from "../core/loop-strategy-registry.js";
import { DEFAULT_ENGINE_CONFIG } from "@cortex/config";

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
export function createAgent(
  config: AgentFactoryConfig,
  llm: LlmAdapter,
  toolkit: Toolkit,
  memory?: MemoryStore,
): Agent & {
  setPool(pool: AgentPool, instanceId: string): void;
  setSafeReporter(reporter: SafeErrorReporter): void;
} {
  const maxLoops = config.maxLoops ?? DEFAULT_ENGINE_CONFIG.defaultMaxLoops;
  const state = new PoolAwareState(config.type);
  let safeReporter: SafeErrorReporter | null = null;

  // ── ReAct 上下文（execution 时构建完整 ctx） ──
  const buildCtx = (): ReActContext => ({
    agentType: config.type,
    llm,
    toolkit,
    systemPrompt: config.systemPrompt,
    maxLoops,
    reactLoopTimeoutMs: DEFAULT_ENGINE_CONFIG.reactLoopTimeoutMs,
    memory,
    safeReporter: safeReporter ?? undefined,
  });

  const agent = {
    type: config.type,

    get status(): AgentStatus {
      return state.status;
    },

    async wakeup(): Promise<void> {
      const t0 = Date.now();
      try {
        state.transition(AS.Awake);
        console.error(`[telemetry] agent.lifecycle agent=${config.type} event=wakeup durationMs=${Date.now() - t0}`);
      } catch (e) {
        console.error(`Agent ${config.type} wakeup 失败: ${e}`);
      }
    },

    async execute(node: TaskNode, model: string): Promise<NodeResult> {
      // @fix N3 (enhancement-review) — transition(Active) 失败时拒绝执行，
      // 防止池配额耗尽后 Agent 仍绕过限制执行任务。
      if (!state.transition(AS.Active)) {
        return {
          nodeId: node.id,
          success: false,
          output: `[${config.type}] 状态转换拒绝: 无法进入 Active（池配额耗尽或非法状态）`,
          error: "AGENT_TRANSITION_DENIED",
        };
      }
      try {
        const enrichedNode = config.preExecuteHook
          ? await config.preExecuteHook(node)
          : node;

        const ctx = buildCtx();
        // 如果 MetaAgent 已设定策略 → 直接用；否则 → 规则路由自动选择
        let strategyName = enrichedNode.preferredStrategy
          ?? loopStrategyRegistry.selectByRule(enrichedNode)?.name;

        // 🔥 code/fix/ops Agent 强制走 ReAct 循环——这些 Agent 必须调用 write_file 等工具
        // DirectStep 是单次 LLM 调用不进 ReAct 循环，不出工具调用，导致任务产出代码文本而非文件
        // @fix code-agent-no-writefile: loopStrategyRegistry 对 payload<200 的任务返回 "direct"，
        //   DirectStep 不传工具定义给 LLM，Agent 永远不调 write_file。
        if (strategyName === "direct" && ["code", "fix", "ops"].includes(config.type)) {
          console.error(`[TRACE dispatch] agentType=${config.type} originalStrategy=direct → forced=react (reason: tool-dependent agent must use ReAct loop)`);
          strategyName = "react";
        } else {
          console.error(`[TRACE dispatch] agentType=${config.type} strategy=${strategyName ?? "react(fallback)"} nodeId=${node.id}`);
        }

        const steps = resolvePipeline(strategyName);
        const result = config.memoryEnabled && memory
          ? await executeWithMemoryPipeline(
              ctx, enrichedNode, model,
              config.getMemoryQuery,
              safeReporter ?? undefined,
              config.filterRead,
              steps,
            )
          : await executeWithMemoryPipeline(
              ctx, enrichedNode, model,
              undefined,
              safeReporter ?? undefined,
              config.filterRead,
              steps,
            );
        return result;
      } finally {
        if (state.status === AS.Active) {
          state.transition(AS.Awake);
        }
      }
    },

    async shutdown(): Promise<void> {
      const t0 = Date.now();
      try {
        state.transition(AS.Draining);
        state.transition(AS.Destroyed);
        console.error(`[telemetry] agent.lifecycle agent=${config.type} event=shutdown durationMs=${Date.now() - t0}`);
      } catch (e) {
        console.error(`Agent ${config.type} shutdown 失败: ${e}`);
      }
    },

    setPool(pool: AgentPool, instanceId: string): void {
      state.setPool(pool, instanceId);
    },

    setSafeReporter(reporter: SafeErrorReporter): void {
      safeReporter = reporter;
      state.setSafeReporter(reporter);
    },
  };

  return (config.postCreateHook ? config.postCreateHook(agent) : agent) as typeof agent;
}
