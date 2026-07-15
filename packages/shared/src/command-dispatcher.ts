// ============================================================
// @cortex/shared — 命令分发契约（TUI ↔ CLI 共享）
//
// 定义命令分发的最小接口契约，TUI 和 CLI 共享此类型，
// 不引入 CLI 依赖。CommandRegistry 实现此接口。
// ============================================================

/** 命令分发契约——TUI 和 CLI 共享 */
export interface ICommandDispatcher {
  /**
   * 分发命令
   * @param args 命令参数（首项为命令名）
   * @param context 执行上下文（可选）
   * @returns 执行结果
   */
  dispatch(args: string[], context?: ICommandContext): Promise<ICommandResult>;
}

/** 命令执行上下文 */
export interface ICommandContext {
  /** 当前工作目录 */
  cwd?: string;
  /** 额外上下文键值 */
  [key: string]: unknown;
}

/** 命令执行结果 */
export interface ICommandResult {
  /** 退出码：0=成功，非0=失败 */
  code: number;
  /** 输出文本 */
  output: string;
}
