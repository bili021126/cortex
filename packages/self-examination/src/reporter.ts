// ============================================================
// @cortex/self-examination/reporter — 摘要 + 报告 + 基线对比
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExamConfig, ExamResult, ExamReport, ExamMetric } from "./config.js";

/** 从 ExamResult 生成 ExamReport */
export function generateReport(result: ExamResult): ExamReport {
  const metrics: Partial<Record<ExamMetric, number>> = {};
  const duration = result.endTime - result.startTime;

  // exitCode
  metrics.exitCode = result.exitCode;

  // API 429 计数
  metrics.api429Count = result.events.filter((e: any) =>
    String(e.payload?.error ?? "").includes("429") || String(e.payload?.error ?? "").includes("rate_limit")
  ).length;

  // API error rate
  const apiCalls = result.events.filter((e: any) => String(e.type ?? "").includes("llm") || String(e.type ?? "").includes("api"));
  const apiErrors = apiCalls.filter((e: any) => !e.payload?.success);
  metrics.apiErrorRate = apiCalls.length > 0 ? +(apiErrors.length / apiCalls.length).toFixed(3) : 0;

  // 事件发射计数
  metrics.eventEmitCount = result.events.length;

  // 假阳性率 (crossCheck 中 success=false 的比例)
  const total = result.crossCheck.length;
  const failed = result.crossCheck.filter((c: any) => !c.success).length;
  metrics.reportFalsePositiveRate = total > 0 ? +(failed / total).toFixed(3) : 0;

  // 管道延迟（平均）
  const eventLatencies: number[] = [];
  for (let i = 1; i < result.events.length; i++) {
    const gap = (result.events[i]?.ts ?? 0) - (result.events[i - 1]?.ts ?? 0);
    if (gap > 0 && gap < 60000) eventLatencies.push(gap);
  }
  metrics.pipelineLatency = eventLatencies.length > 0
    ? Math.round(eventLatencies.reduce((a: number, b: number) => a + b, 0) / eventLatencies.length)
    : 0;

  // 错误汇总
  const errors: string[] = [];
  if (result.error) errors.push(result.error);
  for (const r of result.auditResults) {
    if (!r.success && r.error) errors.push(`[${r.agentType}] ${r.error}`);
  }

  return {
    id: result.config.id,
    name: result.config.name,
    duration,
    exitCode: result.exitCode,
    metrics,
    findings: result.crossCheck,
    summary: generateSummary(result),
    errors,
  };
}

function generateSummary(result: ExamResult): string {
  const pass = result.auditResults.filter((r: any) => r.success).length;
  const fail = result.auditResults.filter((r: any) => !r.success).length;
  const secs = ((result.endTime - result.startTime) / 1000).toFixed(1);
  return `[${result.config.id}] ${pass}/${result.auditResults.length} 通过, ${fail} 失败, ${secs}s`;
}

/** 与基线对比——读取上次报告，比较关键指标 */
export function compareToBaseline(report: ExamReport, baselinePath?: string): string | null {
  if (!baselinePath || !fs.existsSync(baselinePath)) return null;

  let baseline: ExamReport;
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
  } catch { return null; }

  const lines: string[] = ["## 基线对比\n"];
  const keys: ExamMetric[] = ["apiErrorRate", "reportFalsePositiveRate", "pipelineLatency"];
  for (const key of keys) {
    const current = report.metrics[key] ?? 0;
    const base = baseline.metrics[key] ?? 0;
    const diff = current - base;
    const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
    lines.push(`| ${key} | ${base} | ${current} | ${arrow} ${Math.abs(diff).toFixed(3)} |`);
  }
  lines.push("");
  return lines.join("\n");
}

/** 打印终审裁决 */
export function printVerdict(report: ExamReport, comparison: string | null): void {
  console.log("\n╔══════════════════════════════════════╗");
  console.log(`║  ${report.id.padEnd(35)} ║`);
  console.log("╚══════════════════════════════════════╝");
  console.log(`  耗时: ${(report.duration / 1000).toFixed(1)}s`);
  console.log(`  通过: ${report.findings.filter((f: any) => f.success).length}/${report.findings.length}`);
  console.log(`  FP率: ${((report.metrics.reportFalsePositiveRate ?? 0) * 100).toFixed(1)}%`);
  console.log(`  429: ${report.metrics.api429Count ?? 0}`);
  console.log(`  事件: ${report.metrics.eventEmitCount ?? 0}`);
  console.log(`  延迟: ${report.metrics.pipelineLatency ?? 0}ms/event`);
  if (report.errors.length > 0) {
    console.log(`\n  ⚠️  ${report.errors.length} 个错误:`);
    for (const e of report.errors.slice(0, 3)) console.log(`    ${e.slice(0, 120)}`);
  }
  if (comparison) console.log(`\n${comparison}`);
  console.log(`\n  综合: ${report.exitCode === 0 && report.errors.length === 0 ? "✅ PASS" : "❌ FAIL"}`);
}
