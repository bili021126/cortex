/**
 * tui/renderer/permission-dialog.ts — 权限确认对话框渲染器
 *
 * 在工具调用前显示权限确认对话框，支持 L1/L2/L3 三级可逆性评估。
 * L1（可逆读操作）自动放行，L2（可逆写操作）和 L3（不可逆操作）需要确认。
 *
 * @module tui/renderer/permission-dialog
 * @since v3 — CLI TUI 全栈重构
 */
/**
 * 评估工具可逆性等级。
 * - L1: 只读操作，完全可逆
 * - L2: 可逆写操作（如 git commit 可 revert）
 * - L3: 不可逆操作（文件删除、bash 执行等）
 */
export declare function reversibilityLevel(tool: string): 1 | 2 | 3;
/**
 * 渲染 inline 权限确认提示。
 * 在工具调用行后追加 [y/n/a/s]? 单行提示——不打断输出流。
 */
export declare function renderInlinePermission(tool: string, input: string, level: 1 | 2 | 3): void;
/**
 * 清除 inline 权限提示。
 */
export declare function clearInlinePermission(): void;
/**
 * 在 raw mode 下等待单键确认输入。
 * 处理单个按键后立即返回，无需回车。
 *
 * @param timeoutMs 超时毫秒数，默认 30000（30s 超时自动 deny）
 */
export declare function waitForSingleKey(timeoutMs?: number): Promise<"approve_once" | "approve_all" | "deny" | "skip">;
export declare class ConfirmGateState {
    /** 是否已选择"全部允许" */
    private approveAll;
    /** 已跳过的工具计数 */
    private skippedCount;
    /** 是否处于全部允许模式 */
    get isApproveAll(): boolean;
    /** 获取已跳过计数 */
    get skipped(): number;
    /** 处理确认结果 */
    handleResult(result: "approve_once" | "approve_all" | "deny" | "skip"): "allow" | "deny" | "skip";
    /** 重置状态 */
    reset(): void;
}
//# sourceMappingURL=permission-dialog.d.ts.map