/**
 * commands/doctor.ts — `cortex doctor` Monorepo 健康诊断命令
 *
 * 集成 @cortex/doctor 的健康检查管线，提供项目健康状态诊断。
 * 支持文本/JSON 输出、检查器筛选、健康分阈值阻断。
 *
 * @see CLI 设计文档 §4.16
 */

import type { CommandHandler, CommandResult } from "../types.js";
import { HealthChecker, type DoctorOptions, type HealthReport } from "@cortex/doctor";
import * as fs from "node:fs";
import * as path from "node:path";

export function createDoctorHandler(): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    if (args.length > 0 && (args[0] === "--help" || args[0] === "-h")) {
      return {
        success: true,
        output: [
          "用法: cortex doctor [选项]",
          "",
          "对 monorepo 执行全面健康诊断，检查 package.json 字段完整性、",
          "定位文档存在性、测试文件首行标注等。",
          "",
          "选项:",
          "  --format <fmt>     输出格式（text/json），默认 text",
          "  --output, -o <p>   输出报告到文件",
          "  --only <names>     仅运行指定检查器（逗号分隔）",
          "  --skip <names>     跳过指定检查器（逗号分隔）",
          "  --threshold <n>    健康分阈值（低于此值退出码 1）",
          "  --verbose, -v      输出所有发现（含 info 级别）",
          "",
          "内置检查器:",
          "  package-json         检查各包 package.json 必须字段",
          "  positioning-doc      检查各包 PACKAGE_POSITIONING.md 存在性",
          "  test-header          检查测试文件首行 @ci 标注",
          "",
          "示例:",
          "  cortex doctor",
          "  cortex doctor --only package-json,test-header",
          "  cortex doctor --format json --output report.json",
        ].join("\n"),
        exitCode: 0,
      };
    }

    const projectRoot = context.projectRoot ?? process.cwd();
    const format = (options["format"] as string) ?? "text";
    const outputPath = (options["output"] ?? options["o"]) as string | undefined;
    const only = options["only"] as string | undefined;
    const skip = options["skip"] as string | undefined;
    const threshold = options["threshold"] !== undefined
      ? parseInt(String(options["threshold"]), 10)
      : undefined;
    const verbose = (options["verbose"] ?? options["v"]) as boolean | undefined;

    const doctorOptions: DoctorOptions = {
      format: format === "json" ? "json" : "text",
      ...(only ? { only } : {}),
      ...(skip ? { skip } : {}),
      ...(threshold !== undefined ? { threshold } : {}),
      ...(verbose !== undefined ? { verbose } : {}),
    };

    const checker = new HealthChecker();
    const report = await checker.diagnose(projectRoot, doctorOptions);

    // 输出报告
    let output: string;
    if (format === "json") {
      output = JSON.stringify(report, null, 2);
    } else {
      output = formatTextReport(report);
    }

    // 写入文件
    if (outputPath) {
      const resolvedPath = path.resolve(outputPath);
      fs.writeFileSync(resolvedPath, output, "utf-8");
    }

    // 判定退出码（与 CI 门禁对齐）
    const exitCode = report.status === "healthy"
      ? 0
      : report.status === "warning"
        ? 0 // warning 不阻断，但建议关注
        : 1; // unhealthy / error

    // 阈值阻断
    if (threshold !== undefined) {
      const score = computeTotalScore(report);
      if (score < threshold) {
        return {
          success: true,
          error: `健康分 ${score} 低于阈值 ${threshold}，CI 阻断`,
          data: report,
          output,
          exitCode: 1,
        };
      }
    }

    return {
      success: true, // 诊断总是成功完成——exitCode 表达健康状态
      data: report,
      output,
      exitCode,
    };
  };
}

/** 计算总健康分（所有检查器评分的平均值） */
function computeTotalScore(report: HealthReport): number {
  const scores: number[] = report.checks
    .map((c: { score: number | null }) => c.score)
    .filter((s): s is number => s !== null);
  if (scores.length === 0) return 100;
  return Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length);
}

/** 格式化文本报告 */
function formatTextReport(report: HealthReport): string {
  const lines: string[] = [];

  // 状态指示
  const statusIcons: Record<string, string> = {
    healthy: "✅",
    warning: "⚠️",
    unhealthy: "❌",
    error: "💥",
  };
  const icon = statusIcons[report.status] ?? "❓";

  lines.push(`${icon} 健康诊断报告`);
  lines.push(`   扫描时间: ${report.meta.scannedAt}`);
  lines.push(`   项目根:   ${report.meta.projectRoot}`);
  lines.push(`   包数量:   ${report.meta.packageCount}`);
  lines.push(`   耗时:     ${report.meta.durationMs}ms`);
  lines.push(`   状态:     ${report.status}`);
  lines.push("");

  // 各检查器结果
  for (const check of report.checks) {
    const checkIcon = check.passed ? "✅" : "❌";
    const scoreStr = check.score !== null ? ` (${check.score}分)` : "";
    lines.push(`${checkIcon} ${check.checker}${scoreStr}`);
    lines.push(`   ${check.summary.total} 个发现: fatal=${check.summary.fatal} error=${check.summary.error} warning=${check.summary.warning} info=${check.summary.info}`);

    // 列出 error/fatal 级别发现
    const criticalFindings = check.findings.filter(
      (f) => f.severity === "error" || f.severity === "fatal",
    );
    for (const f of criticalFindings) {
      lines.push(`     [${f.severity}] ${f.title}`);
      if (f.suggestion) {
        lines.push(`       → ${f.suggestion}`);
      }
    }
    lines.push("");
  }

  // 总结
  const isHealthy = report.status === "healthy";
  lines.push(isHealthy
    ? "✨ 所有检查通过，monorepo 健康状态良好。"
    : "⚠️ 存在需要关注的问题，请查看上述发现并修复。");

  return lines.join("\n");
}
