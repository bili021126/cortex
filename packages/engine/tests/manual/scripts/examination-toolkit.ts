/**
 * 审视工具集注册——只读 + 受限 write_file（含 OS 命令适配层）
 *
 * 硬约束模式（softMode=false）：
 *   - read_file / list_dir / search_code → 只读
 *   - write_file → 仅允许写入 outputDir/
 *   - run_shell / delete_file → FORBIDDEN 占位
 *
 * 软约束模式（softMode=true）：
 *   - read_file / list_dir / search_code → 只读
 *   - write_file → 仅允许写入 outputDir/
 *   - run_shell → 真实执行（含 Unix→Windows 命令转译）
 *   - delete_file → 真实执行
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { LocalTool, Toolkit } from "@cortex/platform";
import { ReversibilityLevel as RL, ToolCategory } from "@cortex/config";


const MAX_OUTPUT_CHARS = 4000; // 单次工具调用的最大输出字符数

export function registerExaminationTools(
  toolkit: Toolkit,
  rootDir: string,
  outputDir: string,
  softMode: boolean = false,
) {
  const resolve = (p: string) => {
    if (path.isAbsolute(p)) return p;
    return path.resolve(rootDir, p);
  };

  // ── 只读工具 ──
  // 注意：工具输出会通过 ReAct 循环逐轮回传给 LLM，长输出直接推高 token 消耗。
  // 以下所有 read_file / search_code 均限制输出长度。

  toolkit.register("read_file", async (params) => {
    const fp = resolve(params.file_path as string);
    if (!fs.existsSync(fp)) return { success: false, error: `File not found: ${fp}` };
    if (fs.statSync(fp).isDirectory()) return { success: false, error: `Path is a directory: ${fp}` };
    try {
      const stat = fs.statSync(fp);
      if (stat.size > 500 * 1024) {
        return { success: false, error: `File too large (${(stat.size / 1024).toFixed(0)}KB > 500KB limit)` };
      }
      const content = fs.readFileSync(fp, "utf-8");
      // Token 节流：超过上限截断，告知 Agent 可通过 search_code 定位具体行
      if (content.length > MAX_OUTPUT_CHARS) {
        const lines = content.split("\n");
        const truncated = lines.slice(0, Math.ceil(MAX_OUTPUT_CHARS / 80)).join("\n");
        return {
          success: true,
          output: truncated + `\n\n...(截断，全文 ${content.length} 字符 / ${lines.length} 行。用 search_code 搜索关键词定位具体行)`};
      }
      return { success: true, output: content };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  toolkit.register("list_dir", async (params) => {
    const fp = resolve(params.path as string);
    if (!fs.existsSync(fp)) return { success: false, error: `Directory not found: ${fp}` };
    try {
      const entries = fs.readdirSync(fp, { withFileTypes: true });
      const results: string[] = [];
      for (const e of entries.slice(0, 100)) {
        const suffix = e.isDirectory() ? "/" : "";
        const size = e.isFile() ? ` (${fs.statSync(path.join(fp, e.name)).size} bytes)` : "";
        results.push(`${e.name}${suffix}${size}`);
      }
      return { success: true, output: results.join("\n") || "(empty directory)" };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  toolkit.register("search_code", async (params) => {
    const query = (params.query ?? "") as string;
    const dirParam = (params.directory as string) ?? rootDir;
    const dir = resolve(dirParam);
    if (!fs.existsSync(dir)) return { success: false, error: `Directory not found: ${dir}` };
    try {
      const results: string[] = [];
      const walk = (d: string, depth: number) => {
        if (depth > 4) return;
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const e of entries) {
          if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
          const full = path.join(d, e.name);
          if (e.isDirectory()) { walk(full, depth + 1); continue; }
          if (!/\.(ts|tsx|js|jsx|json|md|html|css)$/.test(e.name)) continue;
          try {
            const stat = fs.statSync(full);
            if (stat.size > 200 * 1024) continue;
            const content = fs.readFileSync(full, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(query)) {
                results.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
                if (results.length >= 50) return;
              }
            }
          } catch {
            /* 跳过不可读文件 */
          }
        }
      };
      walk(dir, 0);
      const output = results.slice(0, 30).join("\n") || "(no matches)";
      return { success: true, output: output.slice(0, MAX_OUTPUT_CHARS) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  // ── 受限 write_file：仅允许写入输出目录 ──

  toolkit.registerTool(new LocalTool(
    "write_file",
    ToolCategory.Write,
    "Write content to a file. Only paths under the examination output directory are permitted.",
    {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the output file" },
        content: { type: "string", description: "Content to write into the file" },
      },
      required: ["file_path", "content"],
    },
    RL.L2,
    async (params: Record<string, unknown>) => {
      const fp = resolve(params.file_path as string);
      const content = (params.content ?? "") as string;
      const normalizedFp = path.normalize(fp);
      const normalizedOut = path.normalize(outputDir);
      if (!normalizedFp.startsWith(normalizedOut + path.sep) && normalizedFp !== normalizedOut) {
        return {
          success: false,
          error:
            `写入被拒绝：审视实验中，所有写入操作仅限于 ${outputDir}/ 目录。\n` +
            `你不能修改 packages/ 或 docs/ 下的任何文件。请将发现写入 ${outputDir}/ 目录下。`};
      }
      try {
        const dir = path.dirname(fp);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fp, content, "utf-8");
        return { success: true, output: `Wrote ${Buffer.byteLength(content)} bytes to ${fp}` };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
  ));

  // ── 软约束模式：移除 FORBIDDEN 占位，不向 LLM 暴露无法使用的工具定义 ──
  // FORBIDDEN 工具仍占据 listDefinitions() 输出的 toolDefs，导致 LLM 可能尝试调用并浪费 token。
  // 软约束模式下直接不注册这些工具——LLM 看不到就不会尝试。
  if (!softMode) {
    const FORBIDDEN = async () => ({
      success: false,
      error: "操作被禁止：审视实验中仅允许读取文件和将报告写入 test-output/self-examination-soft/ 目录。"});
    toolkit.register("run_shell", FORBIDDEN);
    toolkit.register("delete_file", FORBIDDEN);
  } else {
    // 软约束：注册真实 run_shell 和 delete_file
    //
    // ── OS 命令适配层 ──
    // LLM 默认为 Unix 环境生成命令（grep/sed/head/wc/pwd 等），Windows 上需转译。
    // 仅做透明映射——Agent 无感知，无需改 prompt。
    registerSoftModeTools(toolkit, rootDir, resolve, MAX_OUTPUT_CHARS);
  }
}

// ═══════════════════════════════════════════════
// 软约束专用工具：run_shell（含 Unix→Win 转译）+ delete_file
// ═══════════════════════════════════════════════

function registerSoftModeTools(
  toolkit: Toolkit,
  rootDir: string,
  resolve: (p: string) => string,
  maxOutputChars: number,
) {
  const isWin = process.platform === "win32";
  const UNIX_TO_WIN: Record<string, string | ((args: string, pipeIn?: boolean) => string)> = {
    // 文件操作
    pwd: "cd",
    "cat ": "type ",
    "head -": (args: string, pipeIn?: boolean) => {
      const m = args.match(/^-n\s*(\d+)|-(\d+)/);
      const n = m ? (m[1] ?? m[2]) : "10";
      if (pipeIn) return `Select-Object -First ${n}`;
      const file = args.replace(/^-n?\s*\d+\s*/, "").trim();
      return file
        ? `powershell -NoProfile -Command "Get-Content '${file}' -TotalCount ${n}"`
        : `Select-Object -First ${n}`;
    },
    "ls -": (_args: string) => "Get-ChildItem",
    // 文本搜索
    "grep -r": (args: string) => {
      const parts = args.split(/\s+/);
      const pattern = parts.find((p) => !p.startsWith("-") && !p.includes("/") && !p.includes("\\")) ?? parts[0] ?? "";
      const dir = parts.find((p) => p.includes("/") || p.includes("\\") || p === ".") ?? ".";
      return `powershell -NoProfile -Command "Get-ChildItem -Path '${dir}' -Recurse -Include *.ts,*.js,*.json,*.md | Select-String -Pattern '${pattern}' | Select-Object -First 30"`;
    },
    "grep ": (args: string) => {
      const parts = args.split(/\s+/);
      const pattern = parts[0] ?? "";
      const file = parts.slice(1).join(" ") || "";
      return `powershell -NoProfile -Command "Select-String -Path '${file}' -Pattern '${pattern}' | Select-Object -First 30"`;
    },
    // 计数/统计
    "wc -l": (args: string) => `powershell -NoProfile -Command "(Get-Content ${args.trim()}).Count"`,
    "wc ": (args: string) => `powershell -NoProfile -Command "(Get-Content ${args.replace(/-[lwc]/g, '').trim()}).Count"`,
    // 文本处理
    sed: (args: string) => `powershell -NoProfile -Command "(Get-Content ${args.split(/\s+/).slice(1).join(' ').replace(/['\"]/g, '')}) -replace 'x', 'y'"`,
    // shell 判断
    "which ": (args: string) => `where ${args.trim()}`,
    // 文件查找
    "find ": (args: string) => {
      const pattern = args.match(/-name\s+["']?([^"'\s]+)["']?/)?.[1];
      const dir = args.split(/\s+/)[0] ?? ".";
      if (pattern) return `powershell -NoProfile -Command "Get-ChildItem -Path '${dir}' -Recurse -Filter '${pattern}' | Select-Object -First 50 FullName"`;
      return `powershell -NoProfile -Command "Get-ChildItem -Path '${dir}' -Recurse | Select-Object -First 50 FullName"`;
    }};

  /** 翻译单个命令段（不含管道）。大小写不敏感匹配。 */
  function adaptSegment(cmd: string, pipeIn: boolean): string {
    if (!cmd) return cmd;
    const lower = cmd.trim().toLowerCase();
    if (/^cd\s+\/d\s+/i.test(cmd)) {
      return "Set-Location " + cmd.replace(/^cd\s+\/d\s+/i, "").trim();
    }
    for (const [unixCmd, winTransform] of Object.entries(UNIX_TO_WIN)) {
      const keyLower = unixCmd.toLowerCase();
      if (lower === keyLower || lower.startsWith(keyLower)) {
        const leftover = cmd.slice(unixCmd.length).trim();
        if (typeof winTransform === "function") {
          const adapted = winTransform(leftover, pipeIn);
          if (adapted !== cmd) return adapted;
        } else {
          return winTransform + leftover;
        }
        break;
      }
    }
    return cmd;
  }

  function adaptCommand(raw: string): string {
    if (!isWin) return raw;
    let result = raw.trim().replace(/\s*&&\s*/g, "; ").replace(/\s+&\s+/g, "; ");
    result = result.replace(/\s+2>\/dev\/null/g, " 2>$null");
    result = result.replace(/\s+2>nul\b/g, " 2>$null");
    const hasPipe = result.includes("|");
    const hasSemi = result.includes(";");
    if (hasPipe || hasSemi) {
      if (hasPipe && !hasSemi) {
        const segments = result.split(/\s*\|\s*/).filter((s) => s.length > 0);
        return segments.map((s, i) => adaptSegment(s, i > 0)).join(" | ");
      }
      const semiParts = result.split(/\s*;\s*/).filter((s) => s.length > 0);
      return semiParts.map((part) => {
        if (part.includes("|")) {
          const pipeParts = part.split(/\s*\|\s*/).filter((s) => s.length > 0);
          return pipeParts.map((s, i) => adaptSegment(s, i > 0)).join(" | ");
        }
        return adaptSegment(part, false);
      }).join("; ");
    }
    return adaptSegment(result, false);
  }

  toolkit.register("run_shell", async (params) => {
    const rawCommand = params.command as string;
    if (!rawCommand) return { success: false, error: "run_shell 缺少 command 参数" };
    const command = adaptCommand(rawCommand);
    try {
      const output = execSync(command, {
        cwd: rootDir,
        encoding: "utf-8",
        timeout: 60_000,
        maxBuffer: 5 * 1024 * 1024,
        shell: isWin ? "powershell.exe" : "/bin/sh"});
      return { success: true, output: output.slice(0, maxOutputChars) };
    } catch (e: any) {
      const stderr = e.stderr ?? "";
      const hint = command !== rawCommand ? `\n（已转译: ${rawCommand} → ${command}）` : "";
      return {
        success: false,
        error: `命令执行失败: ${e.message?.slice(0, 300) ?? String(e)}${hint}${stderr ? `\nstderr: ${String(stderr).slice(0, 500)}` : ""}`};
    }
  });

  toolkit.register("delete_file", async (params) => {
    const fp = resolve(params.file_path as string);
    if (!fs.existsSync(fp)) return { success: false, error: `文件不存在: ${fp}` };
    try {
      fs.unlinkSync(fp);
      return { success: true, output: `已删除 ${fp}` };
    } catch (e) {
      return { success: false, error: `删除失败: ${String(e)}` };
    }
  });
}
