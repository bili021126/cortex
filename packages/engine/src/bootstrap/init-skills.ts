// ============================================================
// @cortex/engine/bootstrap/init-skills —— 技能系统初始化
// ============================================================
/* eslint-disable no-console */

import { SkillRegistry } from "../registry/skill-registry.js";
import { SkillExecutor } from "../core/skill-executor.js";
import { registerSkillPipeline } from "../memory/skill-pipeline.js";
import { loadSkillsFromMemory, persistSkillsToMemory, crystallizeSkillToKnowledge, verifySkillKnowledge } from "../components/skill-persister.js";
import type { ExternalSearcher } from "../components/skill-persister.js";
import type { MemoryStore } from "../memory/memory-store.js"; // for cast only
import type { IPipelineObserver, IMemoryStore } from "@cortex/shared";
import type { Scheduler } from "../core/scheduler.js";
import type { MetaAgent } from "../core/meta-agent.js";
import type { SkillTemplate } from "@cortex/shared";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ENGINE_CONFIG, DIR_CORTEX } from "@cortex/config";

export interface SkillSystemComponents {
  skillRegistry: SkillRegistry;
  skillExecutor: SkillExecutor;
}

export async function initSkillSystem(
  observer: IPipelineObserver,
  memory: IMemoryStore | undefined,
  scheduler: Scheduler,
  metaAgent: MetaAgent,
  projectRoot: string,
  externalSearch?: ExternalSearcher,
): Promise<SkillSystemComponents> {
  const skillRegistry = new SkillRegistry();
  const skillJsonPath = join(projectRoot, DIR_CORTEX, DEFAULT_ENGINE_CONFIG.filePaths.skillRegistry!);

  const onSkillStatusChange = async (skill: SkillTemplate, oldStatus: string) => {
    if (memory) {
      try {
        persistSkillsToMemory([skill], memory as MemoryStore);
      } catch (e) {
        console.warn(
          `[bootstrapEngine] 技能状态变更持久化失败 (MemoryStore): ${skill.id}`,
          e instanceof Error ? e.message : String(e),
        );
      }

      // 结晶为知识：trial → active 时，先事实认证再写入 MemoryType.Knowledge（幂等更新）
      if (skill.status === "active" && oldStatus !== "active") {
        try {
          // 1. 验证：内部（情景记忆）+ 外部（web_search）
          const vr = externalSearch
            ? await verifySkillKnowledge(skill, memory as MemoryStore, "analysis-agent", { externalSearch })
            : await verifySkillKnowledge(skill, memory as MemoryStore, "analysis-agent");
          console.log(`[bootstrapEngine] 知识验证: ${skill.name} verified=${vr.verified}`);
          if (vr.externalResults && vr.externalResults.length > 0) {
            console.log(`[bootstrapEngine] 外部佐证: ${vr.externalResults.length} 条 web_search 结果`);
          }

          // 2. 结晶：传入验证结果
          const result = await crystallizeSkillToKnowledge(skill, memory as MemoryStore, {
            verifiedBy: vr.verified ? "analysis-agent" : undefined,
            evidenceIds: vr.evidenceIds,
          });
          if (result) {
            const tag = result.isUpdate ? "更新(v" + result.version + ")" : "新建";
            console.log(`[bootstrapEngine] 技能结晶为知识: ${skill.name} ${tag} verified=${result.verified}`);
          }
        } catch (e) {
          console.warn(
            `[bootstrapEngine] 技能结晶为知识失败: ${skill.id}`,
            e instanceof Error ? e.message : String(e),
          );
        }
      }
    }
    // JSON 文件已弃用——MemoryStore 是唯一持久化源（§持久线）
    console.log(`[bootstrapEngine] 技能状态变更: ${skill.name}(${skill.id}) ${oldStatus} → ${skill.status}`);
  };

  const skillExecutor = new SkillExecutor(skillRegistry, onSkillStatusChange);
  metaAgent.setSkillRegistry(skillRegistry);
  registerSkillPipeline(observer, skillRegistry, memory);
  scheduler.setSkillExecutor(skillExecutor);

  // 从 MemoryStore 恢复已持久化的技能模板
  if (memory) {
    try {
      const loadedSkills = await loadSkillsFromMemory(memory as MemoryStore);
      if (loadedSkills.length > 0) {
        skillRegistry.registerAll(loadedSkills);
        console.log(
          `[bootstrapEngine] 从记忆库恢复 ${loadedSkills.length} 个技能模板: ` +
          loadedSkills.map((s) => `${s.name}(${s.id})`).join(", "),
        );
      }
    } catch (e) {
      console.warn("[bootstrapEngine] 从记忆库加载技能失败（非致命）:", e);
    }
  }

  // [DEPRECATED] JSON 文件冷启动兜底——仅用于从旧版本 MemoryStore 迁移
  // MemoryStore 为空时从 skills-crystallized.json 恢复，后续版本将移除此路径
  if (skillRegistry.totalCount === 0 && existsSync(skillJsonPath)) {
    try {
      const fileRegistry = SkillRegistry.loadJson(skillJsonPath);
      if (fileRegistry.totalCount > 0) {
        skillRegistry.registerAll(fileRegistry.getAll());
        console.log(`[bootstrapEngine] 从 JSON 文件恢复 ${fileRegistry.getAll().length} 个技能模板（迁移兜底）`);
      }
    } catch (e) {
      console.warn("[bootstrapEngine] 从 JSON 文件加载技能失败（非致命）:", e);
    }
  }

  return { skillRegistry, skillExecutor };
}
