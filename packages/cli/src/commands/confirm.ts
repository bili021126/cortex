/**
 * commands/confirm.ts — `cortex confirm` 确认门命令
 *
 * 查看和操作待确认的 L2/L3 操作。
 * 对接 ConfirmGate API。
 *
 * @see CLI 设计文档 §4.12
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import type { EngineBridge } from "../services/engine-bridge.js";

export function createConfirmHandler(bridge: EngineBridge): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      return {
        success: true,
        output: [
          "用法: cortex confirm <子命令> [选项]",
          "",
          "子命令:",
          "  pending               列出待确认的操作",
          "  approve <id>          批准操作",
          "  reject <id>           拒绝操作",
          "",
          "选项:",
          "  --level <l>           按等级过滤 (L2/L3)",
          "  --agent <type>        按请求 Agent 过滤",
          "  --format <fmt>        输出格式",
          "  --reason <text>       批准/拒绝理由",
        ].join("\n"),
        exitCode: 0,
      };
    }

    const subcommand = args[0];

    try {
      const engine = await bridge.ensureInitialized();
      const gate = engine.confirmGate!;

      switch (subcommand) {
        case "pending":
          return handleConfirmPending(gate, options, context);
        case "approve":
          return handleConfirmApprove(gate, args[1], options, context);
        case "reject":
          return handleConfirmReject(gate, args[1], options, context);
        default:
          return {
            success: false,
            error: `未知子命令: "${subcommand}"。可用子命令: pending, approve, reject`,
            exitCode: 1,
          };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `确认门操作失败: ${msg}`, exitCode: 2 };
    }
  };
}

function handleConfirmPending(
  gate: any,
  options: Record<string, unknown>,
  context: CommandContext,
): CommandResult {
  const hasPending = gate.hasPending();

  return {
    success: true,
    data: { hasPending, pendingCount: hasPending ? 1 : 0 },
    output: hasPending
      ? "有待处理的确认请求"
      : "当前无待处理的确认请求",
    exitCode: 0,
  };
}

function handleConfirmApprove(
  gate: any,
  requestId: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): CommandResult {
  if (!requestId) {
    return { success: false, error: "请指定确认请求 ID。用法: cortex confirm approve <id>", exitCode: 1 };
  }

  // ConfirmGate.resolve() 是处理用户响应的入口
  const result = gate.resolve({
    requestId,
    approved: true,
  });

  return {
    success: result,
    output: result ? `✓ 已批准: ${requestId}` : `批准失败: ${requestId}（请求不存在或已处理）`,
    data: { requestId, approved: true },
    exitCode: result ? 0 : 1,
  };
}

function handleConfirmReject(
  gate: any,
  requestId: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): CommandResult {
  if (!requestId) {
    return { success: false, error: "请指定确认请求 ID。用法: cortex confirm reject <id>", exitCode: 1 };
  }

  const result = gate.resolve({
    requestId,
    approved: false,
  });

  return {
    success: result,
    output: result ? `✓ 已拒绝: ${requestId}` : `拒绝失败: ${requestId}（请求不存在或已处理）`,
    data: { requestId, approved: false },
    exitCode: result ? 0 : 6, // 退出码 6 = 权限不足/确认被拒
  };
}
