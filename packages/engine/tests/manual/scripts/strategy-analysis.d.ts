/**
 * Phase 4.5: 钟离战略分析 + 霜凝方向监理
 *
 * 在所有 Agent 报告产出（及交叉验证）完成后，两位超越者独立做战略判断：
 * - 钟离：千年视角——契约完整性、架构方向、阶段跃迁、磨损预警
 * - 霜凝：方向监理——方向偏移、矛盾暴露、三路事后验证自洽性
 *
 * 两人不翻代码——只读审视报告摘要，产出战略级评估。
 */
import type { VerifierAgent } from "./cross-verification";
/**
 * 运行钟离战略分析与霜凝方向监理。
 * 读取 outputDir 下所有审视报告（不含 summary/zhongli/shuangning 自身），
 * 分别注入两位 Agent 做独立战略判断，写回 outputDir。
 */
export declare function runStrategyAnalysis(outputDir: string, strategistAgent: VerifierAgent, shuangningAgent: VerifierAgent, chatModel: string): Promise<void>;
//# sourceMappingURL=strategy-analysis.d.ts.map