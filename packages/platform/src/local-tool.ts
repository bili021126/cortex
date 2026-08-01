/**
 * local-tool.ts —— 本地工具（LocalTool）
 *
 * 将每个工具的元数据（meta）与执行逻辑（handler）封装为统一的 Tool 接口。
 * 对外只暴露 Tool，Toolkit 不区分本地/远程。
 *
 * @core v3 —— Tool 接口统一抽象的一部分
 */

import type { Tool, ToolHandler, ToolResult } from "@cortex/shared";
import type { ToolCategory, ReversibilityLevel } from "@cortex/config";

export class LocalTool implements Tool {
  readonly needsLock: boolean;

  constructor(
    public readonly name: string,
    public readonly category: ToolCategory,
    public readonly description: string,
    public readonly parameters: Record<string, unknown>,
    public readonly level: ReversibilityLevel,
    private readonly _handler: ToolHandler,
    opts?: { needsLock?: boolean },
  ) {
    this.needsLock = opts?.needsLock ?? false;
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    return await this._handler(params);
  }
}
