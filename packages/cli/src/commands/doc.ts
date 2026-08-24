
/**
 * commands/doc.ts — `cortex doc` 文档工具命令
 *
 * 继承现有 packages/cli/ 的 Markdown→HTML 转换功能，
 * 并扩展文档合规检查。
 *
 * @see CLI 设计文档 §4.8
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import { cliTheme } from "../theme/cli-theme.js";
import { isHelpRequest } from "../utils.js";
import * as fs from "node:fs";
import * as path from "node:path";

const DOC_HELP = [
  "用法: cortex doc <子命令> [选项]",
  "",
  "子命令:",
  "  check <file>         文档合规检查（标题层级/外部链接）",
  "",
  "选项:",
  "  --rules <list>       检查规则",
].join("\n");

export function createDocHandler(): CommandHandler {
  const handler: CommandHandler = async (args, options, context): Promise<CommandResult> => {
    if (isHelpRequest(args)) {
      return { success: true, output: DOC_HELP, exitCode: 0 };
    }

    const subcommand = args[0];
    switch (subcommand) {
      case "check":   return handleDocCheck(args[1], options, context);
      default:
        return { success: false, error: `未知子命令: "${subcommand}"。可用子命令: check`, exitCode: 1 };
    }
  };
  return handler;
}

/** 检查 Markdown 标题层级跳跃 */
function _checkHeadings(content: string): string[] {
  const issues: string[] = [];
  const lines = content.split("\n");
  let prevLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]?.match(/^(#{1,6})\s/);
    if (match) {
       
      const level = match[1]!.length;
      if (prevLevel > 0 && level > prevLevel + 1) {
        issues.push(`第 ${i + 1} 行: 标题级别跳跃 (h${prevLevel} → h${level})`);
      }
      prevLevel = level;
    }
  }
  return issues;
}

/** 检查 Markdown 外部链接 */
function _checkLinks(content: string): string[] {
  const issues: string[] = [];
  const linkMatches = content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
  for (const match of linkMatches) {
     
    const url = match[2]!;
    if (url.startsWith("http") && !url.startsWith("http://localhost")) {
      issues.push(`外部链接: ${match[1]} → ${url}`);
    }
  }
  return issues;
}

function handleDocCheck(
  filePath: string | undefined,
  options: Record<string, unknown>,
  _context: CommandContext,
): CommandResult {
  if (!filePath) {
    return { success: false, error: "请指定文件。用法: cortex doc check <file>", exitCode: 1 };
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return { success: false, error: `文件不存在: ${resolvedPath}`, exitCode: 1 };
  }

  try {
    const content = fs.readFileSync(resolvedPath, "utf-8");
    const rules = ((options["rules"] as string) ?? "links,headings").split(",");
    const issues: string[] = [];
    if (rules.includes("headings")) issues.push(..._checkHeadings(content));
    if (rules.includes("links"))    issues.push(..._checkLinks(content));

    return {
      success: issues.length === 0,
      output: issues.length === 0
        ? "✓ 文档合规检查通过"
        : `文档合规检查: ${issues.length} 项\n${issues.map((i) => `  ${i}`).join("\n")}`,
      data: { file: filePath, issues, passed: issues.length === 0 },
      exitCode: issues.length === 0 ? 0 : 2,
    };
  } catch (err) {
    return { success: false, error: `检查失败: ${err instanceof Error ? err.message : String(err)}`, exitCode: 2 };
  }
}
