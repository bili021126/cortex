// ============================================================
// @cortex/engine/core/hard-verification-gate —— 硬验证门
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
import { execSync } from "node:child_process";
import { MEMORY_VALID_TRANSITIONS, PipelineEventType, PipelinePriority } from "@cortex/shared";
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
    _gitDiffCache = null;
    _gitDiffTime = 0;
    _eslintCache = null;
    _eslintTime = 0;
    static CACHE_TTL = 60_000;
    /** 治理事件类型常量 */
    static GOVERNANCE_EVENT_TYPES = [
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
    check(event) {
        const verdicts = [
            this._ruleGitDiff(event),
            this._ruleEslint(event),
            this._ruleFsmTransition(event),
            this._ruleBarrelExport(event),
            this._ruleCrossPackage(event),
        ];
        return {
            passed: verdicts.every(v => v.passed),
            verdicts,
        };
    }
    // ── 规则 1: Git Diff ──
    _ruleGitDiff(payload) {
        const p = payload;
        const filePath = (p.filePath ?? p.nodeId);
        if (!filePath)
            return { ruleName: "git-diff", passed: true };
        const changed = this._getChangedFiles();
        const found = changed.some(f => f.includes(filePath));
        return {
            ruleName: "git-diff",
            passed: found,
            reason: found ? undefined : `文件 "${filePath}" 不在本次 diff 中`,
        };
    }
    // ── 规则 2: ESLint 违禁确认 ──
    _ruleEslint(payload) {
        const p = payload;
        const violation = p.violation;
        if (!violation)
            return { ruleName: "eslint", passed: true };
        const errors = this._getEslintErrors();
        const matched = errors.some(e => e.rule === violation);
        return {
            ruleName: "eslint",
            passed: matched,
            reason: matched ? undefined : `违禁模式 "${violation}" 未被 ESLint 报出`,
        };
    }
    // ── 规则 3: FSM 状态转换 ──
    _ruleFsmTransition(payload) {
        const p = payload;
        const from = p.fromState;
        const to = p.toState;
        if (!from || !to)
            return { ruleName: "fsm-transition", passed: true };
        const valid = MEMORY_VALID_TRANSITIONS[from]?.has(to);
        return {
            ruleName: "fsm-transition",
            passed: !!valid,
            reason: valid ? undefined : `${from} → ${to} 不在 MEMORY_VALID_TRANSITIONS 中`,
        };
    }
    // ── 规则 4: Barrel 导出 ──
    _ruleBarrelExport(payload) {
        const p = payload;
        const modulePath = p.modulePath;
        if (!modulePath)
            return { ruleName: "barrel-export", passed: true };
        try {
            const barrelPath = modulePath.replace(/\/[^/]+\.ts$/, "/index.ts");
            const fs = require("fs");
            const content = fs.readFileSync(barrelPath, "utf-8");
            const exportName = modulePath.split("/").pop()?.replace(/\.ts$/, "");
            const exported = content.includes(exportName);
            return {
                ruleName: "barrel-export",
                passed: exported,
                reason: exported ? undefined : `${exportName} 未在 barrel 中导出`,
            };
        }
        catch {
            return { ruleName: "barrel-export", passed: true };
        }
    }
    // ── 规则 5: 跨包接口契约 ──
    _ruleCrossPackage(payload) {
        const p = payload;
        const srcPkg = p.sourcePkg;
        const tgtPkg = p.targetPkg;
        const iface = p.interfaceName;
        if (!srcPkg || !tgtPkg || !iface)
            return { ruleName: "cross-package", passed: true };
        try {
            const srcDir = `packages/${srcPkg}/src`;
            const tgtDir = `packages/${tgtPkg}/src`;
            const out = execSync(`grep -rl "interface ${iface}\\\\|type ${iface}" ${srcDir} ${tgtDir} --include="*.ts" 2>/dev/null || true`, { encoding: "utf-8", timeout: 5000, cwd: process.cwd() });
            const files = out.split("\n").filter(Boolean);
            const defined = files.some(f => f.includes(srcPkg));
            const consumed = files.some(f => f.includes(tgtPkg));
            return {
                ruleName: "cross-package",
                passed: defined && consumed,
                reason: defined && consumed ? undefined : `接口 ${iface} 在包间不一致`,
            };
        }
        catch {
            return { ruleName: "cross-package", passed: true };
        }
    }
    // ── 工具方法 ──
    _getChangedFiles() {
        const now = Date.now();
        if (this._gitDiffCache && now - this._gitDiffTime < HardVerificationGate.CACHE_TTL)
            return this._gitDiffCache;
        try {
            const out = execSync("git diff --name-only HEAD~1", { encoding: "utf-8", timeout: 5000, cwd: process.cwd() });
            this._gitDiffCache = out.split("\n").filter(Boolean);
            this._gitDiffTime = now;
            return this._gitDiffCache;
        }
        catch {
            return [];
        }
    }
    _getEslintErrors() {
        const now = Date.now();
        if (this._eslintCache && now - this._eslintTime < HardVerificationGate.CACHE_TTL)
            return this._eslintCache;
        try {
            const out = execSync("pnpm exec eslint --quiet --format compact packages/", {
                encoding: "utf-8", timeout: 30_000, cwd: process.cwd(),
            });
            const errors = [];
            for (const line of out.split("\n")) {
                const m = line.match(/^(.+)\(\d+,\d+\):\s+error\s+.+?\s+(\S+)$/);
                if (m)
                    errors.push({ file: m[1], rule: m[2] });
            }
            this._eslintCache = errors;
            this._eslintTime = now;
            return errors;
        }
        catch {
            return [];
        }
    }
}
/** 拒绝信号全局注册表——供 DocGovernAgent 在下一轮审计时查询 */
const rejectionRegistry = [];
const MAX_REJECTIONS = 50;
/**
 * 拒绝事件发射器——将硬验证门拒绝信号回写给 DocGovernAgent。
 * 拒绝事件以 FYI 优先级、source="rule-denied" 发射，
 * 同时写入拒绝注册表供 DocGovernAgent 下一轮查询。
 */
export function emitGateRejection(observer, originalEvent, result) {
    const denialReasons = result.verdicts.filter(v => !v.passed).map(v => v.reason).filter(Boolean).join("; ");
    const rejectionEvent = {
        type: PipelineEventType.GovernanceComplianceViolation,
        priority: PipelinePriority.NORMAL,
        payload: {
            ...originalEvent,
            severity: "FYI",
            source: "rule-denied",
            summary: `硬验证门拒绝: ${denialReasons}`,
            detail: JSON.stringify(result.verdicts),
            suggestedAction: "fix",
            violationLevel: "P3",
        },
        timestamp: Date.now(),
        notificationType: "FYI",
    };
    observer.emit(rejectionEvent);
    // 写入拒绝注册表——DocGovernAgent 下一轮审计时通过 getRejections() 查询
    rejectionRegistry.push({
        timestamp: Date.now(),
        summary: denialReasons,
        details: JSON.stringify(result.verdicts),
    });
    if (rejectionRegistry.length > MAX_REJECTIONS)
        rejectionRegistry.shift();
}
/** 获取近期拒绝记录——供 DocGovernAgent 审计上下文注入 */
export function getRejections() {
    return rejectionRegistry;
}
//# sourceMappingURL=hard-verification-gate.js.map