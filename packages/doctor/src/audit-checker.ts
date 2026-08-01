// ============================================================
// @cortex/doctor —— audit-trail 审计读取检查器
//
// @file-overview
// AuditTrailChecker 读取 `${projectRoot}/.cortex/logs/audit.jsonl`，
// 报告审计条目的类型分布（2+ 类 = 观测链路健康），并支持按
// spanId 查询（AuditTrail.queryBySpan 读取端，spec S2-8）。
//
// 设计约束（诚实原则）：
//   - audit.jsonl 缺失 → info 级发现（引擎未运行过 ≠ 项目不健康）
//   - 损坏行跳过，不影响整体统计
//   - 仅当文件存在时才构造 AuditTrail（避免只读场景产生副作用）
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";

import { AuditTrail } from "@cortex/telemetry";
import type {
  IChecker,
  CheckerOptions,
  CheckResult,
  Finding,
} from "./types.js";

/** audit.jsonl 相对 projectRoot 的默认路径（与 AuditTrail 默认一致） */
const AUDIT_REL_PATH = path.join(".cortex", "logs", "audit.jsonl");

/** spanId 查询选项键（CheckerOptions 扩展键） */
export const AUDIT_SPAN_ID_OPTION = "auditSpanId";

/**
 * 审计跟踪读取检查器（spec S2-8）。
 *
 * 用法：
 * ```typescript
 * const checker = new HealthChecker();
 * checker.registerChecker(new AuditTrailChecker());
 * const report = await checker.diagnose(root, { only: "audit-trail", auditSpanId: "span-1" });
 * ```
 */
export class AuditTrailChecker implements IChecker {
  readonly name = "audit-trail";
  readonly description = "读取 .cortex/logs/audit.jsonl，报告审计类型分布并支持 spanId 查询";

  async check(projectRoot: string, options?: CheckerOptions): Promise<CheckResult> {
    const startTime = Date.now();
    const auditFile = path.join(projectRoot, AUDIT_REL_PATH);
    const findings: Finding[] = [];

    if (!fs.existsSync(auditFile)) {
      findings.push({
        id: "AUDIT-FILE-001",
        severity: "info",
        checker: this.name,
        title: "审计文件不存在（引擎可能未运行）",
        message: `${AUDIT_REL_PATH} 不存在——引擎尚未运行或未产生审计条目，观测链路暂无可读数据`,
        files: [auditFile],
        suggestion: "运行引擎（bootstrapEngine）一次后重试；若仍缺失请检查 .cortex/logs 权限",
      });
      return {
        checker: this.name,
        passed: true,
        findings,
        summary: { fatal: 0, error: 0, warning: 0, info: 1, total: 1 },
        score: 100,
        durationMs: Date.now() - startTime,
      };
    }

    // 统计条目类型分布（损坏行跳过）
    const countByType = new Map<string, number>();
    let total = 0;
    let corrupted = 0;
    const raw = fs.readFileSync(auditFile, "utf-8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      total++;
      try {
        const entry = JSON.parse(line) as { type?: string };
        const type = entry.type ?? "unknown";
        countByType.set(type, (countByType.get(type) ?? 0) + 1);
      } catch {
        corrupted++;
      }
    }

    const typeSummary = [...countByType.entries()]
      .map(([t, c]) => `${t}×${c}`)
      .join(", ") || "(空)";

    findings.push({
      id: "AUDIT-DATA-001",
      severity: "info",
      checker: this.name,
      title: `审计条目 ${total} 条（${countByType.size} 类）`,
      message: `类型分布: ${typeSummary}${corrupted > 0 ? `；损坏行 ${corrupted} 条已跳过` : ""}`,
      files: [auditFile],
      suggestion: null,
    });

    // spanId 查询（spec S2-8：queryBySpan 读取端）
    const spanId = options?.[AUDIT_SPAN_ID_OPTION] as string | undefined;
    if (spanId && total > 0) {
      const trail = new AuditTrail(path.join(projectRoot, ".cortex", "logs"));
      try {
        const matches = trail.queryBySpan(spanId);
        findings.push({
          id: "AUDIT-SPAN-001",
          severity: "info",
          checker: this.name,
          title: `spanId "${spanId}" 命中 ${matches.length} 条`,
          message: matches.length > 0
            ? `匹配条目: ${matches.map((m) => m.id).join(", ")}`
            : "无匹配条目（record* 当前不产 spanId，命中 0 条属预期）",
          files: [auditFile],
          suggestion: null,
        });
      } finally {
        trail.close();
      }
    }

    return {
      checker: this.name,
      passed: true,
      findings,
      summary: { fatal: 0, error: 0, warning: 0, info: findings.length, total: findings.length },
      score: 100,
      durationMs: Date.now() - startTime,
    };
  }
}
