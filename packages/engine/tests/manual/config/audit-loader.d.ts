/**
 * 审计报告动态加载器 —— 从 test-output/self-examination/ 读取最新验证报告，
 * 提取关键发现并注入到 Persona 的 systemPrompt 中。
 *
 * 用法:
 *   import { loadAuditContext, injectAuditContext } from "./audit-loader";
 *
 *   const ctx = loadAuditContext("test-output/self-examination");
 *   const enhancedPrompt = injectAuditContext(basePrompt, "keqing", ctx);
 *
 * 设计意图:
 *   - persona-prompts.json 存储角色性格/说话风格（稳定，不常变）
 *   - audit-loader.ts 从报告提取最新事实数据（每次验证后自动更新）
 *   - 两者在运行时合并，避免反复覆写 persona-prompts.json
 */
/** 单个 Agent 的报告摘要 */
export interface AgentReportSummary {
    agentKey: string;
    agentName: string;
    fileName: string;
    /** 报告标题（第一个 # heading） */
    title: string;
    /** 总览段落（前 500 字符） */
    overview: string;
    /** 关键结论行（包含 ✅ ❌ ⚠️ 的行） */
    verdicts: string[];
    /** 文件大小 (bytes) */
    size: number;
}
/** 共识清单中的 P0-P3 待修复项 */
export interface FixListSnapshot {
    p0: string[];
    p1: string[];
    p2: string[];
    p3: string[];
    closed: string[];
}
/** 完整审计上下文 */
export interface AuditContext {
    /** 报告目录 */
    reportDir: string;
    /** 整体统计 */
    summary: {
        completed: number;
        failed: number;
        duration: string;
        totalReports: number;
        passCount: number;
        failCount: number;
        warnCount: number;
    };
    /** 各 Agent 报告摘要 */
    agentReports: AgentReportSummary[];
    /** 共识清单快照 */
    fixList: FixListSnapshot;
}
/**
 * 从报告目录加载完整审计上下文。
 * 读取 self-examination-summary.md、consensus-fix-list.md 及各 Agent 报告。
 * 若主目录无报告文件，自动回退到 archive/ 下最新日期子目录。
 */
export declare function loadAuditContext(reportDir: string): AuditContext;
/**
 * 为指定 Agent 构建审计注入上下文文本。
 * 此文本应注入到 Persona systemPrompt 的开头，提供最新的验证数据。
 */
export declare function buildAuditContextForAgent(ctx: AuditContext, agentKey: string): string;
/**
 * 将审计上下文注入到 Persona 的 systemPrompt 中。
 * 上下文插入到 prompt 最前方，用分隔线与原始 prompt 隔开。
 */
export declare function injectAuditContext(baseSystemPrompt: string, agentKey: string, ctx: AuditContext): string;
/**
 * 便捷函数：读取 persona-prompts.json 并注入审计上下文。
 * 返回增强后的 Persona 数组，可直接替换 MeetingConfig.personas。
 */
export declare function enhancePersonasWithAudit(basePrompts: Record<string, {
    emoji: string;
    name: string;
    title: string;
    systemPrompt: string;
}>, ctx: AuditContext): Array<{
    emoji: string;
    name: string;
    title: string;
    systemPrompt: string;
}>;
/**
 * 打印审计上下文摘要到控制台（供脚本启动时展示）。
 */
export declare function printAuditSummary(ctx: AuditContext): void;
//# sourceMappingURL=audit-loader.d.ts.map