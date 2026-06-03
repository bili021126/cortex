import type { TaskNode } from "@cortex/shared";
import type { DispatchCtx, IDispatchStep } from "./types.js";
import type { SkillExecutor } from "../skill-executor.js";

/**
 * SkillInjectionStep —— 技能上下文注入。
 *
 * 职责：
 * 1. 通过 SkillExecutor 按节点标签匹配最佳技能
 * 2. 将技能 prompt 注入节点 payload 前
 *
 * 无匹配技能时原样透传节点（不中断管道）。
 * 此步骤从 scheduler.ts 的 _injectSkillIntoNode 模块级函数迁移而来。
 */
export class SkillInjectionStep implements IDispatchStep {
  readonly name = "SkillInjection";

  async run(ctx: DispatchCtx): Promise<DispatchCtx> {
    const { skillExecutor, node } = ctx;

    if (!skillExecutor) {
      return { ...ctx, enrichedNode: node };
    }

    const enriched = _injectSkillIntoNode(node, skillExecutor);
    return {
      ...ctx,
      enrichedNode: enriched.node,
      matchedSkillId: enriched.matchedSkillId,
    };
  }
}

/**
 * 为节点注入匹配的技能上下文到 payload。
 * 不改动原节点——返回浅拷贝，payload 前插入技能 prompt。
 * @returns 增强后的节点 + 匹配到的技能 ID（无匹配则为 null）
 */
function _injectSkillIntoNode(
  node: TaskNode,
  executor: SkillExecutor,
): { node: TaskNode; matchedSkillId: string | null } {
  const matched = executor.matchSkill(node.tags as import("@cortex/shared").Tag[]);
  if (!matched) return { node, matchedSkillId: null };
  const skillCtx = executor.injectSkillContext(matched.id);
  if (!skillCtx) return { node, matchedSkillId: null };
  return {
    node: {
      ...node,
      payload: `${skillCtx}\n\n${node.payload}`,
    },
    matchedSkillId: matched.id,
  };
}
