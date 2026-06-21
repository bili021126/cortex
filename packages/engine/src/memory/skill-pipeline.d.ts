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
import { type AgentType, type IMemoryStore, type IPipelineObserver, type SkillTemplate } from "@cortex/shared";
import type { SkillRegistry } from "../registry/skill-registry.js";
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
export declare function emitSkillReferenced(observer: IPipelineObserver, matchedSkills: SkillTemplate[], nodeId: string, agentType: AgentType): void;
/**
 * 从 Agent 输出中尝试提取技能使用声明。
 *
 * Agent 可以在输出中声明使用了哪些技能步骤，格式：
 *   [技能参照: skillName] used=[0,1,2] skipped=[3] adaptation="..."
 *
 * @returns 提取到的使用信息，失败返回 null
 */
export declare function extractSkillUsageFromOutput(output: string): Array<{
    skillName: string;
    stepsUsed?: number[];
    stepsSkipped?: number[];
    adaptation?: string;
}> | null;
/**
 * 从节点输出中提取技能并注册+持久化。
 *
 * @returns 成功注册的技能模板数组。
 */
export declare function extractAndPersistSkills(skillRegistry: SkillRegistry, memoryStore: IMemoryStore | undefined, observer: IPipelineObserver, nodeId: string, agentType: AgentType, output: string): SkillTemplate[];
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
export declare function registerSkillPipeline(observer: IPipelineObserver, skillRegistry: SkillRegistry, memoryStore?: IMemoryStore): () => void;
//# sourceMappingURL=skill-pipeline.d.ts.map