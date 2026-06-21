// @layer 规划-执行层
// @role Agent 工厂——替代 BaseAgent 继承模式
import { AgentStatus as AS, } from "@cortex/shared";
import { PoolAwareState } from "./pool-aware.js";
import { executeWithMemoryPipeline, resolvePipeline } from "../memory/pipeline.js";
import { loopStrategyRegistry } from "../core/loop-strategy-registry.js";
import { DEFAULT_ENGINE_CONFIG } from "@cortex/config";
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
export function createAgent(config, llm, toolkit, memory) {
    const maxLoops = config.maxLoops ?? DEFAULT_ENGINE_CONFIG.defaultMaxLoops;
    const state = new PoolAwareState(config.type);
    let safeReporter = null;
    // ── ReAct 上下文（execution 时构建完整 ctx） ──
    const buildCtx = () => ({
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
        get status() {
            return state.status;
        },
        async wakeup() {
            state.transition(AS.Awake);
        },
        async execute(node, model) {
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
                const strategyName = enrichedNode.preferredStrategy
                    ?? loopStrategyRegistry.selectByRule(enrichedNode)?.name;
                const steps = resolvePipeline(strategyName);
                const result = config.memoryEnabled && memory
                    ? await executeWithMemoryPipeline(ctx, enrichedNode, model, config.getMemoryQuery, safeReporter ?? undefined, config.filterRead, steps)
                    : await executeWithMemoryPipeline(ctx, enrichedNode, model, undefined, safeReporter ?? undefined, config.filterRead, steps);
                return result;
            }
            finally {
                if (state.status === AS.Active) {
                    state.transition(AS.Awake);
                }
            }
        },
        async shutdown() {
            state.transition(AS.Draining);
            state.transition(AS.Destroyed);
        },
        setPool(pool, instanceId) {
            state.setPool(pool, instanceId);
        },
        setSafeReporter(reporter) {
            safeReporter = reporter;
            state.setSafeReporter(reporter);
        },
    };
    return (config.postCreateHook ? config.postCreateHook(agent) : agent);
}
//# sourceMappingURL=agent-factory.js.map