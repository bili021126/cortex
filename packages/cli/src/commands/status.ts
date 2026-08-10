/**
 * commands/status.ts — `cortex status` 系统状态总览
 *
 * 检查 daemon 健康（GET /health）、评测状态（eval-report）、核心服务端口。
 *
 * 用法: cortex status
 */
import type { CommandHandler, CommandResult } from "../types.js";
import { isHelpRequest } from "../utils.js";
import { cliTheme, ttySafe } from "../theme/cli-theme.js";

const STATUS_HELP = [
  "用法: cortex status",
  "",
  "系统状态总览：daemon 健康 / 评测状态 / 服务端口",
].join("\n");

export function createStatusHandler(): CommandHandler {
  const handler: CommandHandler = async (args, _options, _context): Promise<CommandResult> => {
    if (isHelpRequest(args)) {
      return { success: true, output: STATUS_HELP, exitCode: 0 };
    }

    const lines = [ttySafe(cliTheme.heading, "✦ 系统状态总览"), ""];

    // 1. daemon 健康（GET /health）
    try {
      const res = await fetch("http://127.0.0.1:3210/api/v1/health");
      if (res.ok) {
        const j = await res.json().catch(() => null) as { status?: string; uptime?: number } | null;
        lines.push(ttySafe(cliTheme.success, `daemon:    ✅ 在线${j?.uptime ? `（uptime ${Math.round(j.uptime / 60)}min）` : ""}`));
      } else {
        lines.push(ttySafe(cliTheme.warn, `daemon:    ⚠️ 响应异常（HTTP ${res.status}）`));
      }
    } catch {
      lines.push(ttySafe(cliTheme.error, "daemon:    ❌ 离线（127.0.0.1:3210 不可达）"));
    }

    // 2. 评测状态（eval-report）
    try {
      const fsMod = await import("node:fs");
      const pathMod = await import("node:path");
      const reportPath = pathMod.join(process.cwd(), ".cortex", "eval-report.json");
      if (fsMod.existsSync(reportPath)) {
        const report = JSON.parse(fsMod.readFileSync(reportPath, "utf-8")) as { generatedAt: string; results: Array<{ passed?: boolean }> };
        const passed = report.results.filter((r) => r.passed).length;
        lines.push(ttySafe(cliTheme.success, `评测:      ✦ ${passed}/${report.results.length} 通过（${report.generatedAt}）`));
      } else {
        lines.push(ttySafe(cliTheme.muted, "评测:      ⚪ 无报告（cortex eval --run 生成）"));
      }
    } catch {
      lines.push(ttySafe(cliTheme.muted, "评测:      ⚪ 无报告"));
    }

    // 3. 桌面端进程
    try {
      const { exec } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execAsync = promisify(exec);
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq electron.exe" /NH', { windowsHide: true, timeout: 5000 });
      const count = stdout.split("\n").filter((l) => l.includes("electron")).length;
      lines.push(`  桌面端:    ${count > 0 ? ttySafe(cliTheme.success, `✅ 运行中（${count} 进程）`) : ttySafe(cliTheme.muted, "⚪ 未运行")}`);
    } catch {
      lines.push(ttySafe(cliTheme.muted, "桌面端:    ⚪ 未知"));
    }

    return { success: true, output: lines.join("\n"), exitCode: 0 };
  };
  return handler;
}
