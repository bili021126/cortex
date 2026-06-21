// @cortex/engine/memory/pipeline —— 记忆增强执行管道
// @layer 记忆层
// @role 记忆管道——检索→增强→执行→写入→校验
import { LinkType, PRESET_CONTEXT_POLICIES } from "@cortex/shared";
import { ContextBuilder } from "@cortex/memory-store";
import { runReActLoop } from "../components/react-loop.js";
import { PipelineRunner } from "@cortex/scheduler";
import { recordTelemetry } from "@cortex/telemetry";
/**
 * 默认记忆检索策略——调用统一入口 makeMemoryQuery。
 * 如果 Agent 不提供自定义 getMemoryQuery，使用此默认实现。
 */
export function defaultMemoryQuery(node) {
    return makeMemoryQuery(node, {
        kind: "TaskLog",
        limit: 5,
    });
}
/**
 * 记忆检索查询工厂函数——统一入口。
 *
 * 11 个 Agent 的关键词提取全部收敛至此处，各 Agent 仅需指定差异化参数
 * （kind / linkTypes / bfsDepth / limit）。
 */
export function makeMemoryQuery(node, opts) {
    const payload = node.payload;
    const keywords = [];
    // 1. CJK 2-gram（中日韩统一汉字区）
    const cjkChars = payload.replace(/[^一-鿿㐀-䶿]/g, "");
    for (let i = 0; i <= cjkChars.length - 2; i++) {
        keywords.push(cjkChars.slice(i, i + 2));
    }
    // 2. 拉丁词（英文/数字/下划线等，长度 > 3 才保留）
    const latinWords = payload.split(/\s+/).filter((w) => w.length > 3);
    keywords.push(...latinWords);
    return {
        keywords,
        kind: opts.kind,
        linkTypes: opts.linkTypes,
        bfsDepth: opts.bfsDepth ?? 2,
        bfsMaxNodes: opts.bfsMaxNodes ?? 20,
        limit: opts.limit ?? 3,
        bfsDirection: opts.bfsDirection ?? 'outbound',
    };
}
// ──────────────────────────────────────────────────────────────
// 管道步骤定义（可插拔积木）
// ──────────────────────────────────────────────────────────────
/**
 * MemoryRetrievalStep — 记忆检索 + 上下文增强。
 * 从 MemoryStore 检索相关记忆，注入到任务 payload 中。
 * 检索失败不阻塞执行（降级为无记忆）。
 */
export class MemoryRetrievalStep {
    name = "MemoryRetrieval";
    async run(ctx) {
        const { memory, agentType, node, memoryQuery, safeReporter, filterRead } = ctx;
        if (!memory) {
            ctx.enrichedNode = node;
            return ctx;
        }
        try {
            // ── Core-2: ContextPolicy 驱动上下文构建 ──
            const contextPolicyId = node.contextPolicyId;
            if (contextPolicyId && PRESET_CONTEXT_POLICIES[contextPolicyId]) {
                const policy = PRESET_CONTEXT_POLICIES[contextPolicyId];
                const builder = new ContextBuilder(memory);
                const result = await builder.build(policy, node);
                // ── 遥测：记录上下文构建统计 ──
                void recordTelemetry("context.builder.total_retrieved", result.totalRetrieved, [
                    { key: "policy", value: contextPolicyId },
                    { key: "agent", value: agentType },
                ], {
                    afterDedup: result.afterDedup,
                    injected: result.injected,
                    charCount: result.charCount,
                    tierCounts: result.tierCounts,
                });
                if (result.injected > 0) {
                    ctx.enrichedNode = {
                        ...node,
                        payload: `上下文记忆（${result.injected}/${result.totalRetrieved} 条，${result.charCount} 字符）：\n${result.context}\n\n任务：${node.payload}`,
                    };
                }
                else {
                    ctx.enrichedNode = node;
                }
                return ctx;
            }
            // ── 回退：关键词检索（无 ContextPolicy） ──
            const query = memoryQuery ? memoryQuery(node) : defaultMemoryQuery(node);
            const ctxRecords = await memory.read(query);
            const filtered = filterRead ? filterRead(ctxRecords, "CSA") : ctxRecords;
            if (filtered.length > 0) {
                const ctxSummary = filtered.map((m) => `[记忆] ${m.summary}`).join("\n");
                ctx.enrichedNode = {
                    ...node,
                    payload: `上下文记忆：\n${ctxSummary}\n\n任务：${node.payload}`,
                };
            }
            else {
                ctx.enrichedNode = node;
            }
        }
        catch (e) {
            ctx.enrichedNode = node;
            console.warn(`[MemoryRetrievalStep] 节点 ${node.id} 记忆检索失败，降级为无记忆执行: ${String(e).slice(0, 200)}`);
            if (safeReporter) {
                safeReporter({
                    source: `${agentType}.MemoryRetrievalStep`,
                    error: e,
                    severity: "degraded",
                    hint: `节点 ${node.id} 记忆检索失败，降级为无记忆执行`,
                });
            }
        }
        return ctx;
    }
}
/**
 * ReActLoopStep — ReAct 循环执行。
 * 从 ctx 提取 ReActContext，调用共享的 runReActLoop。
 * 将来可通过构造函数注入不同的循环策略（Direct / Decompose / Jury）。
 */
export class ReActLoopStep {
    name = "ReActLoop";
    async run(ctx) {
        const node = ctx.enrichedNode ?? ctx.node;
        const reactCtx = {
            agentType: ctx.agentType,
            llm: ctx.llm,
            toolkit: ctx.toolkit,
            systemPrompt: ctx.systemPrompt,
            maxLoops: ctx.maxLoops,
            reactLoopTimeoutMs: ctx.reactLoopTimeoutMs,
            memory: ctx.memory,
            safeReporter: ctx.safeReporter,
        };
        ctx.result = await runReActLoop(reactCtx, node, ctx.model);
        return ctx;
    }
}
/**
 * MemoryWriteStep — 记忆写入。
 * 成功和失败都写（失败经验价值最高）。
 */
export class MemoryWriteStep {
    name = "MemoryWrite";
    async run(ctx) {
        const { memory, agentType, node, result, safeReporter } = ctx;
        if (memory && result) {
            await _rememberResult(memory, agentType, node, result, safeReporter);
        }
        return ctx;
    }
}
/**
 * DirectStep — 单次 LLM 调用，不进入 ReAct 循环，不调用工具。
 * 适合：意图清晰、无工具依赖的单步任务（如纯文本生成、简单分类）。
 * 仍写记忆，以便后续任务利用上下文。
 */
export class DirectStep {
    name = "Direct";
    async run(ctx) {
        const node = ctx.enrichedNode ?? ctx.node;
        const messages = [
            { role: "system", content: ctx.systemPrompt },
            { role: "user", content: `Task: ${node.payload}` },
        ];
        try {
            const res = await ctx.llm.chat(ctx.model, messages, [], node.reasoningEffort);
            ctx.result = {
                nodeId: node.id,
                agentType: ctx.agentType,
                success: true,
                output: res.content ?? undefined,
            };
        }
        catch (e) {
            ctx.result = {
                nodeId: node.id,
                agentType: ctx.agentType,
                success: false,
                output: `[DirectStep crashed: ${String(e).slice(0, 200)}]`,
                error: `Direct step failed: ${String(e)}`,
            };
        }
        return ctx;
    }
}
// ── 管道配置 ──
/** 默认管道：记忆检索 → ReAct 循环 → 记忆写入 */
export const DEFAULT_PIPELINE = [
    new MemoryRetrievalStep(),
    new ReActLoopStep(),
    new MemoryWriteStep(),
];
/** Direct 管道：单次 LLM 调用 → 记忆写入（跳过记忆检索和 ReAct 循环） */
export const DIRECT_PIPELINE = [
    new DirectStep(),
    new MemoryWriteStep(),
];
/**
 * resolvePipeline —— 根据策略名返回对应的 Step 管道。
 *
 * 策略映射：
 *   "react"  → DEFAULT_PIPELINE   [MemoryRetrieval, ReActLoop, MemoryWrite]
 *   "direct" → DIRECT_PIPELINE    [DirectStep, MemoryWrite]
 *   undefined → DEFAULT_PIPELINE  （回退）
 *   "decompose" / "jury" → 未来扩展
 */
export function resolvePipeline(strategy) {
    if (!strategy)
        return DEFAULT_PIPELINE;
    switch (strategy) {
        case "react": return DEFAULT_PIPELINE;
        case "direct": return DIRECT_PIPELINE;
        // 未来: case "decompose": return DECOMPOSE_PIPELINE;
        // 未来: case "jury": return JURY_PIPELINE;
        default: return DEFAULT_PIPELINE;
    }
}
/**
 * executeWithMemoryPipeline —— 记忆增强执行管道。
 *
 * 流程：检索记忆 → 增强上下文 → ReAct 执行 → 记忆写入。
 * 内部使用 PipelineRunner 串联 DEFAULT_PIPELINE 三个 Step。
 *
 * 签名完全向后兼容——所有现有调用者无需修改。
 *
 * @param ctx    ReAct 上下文
 * @param node   任务节点
 * @param model  LLM 模型
 * @param memoryQuery    可选自定义记忆检索策略
 * @param safeReporter   可选错误上报器
 * @param filterRead     可选读路径 Intent 过滤
 * @returns NodeResult
 */
export async function executeWithMemoryPipeline(ctx, node, model, memoryQuery, safeReporter, filterRead, customSteps) {
    const pipelineCtx = {
        agentType: ctx.agentType,
        llm: ctx.llm,
        toolkit: ctx.toolkit,
        systemPrompt: ctx.systemPrompt,
        maxLoops: ctx.maxLoops,
        reactLoopTimeoutMs: ctx.reactLoopTimeoutMs ?? 300_000,
        model,
        memory: ctx.memory,
        safeReporter: safeReporter ?? ctx.safeReporter,
        filterRead,
        memoryQuery,
        node,
    };
    const steps = customSteps ?? DEFAULT_PIPELINE;
    const finalCtx = await PipelineRunner.run(steps, pipelineCtx);
    if (!finalCtx.result) {
        throw new Error(`Pipeline [${steps.map(s => s.name).join("→")}] completed without result for node ${node.id}`);
    }
    return finalCtx.result;
}
/**
 * 将执行结果写入 MemoryStore（成功和失败都写）。
 *
 * 成功记忆：Episodic，weight=5，记录决策和产出
 * 失败记忆：Episodic，weight=3（经验教训，价值高但不重复推荐），记录错误原因
 *
 * 包括：主记忆（Episodic）+ 上下文记忆 + 链接。
 *
 * @fix H-01 — catch 块清理半成品 Pending 条目，防止残品占满 MAX_TOTAL_MEMORIES
 */
async function _rememberResult(memory, agentType, node, result, safeReporter) {
    const isSuccess = result.success;
    const isFix = node.type === "bugfix" || node.type === "refactor";
    const content = {
        taskType: node.type,
        entities: node.tags,
        decision: result.output ?? (result.error ?? ""),
        outcome: isSuccess ? "success" : "failure",
    };
    if (isFix) {
        content.pitfall = node.payload.slice(0, 300);
    }
    if (!isSuccess) {
        content.lesson = `${agentType} 执行 ${node.type} 失败。错误: ${(result.error ?? "unknown").slice(0, 300)}`;
    }
    else if (isFix) {
        content.lesson = `${agentType} successfully fixed a ${node.type}. The original error context is preserved above.`;
    }
    // v3: semantic_gist = summary（暂从 summary 复刻，后续由 LLM 萃取增强）
    const mainSummary = isSuccess
        ? `[${isFix ? "修复记录" : "完成"}] ${agentType} × ${node.type}: ${node.payload.slice(0, 120)}`
        : `[失败教训] ${agentType} × ${node.type}: ${(result.error ?? "unknown").slice(0, 120)}`;
    const source = { agentType, taskId: node.id };
    let memId;
    let ctxMemId;
    try {
        memId = memory.writePending({
            source,
            kind: "TaskLog",
            summary: mainSummary,
            semantic_gist: mainSummary.slice(0, 200),
            content_blob: content,
            content_hash: "", // 由 writePending 内部计算
            weight: isSuccess ? 5 : 3,
        });
        const ctxContent = {
            nodeId: node.id,
            nodeType: node.type,
            tags: node.tags,
            outcome: isSuccess ? "success" : "failure",
            snippet: String(content.decision).slice(0, 200),
        };
        const ctxSummary = `[上下文] 节点 ${node.id} (${node.type}): ${node.payload.slice(0, 120)}`;
        ctxMemId = memory.writePending({
            source,
            kind: "TaskLog",
            summary: ctxSummary,
            semantic_gist: ctxSummary.slice(0, 200),
            content_blob: ctxContent,
            content_hash: "",
            weight: 2,
        });
        memory.link(memId, ctxMemId, LinkType.ProducedBy);
        if (isFix && node.parentId) {
            const parentMemories = await memory.read({
                metadataFilter: { taskId: node.parentId },
                limit: 1,
            });
            if (parentMemories.length > 0) {
                memory.link(memId, parentMemories[0].id, LinkType.ProducedBy);
            }
        }
        const ok1 = memory.commitMemory(memId);
        const ok2 = memory.commitMemory(ctxMemId);
        if (!ok1 || !ok2) {
            safeReporter?.({
                source: `${agentType}.executeWithMemoryPipeline._rememberResult`,
                error: new Error(`commit 部分失败: main=${ok1}, ctx=${ok2}`),
                severity: "degraded",
                hint: `节点 ${node.id} 记忆提交失败，main=${ok1}, ctx=${ok2}`,
            });
        }
    }
    catch (memErr) {
        // 统一取消——自动判断 Pending→rollback / Active→archive
        try {
            if (memId !== undefined)
                memory.cancel(memId);
        }
        catch { /* 静默 */ }
        try {
            if (ctxMemId !== undefined)
                memory.cancel(ctxMemId);
        }
        catch { /* 静默 */ }
        const hint = `任务 ${node.id} 已${isSuccess ? "成功" : "失败"}完成，但记忆写入失败，半成品 Pending 条目已清理`;
        if (safeReporter) {
            safeReporter({
                source: `${agentType}.executeWithMemoryPipeline._rememberResult`,
                error: memErr,
                severity: "degraded",
                hint,
            });
        }
    }
}
/**
 * 将子 Agent 的完整输出压缩为 Context Sharding 摘要。
 *
 * 模仿 Kimi Agent Swarm 的"子 Agent 只汇报关键结论"模式：
 * - 提取前 200 字作为关键发现
 * - 提取文件路径和工具调用
 * - 丢弃完整推理中间过程
 *
 * @param nodeResult 子 Agent 的完整执行结果
 * @returns 压缩后的摘要，可写入 MemoryStore 供协调者读取
 */
export function compactToSubAgentSummary(nodeResult) {
    const output = nodeResult.output ?? "";
    const keyFindings = output.slice(0, 200).replace(/\n/g, " ");
    // 提取文件路径
    const fileMatches = output.match(/[\w./-]+\.(ts|tsx|js|json|md|yaml|yml)/g) ?? [];
    const filesTouched = [...new Set(fileMatches)].slice(0, 10);
    // 提取工具调用
    const toolMatches = output.match(/\[(工具|tool):\s*(\w+)\]/g) ?? [];
    const toolsUsed = [...new Set(toolMatches.map((m) => m.replace(/\[(工具|tool):\s*(\w+)\].*/, "$2")))].slice(0, 10);
    return {
        nodeId: nodeResult.nodeId,
        agentType: nodeResult.agentType,
        success: nodeResult.success,
        keyFindings: keyFindings || (nodeResult.success ? "执行成功" : `失败: ${(nodeResult.error ?? "unknown").slice(0, 100)}`),
        stepsExecuted: (output.match(/step[\s:]*\d+/gi) ?? []).length || 1,
        toolsUsed,
        filesTouched,
    };
}
//# sourceMappingURL=pipeline.js.map