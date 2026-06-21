/**
 * Phase 4.25: 交叉验证 Second-Pass
 *
 * 在 Agent 自由探索产出报告后，由互补专长的另一位 Agent 对报告中的
 * 可验证事实声明做 search_code / read_file 级别的核查。
 *
 * 验证者不做新探索——只确认已有声明是否能在代码库中找到对应证据。
 * 这是解决刻晴 25% 伪阳性率的关键机制：在圆桌共识前把可验证事实和 LLM 推理分开。
 */
import type { TaskNode } from "@cortex/shared";
export interface CrossVerifyPair {
    reporterKey: string;
    reporterName: string;
    reporterEmoji: string;
    verifierKey: string;
    verifierName: string;
    verifierEmoji: string;
    /** 用于在输出目录中匹配报告文件名的模式 */
    reportFilePattern: string;
}
/** 从 JSON 配置文件加载交叉验证配对表，解析失败时回退硬编码 */
export declare function loadCrossVerifyPairs(configDir: string): CrossVerifyPair[];
export interface VerifierAgent {
    execute: (node: TaskNode, model: string) => Promise<{
        success: boolean;
        output?: string;
        error?: string;
    }>;
}
/**
 * 运行交叉验证。
 *
 * @param outputDir  审视报告输出目录（如 test-output/self-examination-soft/）
 * @param agents     key→Agent 实例的映射，key 与 CROSS_VERIFY_PAIRS 中的 verifierKey 对应
 * @param chatModel  使用的 LLM 模型名
 * @returns 产出的验证文件路径列表
 */
export declare function runCrossVerification(outputDir: string, pairs: CrossVerifyPair[], agents: Record<string, VerifierAgent>, chatModel: string): Promise<string[]>;
//# sourceMappingURL=cross-verification.d.ts.map