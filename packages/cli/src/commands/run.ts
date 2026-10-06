/**
 * commands/run.ts — `cortex run` 单次执行命令
 *
 * 最常用的顶级命令——接受输入文件，调度 Agent 执行，输出结果。
 * 对接 Scheduler + TaskBoard + AgentPool。
 *
 * @see CLI 设计文档 §4.3
 */

import type { CommandHandler, CommandResult } from "../types.js";
import type { EngineBridge } from "../services/engine-bridge.js";
import { daemonFetchJson } from "../services/daemon-client.js";
import type { TaskNode, Tag } from "@cortex/shared";
import * as fs from "node:fs";
import * as path from "node:path";

/** run 命令已解析的选项 */
interface RunOptions {
  agentType: string | undefined;
  watchMode: boolean | undefined;
  dryRun: boolean | undefined;
}

function _parseRunOptions(options: Record<string, unknown>): RunOptions {
  return {
    agentType: (options["agent"] ?? options["a"]) as string | undefined,
    watchMode: options["watch"] as boolean | undefined,
    dryRun: options["dry-run"] as boolean | undefined,
  };
}

/** 读取输入文件或 stdin */
function _readInput(filePath: string | undefined): string {
  if (filePath) return fs.readFileSync(path.resolve(filePath), "utf-8");
  return fs.readFileSync(0, "utf-8");
}

/** 构建干跑输出文本 */
function _buildRunDryRun(inputSource: string, contentLength: number, opts: RunOptions): string {
  return [
    "📋 执行计划 (Dry-Run)",
    `   输入: ${inputSource}`,
    `   内容长度: ${contentLength} 字符`,
    opts.agentType ? `   Agent: ${opts.agentType}` : "   Agent: 自动匹配",
    opts.watchMode ? "   监视: 开启" : "   监视: 关闭",
  ].join("\n");
}

/** 构建失败节点的错误详情 */
function _buildErrorDetails(report: { results: { success: boolean; nodeId: string; error?: string }[] }): string {
  return report.results
    .filter((r) => !r.success)
    .map((r) => `  [${r.nodeId}] ${r.error ?? "未知错误"}`)
    .join("\n");
}

/** 构建 CLI 发起的 TaskNode */
function _createTaskNode(content: string, agentType: string | undefined): TaskNode {
  return {
    id: `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: agentType ?? "analysis",
    tags: (agentType ? [agentType] : ["analysis"]) as Tag[],
    needsMultiPerspective: false,
    status: "pending",
    claimedBy: [],
    payload: content,
    results: [],
    createdAt: Date.now(),
  };
}

/** 通过 Engine 调度执行——daemon-first：优先连运行中的 daemon（引擎完整），不可达才回落本地 bridge */
async function _handleRunExecution(
  bridge: EngineBridge,
  content: string,
  agentType: string | undefined,
): Promise<CommandResult> {
  const node = _createTaskNode(content, agentType);

  // ── daemon-first ──
  const submitted = await daemonFetchJson<{ data?: { id?: string } }>("/api/v1/nodes", {
    method: "POST",
    body: JSON.stringify(node),
  });
  if (submitted) {
    const exec = await daemonFetchJson<{
      data?: { totalNodes: number; completed: number; failed: number; durationMs: number; results?: Array<{ nodeId: string; output?: string; success: boolean; error?: string }> };
    }>("/api/v1/scheduler/execute", { method: "POST", timeoutMs: 180000 });
    const rep = exec?.data;
    if (!rep) {
      return { success: false, error: "daemon 已接收节点但 /scheduler/execute 无响应", exitCode: 2 };
    }
    if (rep.completed > 0) {
      const r = rep.results?.find((x) => x.nodeId === node.id) ?? rep.results?.[0];
      return {
        success: true,
        output: r?.output ?? "✓ 执行完成（结果已沉淀进记忆）",
        data: { via: "daemon", totalNodes: rep.totalNodes, completed: rep.completed, failed: rep.failed, durationMs: rep.durationMs, result: r },
        exitCode: 0,
      };
    }
    const r = rep.results?.[0];
    return {
      success: false,
      error: `执行失败: ${rep.failed}/${rep.totalNodes} 节点失败${r?.error ? `\n${r.error}` : ""}`,
      data: { via: "daemon", ...rep },
      exitCode: 2,
    };
  }

  // ── 本地回落（daemon 不可达）──
  if (bridge.isBootstrapConfigured) await bridge.ensureBootstrapped();
  else await bridge.ensureInitialized();
  const board = await bridge.getTaskBoard();
  const scheduler = await bridge.getScheduler();

  board.addNode(node);
  const report = await scheduler.executeAll();

  if (report.completed > 0) {
    const result = report.results[0];
    return {
      success: true,
      output: result?.output ?? "✓ 执行完成",
      data: { via: "local", totalNodes: report.totalNodes, completed: report.completed, failed: report.failed, durationMs: report.durationMs, result },
      exitCode: 0,
    };
  }

  const errorDetails = _buildErrorDetails(report);
  return {
    success: false,
    error: `执行失败: ${report.failed}/${report.totalNodes} 节点失败\n${errorDetails}`,
    data: report,
    exitCode: 2,
  };
}

export function createRunHandler(bridge: EngineBridge): CommandHandler {
  return async (args, options, _context): Promise<CommandResult> => {
    const filePath = args[0];
    if (!filePath && !options["--"]) {
      return { success: false, error: "请指定输入文件。用法: cortex run <file> [选项]", exitCode: 1 };
    }

    const parsed = _parseRunOptions(options);
    const inputSource = filePath ?? "stdin";

    let content: string;
    try { content = _readInput(filePath); }
    catch (err) {
      return { success: false, error: `读取输入失败: ${err instanceof Error ? err.message : String(err)}`, exitCode: 1 };
    }

    if (parsed.dryRun) {
      return { success: true, output: _buildRunDryRun(inputSource, content.length, parsed), exitCode: 0 };
    }

    try { return await _handleRunExecution(bridge, content, parsed.agentType); }
    catch (err) {
      return { success: false, error: `调度执行失败: ${err instanceof Error ? err.message : String(err)}`, exitCode: 2 };
    }
  };
}
