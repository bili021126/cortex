// ============================================================
// @cortex/engine/plugin/governance.plugin
//
// Governance 插件——依赖 PipelineObserver + MemoryStore。
// 修宪管线：提案加载 → 评判 → 应用 → 超时检测 → 摘要。
//
// @since v3.0 — 引擎插件化解耦
// ============================================================
import { loadPendingProposals, judgeProposals, applyApproved, checkTimeouts, summarizeGovernance, } from "@cortex/governance";
export class GovernancePlugin {
    name = "governance";
    dependencies = ["pipelineObserver", "memoryStore"];
    async init(_ctx) { }
    async start() { }
    async stop() { }
    health() {
        return "healthy";
    }
    /** 运行修宪治理循环 */
    runGovernanceCycle(projectRoot) {
        // §1 加载待处理提案
        loadPendingProposals(projectRoot);
        // §2 评判
        const judgments = judgeProposals(projectRoot);
        // §3 应用已通过提案
        for (const j of judgments) {
            if (j.judgment.verdict === "APPROVED") {
                applyApproved(j.proposal, projectRoot);
            }
        }
        // §4 超时检测
        checkTimeouts(projectRoot);
        // §5 摘要
        const summary = summarizeGovernance(projectRoot);
        console.warn(`[Governance] 摘要: 待判 ${summary.pendingJudgment}，` +
            `已通过 ${summary.approved}，阻塞 ${summary.blocked}，` +
            `已应用 ${summary.applied}`);
    }
}
// 自注册
import { PluginLoader } from "./plugin-loader.js";
PluginLoader.register("governance", GovernancePlugin);
//# sourceMappingURL=governance.plugin.js.map