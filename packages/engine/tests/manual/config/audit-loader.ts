/**
 * 审计报告动态加载器 —— 从 test-output/self-examination/ 读取最新验证报告，
 * 提取关键发现并注入到 Persona 的 systemPrompt 中。
 *
 * 用法:
 *   import { loadAuditContext, injectAuditContext } from "./audit-loader";
 *
 *   const ctx = loadAuditContext("test-output/self-examination");
 *   const enhancedPrompt = injectAuditContext(basePrompt, "keqing", ctx);
 *
 * 设计意图:
 *   - persona-prompts.json 存储角色性格/说话风格（稳定，不常变）
 *   - audit-loader.ts 从报告提取最新事实数据（每次验证后自动更新）
 *   - 两者在运行时合并，避免反复覆写 persona-prompts.json
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ═══════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════

/** 单个 Agent 的报告摘要 */
export interface AgentReportSummary {
  agentKey: string;
  agentName: string;
  fileName: string;
  /** 报告标题（第一个 # heading） */
  title: string;
  /** 总览段落（前 500 字符） */
  overview: string;
  /** 关键结论行（包含 ✅ ❌ ⚠️ 的行） */
  verdicts: string[];
  /** 文件大小 (bytes) */
  size: number;
}

/** 共识清单中的 P0-P3 待修复项 */
export interface FixListSnapshot {
  p0: string[];
  p1: string[];
  p2: string[];
  p3: string[];
  closed: string[];
}

/** 完整审计上下文 */
export interface AuditContext {
  /** 报告目录 */
  reportDir: string;
  /** 整体统计 */
  summary: {
    completed: number;
    failed: number;
    duration: string;
    totalReports: number;
    passCount: number;
    failCount: number;
    warnCount: number;
  };
  /** 各 Agent 报告摘要 */
  agentReports: AgentReportSummary[];
  /** 共识清单快照 */
  fixList: FixListSnapshot;
}

// ═══════════════════════════════════════════════
// Agent key → 报告文件名映射
// ═══════════════════════════════════════════════

const AGENT_REPORT_MAP: Record<string, string[]> = {
  keqing: ["keqing-p1-verification.md", "keqing-code-quality-audit.md"],
  nahida: ["nahida-p3-verification.md", "nahida-architecture-analysis.md"],
  albedo: ["albedo-p0-code-review.md", "albedo-core-code-audit.md"],
  beidou: ["beidou-p2-verification.md", "beidou-ops-readiness.md", "beidou-deploy-readiness.md"],
  amber: ["amber-change-summary.md", "amber-filesystem-inspect.md"],
  ningguang: ["ningguang-fixlist-consistency.md"],
};

const AGENT_NAME_MAP: Record<string, string> = {
  keqing: "刻晴", nahida: "纳西妲", albedo: "阿贝多",
  beidou: "北斗", amber: "安柏", ningguang: "凝光",
};

// ═══════════════════════════════════════════════
// 报告解析
// ═══════════════════════════════════════════════

function parseAgentReport(filePath: string, agentKey: string): AgentReportSummary | null {
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // 提取标题（第一个 # heading）
  const titleLine = lines.find((l) => /^# [^#]/.test(l));
  const title = titleLine ? titleLine.replace(/^# /, "").trim() : path.basename(filePath, ".md");

  // 提取总览（标题后的第一个实质性段落，跳过元数据行和空行）
  let overview = "";
  let inOverview = false;
  let overviewLines = 0;
  for (const line of lines) {
    if (line.startsWith("# ") && !inOverview) { inOverview = true; continue; }
    if (!inOverview) continue;
    // 跳过元数据行、空行、分隔线
    if (/^> /.test(line) || /^---$/.test(line) || /^\|.*\|$/.test(line)) continue;
    const trimmed = line.trim();
    if (!trimmed) { if (overview) break; else continue; }
    if (trimmed.startsWith("## ")) break;
    overview += (overview ? " " : "") + trimmed;
    overviewLines++;
    if (overview.length > 500 || overviewLines > 5) break;
  }

  // 提取关键判定行（包含 ✅ ❌ ⚠️ 的非表格行）
  const verdicts: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("|") || trimmed.startsWith(">") || trimmed.startsWith("#")) continue;
    if (/\*\*结论[:：]/.test(trimmed) || /\*\*判定[:：]/.test(trimmed)) {
      verdicts.push(trimmed);
    }
  }

  return {
    agentKey,
    agentName: AGENT_NAME_MAP[agentKey] ?? agentKey,
    fileName: path.basename(filePath),
    title,
    overview: overview.slice(0, 500),
    verdicts: verdicts.slice(0, 8),
    size: Buffer.byteLength(content, "utf-8"),
  };
}

function parseFixList(filePath: string): FixListSnapshot {
  const result: FixListSnapshot = { p0: [], p1: [], p2: [], p3: [], closed: [] };
  if (!fs.existsSync(filePath)) return result;

  const content = fs.readFileSync(filePath, "utf-8");
  const sections = content.split(/(?=### )/);

  for (const section of sections) {
    const lines = section.split("\n");
    const items = lines
      .filter((l) => /^- \[[ x]\]/.test(l))
      .map((l) => l.replace(/^- \[[ x]\]\s*/, "").trim());

    if (section.startsWith("### P0")) result.p0 = items;
    else if (section.startsWith("### P1")) result.p1 = items;
    else if (section.startsWith("### P2")) result.p2 = items;
    else if (section.startsWith("### P3")) result.p3 = items;
    else if (section.startsWith("### ✅")) result.closed = items;
  }

  return result;
}

// ═══════════════════════════════════════════════
// 公共 API
// ═══════════════════════════════════════════════

/**
 * 解析报告文件路径：先在主目录查找，若不存在则回退到 archive/ 下最新日期的子目录。
 */
function resolveReportPath(reportDir: string, fileName: string): string | null {
  const primary = path.join(reportDir, fileName);
  if (fs.existsSync(primary)) return primary;

  // 回退：在 archive/ 下查找最新日期子目录
  const archiveDir = path.join(reportDir, "archive");
  if (!fs.existsSync(archiveDir)) return null;

  const subdirs = fs.readdirSync(archiveDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse(); // 最新日期在前

  for (const subdir of subdirs) {
    const candidate = path.join(archiveDir, subdir, fileName);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * 从报告目录加载完整审计上下文。
 * 读取 self-examination-summary.md、consensus-fix-list.md 及各 Agent 报告。
 * 若主目录无报告文件，自动回退到 archive/ 下最新日期子目录。
 */
export function loadAuditContext(reportDir: string): AuditContext {
  const summaryPath = path.join(reportDir, "self-examination-summary.md");
  const fixListPath = path.join(reportDir, "consensus-fix-list.md");

  // 解析整体摘要
  let summary = { completed: 0, failed: 0, duration: "未知", totalReports: 0, passCount: 0, failCount: 0, warnCount: 0 };
  if (fs.existsSync(summaryPath)) {
    const text = fs.readFileSync(summaryPath, "utf-8");
    const cMatch = text.match(/完成[:：]\s*(\d+)/); if (cMatch) summary.completed = parseInt(cMatch[1]);
    const fMatch = text.match(/失败[:：]\s*(\d+)/); if (fMatch) summary.failed = parseInt(fMatch[1]);
    const dMatch = text.match(/耗时[:：]\s*([\d.]+s)/); if (dMatch) summary.duration = dMatch[1];
    const rMatch = text.match(/产出报告[:：]\s*(\d+)/); if (rMatch) summary.totalReports = parseInt(rMatch[1]);
    const pMatch = text.match(/通过\/闭合[:：]\s*(\d+)/); if (pMatch) summary.passCount = parseInt(pMatch[1]);
    const xMatch = text.match(/未完成[:：]\s*(\d+)/); if (xMatch) summary.failCount = parseInt(xMatch[1]);
    const wMatch = text.match(/黄灯\/残留[:：]\s*(\d+)/); if (wMatch) summary.warnCount = parseInt(wMatch[1]);
  }

  // 解析各 Agent 报告（主目录 + archive 回退）
  const agentReports: AgentReportSummary[] = [];
  for (const [agentKey, fileNames] of Object.entries(AGENT_REPORT_MAP)) {
    for (const fileName of fileNames) {
      const reportPath = resolveReportPath(reportDir, fileName);
      if (!reportPath) continue;
      const report = parseAgentReport(reportPath, agentKey);
      if (report) agentReports.push(report);
    }
  }

  // 解析共识清单
  const fixList = parseFixList(fixListPath);

  return { reportDir, summary, agentReports, fixList };
}

/**
 * 为指定 Agent 构建审计注入上下文文本。
 * 此文本应注入到 Persona systemPrompt 的开头，提供最新的验证数据。
 */
export function buildAuditContextForAgent(ctx: AuditContext, agentKey: string): string {
  const parts: string[] = [];
  const agentName = AGENT_NAME_MAP[agentKey] ?? agentKey;

  // 1. 整体状态
  parts.push(`[审计上下文 · 最新验证数据 · ${new Date().toISOString().slice(0, 10)}]`);
  parts.push("");
  parts.push(`整体状态：${ctx.summary.completed} 完成 / ${ctx.summary.failed} 失败，耗时 ${ctx.summary.duration}`);
  parts.push(`标记统计：✅ ${ctx.summary.passCount} 通过 | ❌ ${ctx.summary.failCount} 未完成 | ⚠️ ${ctx.summary.warnCount} 残留`);
  parts.push("");

  // 2. 该 Agent 自己的报告发现
  const ownReports = ctx.agentReports.filter((r) => r.agentKey === agentKey);
  if (ownReports.length > 0) {
    parts.push(`── ${agentName} 报告发现 ──`);
    for (const r of ownReports) {
      parts.push(`📄 ${r.title} (${(r.size / 1024).toFixed(1)}KB)`);
      if (r.overview) parts.push(`   ${r.overview.slice(0, 300)}`);
      for (const v of r.verdicts.slice(0, 3)) {
        parts.push(`   ${v}`);
      }
      parts.push("");
    }
  }

  // 3. 其他 Agent 的关键发现（交叉引用）
  const otherReports = ctx.agentReports.filter((r) => r.agentKey !== agentKey);
  if (otherReports.length > 0) {
    parts.push(`── 其他 Agent 关键发现（交叉参考）──`);
    for (const r of otherReports) {
      const verdictSummary = r.verdicts.slice(0, 1).join(" ");
      if (verdictSummary) {
        parts.push(`  ${r.agentName}（${r.title}）: ${verdictSummary.slice(0, 150)}`);
      }
    }
    parts.push("");
  }

  // 4. 共识清单当前状态
  parts.push(`── 当前共识清单 ──`);
  if (ctx.fixList.p0.length > 0) {
    parts.push(`P0 待修复 (${ctx.fixList.p0.length}项):`);
    ctx.fixList.p0.slice(0, 3).forEach((item) => parts.push(`  - [ ] ${item.slice(0, 120)}`));
  }
  if (ctx.fixList.p1.length > 0) {
    parts.push(`P1 待修复 (${ctx.fixList.p1.length}项):`);
    ctx.fixList.p1.slice(0, 3).forEach((item) => parts.push(`  - [ ] ${item.slice(0, 120)}`));
  }
  parts.push(`P2: ${ctx.fixList.p2.length}项 | P3: ${ctx.fixList.p3.length}项 | 已闭合: ${ctx.fixList.closed.length}项`);
  parts.push("");

  parts.push("[审计上下文结束] —— 以上数据基于最新验证报告，请在发言时引用最新数据而非历史记忆。");

  return parts.join("\n");
}

/**
 * 将审计上下文注入到 Persona 的 systemPrompt 中。
 * 上下文插入到 prompt 最前方，用分隔线与原始 prompt 隔开。
 */
export function injectAuditContext(
  baseSystemPrompt: string,
  agentKey: string,
  ctx: AuditContext,
): string {
  const contextBlock = buildAuditContextForAgent(ctx, agentKey);
  return `${contextBlock}\n\n---\n\n${baseSystemPrompt}`;
}

/**
 * 便捷函数：读取 persona-prompts.json 并注入审计上下文。
 * 返回增强后的 Persona 数组，可直接替换 MeetingConfig.personas。
 */
export function enhancePersonasWithAudit(
  basePrompts: Record<string, { emoji: string; name: string; title: string; systemPrompt: string }>,
  ctx: AuditContext,
): Array<{ emoji: string; name: string; title: string; systemPrompt: string }> {
  return Object.entries(basePrompts)
    .filter(([key]) => key !== "_note")
    .map(([key, p]) => ({
      ...p,
      systemPrompt: injectAuditContext(p.systemPrompt, key, ctx),
    }));
}

/**
 * 打印审计上下文摘要到控制台（供脚本启动时展示）。
 */
export function printAuditSummary(ctx: AuditContext): void {
  console.log(`\n📋 审计报告加载: ${ctx.reportDir}`);
  console.log(`   整体: ${ctx.summary.completed}完成/${ctx.summary.failed}失败, ${ctx.summary.totalReports}报告, ${ctx.summary.duration}`);
  console.log(`   标记: ✅${ctx.summary.passCount} ❌${ctx.summary.failCount} ⚠️${ctx.summary.warnCount}`);
  console.log(`   共识清单: P0=${ctx.fixList.p0.length} P1=${ctx.fixList.p1.length} P2=${ctx.fixList.p2.length} P3=${ctx.fixList.p3.length}`);
  console.log(`   Agent报告: ${ctx.agentReports.map((r) => `${r.agentName}(${r.fileName})`).join(", ")}`);
}
