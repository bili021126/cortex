// ============================================================
// @cortex/engine/bootstrap/init-skills —— 技能系统初始化
//
// @since v2.6 — 重构：技能即记忆，SkillExecutor 已移除。
//   Agent 自主拉取技能参照，不通过强制注入。
// ============================================================
import { SkillRegistry, deriveStatus } from "@cortex/skill-kit";
import { registerSkillPipeline } from "@cortex/skill-kit";
import { crystallizeSkillToKnowledge, loadSkillsFromMemory, persistSkillsToMemory, verifySkillKnowledge } from "@cortex/skill-kit";
export async function initSkillSystem(observer, memory, metaAgent, projectRoot, externalSearch) {
    const skillRegistry = new SkillRegistry();
    const onSkillStatusChange = async (skill, oldStatus) => {
        if (memory) {
            try {
                persistSkillsToMemory([skill], memory);
            }
            catch (e) {
                console.warn(`[bootstrapEngine] 技能状态变更持久化失败 (MemoryStore): ${skill.id}`, e instanceof Error ? e.message : String(e));
            }
            // 结晶为知识：trial → active 时，先事实认证再写入 MemoryKind.Knowledge（幂等更新）
            const currentStatus = deriveStatus(skill.weight, skill.feedbackHistory);
            if (currentStatus === "active" && oldStatus !== "active") {
                try {
                    const vr = externalSearch
                        ? await verifySkillKnowledge(skill, memory, "analysis-agent", { externalSearch })
                        : await verifySkillKnowledge(skill, memory, "analysis-agent");
                    process.stderr.write(`[bootstrapEngine] 知识验证: ${skill.name} verified=${vr.verified}`);
                    if (vr.externalResults && vr.externalResults.length > 0) {
                        process.stderr.write(`[bootstrapEngine] 外部佐证: ${vr.externalResults.length} 条 web_search 结果`);
                    }
                    const result = await crystallizeSkillToKnowledge(skill, memory, {
                        verifiedBy: vr.verified ? "analysis-agent" : undefined,
                        evidenceIds: vr.evidenceIds,
                    });
                    if (result) {
                        const tag = result.isUpdate ? "更新(v" + result.version + ")" : "新建";
                        process.stderr.write(`[bootstrapEngine] 技能结晶为知识: ${skill.name} ${tag} verified=${result.verified}`);
                    }
                }
                catch (e) {
                    console.warn(`[bootstrapEngine] 技能结晶为知识失败: ${skill.id}`, e instanceof Error ? e.message : String(e));
                }
            }
        }
        process.stderr.write(`[bootstrapEngine] 技能状态变更: ${skill.name}(${skill.id}) ${oldStatus} → ${deriveStatus(skill.weight, skill.feedbackHistory)}`);
    };
    // 将 onSkillStatusChange 挂到 registry 上（供 recordFeedback 等调用）
    skillRegistry._onStatusChange = onSkillStatusChange;
    metaAgent.setSkillRegistry(skillRegistry);
    registerSkillPipeline(observer, skillRegistry, memory);
    // 从 MemoryStore 恢复已持久化的技能模板
    if (memory) {
        try {
            const loadedSkills = await loadSkillsFromMemory(memory);
            if (loadedSkills.length > 0) {
                skillRegistry.registerAll(loadedSkills);
                process.stderr.write(`[bootstrapEngine] 从记忆库恢复 ${loadedSkills.length} 个技能模板: ` +
                    loadedSkills.map((s) => `${s.name}(${s.id})`).join(", "));
            }
        }
        catch (e) {
            console.warn("[bootstrapEngine] 从记忆库加载技能失败（非致命）:", e);
        }
    }
    return skillRegistry;
}
//# sourceMappingURL=init-skills.js.map