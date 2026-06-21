/**
 * tui/modes/plan-utils.ts — Plan 模式工具函数
 *
 * 从 commands/repl/executors/plan-executor.ts 迁移的纯工具函数。
 * 不依赖 EngineBridge/ICortexApi，仅纯函数计算。
 *
 * @module tui/modes/plan-utils
 * @since v3 — CLI TUI 全栈重构，旧 REPL 清理后迁移
 */
import type { TaskNode } from "@cortex/shared";
import type { IntentClarification } from "@cortex/engine";
/**
 * 从用户意图中提取显式指定的工作区路径。
 * 匹配模式："将这个路径作为工作区"/"以...为工作区"/"把工作区设为..."
 * 返回绝对路径或 null。
 */
export declare function extractWorkspacePath(input: string): string | null;
/** 展示意图解析结果 */
export declare function displayClarification(cl: IntentClarification): void;
/**
 * 意图明晰化确认循环。
 * 调用 MetaAgent.clarifyIntent 解析意图→展示→等待用户确认。
 * 返回 effectiveIntent（用户确认后使用），null 表示用户取消。
 */
export declare function clarifyAndConfirm(input: string, metaAgent: {
    clarifyIntent: (intent: string) => Promise<IntentClarification>;
}, askUser?: (question: string) => Promise<string>): Promise<string | null>;
/** 将 TaskNode 树格式化为可读的缩进展示 */
export declare function formatPlanTree(nodes: TaskNode[]): string;
//# sourceMappingURL=plan-utils.d.ts.map