/**
 * Cortex 自审视实验——甘雨召集审视委员会，对共识修复清单逐项验证
 *
 * 用法: npx tsx tests/manual/scripts/cortex-self-examination.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 场景:
 *   甘雨（MetaAgent）收到一份共识修复清单。她没有自己逐项查验——
 *   那会压垮她一个人。她做了一个秘书该做的事：把任务拆开，分给七位专家，
 *   每人只负责自己最擅长的那一块。任务结束，甘雨只做汇总，不替专家下判断。
 *
 * 硬约束（安全边界，不可突破）:
 *   - 所有 Agent 只能使用 read_file / search_code / list_files 读取项目文件
 *   - write_file 仅允许写入 test-output/self-examination/ 输出目录（审视报告）
 *   - run_shell、delete_file 被显式禁止
 *   - 不能触碰 packages/ 和 docs/ 下的任何文件
 *
 * 软约束（开放性引导）:
 *   - 不规定具体产出格式
 *   - 不规定审查范围
 *   - 由甘雨自主决定如何组织团队
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { AgentType, MemoryType, LinkType, PipelinePriority, type TaskNode, type SafeErrorReporter } from "@cortex/shared";
import { LlmAdapter } from "../../../src/llm-adapter";
import { TaskBoard } from "../../../src/task-board";
import { AgentPool } from "../../../src/agent-pool";
import { CodeAgent } from "../../../src/code-agent";
import { ReviewAgent } from "../../../src/review-agent";
import { InspectorAgent } from "../../../src/inspector-agent";
import { BrowserAgent } from "../../../src/browser-agent";
import { AnalysisAgent } from "../../../src/analysis-agent";
import { DocGovernAgent } from "../../../src/doc-govern-agent";
import { LoopAgent } from "../../../src/loop-agent";
import { OpsAgent } from "../../../src/ops-agent";
import { Scheduler } from "../../../src/scheduler";
import { PipelineObserver } from "../../../src/pipeline-observer";
import { ConfirmGate } from "../../../src/confirm-gate";
import { Toolkit } from "../../../src/toolkit";
import { MemoryStore } from "../../../src/memory-store";
import { ButlerAgent } from "../../../src/butler-agent";
import { MetaAgent } from "../../../src/meta-agent";
import { runMeeting, CODE_REVIEW_ROUNDTABLE } from "../config/roundtable-config";

// ═══════════════════════════════════════════════
// 1. 环境变量——从根目录 .env 加载
// ═══════════════════════════════════════════════

function loadEnv() {
  const envPath = path.resolve(process.cwd(), "..", "..", ".env");
  if (!fs.existsSync(envPath)) {
    const alt = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(alt)) {
      console.error("错误：.env 文件不存在，请在项目根目录创建 .env 并配置 DEEPSEEK_API_KEY");
      process.exit(1);
    }
    const lines = fs.readFileSync(alt, "utf-8").split("\n");
    for (const line of lines) {
      const clean = line.replace(/\r$/, "");
      const m = clean.match(/^([^=]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].trim();
    }
    return;
  }
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const clean = line.replace(/\r$/, "");
    const m = clean.match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

// ═══════════════════════════════════════════════
// 2. 审视工具集——只读 + 受限 write_file
// ═══════════════════════════════════════════════

function registerExaminationTools(
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
  const MAX_OUTPUT_CHARS = 4000; // 单次工具调用的最大输出字符数

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
          output: truncated + `\n\n...(截断，全文 ${content.length} 字符 / ${lines.length} 行。用 search_code 搜索关键词定位具体行)`,
        };
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

  toolkit.register("write_file", async (params) => {
    const fp = resolve(params.file_path as string);
    const content = (params.content ?? "") as string;
    const normalizedFp = path.normalize(fp);
    const normalizedOut = path.normalize(outputDir);
    if (!normalizedFp.startsWith(normalizedOut + path.sep) && normalizedFp !== normalizedOut) {
      return {
        success: false,
        error:
          `写入被拒绝：审视实验中，所有写入操作仅限于 ${outputDir}/ 目录。\n` +
          `你不能修改 packages/ 或 docs/ 下的任何文件。请将发现写入 ${outputDir}/ 目录下。`,
      };
    }
    try {
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fp, content, "utf-8");
      return { success: true, output: `Wrote ${Buffer.byteLength(content)} bytes to ${fp}` };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  // ── 软约束模式：移除 FORBIDDEN 占位，不向 LLM 暴露无法使用的工具定义 ──
  // FORBIDDEN 工具仍占据 listDefinitions() 输出的 toolDefs，导致 LLM 可能尝试调用并浪费 token。
  // 软约束模式下直接不注册这些工具——LLM 看不到就不会尝试。
  if (!softMode) {
    const FORBIDDEN = async () => ({
      success: false,
      error: "操作被禁止：审视实验中仅允许读取文件和将报告写入 test-output/self-examination/ 目录。",
    });
    toolkit.register("run_shell", FORBIDDEN);
    toolkit.register("delete_file", FORBIDDEN);
  } else {
    // 软约束：注册真实 run_shell 和 delete_file
    //
    // ── OS 命令适配层 ──
    // LLM 默认为 Unix 环境生成命令（grep/sed/head/wc/pwd 等），Windows 上需转译。
    // 仅做透明映射——Agent 无感知，无需改 prompt。
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
      "ls -": (_args: string) => "Get-ChildItem", // ls -la / ls -l → Get-ChildItem
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
      },
    };

    /** 翻译单个命令段（不含管道）。大小写不敏感匹配。 */
    function adaptSegment(cmd: string, pipeIn: boolean): string {
      if (!cmd) return cmd;
      const lower = cmd.trim().toLowerCase();
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
      // PowerShell 不支持 &&——替换为 ;（自审视场景下语义等价）
      let result = raw.trim().replace(/\s*&&\s*/g, "; ");
      if (result.includes("|")) {
        const segments = result.split(/\s*\|\s*/).filter((s) => s.length > 0);
        return segments.map((s, i) => adaptSegment(s, i > 0)).join(" | ");
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
          shell: isWin ? "powershell.exe" : "/bin/sh",
        });
        return { success: true, output: output.slice(0, MAX_OUTPUT_CHARS) };
      } catch (e: any) {
        const stderr = e.stderr ?? "";
        const hint = command !== rawCommand ? `\n（已转译: ${rawCommand} → ${command}）` : "";
        return {
          success: false,
          error: `命令执行失败: ${e.message?.slice(0, 300) ?? String(e)}${hint}${stderr ? `\nstderr: ${String(stderr).slice(0, 500)}` : ""}`,
        };
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
}

// ═══════════════════════════════════════════════
// 3. 种子记忆——帮委员会快速了解项目
// ═══════════════════════════════════════════════

function seedExaminationMemory(memory: MemoryStore): void {
  const existing = memory.read({
    metadataFilter: { taskId: "self-exam-constitution-index" },
    limit: 1,
  });
  if (existing.length > 0) return;

  // 项目入口指引
  const indexId = memory.write({
    memoryType: MemoryType.Conceptual,
    content: {
      taskType: "examination",
      entities: ["cortex", "architecture", "constitution"],
      decision:
        "Cortex 项目结构：packages/shared/ 是类型协议层，packages/engine/ 是核心引擎（含 9 类 Agent + Scheduler + MemoryStore + Toolkit），" +
        " packages/testing/ 是测试工具包。docs/constitution/ 存放宪法级架构约束，docs/issues/ 存放议题追踪。",
      outcome: "guide",
    },
    summary:
      "审视入口指引：shared（协议层）→ engine（核心引擎，含全部 Agent 与调度器）→ testing（测试层）。宪法在 docs/constitution/，议题在 docs/issues/。",
    agentType: AgentType.Analysis as any,
    creatorId: "system",
    metadata: { taskId: "self-exam-constitution-index" },
  });

  // 宪法哲学提示
  const philId = memory.write({
    memoryType: MemoryType.Conceptual,
    content: {
      taskType: "examination",
      entities: ["constitution", "design-philosophy"],
      decision:
        "Cortex 宪法从 v1.1 的「大脑隐喻」演进到 v2.3 的「工具链隐喻」。六条不可变原则约束架构演化方向：" +
        " 每个组件可替换、可验证、职责清晰。Agent 体系并非静态集合，而是可演化生态。",
      outcome: "context",
    },
    summary:
      "设计哲学：Cortex 宪法经历了从大脑隐喻到工具链隐喻的演进。六条不可变原则是所有架构决策的锚点。",
    agentType: AgentType.Analysis as any,
    creatorId: "system",
    metadata: { taskId: "self-exam-design-philosophy" },
  });

  memory.link(philId, indexId, LinkType.DerivedFrom, "system");
}

/**
 * 为质量严控 Agent 加载上轮审视报告作为上下文种子记忆。
 * 仅加载已验证思维框架稳定的 Agent 的上轮产出——
 * 刻晴（questioning-authority）、纳西妲（trace-to-source）、凝光（rule-supremacy）。
 * 这是方案F「审计结论注入下一轮自审视」在脚本层的最小落地。
 */
function seedPreviousReports(
  memory: MemoryStore,
  outputDir: string,
  reportMaxChars: number,
): void {
  const QUALITY_AGENTS: Record<string, { agentType: AgentType; label: string }> = {
    keqing: { agentType: AgentType.Review, label: "刻晴" },
    nahida: { agentType: AgentType.Analysis, label: "纳西妲" },
    ningguang: { agentType: AgentType.DocGovern, label: "凝光" },
  };

  if (!fs.existsSync(outputDir)) return;

  const existing = memory.read({
    metadataFilter: { taskId: "self-exam-constitution-index" },
    limit: 1,
  });
  const indexMemId = existing.length > 0 ? existing[0].id : undefined;

  for (const [key, { agentType, label }] of Object.entries(QUALITY_AGENTS)) {
    // 跳过已注入的报告（幂等）
    const prevInjected = memory.read({
      metadataFilter: { taskId: `self-exam-prev-report-${key}` },
      limit: 1,
    });
    if (prevInjected.length > 0) continue;

    const files = fs.readdirSync(outputDir);
    const reportFile = files.find(
      (f) => f.startsWith(key) && f.endsWith(".md") && f !== "self-examination-summary.md",
    );
    if (!reportFile) continue;

    const reportPath = path.join(outputDir, reportFile);
    let content: string;
    try {
      content = fs.readFileSync(reportPath, "utf-8");
    } catch {
      continue;
    }

    // 截断过长内容——完整报告留在文件系统，记忆里放精要
    const truncated = content.length > reportMaxChars
      ? content.slice(0, reportMaxChars) + `\n\n...(截断，全文 ${content.length} 字符见上轮报告 ${reportFile})`
      : content;

    try {
      const reportId = memory.write({
        memoryType: MemoryType.Conceptual,
        content: {
          taskType: "previous-examination-report",
          entities: [key, "self-examination", "previous-round"],
          decision: truncated,
          outcome: "context",
        },
        summary: `${label}（${key}）上轮审视报告：${reportFile}（${content.length} 字符）`,
        agentType: agentType as any,
        creatorId: "system",
        metadata: { taskId: `self-exam-prev-report-${key}`, reportFile },
      });

      if (indexMemId) {
        memory.link(reportId, indexMemId, LinkType.DerivedFrom, "system");
      }
    } catch {
      // 写入失败不阻塞整体流程
    }
  }
}

// ═══════════════════════════════════════════════
// 4. 聚合摘要生成——自审视闭环输出
// ═══════════════════════════════════════════════

interface ReportMeta {
  file: string;
  size: number;
  mtime: Date;
  title: string;
  passCount: number;
  failCount: number;
  warningCount: number;
}

function extractReportMeta(filePath: string): ReportMeta | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    // 提取标题（第一个 # 或 ## 行）
    let title = "";
    for (const line of lines) {
      const m = line.match(/^#{1,2}\s+(.+)/);
      if (m) { title = m[1].trim(); break; }
    }

    // 统计标记
    let passCount = 0, failCount = 0, warningCount = 0;
    for (const line of lines) {
      if (/✅|\[x\]|通过|已闭合|已修复|已完成/.test(line)) passCount++;
      if (/❌|\s未完成|未修复|未开始/.test(line)) failCount++;
      if (/⚠|⚠️|黄灯|部分|残留/.test(line)) warningCount++;
    }

    return {
      file: path.basename(filePath),
      size: Buffer.byteLength(content),
      mtime: fs.statSync(filePath).mtime,
      title,
      passCount,
      failCount,
      warningCount,
    };
  } catch {
    return null;
  }
}

function generateExaminationSummary(
  outputDir: string,
  report: { completed: number; failed: number },
  execDuration: number,
  fixListPath: string,
  isSoft: boolean = false,
): string {
  const now = new Date().toISOString().slice(0, 10);

  // 扫描产出文件
  const metas: ReportMeta[] = [];
  if (fs.existsSync(outputDir)) {
    const files = fs.readdirSync(outputDir);
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      if (f === "self-examination-summary.md") continue;
      const meta = extractReportMeta(path.join(outputDir, f));
      if (meta) metas.push(meta);
    }
  }

  const fixListLabel = path.basename(fixListPath);

  const lines: string[] = [];

  lines.push(isSoft ? "# 自由审视摘要" : "# 自审视验证摘要");
  lines.push("");
  lines.push(isSoft ? "> 产出方式：7 位 Agent 并行探索（MetaAgent 自规划）" : "> 产出方式：7 位 Agent 并行验证（MetaAgent 自规划）");
  lines.push(isSoft ? `> 探索日期：${now}` : `> 验证日期：${now}`);
  lines.push(`> 输入清单：${fixListLabel}`);
  lines.push(`> 执行耗时：${(execDuration / 1000).toFixed(0)}s`);
  lines.push(`> 完成: ${report.completed}  失败: ${report.failed}`);
  lines.push(`> 此文件由 cortex-self-examination.ts 自动生成，每次运行覆写。旧版追加至「历史版本」区。`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // 执行概况
  lines.push("## 执行概况");
  lines.push("");
  lines.push(`- 调度完成: ${report.completed} 个任务`);
  lines.push(`- 调度失败: ${report.failed} 个任务`);
  lines.push(`- 全流程耗时: ${(execDuration / 1000).toFixed(1)}s (${(execDuration / 60000).toFixed(1)}min)`);
  lines.push(`- 产出报告: ${metas.length} 个`);
  lines.push("");

  // Agent 产出明细
  lines.push("## Agent 产出明细");
  lines.push("");
  lines.push("| Agent | 报告文件 | 大小 | 标题 | ✅ | ❌ | ⚠️ |");
  lines.push("|-------|----------|------|------|----|----|-----|");

  // key→显示名 映射（文件名匹配用英文 key，表格显示用中文名）
  const agentKeys = ["keqing", "beidou", "nahida", "ningguang", "mona", "amber", "albedo"];
  const agentDisplay: Record<string, { emoji: string; label: string }> = {
    keqing: { emoji: "⚡", label: "刻晴" },
    beidou: { emoji: "⚓", label: "北斗" },
    nahida: { emoji: "🌿", label: "纳西妲" },
    ningguang: { emoji: "💎", label: "凝光" },
    mona: { emoji: "🔮", label: "莫娜" },
    amber: { emoji: "🐰", label: "安柏" },
    albedo: { emoji: "⚗️", label: "阿贝多" },
  };

  for (const key of agentKeys) {
    const meta = metas.find((m) => m.file.includes(key));
    if (meta) {
      const kb = (meta.size / 1024).toFixed(1);
      const titleShort = meta.title.slice(0, 40) + (meta.title.length > 40 ? "…" : "");
      const disp = agentDisplay[key] ?? { emoji: "", label: key };
      lines.push(`| ${disp.emoji}${disp.label} | ${meta.file} | ${kb}KB | ${titleShort} | ${meta.passCount} | ${meta.failCount} | ${meta.warningCount} |`);
    }
  }
  lines.push("");
  lines.push(`> 统计口径：✅=通过/闭合标记  ❌=未完成标记  ⚠️=黄灯/残留标记。仅供参考，以各报告全文为准。`);
  lines.push("");

  // 整体状态
  const totalPass = metas.reduce((s, m) => s + m.passCount, 0);
  const totalFail = metas.reduce((s, m) => s + m.failCount, 0);
  const totalWarn = metas.reduce((s, m) => s + m.warningCount, 0);

  lines.push("## 整体状态速览");
  lines.push("");
  lines.push(`- ✅ 通过/闭合: ${totalPass}`);
  lines.push(`- ❌ 未完成: ${totalFail}`);
  lines.push(`- ⚠️ 黄灯/残留: ${totalWarn}`);
  lines.push("");

  if (report.failed > 0) {
    lines.push(`### ⚠️ 失败任务`);
    lines.push("");
    lines.push(`有 ${report.failed} 个 Agent 验证任务失败，请检查上方日志。对应报告可能未生成或不完整。`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(isSoft ? `*自由审视摘要，由 cortex-self-examination.ts 自动生成，${now}*` : `*自审视验证摘要，由 cortex-self-examination.ts 自动生成，${now}*`);
  lines.push("");

  return lines.join("\n");
}

function writeExaminationSummary(
  outputDir: string,
  report: { completed: number; failed: number },
  execDuration: number,
  fixListPath: string,
  summaryPath: string,
  isSoft: boolean = false,
): void {
  const newContent = generateExaminationSummary(outputDir, report, execDuration, fixListPath, isSoft);

  // 读取旧内容，追加到历史版本区
  let oldContent = "";
  if (fs.existsSync(summaryPath)) {
    oldContent = fs.readFileSync(summaryPath, "utf-8");
  }

  const historyBlock = oldContent
    ? [
        "",
        "---",
        "",
        "## 📜 历史版本（自动追加，方便追溯）",
        "",
        "> 以下为本次验证前的内容。每次自审视完成后，旧版自动移入此区。",
        "",
        oldContent,
      ].join("\n")
    : "";

  const finalContent = newContent + historyBlock;
  fs.writeFileSync(summaryPath, finalContent, "utf-8");
  console.log(`   📝 ${isSoft ? "自由审视" : "自审视"}摘要已覆写: ${summaryPath} (${Buffer.byteLength(finalContent)} bytes)`);
  if (oldContent) {
    console.log(`   📜 旧版已追加至「历史版本」区`);
  }
}

// ═══════════════════════════════════════════════
// 5. 主流程——甘雨召集审视委员会
// ═══════════════════════════════════════════════

function agentName(type: string): string {
  const map: Record<string, string> = {
    code: "阿贝多 (Code)",
    review: "刻晴 (Review)",
    inspector: "安柏 (Inspector)",
    browser: "宵宫 (Browser)",
    analysis: "纳西妲 (Analysis)",
    "doc-govern": "凝光 (DocGovern)",
    loop: "莫娜 (Loop)",
    butler: "托马 (Butler)",
    ops: "北斗 (Ops)",
  };
  return map[type] ?? type;
}

async function main() {
  // ── 模式检测 ──
  const args = process.argv.slice(2);
  const SOFT_MODE = args.includes("--soft") || args.includes("--mode") && args.includes("soft");

  // Windows 终端 UTF-8 显示修复：chcp 操作控制台句柄，跨进程生效
  if (process.platform === "win32") {
    try { execSync("chcp 65001", { stdio: "pipe" }); } catch { /* 静默 */ }
  }

  loadEnv();
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) {
    console.error("错误：DEEPSEEK_API_KEY 未设置，请在 .env 中配置");
    process.exit(1);
  }

  const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-v4-flash";
  const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-v4-flash";
  const REASONING_EFFORT = process.env.DEEPSEEK_REASONING_EFFORT ?? "high";
  const REPORT_MAX_CHARS = parseInt(process.env.SE_REPORT_MAX_CHARS ?? "15000", 10);

  // 使用 import.meta.url 推导路径，避免 cd 到不同目录导致路径解析错误
  const __filename = fileURLToPath(import.meta.url);
  const SCRIPTS_DIR = path.dirname(__filename);
  const ENGINE_DIR = path.resolve(SCRIPTS_DIR, "..", "..", "..");
  const ROOT = path.resolve(ENGINE_DIR, "..", "..");
  const OUTPUT_DIR = SOFT_MODE
    ? path.join(ROOT, "test-output", "self-examination-soft")
    : path.join(ROOT, "test-output", "self-examination");

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const MODE_LABEL = SOFT_MODE ? "🔍 自由审视" : "🔬 修复验证审视";
  const MODE_DESC = SOFT_MODE
    ? "软约束 · 不设目标 · 开放所有文件"
    : "输入: consensus-fix-list.md · 只读 · 联合汇报";

  console.log("╔══════════════════════════════════════════════════╗");
  console.log(`║  ${MODE_LABEL}                            ║`);
  console.log(`║  ${MODE_DESC}      ║`);
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  项目: ${ROOT}`);
  console.log(`  输出目录: ${OUTPUT_DIR}`);
  console.log(`  模型: ${CHAT_MODEL}`);
  console.log(`  端点: ${BASE_URL}\n`);

  // ── 初始化组件 ──
  console.log("🟢 [第一阶段] 初始化组件...");

  const adapter = new LlmAdapter({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    chatModel: CHAT_MODEL,
    reasonerModel: REASONER_MODEL,
    reasoningEffort: REASONING_EFFORT,
  });
  adapter.setCacheEnabled(true);

  const metaAgent = new MetaAgent(adapter);
  const board = new TaskBoard();
  const pool = new AgentPool();
  const observer = new PipelineObserver();

  // ── onInvariant 注入：将 invariant 违规从 console.error 接驳入 observer 可观测管道 ──
  // 审判决议（刻晴 #7 + 莫娜 §2.2）：静态回调虽已定义，但 bootstrap 未设值，
  // 导致 TaskBoard/AgentPool 状态不一致时仅走 console.error，不进 observer，用户不可见。
  TaskBoard.onInvariant = (ctx) => {
    observer.emit({
      type: "scheduler.invariant_violation",
      priority: PipelinePriority.CRITICAL,
      payload: ctx,
      timestamp: Date.now(),
    });
  };
  AgentPool.onInvariant = (ctx) => {
    observer.emit({
      type: "agent_pool.invariant_violation",
      priority: PipelinePriority.CRITICAL,
      payload: ctx,
      timestamp: Date.now(),
    });
  };
  const gate = new ConfirmGate();
  gate.bypassAll();

  // 全新记忆数据库
  const memory = new MemoryStore();
  const MEMORY_DB = path.join(ROOT, ".cortex", "memory-self-exam.db");
  await memory.init(MEMORY_DB);
  seedExaminationMemory(memory);
  seedPreviousReports(memory, OUTPUT_DIR, REPORT_MAX_CHARS);
  console.log(`   🧠 MemoryStore: ${MEMORY_DB}`);
  console.log(`   📖 种子记忆: 项目入口指引 + 设计哲学 + 上轮审视报告（刻晴/纳西妲/凝光）\n`);

  // ── Agent 池注册 ──
  pool.register({ type: AgentType.Code, maxInstances: 2 });
  pool.register({ type: AgentType.Review, maxInstances: 2 });
  pool.register({ type: AgentType.Inspector, maxInstances: 2 });
  pool.register({ type: AgentType.Browser, maxInstances: 1 });
  pool.register({ type: AgentType.Analysis, maxInstances: 2 });
  pool.register({ type: AgentType.DocGovern, maxInstances: 1 });
  pool.register({ type: AgentType.Ops, maxInstances: 2 });
  pool.register({ type: AgentType.Loop, maxInstances: 2 });
  pool.register({ type: AgentType.Butler, maxInstances: 1 });

  const scheduler = new Scheduler(board, pool, observer, gate, metaAgent);

  // ── 注册审视委员 ──
  console.log("🟢 [第二阶段] 召集审视委员会...");

  // 阿贝多——西风骑士团首席炼金术士，用科学与实验精神审视代码
  const codeToolkit = new Toolkit(gate);
  registerExaminationTools(codeToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const codeAgent = new CodeAgent(adapter, codeToolkit, memory);
  await codeAgent.wakeup();
  scheduler.register(AgentType.Code, codeAgent, CHAT_MODEL);
  console.log("   ⚗️ 阿贝多 (Code) —— 炼金术士，" + (SOFT_MODE ? "核心层深度审查" : "P0 深度代码审查"));

  // 刻晴——璃月七星之玉衡，效率至上的法典审查者
  const reviewToolkit = new Toolkit(gate);
  registerExaminationTools(reviewToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const reviewAgent = new ReviewAgent(adapter, reviewToolkit, memory);
  await reviewAgent.wakeup();
  scheduler.register(AgentType.Review, reviewAgent, CHAT_MODEL);
  console.log("   ⚡ 刻晴 (Review) —— 玉衡星，" + (SOFT_MODE ? "代码质量侦察" : "P1 修复验证"));

  // 安柏——西风骑士团侦察骑士，永远元气满满的现场调查员
  const inspectorToolkit = new Toolkit(gate);
  registerExaminationTools(inspectorToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const inspectorAgent = new InspectorAgent(adapter, inspectorToolkit);
  inspectorAgent.setWorkspaceRoot(ROOT);
  await inspectorAgent.wakeup();
  scheduler.register(AgentType.Inspector, inspectorAgent, CHAT_MODEL);
  console.log("   🐰 安柏 (Inspector) —— 侦察骑士，" + (SOFT_MODE ? "全项目侦察" : "变更规模统计"));

  // 宵宫——长野原烟花店，观察者视角
  const browserToolkit = new Toolkit(gate);
  registerExaminationTools(browserToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const browserAgent = new BrowserAgent(adapter, browserToolkit);
  browserAgent.setWorkspaceRoot(ROOT);
  await browserAgent.wakeup();
  scheduler.register(AgentType.Browser, browserAgent, CHAT_MODEL);
  console.log("   🎆 宵宫 (Browser) —— 审查观察者");

  // 纳西妲——草神，温柔但有深度的架构分析师
  const analysisToolkit = new Toolkit(gate);
  registerExaminationTools(analysisToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const analysisAgent = new AnalysisAgent(adapter, analysisToolkit, memory);
  await analysisAgent.wakeup();
  scheduler.register(AgentType.Analysis, analysisAgent, CHAT_MODEL);
  console.log("   🌿 纳西妲 (Analysis) —— 草神，" + (SOFT_MODE ? "架构全景分析" : "P3 验证与架构趋势"));

  // 凝光——璃月七星之天权，群玉阁的主人，律法与治理的巨擘
  const docGovernToolkit = new Toolkit(gate);
  registerExaminationTools(docGovernToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const docGovernAgent = new DocGovernAgent(adapter, docGovernToolkit);
  await docGovernAgent.wakeup();
  scheduler.register(AgentType.DocGovern, docGovernAgent, CHAT_MODEL);
  console.log("   💎 凝光 (DocGovern) —— 天权星，" + (SOFT_MODE ? "治理合规审计" : "清单一致性审计"));

  // 莫娜——占星术士，能从水镜中看见隐藏的模式与趋势
  const loopToolkit = new Toolkit(gate);
  registerExaminationTools(loopToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const loopAgent = new LoopAgent(adapter, loopToolkit);
  await loopAgent.wakeup();
  scheduler.register(AgentType.Loop, loopAgent, CHAT_MODEL);
  console.log("   🔮 莫娜 (Loop) —— 占星术士，" + (SOFT_MODE ? "模式发现与趋势预言" : "修复质量趋势"));

  // 北斗——南十字船队大姐头，见过大风大浪的工程实干家
  const opsToolkit = new Toolkit(gate);
  registerExaminationTools(opsToolkit, ROOT, OUTPUT_DIR, SOFT_MODE);
  const opsAgent = new OpsAgent(adapter, opsToolkit);
  await opsAgent.wakeup();
  scheduler.register(AgentType.Ops, opsAgent, CHAT_MODEL);
  console.log("   ⚓ 北斗 (Ops) —— 南十字船长，" + (SOFT_MODE ? "工程就绪诊断" : "P2 验证与工程诊断"));

  // 托马——神里家管，旁观者，不参与任务派遣
  const butlerAgent = new ButlerAgent(observer);
  await butlerAgent.wakeup();
  scheduler.register(AgentType.Butler, butlerAgent, CHAT_MODEL);
  console.log("   🍵 托马 (Butler) —— 神里家管，旁观记录\n");

  // ── SafeReporter 注入：将所有 Agent 的 _safeReporter 接驳入 observer 管道 ──
  // 审判决议（刻晴 C1 + 莫娜 §1.2）：_safeReporter 默认为 null，
  // 静默 catch 中 _safeReporter?.() 的可选链在 null 上等于空操作，5 处安保失效。
  // 每 Agent 实例注入 observer-backed reporter，杜绝静默吞错。
  const safeReporter: SafeErrorReporter = (ctx) => {
    observer.emit({
      type: `agent.${ctx.severity === "fatal" ? "fatal" : "error"}`,
      priority: ctx.severity === "fatal" ? PipelinePriority.CRITICAL : PipelinePriority.HIGH,
      payload: ctx,
      timestamp: Date.now(),
    });
  };
  for (const a of [codeAgent, reviewAgent, inspectorAgent, browserAgent, analysisAgent, docGovernAgent, loopAgent, opsAgent]) {
    a.setSafeReporter(safeReporter);
  }
  console.log("   🛡️ SafeReporter 已注入 8 位审视委员——静默吞错终结。\n");

  // ── 甘雨自规划 ──
  if (SOFT_MODE) {
    console.log("🟢 [第三阶段] 甘雨放弃清单——给每位专家发方向指引，让代码库自己说话...\n");
  } else {
    console.log("🟢 [第三阶段] 甘雨读取共识修复清单，规划验证任务...\n");
  }

  const fixListPath = path.join(ROOT, "test-output", "self-examination", "consensus-fix-list.md");
  const fixListContent = SOFT_MODE
    ? "(软约束模式：不使用修复清单——各 Agent 自由探索整个代码库)"
    : (fs.existsSync(fixListPath) ? fs.readFileSync(fixListPath, "utf-8") : "(共识修复清单未找到)");

  // ═══════════════════════════════════════════════
  // 甘雨的意图——用中文思维叙述，让 MetaAgent 理解任务的「为什么」
  // 遵循六层框架：情境 → 身份 → 分寸 → 范围 → 信息 → 输出
  //
  // 技能模板加载：
  //   - 硬约束 (默认)：verification-templates.json —— 逐项验证清单
  //   - 软约束 (--soft)：verification-templates-soft.json —— 探索方向指引
  // 这是认知闭环的最小可验证单元——
  // 每次自审视完成后更新 JSON，下一次规划时自动获益。
  // ═══════════════════════════════════════════════

  const templatesFile = SOFT_MODE ? "verification-templates-soft.json" : "verification-templates.json";
  const templatesPath = path.join(SCRIPTS_DIR, "..", "config", templatesFile);
  let templatesLoaded = false;
  let templatesData: any = null;

  if (fs.existsSync(templatesPath)) {
    try {
      templatesData = JSON.parse(fs.readFileSync(templatesPath, "utf-8"));
      if (templatesData.templates && templatesData.templates.length === 7) {
        templatesLoaded = true;
        console.log(`   📋 从 ${templatesFile} 加载 7 条${SOFT_MODE ? "探索" : "验证"}技能模板\n`);
      } else {
        console.log(`   ⚠️ ${templatesFile} 模板数量异常，回退硬编码\n`);
      }
    } catch (e: any) {
      console.log(`   ⚠️ ${templatesFile} 解析失败: ${e.message}，回退硬编码\n`);
    }
  } else {
    console.log(`   ℹ️ ${templatesFile} 不存在，使用硬编码${SOFT_MODE ? "探索" : "验证"}指引\n`);
  }

  // ── 构建任务节点描述 ──
  function buildTaskLines(t: any, idx: number): string[] {
    return [
      `── 节点 ${idx + 1}：${t.name} (type=${t.type}) —— ${t.title} ──`,
      t.narrative,
      ...t.steps.map((s: string, i: number) => `${i + 1}. ${s}`),
      `每项输出：${t.outputFormat}`,
      `写出到 ${t.outputFile}`,
    ];
  }

  const taskBody = templatesLoaded
    ? templatesData.templates.flatMap((t: any, i: number) => buildTaskLines(t, i))
    : SOFT_MODE
      ? [
          // 回退：JSON 未加载时，使用软约束通用指引
          "没有修复清单。七位专家凭各自的专业直觉在代码库中自由探索。",
          "每个人从自己最敏锐的角度出发，发现代码、架构、工程、治理、模式中的一切值得关注的问题。",
          "不评分、不定级——只需如实报告。宁深挖一个真问题，不罗列十个假动作。",
          "各节点输出到 test-output/self-examination-soft/{agent-key}-*.md。",
        ]
      : [
          // 回退：JSON 未加载时，使用硬约束通用指引
          "请根据共识修复清单中的 P0-P3 条目，为七位专家各分配与其 type 匹配的验证任务。",
          "每位专家核查其对应优先级的条目是否已在代码层落地——不是改标记、不是加注释，是真改。",
          "各节点输出到 test-output/self-examination/{agent-key}-verification.md。",
        ];

  // ── 意图组装 ──
  const intentParts: string[] = [];

  if (SOFT_MODE) {
    // ═══ 软约束意图：自由探索 ═══
    intentParts.push(
      // 第一层：当前情境——没有目标，只有代码
      "桌上没有「共识修复清单」。这一次，你不是来逐项打勾的。",
      "整个 Cortex 项目的代码库向你完全敞开——packages/、docs/、config/，没有禁区。",
      "七位专家不是「验证员」——他们是「侦察兵」。各自从自己最专业的角度出发，在代码中自由穿行。",
      "",

      // 第二层：身份位置——你仍然是甘雨，但角色从「分配清单」变为「分配方向」
      "你的职责仍然是「分派」，不是「包揽」。但这一次，你给每个人的不是一份「待检查项清单」，",
      "而是「你该去看什么方向」。方向比清单重要——因为清单会漏，方向不会。",
      "  · 阿贝多（code）—— 炼金术士，深入核心模块的每一行代码，用实验精神验证正确性",
      "  · 刻晴（review）—— 玉衡星，扫描整个代码库，用效率主义的视角找不对劲的地方",
      "  · 北斗（ops）—— 船长，诊断工程就绪性——构建、依赖、配置、运行时脆弱点",
      "  · 纳西妲（analysis）—— 草神，俯瞰架构全景——依赖图、模块边界、扩展成本",
      "  · 凝光（doc-govern）—— 天权，审计治理合规——声明与实际之间有多少水分",
      "  · 莫娜（loop）—— 占星术士，从散落的代码中看见隐藏的模式和趋势",
      "  · 安柏（inspector）—— 侦察骑士，地毯式扫一遍项目目录，报告一切异常",
      "",

      // 第三层：分寸拿捏——不设目标，不划边界
      "不要给任何人设「完成指标」——刻晴不需要检查够 20 个文件才算合格。",
      "深度比广度重要。一个真问题比十个假报告有价值。",
      "如果某位专家报告「我仔细看了X，没有发现问题」——那也是重要的发现。",
      "",

      // 第四层：任务范围——七个独立根节点，全并行
      "现在开始规划。为以下七位专家各建一个独立根节点。",
      "",

      // 硬约束 type 不变
      "【硬约束】type 必须使用以下七个精确值之一，不允许任何变体、缩写或同义词：",
      "  type=\"review\"  → 刻晴    type=\"ops\"    → 北斗",
      "  type=\"analysis\" → 纳西妲   type=\"doc-govern\" → 凝光",
      "  type=\"loop\"     → 莫娜    type=\"inspector\" → 安柏",
      "  type=\"code\"     → 阿贝多",
      "如果你写出 type=\"implementation\"、type=\"inspect\"、type=\"reviewer\" 或任何不在上述七者中的值，",
      "调度器将无法匹配到对应 Agent，导致那位专家坐在板凳上干等——这是你的失职。",
      "",
    );
  } else {
    // ═══ 硬约束意图：逐项验证 ═══
    intentParts.push(
      // 第一层：当前情境——铺完整图景
      "你面前放着一份「共识修复清单」，里面密密麻麻列着 P0 到 P3 四个优先级的三十项修复条目。",
      "上一次圆桌会议上，六位专家已经逐项争论过——哪些真的修好了，哪些还差一口气，哪些根本没人碰。",
      "现在需要你做的，不是你自己动手逐项查验——你是秘书，不是审查官。",
      "",

      // 第二层：身份位置——你是甘雨，不是万能审查官
      "你的职责是「分派」，不是「包揽」。你手下有七位专家，各有各的专长：",
      "  · 阿贝多（code）—— 炼金术士，最擅长逐行审查代码正确性，尤其 P0 阻断级问题",
      "  · 刻晴（review）—— 玉衡星，对修复闭环有强迫症般的执着，适合验证 P1 高优先项",
      "  · 北斗（ops）—— 船长，工程直觉一流，能一眼看出 P2 工程项是否真的落地了",
      "  · 纳西妲（analysis）—— 草神，能从一棵树看见整片雨林，适合验证 P3 改善项并评估架构趋势",
      "  · 凝光（doc-govern）—— 天权，擅长逐条比对清单与代码，看口号和现实之间有多少水分",
      "  · 莫娜（loop）—— 占星术士，能从散落的修复点中看见隐藏的模式和趋势",
      "  · 安柏（inspector）—— 侦察骑士，最适合做变更规模的现场调查，不评价只统计",
      "",

      // 第三层：分寸拿捏——一人扛不动，七人刚好
      "如果你偷懒，把所有任务揉成一个「通用节点」——那等于让一个人审查整个项目。",
      "他会超时、会卡死、会漏掉一大半。另外六位专家干坐着喝茶，看着队友被压垮。",
      "这不是「优化」，这是「故障」。七个根节点，每个 type 精确对应一位专家——这是硬约束，不是建议。",
      "",

      // 第四层：任务范围——七个独立根节点，全并行
      "现在开始规划。为以下七位专家各建一个独立根节点。",
      "",

      "【硬约束】type 必须使用以下七个精确值之一，不允许任何变体、缩写或同义词：",
      "  type=\"review\"  → 刻晴    type=\"ops\"    → 北斗",
      "  type=\"analysis\" → 纳西妲   type=\"doc-govern\" → 凝光",
      "  type=\"loop\"     → 莫娜    type=\"inspector\" → 安柏",
      "  type=\"code\"     → 阿贝多",
      "如果你写出 type=\"implementation\"、type=\"inspect\"、type=\"reviewer\" 或任何不在上述七者中的值，",
      "调度器将无法匹配到对应 Agent，导致那位专家坐在板凳上干等——这是你的失职。",
      "",
    );
  }

  // 第五层：具体任务信息——由技能模板注入（双模式共用）
  intentParts.push(...taskBody, "");

  // 第六层：输出规范（双模式共用）
  intentParts.push(
    "以上七个节点全部设为根（无 parentId），全并行执行。",
    "每个节点的 payload 自包含——不需要读其他节点的结果才能开工。",
    "甘雨只做分派和最终的汇总摘要，不对专家的判断做二次加工。",
  );

  const intent = intentParts.join("\n");

  console.log("   📋 审视任务:");
  console.log(`   ${intent.split("\n").slice(0, 8).join("\n").slice(0, 300)}...\n`);

  console.log("   🌙 甘雨正在规划...");
  const planStart = Date.now();
  let nodes: TaskNode[] = [];
  try {
    nodes = await metaAgent.plan(intent, {
      existingTags: ["code", "review", "inspector", "analysis", "doc-govern", "ops", "loop"],
    });
  } catch (e) {
    console.error(`   ❌ MetaAgent 规划失败: ${e}`);
    process.exit(1);
  }
  console.log(`   ✅ 规划完成 (${Date.now() - planStart}ms): ${nodes.length} 个任务节点\n`);

  if (nodes.length === 0) {
    console.error("   ❌ MetaAgent 未生成任何任务节点——请检查上方日志");
    process.exit(1);
  }

  for (const n of nodes) {
    const parent = n.parentId ? ` → child of [${n.parentId.slice(0, 16)}]` : " → root";
    console.log(`     [${n.type}] ${n.tags.join(", ")}  ${n.id}${parent}`);
    const payloadPreview = n.payload.slice(0, 120);
    console.log(`        ${payloadPreview}...`);
  }

  // 依赖结构诊断
  const roots = nodes.filter((n) => !n.parentId);
  const nonRoots = nodes.filter((n) => n.parentId);
  console.log(`\n   🌳 依赖结构: ${roots.length} 个根节点, ${nonRoots.length} 个子节点`);
  if (nonRoots.length === 0) {
    console.log("   ⚠️ 诊断：所有节点都是根节点——甘雨没有建立时序依赖！\n");
  } else {
    const byParentId = new Map<string, TaskNode[]>();
    for (const n of nodes) {
      if (n.parentId) {
        const existing = byParentId.get(n.parentId);
        if (existing) existing.push(n);
        else byParentId.set(n.parentId, [n]);
      }
    }
    let layer = 0;
    let current = roots;
    while (current.length > 0) {
      console.log(
        `   Layer ${layer}: ${current.map((n) => agentName(n.tags[0] ?? n.type).split(" ")[0]).join(" | ")}`,
      );
      const next: TaskNode[] = [];
      for (const n of current) {
        const children = byParentId.get(n.id);
        if (children) next.push(...children);
      }
      current = next;
      layer++;
    }
    console.log();
  }

  // ── 入板 ──
  for (const n of nodes) board.addNode(n);

  // ── 事件监听 ──
  observer.on(PipelinePriority.HIGH, (e) => {
    const payload = e.payload as any;
    const nodeId = payload?.nodeId ?? "";
    const snippet = JSON.stringify(payload).slice(0, 120);
    console.log(`   📡 ${e.type}: ${nodeId ? nodeId : snippet}`);
  });

  // ── 执行 ──
  console.log(SOFT_MODE ? "🟢 [第四阶段] 审视委员会开始探索...\n" : "🟢 [第四阶段] 审视委员会开始工作...\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const execStart = Date.now();
  const report = await scheduler.executeAll();
  const execDuration = Date.now() - execStart;

  // ── 结果汇总 ──
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  📊 审视结果                                     ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`   完成: ${report.completed}  失败: ${report.failed}  耗时: ${execDuration}ms`);
  console.log();

  const allNodes = board.getAllNodes();
  for (const n of allNodes) {
    const status = n.status === "done" ? "✅" : n.status === "failed" ? "❌" : "⏳";
    const label = agentName(n.results[0]?.agentType ?? n.tags[0]);
    console.log(`   ${status} [${n.type}] ${n.tags.join(", ")}  ${label}`);
  }
  console.log();

  // ── 专家发言实录 ──
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  🎭 审视委员会发言实录                            ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  for (const n of allNodes) {
    if (n.results.length === 0 || n.status === "pending") continue;
    const r = n.results[0];
    const label = agentName(r.agentType ?? "unknown");
    const content = (r.output ?? r.error ?? "(无输出)").trim();

    const statusMark = r.success ? "✅" : "❌";
    console.log(`── ${statusMark} ${label} ──`);
    const indent = "   ";
    const maxLines = 500;
    const lines = content.split("\n");
    const displayLines = lines.slice(0, maxLines);
    for (const line of displayLines) {
      console.log(`${indent}${line}`);
    }
    if (lines.length > maxLines) {
      console.log(`${indent}... (截断，共 ${lines.length} 行，仅显示前 ${maxLines} 行)`);
    }
    console.log();
  }

  // ── 审视产出文件 ──
  console.log("── 审视产出文件 ──");
  if (fs.existsSync(OUTPUT_DIR)) {
    const files = fs.readdirSync(OUTPUT_DIR, { recursive: true }) as string[];
    if (files.length === 0) {
      console.log("   (空目录——审视委员会未产出任何文件)\n");
    } else {
      for (const f of files) {
        const fp = path.join(OUTPUT_DIR, f);
        const stat = fs.statSync(fp);
        if (stat.isFile()) {
          console.log(`   📄 ${f}  (${stat.size} bytes)`);
        }
      }
    }
  }
  console.log();

  // ── 聚合摘要：自审视闭环输出 ──
  const SUMMARY_PATH = path.join(OUTPUT_DIR, "self-examination-summary.md");
  const fixListLabel = SOFT_MODE
    ? "(软约束自由审视——无修复清单)"
    : fixListPath;
  writeExaminationSummary(OUTPUT_DIR, report, execDuration, fixListLabel, SUMMARY_PATH, SOFT_MODE);
  console.log();

  // ═══════════════════════════════════════════════
  // 5. 第五阶段——三轮圆桌代码审阅（宪法 v2.5 入宪）
  //   仅软约束模式下触发。
  //   10 位 Agent 全员入席：探索 7 人 + 甘雨 + 托马 + 宵宫
  // ═══════════════════════════════════════════════

  if (SOFT_MODE) {
    console.log("🟢 [第五阶段] 三轮圆桌代码审阅...");
    console.log("   入席者: 刻晴 阿贝多 纳西妲 凝光 莫娜 安柏 北斗 宵宫 甘雨 托马");
    console.log("   制度: 每轮每人 5-7 次发言 · 必须收束结论 · 凝光签署\n");

    const ROUNDTABLE_OUTPUT = path.join(OUTPUT_DIR, "roundtable-consensus.md");
    const DB_DIR = path.join(ROOT, ".cortex");

    try {
      await runMeeting(
        CODE_REVIEW_ROUNDTABLE,
        adapter,
        CHAT_MODEL,
        DB_DIR,
        ROUNDTABLE_OUTPUT,
      );
      console.log(`   📝 圆桌共识清单: ${ROUNDTABLE_OUTPUT}\n`);
    } catch (e) {
      console.error(`   ❌ 圆桌代码审阅失败: ${String(e).slice(0, 200)}`);
    }
  }

  // ── 记忆系统诊断 ──
  console.log("── 记忆系统诊断 ──");
  const allMemories = memory.read({});
  const accessed = allMemories.filter((m) => m.lastAccessedAt > m.createdAt + 1000);
  console.log(`   总记忆: ${allMemories.length}  被访问过: ${accessed.length}`);
  if (accessed.length > 0) {
    for (const m of accessed) {
      console.log(`     📖 ${m.summary.slice(0, 120)}`);
    }
  } else {
    console.log("   ⚠️ 没有记忆被 Agent 主动访问——审视委员会可能未利用记忆系统");
  }
  console.log();

  // ── 清理 ──
  try {
    await browserAgent.shutdown();
  } catch {
    /* 静默 */
  }

  console.log(`   全流程耗时: ${execDuration}ms\n`);
}

main().catch((err) => {
  console.error("Cortex 自审视实验异常终止", err);
  process.exit(1);
});
