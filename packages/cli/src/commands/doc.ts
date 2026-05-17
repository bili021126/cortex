/**
 * commands/doc.ts — `cortex doc` 文档工具命令
 *
 * 继承现有 packages/cli/ 的 Markdown→HTML 转换功能，
 * 并扩展文档合规检查。
 *
 * @see CLI 设计文档 §4.8
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import { convert, convertToDocument } from "@cortex/parser";
import * as fs from "node:fs";
import * as path from "node:path";
import { createServer } from "node:http";

export function createDocHandler(): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      return {
        success: true,
        output: [
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
        ].join("\n"),
        exitCode: 0,
      };
    }

    const subcommand = args[0];

    switch (subcommand) {
      case "convert":
        return handleDocConvert(args[1], options, context);
      case "serve":
        return handleDocServe(args[1], options, context);
      case "check":
        return handleDocCheck(args[1], options, context);
      default:
        return {
          success: false,
          error: `未知子命令: "${subcommand}"。可用子命令: convert, serve, check`,
          exitCode: 1,
        };
    }
  };
}

function handleDocConvert(
  filePath: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
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

    let html: string;
    if (documentMode) {
      html = convertToDocument(markdown, title);
    } else {
      html = convert(markdown);
    }

    if (outputPath) {
      const resolvedOutput = path.resolve(outputPath);
      fs.writeFileSync(resolvedOutput, html, "utf-8");
      return {
        success: true,
        output: `✓ 转换完成: ${path.basename(filePath)} → ${path.basename(outputPath)}`,
        data: { input: filePath, output: outputPath, size: html.length },
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

function handleDocServe(
  dirPath: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
): CommandResult {
  const rootDir = dirPath ? path.resolve(dirPath) : process.cwd();
  const port = parseInt(String(options["port"] ?? "8080"), 10);

  if (!fs.existsSync(rootDir)) {
    return { success: false, error: `目录不存在: ${rootDir}`, exitCode: 1 };
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    let filePath = path.join(rootDir, url.pathname);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
      return;
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end("404 Not Found");
        return;
      }
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const ext = path.extname(filePath);
    const mime: Record<string, string> = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
    };

    res.writeHead(200, { "Content-Type": mime[ext] ?? "text/plain" });
    res.end(content);
  });

  server.listen(port, () => {
    console.log(`📖 文档服务器启动: http://localhost:${port}`);
    console.log(`   根目录: ${rootDir}`);
  });

  // 在原型阶段，serve 命令保持进程运行
  return {
    success: true,
    output: `文档服务器运行于 http://localhost:${port}`,
    exitCode: 0,
  };
}

function handleDocCheck(
  filePath: string | undefined,
  options: Record<string, unknown>,
  context: CommandContext,
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

    // 基本合规检查
    if (rules.includes("headings")) {
      const lines = content.split("\n");
      let prevLevel = 0;
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^(#{1,6})\s/);
        if (match) {
          const level = match[1].length;
          if (prevLevel > 0 && level > prevLevel + 1) {
            issues.push(`第 ${i + 1} 行: 标题级别跳跃 (h${prevLevel} → h${level})`);
          }
          prevLevel = level;
        }
      }
    }

    if (rules.includes("links")) {
      const linkMatches = content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
      for (const match of linkMatches) {
        const url = match[2];
        if (url.startsWith("http") && !url.startsWith("http://localhost")) {
          // 外部链接——仅记录
          issues.push(`外部链接: ${match[1]} → ${url}`);
        }
      }
    }

    return {
      success: issues.length === 0,
      output: issues.length === 0
        ? "✓ 文档合规检查通过"
        : `文档合规检查: ${issues.length} 项\n${issues.map((i) => `  ${i}`).join("\n")}`,
      data: { file: filePath, issues, passed: issues.length === 0 },
      exitCode: issues.length === 0 ? 0 : 2,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `检查失败: ${msg}`, exitCode: 2 };
  }
}
