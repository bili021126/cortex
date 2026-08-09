/**
 * commands/eval.ts — `cortex eval` 评测命令
 *
 * 查看最近一次 eval-gate 报告（.cortex/eval-report.json）或触发重跑。
 *
 * @see docs/analysis/harness-deep-dive-2026-08-05.md §3（H3 eval-gate）
 */
import type { CommandHandler, CommandResult } from "../types.js";
import { isHelpRequest } from "../utils.js";

const EVAL_HELP = [
  "用法: cortex eval [--run]",
  "",
  "子选项:",
  "  --run    重新运行评测（npx tsx eval-gate）",
  "  --help   显示帮助",
  "",
  "默认：查看最近一次评测报告（.cortex/eval-report.json）",
].join("\n");

interface EvalReportEntry {
  goldenId?: string;
  id?: string;
  passed?: boolean;
  durationMs?: number;
  error?: string;
  asserts?: Array<{ passed: boolean; verb: string; eventType: string; detail: string }>;
}

export function createEvalHandler(): CommandHandler {
  const handler: CommandHandler = async (args, options, _context): Promise<CommandResult> => {
    if (isHelpRequest(args)) {
      return { success: true, output: EVAL_HELP, exitCode: 0 };
    }

    // --run：重新执行评测
    if (options?.run || args.includes("--run")) {
      try {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);
        const { stdout } = await execAsync("npx tsx packages/engine/tests/eval/eval-gate.ts", {
          cwd: process.cwd(),
          windowsHide: true,
          timeout: 120_000,
        });
        const tail = stdout.split("\n").filter((l) => l.includes("✅") || l.includes("❌") || l.includes("结果:")).slice(-12);
        return { success: true, output: `评测完成:\n${tail.join("\n")}`, exitCode: 0 };
      } catch (e) {
        return { success: false, output: `评测失败: ${e instanceof Error ? e.message : String(e)}`, exitCode: 1 };
      }
    }

    // 默认：查看最近报告
    try {
      const fsMod = await import("node:fs");
      const pathMod = await import("node:path");
      const reportPath = pathMod.join(process.cwd(), ".cortex", "eval-report.json");
      if (!fsMod.existsSync(reportPath)) {
        return { success: false, output: "暂无评测报告——先运行 cortex eval --run 生成", exitCode: 1 };
      }
      const report = JSON.parse(fsMod.readFileSync(reportPath, "utf-8")) as { generatedAt: string; results: EvalReportEntry[] };
      const passed = report.results.filter((r) => r.passed).length;
      const lines = [
        `评测报告（${report.generatedAt}）:`,
        `  通过: ${passed}/${report.results.length}`,
        "",
        ...report.results.map((r) => {
          const mark = r.passed ? "✅" : "❌";
          const id = r.goldenId ?? r.id ?? "?";
          const fails = (r.asserts ?? []).filter((a) => !a.passed);
          const why = fails.length > 0 ? ` — ${fails[0]?.detail ?? r.error ?? "断言失败"}` : "";
          return `  ${mark} ${id}${why}`;
        }),
      ];
      return { success: true, output: lines.join("\n"), exitCode: 0 };
    } catch (e) {
      return { success: false, output: `读取报告失败: ${e instanceof Error ? e.message : String(e)}`, exitCode: 1 };
    }
  };
  return handler;
}
