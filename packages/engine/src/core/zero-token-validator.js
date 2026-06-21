// ============================================================
// @cortex/engine/core/zero-token-validator —— 零 token 规则引擎
//
// @layer 治理层
// @role 过滤器——不依赖 LLM，纯确定性校验
//
// 设计原则：
//   治理事件的本质是暴露不可靠——但暴露不可靠的组件本身也不可靠。
//   DocGovernAgent 的 LLM 审计输出在进入哨兵管道之前，
//   先经一组零 token 规则校验。规则命中 → source="rule"，
//   未命中 → source="llm-inference"（仅记录，不阻止）。
//
//   这样假阳性在进入 NotificationPipe 之前就被标记了。
// ============================================================
import { execSync } from "node:child_process";
import { MEMORY_VALID_TRANSITIONS } from "@cortex/shared";
// ─── 内置规则 ─────────────────────────────────────
/**
 * 规则 1：Git Diff 检查——断言 event.payload 中引用的文件路径
 * 确实在当前 diff 中出现了改动。
 */
export class GitDiffRule {
    name = "git-diff-check";
    _cachedDiff = null;
    _cacheTime = 0;
    static CACHE_TTL = 60_000;
    validate(event, _ctx) {
        const payload = event.payload;
        const filePath = payload?.filePath ?? payload?.nodeId;
        if (!filePath || typeof filePath !== "string") {
            return { ruleName: this.name, passed: true, detail: "无文件路径引用，跳过" };
        }
        const changedFiles = this._getChangedFiles();
        const inDiff = changedFiles.some(f => f.includes(filePath));
        return {
            ruleName: this.name,
            passed: inDiff,
            detail: inDiff
                ? `文件 ${filePath} 在本次 diff 中`
                : `文件 ${filePath} 不在本次 diff 中——可能是 LLM 幻觉`,
        };
    }
    _getChangedFiles() {
        const now = Date.now();
        if (this._cachedDiff && (now - this._cacheTime) < GitDiffRule.CACHE_TTL) {
            return this._cachedDiff;
        }
        try {
            const out = execSync("git diff --name-only HEAD~1", {
                encoding: "utf-8",
                timeout: 5000,
                cwd: process.cwd(),
            });
            this._cachedDiff = out.split("\n").filter(Boolean);
            this._cacheTime = now;
            return this._cachedDiff;
        }
        catch {
            return [];
        }
    }
}
/**
 * 规则 2：ESLint 宪法违禁检查——断言 event.payload 中引用的
 * 违禁模式（`!` 断言、`as any`）确实是 ESLint 报出的。
 */
export class EslintRule {
    name = "eslint-constitutional-check";
    _cachedErrors = null;
    _cacheTime = 0;
    static CACHE_TTL = 60_000;
    validate(event, _ctx) {
        const payload = event.payload;
        const violation = payload?.violation;
        if (!violation) {
            return { ruleName: this.name, passed: true, detail: "无违禁引用，跳过" };
        }
        const errors = this._getEslintErrors();
        const matched = errors.some(e => e.rule === violation);
        return {
            ruleName: this.name,
            passed: matched,
            detail: matched
                ? `违禁模式 ${violation} 已被 ESLint 确认`
                : `违禁模式 ${violation} 未被 ESLint 报出——可能是 LLM 幻觉`,
        };
    }
    _getEslintErrors() {
        const now = Date.now();
        if (this._cachedErrors && (now - this._cacheTime) < EslintRule.CACHE_TTL) {
            return this._cachedErrors;
        }
        try {
            const out = execSync("pnpm exec eslint --quiet --format compact packages/", {
                encoding: "utf-8",
                timeout: 30_000,
                cwd: process.cwd(),
            });
            const errors = [];
            for (const line of out.split("\n")) {
                const m = line.match(/^(.+)\((\d+),\d+\):\s+error\s+.+?\s+(\S+)$/);
                if (m)
                    errors.push({ file: m[1], line: parseInt(m[2]), rule: m[3] });
            }
            this._cachedErrors = errors;
            this._cacheTime = now;
            return errors;
        }
        catch {
            return [];
        }
    }
}
/**
 * 规则 3：FSM 状态流转检查——断言 event.payload 中声称的状态转换
 * 在 MEMORY_VALID_TRANSITIONS 中是合法的。
 */
export class FsmTransitionRule {
    name = "fsm-transition-check";
    validate(event, _ctx) {
        const payload = event.payload;
        const from = payload?.fromState;
        const to = payload?.toState;
        if (!from || !to) {
            return { ruleName: this.name, passed: true, detail: "无状态转换引用，跳过" };
        }
        const valid = MEMORY_VALID_TRANSITIONS[from]?.has(to);
        return {
            ruleName: this.name,
            passed: !!valid,
            detail: valid
                ? `${from} → ${to} 是合法转换`
                : `${from} → ${to} 不在 MEMORY_VALID_TRANSITIONS 中——不可达`,
        };
    }
}
/**
 * 规则 4：Barrel 导出检查——断言 event.payload 中声称的新模块
 * 确实在对应包的 barrel (index.ts) 中有导出。
 */
export class BarrelExportRule {
    name = "barrel-export-check";
    validate(event, _ctx) {
        const payload = event.payload;
        const modulePath = payload?.modulePath;
        if (!modulePath) {
            return { ruleName: this.name, passed: true, detail: "无模块引用，跳过" };
        }
        // 从模块路径推断 barrel 路径
        const barrelPath = modulePath.replace(/\/[^/]+\.ts$/, "/index.ts");
        try {
            const content = require("fs").readFileSync(barrelPath, "utf-8");
            const exportName = modulePath.split("/").pop()?.replace(/\.ts$/, "");
            const exported = content.includes(exportName);
            return {
                ruleName: this.name,
                passed: exported,
                detail: exported
                    ? `${exportName} 已在 barrel 中导出`
                    : `${exportName} 未在 ${barrelPath} 中导出`,
            };
        }
        catch {
            return { ruleName: this.name, passed: true, detail: "无法读取 barrel 文件，跳过" };
        }
    }
}
/**
 * 规则 5：跨包接口契约检查——断言 event.payload 中声称的接口变更
 * 在两包之间确实一致（通过 grep 验证）。
 */
export class CrossPackageContractRule {
    name = "cross-package-contract-check";
    validate(event, _ctx) {
        const payload = event.payload;
        const sourcePkg = payload?.sourcePkg;
        const targetPkg = payload?.targetPkg;
        const interfaceName = payload?.interfaceName;
        if (!sourcePkg || !targetPkg || !interfaceName) {
            return { ruleName: this.name, passed: true, detail: "无跨包引用，跳过" };
        }
        try {
            const srcDir = `packages/${sourcePkg}/src`;
            const tgtDir = `packages/${targetPkg}/src`;
            const fs = require("fs");
            // 在源包中查找接口定义
            const srcMatch = this._grepInterface(srcDir, interfaceName);
            // 在目标包中查找接口引用
            const tgtMatch = this._grepInterface(tgtDir, interfaceName);
            const defined = srcMatch.length > 0;
            const consumed = tgtMatch.length > 0;
            return {
                ruleName: this.name,
                passed: defined && consumed,
                detail: defined && consumed
                    ? `${interfaceName} 在 ${sourcePkg} 中定义，在 ${targetPkg} 中引用`
                    : (!defined
                        ? `${interfaceName} 未在 ${sourcePkg} 中找到定义`
                        : `${interfaceName} 在 ${targetPkg} 中无引用`),
            };
        }
        catch {
            return { ruleName: this.name, passed: true, detail: "检查跳过（IO 错误）" };
        }
    }
    _grepInterface(dir, name) {
        const { execSync } = require("node:child_process");
        try {
            const out = execSync(`grep -rl "interface ${name}\\|type ${name}" ${dir} --include="*.ts" 2>/dev/null || true`, {
                encoding: "utf-8", timeout: 5000, cwd: process.cwd(),
            });
            return out.split("\n").filter(Boolean);
        }
        catch {
            return [];
        }
    }
}
// ─── 零 token 校验器 ─────────────────────────────
/**
 * ZeroTokenValidator —— 治理事件的零 token 预检。
 *
 * 注册一组 ZeroTokenRule，对进入哨兵管道的治理事件逐条验证。
 * 所有规则断言通过 = source="rule"；任意规则断言失败 = source="llm-inference"。
 */
export class ZeroTokenValidator {
    rules = [];
    constructor() {
        this.register(new GitDiffRule());
        this.register(new EslintRule());
        this.register(new FsmTransitionRule());
        this.register(new BarrelExportRule());
        this.register(new CrossPackageContractRule());
    }
    /** 注册自定义规则 */
    register(rule) {
        this.rules.push(rule);
    }
    /**
     * 校验治理事件——逐条运行注册的规则。
     *
     * @returns source: "rule"（全部通过）或 "llm-inference"（至少一条失败）
     */
    validate(event, ctx) {
        const results = this.rules.map(rule => rule.validate(event, ctx));
        const allPassed = results.every(r => r.passed);
        return {
            source: allPassed ? "rule" : "llm-inference",
            results,
        };
    }
}
//# sourceMappingURL=zero-token-validator.js.map