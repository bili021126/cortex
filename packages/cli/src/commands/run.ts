/**
 * commands/run.ts — `cortex run` 单次执行命令
 *
 * 最常用的顶级命令——接受输入文件，调度 Agent 执行，输出结果。
 * 对接 Scheduler + TaskBoard + AgentPool。
 *
 * @see CLI 设计文档 §4.3
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import type { EngineBridge } from "../services/engine-bridge.js";
import { convert, convertToDocument } from "@cortex/parser";
import * as fs from "node:fs";
import * as path from "node:path";

export function createRunHandler(bridge: EngineBridge): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    const filePath = args[0];
    if (!filePath && !options["--"]) {
      return {
        success: false,
        error: "请指定输入文件。用法: cortex run <file> [选项]",
        exitCode: 1,
      };
    }

    const inputSource = filePath ?? "stdin";
    const agentType = (options["agent"] ?? options["a"]) as string | undefined;
    const outputPath = (options["output"] ?? options["o"]) as string | undefined;
    const title = options["title"] as string | undefined;
    const documentMode = options["document"] as boolean | undefined;
    const watchMode = options["watch"] as boolean | undefined;
    const dryRun = options["dry-run"] as boolean | undefined;

    // ── 读取输入 ──
    let content: string;
    try {
      if (filePath) {
        content = fs.readFileSync(path.resolve(filePath), "utf-8");
      } else {
        content = fs.readFileSync(0, "utf-8");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `读取输入失败: ${msg}`, exitCode: 1 };
    }

    // ── Dry-run 模式 ──
    if (dryRun) {
      const info = [
        "📋 执行计划 (Dry-Run)",
        `   输入: ${inputSource}`,
        `   内容长度: ${content.length} 字符`,
        agentType ? `   Agent: ${agentType}` : "   Agent: 自动匹配",
        outputPath ? `   输出: ${outputPath}` : "   输出: stdout",
        watchMode ? "   监视: 开启" : "   监视: 关闭",
      ].join("\n");
      return { success: true, output: info, exitCode: 0 };
    }

    // ── 文档转换路径 ──
    const ext = filePath ? path.extname(filePath).toLowerCase() : "";
    if (ext === ".md" || ext === ".markdown" || (options["document"] as boolean)) {
      try {
        let html: string;
        if (documentMode) {
          html = convertToDocument(content, title as string);
        } else {
          html = convert(content);
        }

        if (outputPath) {
          fs.writeFileSync(path.resolve(outputPath), html, "utf-8");
          return {
            success: true,
            output: `✓ 转换完成: ${path.basename(outputPath)}`,
            data: { outputPath, size: html.length },
            exitCode: 0,
          };
        }

        return {
          success: true,
          output: html,
          data: { html, size: html.length },
          exitCode: 0,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `转换失败: ${msg}`, exitCode: 2 };
      }
    }

    // ── Engine 调度路径 ──
    try {
      await bridge.ensureInitialized();
      const board = await bridge.getTaskBoard();
      const scheduler = await bridge.getScheduler();

      const taskNode: any = {
        id: `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: agentType ?? "analysis",
        tags: (agentType ? [agentType] : ["analysis"]),
        needsMultiPerspective: false,
        status: "pending",
        claimedBy: [],
        payload: content,
        results: [],
        createdAt: Date.now(),
      };

      board.addNode(taskNode);
      const report = await scheduler.executeAll();

      if (report.completed > 0) {
        const result = report.results[0];
        return {
          success: true,
          output: result.output ?? "✓ 执行完成",
          data: {
            totalNodes: report.totalNodes,
            completed: report.completed,
            failed: report.failed,
            durationMs: report.durationMs,
            result,
          },
          exitCode: 0,
        };
      }

      return {
        success: false,
        error: `执行失败: ${report.failed}/${report.totalNodes} 节点失败`,
        data: report,
        exitCode: 2,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `调度执行失败: ${msg}`, exitCode: 2 };
    }
  };
}
