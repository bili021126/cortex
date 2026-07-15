// ============================================================
// @cortex/engine/bootstrap/init-skills —— 技能系统初始化
//
// @since v2.6 — 重构：技能即记忆，SkillExecutor 已移除。
//   Agent 自主拉取技能参照，不通过强制注入。
// ============================================================
 

import { SkillRegistry, deriveStatus } from "@cortex/skill-kit";
import { registerSkillPipeline } from "@cortex/skill-kit";
import { crystallizeSkillToKnowledge, loadSkillsFromMemory, persistSkillsToMemory, verifySkillKnowledge } from "@cortex/skill-kit";
import type { ExternalSearcher } from "@cortex/skill-kit";
import type { MemoryStore } from "@cortex/memory-store";
import type { IMemoryStore, IPipelineObserver, SkillTemplate } from "@cortex/shared";
import { PipelineEventType, PipelinePriority } from "@cortex/shared";
import type { MetaAgent } from "../core/meta-agent.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function initSkillSystem(
  observer: IPipelineObserver,
  memory: IMemoryStore | undefined,
  metaAgent: MetaAgent,
  projectRoot: string,
  externalSearch?: ExternalSearcher,
): Promise<SkillRegistry> {
  const skillRegistry = new SkillRegistry();
  const onSkillStatusChange = async (skill: SkillTemplate, oldStatus: string) => {
    if (memory) {
      try {
        persistSkillsToMemory([skill], memory as MemoryStore);
      } catch (e) {
        observer.emit({
          type: PipelineEventType.ErrorReported,
          priority: PipelinePriority.NORMAL,
          payload: { message: `[bootstrapEngine] 技能状态变更持久化失败 (MemoryStore): ${skill.id}: ${e instanceof Error ? e.message : String(e)}` },
          timestamp: Date.now(),
          notificationType: "WARNING",
        });
      }

      // 结晶为知识：trial → active 时，先事实认证再写入 MemoryKind.Knowledge（幂等更新）
      const currentStatus = deriveStatus(skill.weight, skill.feedbackHistory);
      if (currentStatus === "active" && oldStatus !== "active") {
        try {
          const vr = externalSearch
            ? await verifySkillKnowledge(skill, memory as MemoryStore, "analysis-agent", { externalSearch })
            : await verifySkillKnowledge(skill, memory as MemoryStore, "analysis-agent");
          process.stderr.write(`[bootstrapEngine] 知识验证: ${skill.name} verified=${vr.verified}`);
          if (vr.externalResults && vr.externalResults.length > 0) {
            process.stderr.write(`[bootstrapEngine] 外部佐证: ${vr.externalResults.length} 条 web_search 结果`);
          }

          const result = await crystallizeSkillToKnowledge(skill, memory as MemoryStore, {
            verifiedBy: vr.verified ? "analysis-agent" : undefined,
            evidenceIds: vr.evidenceIds,
          });
          if (result) {
            const tag = result.isUpdate ? "更新(v" + result.version + ")" : "新建";
            process.stderr.write(`[bootstrapEngine] 技能结晶为知识: ${skill.name} ${tag} verified=${result.verified}`);
          }
        } catch (e) {
          observer.emit({
            type: PipelineEventType.ErrorReported,
            priority: PipelinePriority.NORMAL,
            payload: { message: `[bootstrapEngine] 技能结晶为知识失败: ${skill.id}: ${e instanceof Error ? e.message : String(e)}` },
            timestamp: Date.now(),
            notificationType: "WARNING",
          });
        }
      }
    }
    process.stderr.write(`[bootstrapEngine] 技能状态变更: ${skill.name}(${skill.id}) ${oldStatus} → ${deriveStatus(skill.weight, skill.feedbackHistory)}`);
  };

  // 将 onSkillStatusChange 挂到 registry 上（供 recordFeedback 等调用）
  (skillRegistry as unknown as { _onStatusChange: typeof onSkillStatusChange })._onStatusChange = onSkillStatusChange;

  metaAgent.setSkillRegistry(skillRegistry);
  registerSkillPipeline(observer, skillRegistry, memory);

  // 从 MemoryStore 恢复已持久化的技能模板
  // Core-2 Batch1: 若 MemoryStore 为空，回退从 skills/ 目录加载 JSON
  let loadedSkills: SkillTemplate[] = [];
  if (memory) {
    try {
      loadedSkills = await loadSkillsFromMemory(memory as MemoryStore);
      if (loadedSkills.length > 0) {
        skillRegistry.registerAll(loadedSkills);
        process.stderr.write(
          `[bootstrapEngine] 从记忆库恢复 ${loadedSkills.length} 个技能模板: ` +
          loadedSkills.map((s) => `${s.name}(${s.id})`).join(", "),
        );
      }
    } catch (e) {
      observer.emit({
        type: PipelineEventType.ErrorReported,
        priority: PipelinePriority.NORMAL,
        payload: { message: `[bootstrapEngine] 从记忆库加载技能失败（非致命）: ${e}` },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    }
  }

  // Core-2 Batch1: MemoryStore 为空时回退——从 skills/ 目录加载 JSON 文件
  if (loadedSkills.length === 0) {
    try {
      const skillDir = path.join(projectRoot, "skills");
      let dirEntries: string[] = [];
      try {
        dirEntries = await fs.readdir(skillDir);
      } catch {
        // 目录不存在 → 静默跳过
        return skillRegistry;
      }
      const files = dirEntries.filter((f) => f.endsWith(".json"));
      const fileSkills: SkillTemplate[] = [];
      for (const f of files) {
        try {
          const raw = await fs.readFile(path.join(skillDir, f), "utf-8");
          const skill = JSON.parse(raw) as SkillTemplate;
          if (skill.id && skill.triggerTags && skill.steps) {
            fileSkills.push(skill);
          }
        } catch {
          // 单个文件解析失败不阻断
          process.stderr.write(`[bootstrapEngine] 跳过技能文件（解析失败）: ${f}\n`);
        }
      }
      if (fileSkills.length > 0) {
        skillRegistry.registerAll(fileSkills);
        process.stderr.write(
          `[bootstrapEngine] 从 skills/ 目录加载 ${fileSkills.length} 个技能模板: ` +
          fileSkills.map((s) => `${s.name}(${s.id})`).join(", "),
        );
      }
    } catch (e) {
      observer.emit({
        type: PipelineEventType.ErrorReported,
        priority: PipelinePriority.NORMAL,
        payload: { message: `[bootstrapEngine] 从 skills/ 目录加载技能失败（非致命）: ${e}` },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    }
  }

  return skillRegistry;
}
