// ============================================================
// @cortex/engine/planning/hard-verification-gate —— 硬验证门
//
// @layer 治理层
// @role 预检——发射前验证，拒绝时反馈
//
// 设计：
//   硬验证门插在治理事件发射之前。LLM 审计输出（如 DocGovernAgent）
//   在进入 GovernanceEventEmitter._emit() 之前过一道零 token 规则门。
//
//   全部 5 条规则通过 → check() 返回 { passed: true }
//   任意一条规则否决 → check() 返回 { passed: false, reasons: [...] }
//
//   拒绝时事件不会被静默丢弃——它带着 source="rule-denied" 和拒绝原因
//   以 FYI 优先级回写给发射方（DocGovernAgent），模型在下一轮自我修正。
// ============================================================

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { MEMORY_VALID_TRANSITIONS, PipelineEventType, PipelinePriority, type GovernanceEventPayload, type IPipelineObserver } from "@cortex/shared";
import { DegradationBoundary } from "../core/degradation-boundary.js";
import { VERIFICATION_CACHE_TTL_MS, BARREL_MAX_SIZE, TSFILE_MAX_SIZE } from "@cortex/config";

// ─── 治理 Payload 扩展字段（硬验证门规则依赖的约定字段，非 GovernanceEventPayload 固定字段）──
interface GateRulePayload {
  filePath?: string;
  nodeId?: string;
  violation?: string;
  fromState?: string;
  toState?: string;
  modulePath?: string;
  sourcePkg?: string;
  targetPkg?: string;
  interfaceName?: string;
}

// ─── 裁决类型 ─────────────────────────────────────

export interface RuleVerdict {
  ruleName: string;
  passed: boolean;
  /** H18 fix: 规则因缺少输入数据而跳过（不计入 gate 总结果） */
  skipped?: boolean;
  reason?: string;
}

export interface HardGateResult {
  /** 全部规则通过？ */
  passed: boolean;
  /** 逐条裁决明细 */
  verdicts: RuleVerdict[];
}

// ─── 硬验证门 ────────────────────────────────────

/**
 * HardVerificationGate —— 零 token 硬验证门。
 *
 * 用法：
 *   const gate = new HardVerificationGate();
 *   const result = gate.check(governanceEventPayload);
 *   if (!result.passed) { /* 拒绝处理 *\/ }
 */
export class HardVerificationGate {
  private _gitDiffCache: string[] | null = null;
  private _gitDiffTime = 0;
  private _eslintCache: Array<{ file: string; rule: string }> | null = null;
  private _eslintTime = 0;
  private static readonly CACHE_TTL = VERIFICATION_CACHE_TTL_MS;

  /** 治理事件类型常量 */
  static readonly GOVERNANCE_EVENT_TYPES = [
    PipelineEventType.ConstitutionViolation,
    PipelineEventType.GovernanceAmendmentProposed,
    PipelineEventType.GovernanceAuditReport,
    PipelineEventType.GovernanceComplianceViolation,
    PipelineEventType.GovernanceRoundtableConsensus,
  ];

  /**
   * 硬验证——5 条零 token 规则逐条校验。
   * 全部通过 → passed=true；任意否决 → passed=false + 否决原因。
   */
  check(event: GovernanceEventPayload): HardGateResult {
    const verdicts: RuleVerdict[] = [
      this._ruleGitDiff(event),
      this._ruleEslint(event),
      this._ruleFsmTransition(event),
      this._ruleBarrelExport(event),
      this._ruleCrossPackage(event),
    ];
    return {
      // H18 fix: 排除 skipped 规则——缺失数据的不影响总判决
      passed: verdicts.filter(v => !v.skipped).every(v => v.passed),
      verdicts,
    };
  }

  // ── 规则 1: Git Diff ──
  private _ruleGitDiff(payload: GovernanceEventPayload): RuleVerdict {
    const p = payload as GateRulePayload;
    const filePath = (typeof p.filePath === "string" ? p.filePath : (typeof p.nodeId === "string" ? p.nodeId : undefined)) as string | undefined;
    if (!filePath) return { ruleName: "git-diff", passed: true, skipped: true, reason: "缺少 filePath/nodeId 字段" };

    const changed = this._getChangedFiles();
    const found = changed.some(f => f.includes(filePath));
    return {
      ruleName: "git-diff",
      passed: found,
      reason: found ? undefined : `文件 "${filePath}" 不在本次 diff 中`,
    };
  }

  // ── 规则 2: ESLint 违禁确认 ──
  private _ruleEslint(payload: GovernanceEventPayload): RuleVerdict {
    const p = payload as GateRulePayload;
    const violation = typeof p.violation === "string" ? p.violation : undefined;
    if (!violation) return { ruleName: "eslint", passed: true, skipped: true, reason: "缺少 violation 字段" };

    const errors = this._getEslintErrors();
    const matched = errors.some(e => e.rule === violation);
    return {
      ruleName: "eslint",
      passed: matched,
      reason: matched ? undefined : `违禁模式 "${violation}" 未被 ESLint 报出`,
    };
  }

  // ── 规则 3: FSM 状态转换 ──
  private _ruleFsmTransition(payload: GovernanceEventPayload): RuleVerdict {
    const p = payload as GateRulePayload;
    const from = typeof p.fromState === "string" ? p.fromState : undefined;
    const to = typeof p.toState === "string" ? p.toState : undefined;
    if (!from || !to) return { ruleName: "fsm-transition", passed: true, skipped: true, reason: "缺少 fromState/toState 字段" };

    const valid = MEMORY_VALID_TRANSITIONS[from]?.has(to);
    return {
      ruleName: "fsm-transition",
      passed: !!valid,
      reason: valid ? undefined : `${from} → ${to} 不在 MEMORY_VALID_TRANSITIONS 中`,
    };
  }

  // ── 规则 4: Barrel 导出 ──
  private _ruleBarrelExport(payload: GovernanceEventPayload): RuleVerdict {
    const p = payload as GateRulePayload;
    const modulePath = typeof p.modulePath === "string" ? p.modulePath : undefined;
    if (!modulePath) return { ruleName: "barrel-export", passed: true, skipped: true, reason: "缺少 modulePath 字段" };

    try {
      const barrelPath = modulePath.replace(/\/[^/]+\.ts$/, "/index.ts");
      // 文件大小限制 10MB（代码文件上限）
      const _MAX_SIZE = BARREL_MAX_SIZE;
      const _stats = fs.statSync(barrelPath);
      if (_stats.size > _MAX_SIZE) {
        return { ruleName: "barrel-export", passed: false, reason: `Barrel 文件过大: ${barrelPath} (${_stats.size} bytes)` };
      }
      const content = fs.readFileSync(barrelPath, "utf-8");
      const exportName = modulePath.split("/").pop()?.replace(/\.ts$/, "");
      const exported = content.includes(exportName ?? "");
      return {
        ruleName: "barrel-export",
        passed: exported,
        reason: exported ? undefined : `${exportName} 未在 barrel 中导出`,
      };
    } catch (e) {
      return { ruleName: "barrel-export", passed: false, reason: `I/O 故障: ${String(e).slice(0, 100)}` };
    }
  }

  // ── 规则 5: 跨包接口契约 ──
  private _ruleCrossPackage(payload: GovernanceEventPayload): RuleVerdict {
    const p = payload as GateRulePayload;
    const srcPkg = typeof p.sourcePkg === "string" ? p.sourcePkg : undefined;
    const tgtPkg = typeof p.targetPkg === "string" ? p.targetPkg : undefined;
    const iface = typeof p.interfaceName === "string" ? p.interfaceName : undefined;
    if (!srcPkg || !tgtPkg || !iface) return { ruleName: "cross-package", passed: true, skipped: true, reason: "缺少 sourcePkg/targetPkg/interfaceName 字段" };

    // 防注入：校验接口名仅含合法标识符字符
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(iface) || !/^[a-z][a-z0-9-]*$/.test(srcPkg) || !/^[a-z][a-z0-9-]*$/.test(tgtPkg)) {
      return { ruleName: "cross-package", passed: false, reason: `非法接口名或包名: iface=${iface} src=${srcPkg} tgt=${tgtPkg}` };
    }

    try {
      const cwd = process.cwd();
      const srcDir = path.join(cwd, `packages/${srcPkg}/src`);
      const tgtDir = path.join(cwd, `packages/${tgtPkg}/src`);

      // 原生 fs 递归搜索，替换 shell grep 调用（防注入 + 跨平台）
      const ifacePattern = new RegExp(`\\b(interface|type)\\s+${iface}\\b`);
      const matchingFiles: string[] = [];

      function walkAndMatch(dir: string): void {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkAndMatch(full);
          } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            try {
              // 文件大小限制 10MB（代码文件上限）
              const _MAX_TS_SIZE = TSFILE_MAX_SIZE;
              const _st = fs.statSync(full);
              if (_st.size > _MAX_TS_SIZE) continue;
              const content = fs.readFileSync(full, 'utf-8');
              if (ifacePattern.test(content)) matchingFiles.push(full);
            } catch { /* skip unreadable */ }
          }
        }
      }

      walkAndMatch(srcDir);
      walkAndMatch(tgtDir);

      const defined = matchingFiles.some(f => f.includes(srcPkg));
      const consumed = matchingFiles.some(f => f.includes(tgtPkg));
      return {
        ruleName: "cross-package",
        passed: defined && consumed,
        reason: defined && consumed ? undefined : `接口 ${iface} 在包间不一致`,
      };
    } catch (e) {
      return { ruleName: "cross-package", passed: false, reason: `I/O 故障: ${String(e).slice(0, 100)}` };
    }
  }

  // ── 工具方法 ──

  private _getChangedFiles(): string[] {
    const now = Date.now();
    if (this._gitDiffCache && now - this._gitDiffTime < HardVerificationGate.CACHE_TTL) return this._gitDiffCache;
    try {
      const out = execFileSync("git", ["diff", "--name-only", "HEAD~1"], { encoding: "utf-8", timeout: 5000, cwd: process.cwd() });
      this._gitDiffCache = out.split("\n").filter(Boolean);
      this._gitDiffTime = now;
      return this._gitDiffCache;
    } catch (err) { DegradationBoundary.handle(err, 'hard-verification-gate', 'trace'); return []; }
  }

  private _getEslintErrors(): Array<{ file: string; rule: string }> {
    const now = Date.now();
    if (this._eslintCache && now - this._eslintTime < HardVerificationGate.CACHE_TTL) return this._eslintCache;
    try {
      const out = execFileSync("pnpm", ["exec", "eslint", "--quiet", "--format", "compact", "packages/"], {
        encoding: "utf-8", timeout: 30_000, cwd: process.cwd(),
      });
      const errors: Array<{ file: string; rule: string }> = [];
      for (const line of out.split("\n")) {
        const m = line.match(/^(.+)\(\d+,\d+\):\s+error\s+.+?\s+(\S+)$/);
        if (m) errors.push({ file: m[1] ?? "", rule: m[2] ?? "" });
      }
      this._eslintCache = errors;
      this._eslintTime = now;
      return errors;
    } catch (err) { DegradationBoundary.handle(err, 'hard-verification-gate', 'trace'); return []; }
  }
}

/** 拒绝信号全局注册表——供 DocGovernAgent 在下一轮审计时查询 */
const rejectionRegistry: Array<{ timestamp: number; summary: string; details: string }> = [];
const MAX_REJECTIONS = 50;

/**
 * 拒绝事件发射器——将硬验证门拒绝信号回写给 DocGovernAgent。
 * 拒绝事件以 FYI 优先级、source="rule-denied" 发射，
 * 同时写入拒绝注册表供 DocGovernAgent 下一轮查询。
 */
export function emitGateRejection(
  observer: IPipelineObserver,
  originalEvent: GovernanceEventPayload,
  result: HardGateResult,
): void {
  const denialReasons = result.verdicts.filter(v => !v.passed).map(v => v.reason).filter(Boolean).join("; ");
  const rejectionEvent = {
    type: PipelineEventType.GovernanceComplianceViolation,
    priority: PipelinePriority.NORMAL,
    payload: {
      ...originalEvent,
      severity: "FYI",
      source: "rule-denied" as const,
      summary: `硬验证门拒绝: ${denialReasons}`,
      detail: JSON.stringify(result.verdicts),
      suggestedAction: "fix",
      violationLevel: "P3",
    },
    timestamp: Date.now(),
    notificationType: "FYI",
  } as const;
  observer.emit(rejectionEvent);

  // 写入拒绝注册表——DocGovernAgent 下一轮审计时通过 getRejections() 查询
  rejectionRegistry.push({
    timestamp: Date.now(),
    summary: denialReasons,
    details: JSON.stringify(result.verdicts),
  });
  if (rejectionRegistry.length > MAX_REJECTIONS) rejectionRegistry.shift();
}

/** 获取近期拒绝记录——供 DocGovernAgent 审计上下文注入 */
export function getRejections(): ReadonlyArray<{ timestamp: number; summary: string; details: string }> {
  return rejectionRegistry;
}
