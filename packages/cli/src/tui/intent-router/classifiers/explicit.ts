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
 * 识别 .command、/slash-command、!shortcut 等明确指令格式
 */
export class ExplicitClassifier implements Classifier {
  name = "explicit";

  /** 命令前缀 */
  private readonly prefixes = [
    { prefix: ".", type: "command" as const },
    { prefix: "/", type: "command" as const },
    { prefix: "!", type: "command" as const },
  ];

  /** Agent 调用前缀 */
  private readonly agentPrefix = "@";

  classify(input: string, _context: RouterContext): ClassificationResult {
    const trimmed = input.trim();

    // 检查命令前缀
    for (const { prefix, type } of this.prefixes) {
      if (trimmed.startsWith(prefix)) {
        const cmdPart = trimmed.slice(prefix.length).split(/\s+/);
        const command = cmdPart[0] ?? "";
        const args = cmdPart.slice(1);

        return {
          type,
          confidence: 0.99,
          reason: `以 '${prefix}' 开头的显式指令`,
          params: { command, args },
        };
      }
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
