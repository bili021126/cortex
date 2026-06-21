/**
 * SkillPipeline —— 技能提取与持久化管道（Core-1 技能闭环）。
 *
 * 从 Agent 节点输出中提取技能模板，注册到 SkillRegistry（内存），
 * 并持久化到 MemoryStore（SQLite），实现跨轮次认知复用。
 *
 * 提取失败不阻塞调度——通过 PipelineObserver 上报诊断信息。
 *
 * @since 技能沉淀机制 Core-1
 *
 * @fix D2 — SkillRegistry 类型从 @cortex/shared 改为从本地 ../skill-registry.js 导入。
 *   SkillRegistry 类的实现已从 shared 移入 engine，shared 仅保留 SerializedSkillRegistry 类型。
 */
import { PipelineEventType, PipelinePriority } from "@cortex/shared";
import { extractSkillsFromOutput, persistSkillsToMemory } from "../components/index.js";
// ─── 技能参照事件发射 ───────────────────────────────────────
/**
 * 当技能被查询/匹配到某个节点时，向管线发射 SkillReferenced 事件。
 *
 * 这是技能可观测性的核心：记录"哪些技能被提供给哪个 Agent/节点"——
 * 独立于 Agent 是否实际采信。事后结合 NodeComplete 结果即可回推效用。
 *
 * @param observer     可观测管道
 * @param matchedSkills 通过 queryByTags 匹配到的技能列表
 * @param nodeId       任务节点 ID
 * @param agentType    执行 Agent 类型
 */
export function emitSkillReferenced(observer, matchedSkills, nodeId, agentType) {
    for (const skill of matchedSkills) {
        observer.emit({
            type: PipelineEventType.SkillReferenced,
            priority: PipelinePriority.NORMAL,
            payload: {
                nodeId,
                agentType,
                skillId: skill.id,
                skillName: skill.name,
            },
            timestamp: Date.now(),
        });
    }
}
/**
 * 从 Agent 输出中尝试提取技能使用声明。
 *
 * Agent 可以在输出中声明使用了哪些技能步骤，格式：
 *   [技能参照: skillName] used=[0,1,2] skipped=[3] adaptation="..."
 *
 * @returns 提取到的使用信息，失败返回 null
 */
export function extractSkillUsageFromOutput(output) {
    const pattern = /\[技能参照:\s*([^\]]+)\]\s*used=\[([^\]]*)\]\s*skipped=\[([^\]]*)\]\s*adaptation="([^"]*)"/g;
    const results = [];
    let match;
    while ((match = pattern.exec(output)) !== null) {
        const used = match[2] ? match[2].split(",").map(Number).filter((n) => !isNaN(n)) : undefined;
        const skipped = match[3] ? match[3].split(",").map(Number).filter((n) => !isNaN(n)) : undefined;
        results.push({
            skillName: match[1].trim(),
            stepsUsed: used && used.length > 0 ? used : undefined,
            stepsSkipped: skipped && skipped.length > 0 ? skipped : undefined,
            adaptation: match[4] || undefined,
        });
    }
    return results.length > 0 ? results : null;
}
/**
 * 从节点输出中提取技能并注册+持久化。
 *
 * @returns 成功注册的技能模板数组。
 */
export function extractAndPersistSkills(skillRegistry, memoryStore, observer, nodeId, agentType, output) {
    const { skills, diagnostics } = extractSkillsFromOutput(output);
    for (const diag of diagnostics) {
        observer.emit({
            type: PipelineEventType.NodeComplete,
            priority: PipelinePriority.NORMAL,
            payload: {
                nodeId,
                agentType: agentType,
                success: true,
                output: `[skill-extractor] ${diag}`,
            },
            timestamp: Date.now(),
        });
    }
    if (skills.length === 0)
        return [];
    const registered = [];
    for (const skill of skills) {
        try {
            skillRegistry.register(skill);
            registered.push(skill);
        }
        catch (e) {
            observer.emit({
                type: PipelineEventType.ErrorReported,
                priority: PipelinePriority.HIGH,
                payload: {
                    source: `skill-pipeline.extractAndPersistSkills.${nodeId}`,
                    severity: "degraded",
                    error: `注册技能 ${skill.id} 失败: ${String(e).slice(0, 200)}`,
                },
                timestamp: Date.now(),
                notificationType: "WARNING",
            });
        }
    }
    if (registered.length > 0) {
        observer.emit({
            type: PipelineEventType.NodeComplete,
            priority: PipelinePriority.NORMAL,
            payload: {
                nodeId,
                agentType: agentType,
                success: true,
                output: `[skill-extractor] 成功注册 ${registered.length}/${skills.length} 个技能模板: ${registered.map((s) => `${s.name}(${s.id})`).join(", ")}`,
            },
            timestamp: Date.now(),
        });
        // 持久化到 MemoryStore
        if (memoryStore) {
            persistSkillsToMemory(registered, memoryStore);
        }
    }
    return registered;
}
/**
 * 注册技能管道订阅者——通过 PipelineObserver 订阅 NodeComplete 事件，
 * 在每个节点成功后提取技能模板并持久化。
 *
 * 订阅者模式：Scheduler 不再持有 SkillRegistry/MemoryStore 引用，
 * 技能闭环作为独立订阅者挂载到可观测管道上，与调度核心解耦。
 *
 * @param observer      可观测管道
 * @param skillRegistry 技能注册表
 * @param memoryStore   可选——记忆中枢（用于持久化技能到 SQLite）
 * @returns             取消订阅函数（调用即移除 handler）
 */
export function registerSkillPipeline(observer, skillRegistry, memoryStore) {
    const handler = (event) => {
        if (event.type !== PipelineEventType.NodeComplete)
            return;
        const payload = event.payload;
        if (!payload.success || !payload.output)
            return;
        extractAndPersistSkills(skillRegistry, memoryStore, observer, payload.nodeId, payload.agentType, payload.output);
    };
    observer.on(PipelinePriority.HIGH, handler);
    // 返回取消订阅函数
    return () => observer.off(PipelinePriority.HIGH, handler);
}
//# sourceMappingURL=skill-pipeline.js.map