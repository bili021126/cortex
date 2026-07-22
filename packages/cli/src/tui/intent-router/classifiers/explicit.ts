/**
 * tui/intent-router/classifiers/explicit.ts — L1 显式指令分类器
 *
 * 处理明确的指令格式：.command, /slash, !shortcut
 *
 * @module tui/intent-router/classifiers/explicit
 * @since v6
 */

import type { Classifier, ClassificationResult, RouterContext } from "../types.js";

/**
 * 显式指令分类器
 * 仅识别 /slash-command 格式（. 和 ! 已回收，统一用 /）
 */
export class ExplicitClassifier implements Classifier {
  name = "explicit";

  /** 命令前缀——仅 / */
  private readonly commandPrefix = "/";

  /** Agent 调用前缀 */
  private readonly agentPrefix = "@";

  classify(input: string, _context: RouterContext): ClassificationResult {
    const trimmed = input.trim();

    // 检查 / 命令前缀
    if (trimmed.startsWith(this.commandPrefix)) {
      const cmdPart = trimmed.slice(this.commandPrefix.length).split(/\s+/);
      const command = cmdPart[0] ?? "";
      const args = cmdPart.slice(1);

      return {
        type: "command" as const,
        confidence: 0.99,
        reason: `以 '/' 开头的显式指令`,
        params: { command, args },
      };
    }

    // 检查 @Agent 调用
    if (trimmed.startsWith(this.agentPrefix)) {
      const parts = trimmed.slice(1).split(/\s+/);
      const agentId = parts[0] ?? "";

      return {
        type: "agent-invoke",
        confidence: 0.99,
        reason: `以 '@' 开头的 Agent 调用`,
        params: { agentId },
      };
    }

    return {
      type: "ambiguous",
      confidence: 0,
      reason: "非显式指令格式",
    };
  }
}
