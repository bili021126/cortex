/**
 * commands/confirm.ts — `cortex confirm` 确认门命令
 *
 * 查看和操作待确认的 L2/L3 操作。
 * 对接 ConfirmGate API。
 *
 * @see CLI 设计文档 §4.12
 */

import type { CommandHandler, CommandResult } from "../types.js";
import { isHelpRequest } from "../utils.js";
import type { ICortexApi, IConfirmGate } from "@cortex/shared";
import { CLI_EXIT_SUCCESS, CLI_EXIT_CONFIRM_DENIED } from "@cortex/config";

const CONFIRM_HELP = [
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
].join("\n");

export function createConfirmHandler(bridge: ICortexApi): CommandHandler {
  const handler: CommandHandler = async (args, _options, _context): Promise<CommandResult> => {
    if (isHelpRequest(args)) {
      return { success: true, output: CONFIRM_HELP, exitCode: 0 };
    }

    const subcommand = args[0];
    try {
      const gate = await bridge.getConfirmGate();
      switch (subcommand) {
        case "pending": return handleConfirmPending(gate);
        case "approve": return handleConfirmApprove(gate, args[1]);
        case "reject":  return handleConfirmReject(gate, args[1]);
        default:
          return { success: false, error: `未知子命令: "${subcommand}"。可用子命令: pending, approve, reject`, exitCode: 1 };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `确认门操作失败: ${msg}`, exitCode: 2 };
    }
  };
  return handler;
}

function handleConfirmPending(gate: IConfirmGate): CommandResult {
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
  gate: IConfirmGate,
  requestId: string | undefined,
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
  gate: IConfirmGate,
  requestId: string | undefined,
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
    exitCode: result ? CLI_EXIT_SUCCESS : CLI_EXIT_CONFIRM_DENIED,
  };
}
