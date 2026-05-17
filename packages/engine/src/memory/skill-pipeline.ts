/**
 * SkillPipeline —— 技能提取与持久化管道（Core-2 技能闭环）。
 *
 * 从 Agent 节点输出中提取技能模板，注册到 SkillRegistry（内存），
 * 并持久化到 MemoryStore（SQLite），实现跨轮次认知复用。
 *
 * 提取失败不阻塞调度——通过 PipelineObserver 上报诊断信息。
 *
 * @since 技能沉淀机制 Core-2
 *
 * @fix D2 — SkillRegistry 类型从 @cortex/shared 改为从本地 ../skill-registry.js 导入。
 *   SkillRegistry 类的实现已从 shared 移入 engine，shared 仅保留 SerializedSkillRegistry 类型。
 */
import type { SkillTemplate, AgentType } from "@cortex/shared";
import type { PipelineObserver } from "../pipeline-observer.js";
import type { SkillRegistry } from "../skill-registry.js";
import type { MemoryStore } from "./memory-store.js";
import { extractSkillsFromOutput } from "../components/index.js";
import { persistSkillsToMemory } from "../components/index.js";
import { PipelineEventType, PipelinePriority } from "@cortex/shared";
import type { PipelineHandler } from "@cortex/shared";

/**
 * 从节点输出中提取技能并注册+持久化。
 *
 * @returns 成功注册的技能模板数组。
 */
export function extractAndPersistSkills(
  skillRegistry: SkillRegistry,
  memoryStore: MemoryStore | undefined,
  observer: PipelineObserver,
  nodeId: string,
  agentType: AgentType,
  output: string,
): SkillTemplate[] {
  const { skills, diagnostics } = extractSkillsFromOutput(output);

  for (const diag of diagnostics) {
    observer.emit({
      type: PipelineEventType.NodeComplete,
      priority: PipelinePriority.NORMAL,
      payload: {
        nodeId,
        agentType: agentType as string,
        success: true,
        output: `[skill-extractor] ${diag}`,
      },
      timestamp: Date.now(),
    });
  }

  if (skills.length === 0) return [];

  const registered: SkillTemplate[] = [];
  for (const skill of skills) {
    try {
      skillRegistry.register(skill);
      registered.push(skill);
    } catch (e) {
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
        agentType: agentType as string,
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
export function registerSkillPipeline(
  observer: PipelineObserver,
  skillRegistry: SkillRegistry,
  memoryStore?: MemoryStore,
): () => void {
  const handler: PipelineHandler = (event) => {
    if (event.type !== PipelineEventType.NodeComplete) return;
    const payload = event.payload as { nodeId: string; agentType: string; success: boolean; output?: string };
    if (!payload.success || !payload.output) return;

    extractAndPersistSkills(
      skillRegistry,
      memoryStore,
      observer,
      payload.nodeId,
      payload.agentType as AgentType,
      payload.output,
    );
  };

  observer.on(PipelinePriority.HIGH, handler);

  // 返回取消订阅函数
  return () => observer.off(PipelinePriority.HIGH, handler);
}
