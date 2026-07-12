
/**
 * commands/doc.ts — `cortex doc` 文档工具命令
 *
 * 继承现有 packages/cli/ 的 Markdown→HTML 转换功能，
 * 并扩展文档合规检查。
 *
 * @see CLI 设计文档 §4.8
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import { isHelpRequest, convertMarkdown } from "../utils.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { createServer } from "node:http";

const DOC_HELP = [
  "用法: cortex doc <子命令> [选项]",
  "",
  "子命令:",
  "  convert <file>       转换 Markdown→HTML",
  "  serve <dir>          启动文档服务器",
  "  check <file>         文档合规检查",
  "",
  "选项:",
  "  --output, -o <path>  输出文件路径",
  "  --title, -t <title>  文档标题",
  "  --document, -d       输出完整 HTML 文档",
  "  --port <n>           端口号（默认 8080）",
  "  --watch              文件变更时自动刷新",
  "  --rules <list>       检查规则",
].join("\n");

export function createDocHandler(): CommandHandler {
  const handler: CommandHandler = async (args, options, context): Promise<CommandResult> => {
    if (isHelpRequest(args)) {
      return { success: true, output: DOC_HELP, exitCode: 0 };
    }

    const subcommand = args[0];
    switch (subcommand) {
      case "convert": return handleDocConvert(args[1], options, context);
      case "serve":   return handleDocServe(args[1], options, context);
      case "check":   return handleDocCheck(args[1], options, context);
      default:
        return { success: false, error: `未知子命令: "${subcommand}"。可用子命令: convert, serve, check`, exitCode: 1 };
    }
  };
  return handler;
}

function handleDocConvert(
  filePath: string | undefined,
  options: Record<string, unknown>,
  _context: CommandContext,
): CommandResult {
  if (!filePath) {
    return { success: false, error: "请指定输入文件。用法: cortex doc convert <file>", exitCode: 1 };
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return { success: false, error: `文件不存在: ${resolvedPath}`, exitCode: 1 };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".md" && ext !== ".markdown") {
    return { success: false, error: `不支持的文件格式: ${ext}（仅支持 .md）`, exitCode: 1 };
  }

  try {
    const markdown = fs.readFileSync(resolvedPath, "utf-8");
    const title = options["title"] as string | undefined;
    const documentMode = options["document"] as boolean;
    const outputPath = (options["output"] ?? options["o"]) as string | undefined;
    return convertMarkdown({ content: markdown, title, documentMode, outputPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `转换失败: ${msg}`, exitCode: 2 };
  }
}

/** doc serve 的请求处理器工厂 */
function _createDocRequestHandler(rootDir: string, port: number) {
  return (req: { url?: string | undefined }, res: { writeHead: (code: number, headers?: Record<string, string>) => void; end: (data: string) => void }): void => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const normalizedRoot = path.resolve(rootDir);
    let filePath = path.resolve(normalizedRoot, "." + url.pathname);
    if (!filePath.startsWith(normalizedRoot + path.sep) && filePath !== normalizedRoot) {
      res.writeHead(403); res.end("403 Forbidden"); return;
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain" }); res.end("404 Not Found"); return;
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      if (!fs.existsSync(filePath)) { res.writeHead(404); res.end("404 Not Found"); return; }
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const ext = path.extname(filePath);
    const mime: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json" };
    res.writeHead(200, { "Content-Type": mime[ext] ?? "text/plain" });
    res.end(content);
  };
}

function handleDocServe(
  dirPath: string | undefined,
  options: Record<string, unknown>,
  _context: CommandContext,
): CommandResult {
  const rootDir = dirPath ? path.resolve(dirPath) : process.cwd();
  const port = parseInt(String(options["port"] ?? "8080"), 10);

  if (!fs.existsSync(rootDir)) {
    return { success: false, error: `目录不存在: ${rootDir}`, exitCode: 1 };
  }

  const server = createServer(_createDocRequestHandler(rootDir, port));

  server.listen(port, () => {
    console.error(`📖 文档服务器启动: http://localhost:${port}`);
    console.error(`   根目录: ${rootDir}`);
  });

  let _cleanedUp = false;
  const cleanup = () => {
    if (_cleanedUp) return;
    _cleanedUp = true;
    server.close(() => { console.error("\n📖 文档服务器已关闭"); process.exit(0); });
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);

  return { success: true, output: `文档服务器运行于 http://localhost:${port}`, exitCode: 0 };
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
