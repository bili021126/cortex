// @ci: unit
/**
 * doctor.test.ts — @cortex/doctor 单元测试
 *
 * 覆盖：
 * 1. HealthChecker 构造函数与注册
 * 2. package.json 必检字段检测（字段缺失、类型错误）
 * 3. PACKAGE_POSITIONING.md 存在性检测
 * 4. 测试文件首行 // @ci: 标注检测
 * 5. doctor() 便捷工厂函数
 * 6. 检查器注册与覆盖机制
 * 7. 边界条件（空目录、非法 JSON、无 tests 目录）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { HealthChecker, doctor } from "@cortex/doctor";
// ============================================================
// 测试夹具（Fixture）工具
// ============================================================
/**
 * 在临时目录中构建模拟 monorepo 结构。
 * 返回根路径，测试结束后应调用 destroy() 清理。
 */
function createFixtureMonorepo() {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-test-"));
    const packagesDir = path.join(baseDir, "packages");
    fs.mkdirSync(packagesDir, { recursive: true });
    return {
        root: baseDir,
        destroy: () => {
            fs.rmSync(baseDir, { recursive: true, force: true });
        },
    };
}
/**
 * 在 monorepo 中创建一个子包。
 *
 * @param root - monorepo 根路径
 * @param name - 包目录名
 * @param overrides - 自定义选项
 *   - useExactPkgJson: 设为 true 时 pkgJson 将完全替代默认值（用于测试缺失字段的场景）
 *   - hasPositioningDoc: 是否创建 PACKAGE_POSITIONING.md（默认 true）
 *   - pkgJson: package.json 内容（默认合并，useExactPkgJson=true 时完全替代）
 *   - testFiles: 测试文件列表
 */
function addPackage(root, name, overrides) {
    const pkgDir = path.join(root, "packages", name);
    fs.mkdirSync(pkgDir, { recursive: true });
    // package.json 处理
    const defaultPkgJson = {
        name: `@cortex/${name}`,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
            build: "tsc",
            typecheck: "tsc --noEmit",
            test: "vitest run",
        },
    };
    let finalPkgJson;
    if (overrides?.pkgJson) {
        if (overrides.useExactPkgJson) {
            // 完全替代模式——用于测试缺失字段的场景
            finalPkgJson = overrides.pkgJson;
        }
        else {
            // 合并模式——override 字段覆盖默认值
            finalPkgJson = { ...defaultPkgJson, ...overrides.pkgJson };
        }
    }
    else {
        finalPkgJson = defaultPkgJson;
    }
    fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(finalPkgJson, null, 2), "utf-8");
    // PACKAGE_POSITIONING.md：默认创建，显式 false 时跳过
    if (overrides?.hasPositioningDoc !== false) {
        fs.writeFileSync(path.join(pkgDir, "PACKAGE_POSITIONING.md"), `# @cortex/${name} — 定位文档\n\n补足说明...\n`, "utf-8");
    }
    // 测试文件
    if (overrides?.testFiles) {
        const testsDir = path.join(pkgDir, "tests");
        fs.mkdirSync(testsDir, { recursive: true });
        for (const file of overrides.testFiles) {
            fs.writeFileSync(path.join(testsDir, file.name), file.content, "utf-8");
        }
    }
}
// ============================================================
// 测试套件
// ============================================================
describe("HealthChecker", () => {
    let fixture;
    beforeEach(() => {
        fixture = createFixtureMonorepo();
    });
    afterEach(() => {
        fixture.destroy();
    });
    // ── 基础功能 ─────────────────────────────────────
    it("默认注册三个内置检查器", () => {
        const checker = new HealthChecker();
        const checkers = checker.getCheckers();
        expect(checkers).toHaveLength(3);
        const names = checkers.map((c) => c.name).sort();
        expect(names).toEqual(["package-json", "positioning-doc", "test-header"]);
    });
    it("诊断健康项目返回 healthy 状态", async () => {
        // 创建完全合规的包
        addPackage(fixture.root, "pkg-a", {
            hasPositioningDoc: true,
            testFiles: [
                { name: "pkg-a.test.ts", content: "// @ci: unit\nimport { test } from 'vitest';\n" },
            ],
        });
        addPackage(fixture.root, "pkg-b", {
            hasPositioningDoc: true,
            testFiles: [
                { name: "pkg-b.test.ts", content: "// @ci: unit\nimport { test } from 'vitest';\n" },
            ],
        });
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        expect(report.status).toBe("healthy");
        expect(report.checks).toHaveLength(3);
        expect(report.meta.packageCount).toBe(2);
        expect(report.meta.runId).toMatch(/^doctor-/);
        expect(report.meta.durationMs).toBeGreaterThanOrEqual(0);
    });
    // ── package.json 检查 ────────────────────────────
    it("检测缺少 name 字段的包", async () => {
        addPackage(fixture.root, "no-name", {
            useExactPkgJson: true,
            pkgJson: {
                // 故意缺失 name
                version: "0.1.0",
                private: true,
                type: "module",
                scripts: {
                    build: "tsc",
                    typecheck: "tsc --noEmit",
                    test: "vitest run",
                },
            },
        });
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        const pkgCheck = report.checks.find((c) => c.checker === "package-json");
        expect(pkgCheck).toBeDefined();
        expect(pkgCheck.passed).toBe(false);
        expect(pkgCheck.findings.some((f) => f.id.startsWith("PKG-FIELD-"))).toBe(true);
        expect(pkgCheck.findings.some((f) => f.message.includes("缺少字段: name"))).toBe(true);
    });
    it("检测缺少 scripts 字段的包", async () => {
        addPackage(fixture.root, "no-scripts", {
            useExactPkgJson: true,
            pkgJson: {
                name: "@cortex/no-scripts",
                version: "0.1.0",
                private: true,
                type: "module",
                // 缺少 scripts 对象
            },
        });
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        const pkgCheck = report.checks.find((c) => c.checker === "package-json");
        expect(pkgCheck).toBeDefined();
        expect(pkgCheck.passed).toBe(false);
        expect(pkgCheck.findings.some((f) => f.message.includes("缺少字段: scripts"))).toBe(true);
    });
    it("检测 scripts 缺少 build 字段", async () => {
        addPackage(fixture.root, "no-build-script", {
            useExactPkgJson: true,
            pkgJson: {
                name: "@cortex/no-build-script",
                version: "0.1.0",
                private: true,
                type: "module",
                scripts: {
                    typecheck: "tsc --noEmit",
                    test: "vitest run",
                },
            },
        });
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        const pkgCheck = report.checks.find((c) => c.checker === "package-json");
        expect(pkgCheck).toBeDefined();
        expect(pkgCheck.passed).toBe(false);
        expect(pkgCheck.findings.some((f) => f.message.includes("缺少字段: scripts.build"))).toBe(true);
    });
    it("检测 type 字段不为 module", async () => {
        addPackage(fixture.root, "wrong-type", {
            useExactPkgJson: true,
            pkgJson: {
                name: "@cortex/wrong-type",
                version: "0.1.0",
                private: true,
                type: "commonjs", // 应为 "module"
                scripts: {
                    build: "tsc",
                    typecheck: "tsc --noEmit",
                    test: "vitest run",
                },
            },
        });
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        const pkgCheck = report.checks.find((c) => c.checker === "package-json");
        expect(pkgCheck).toBeDefined();
        expect(pkgCheck.passed).toBe(false);
        const typeFindings = pkgCheck.findings.filter((f) => f.message.includes("type") && f.message.includes('"module"'));
        expect(typeFindings.length).toBeGreaterThan(0);
    });
    it("合规包 package-json 检查通过", async () => {
        addPackage(fixture.root, "valid-pkg", {});
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        const pkgCheck = report.checks.find((c) => c.checker === "package-json");
        expect(pkgCheck).toBeDefined();
        expect(pkgCheck.passed).toBe(true);
        expect(pkgCheck.findings).toHaveLength(0);
    });
    // ── PACKAGE_POSITIONING.md 检查 ──────────────────
    it("检测缺少 PACKAGE_POSITIONING.md 的包", async () => {
        addPackage(fixture.root, "no-pos-doc", {
            hasPositioningDoc: false,
        });
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        const posCheck = report.checks.find((c) => c.checker === "positioning-doc");
        expect(posCheck).toBeDefined();
        // 定位文档缺失为 warning 级别，passed=true（无 error/fatal）
        expect(posCheck.passed).toBe(true);
        // 但应有 findings
        expect(posCheck.findings.length).toBeGreaterThan(0);
        expect(posCheck.findings.some((f) => f.id.startsWith("POS-DOC-"))).toBe(true);
    });
    it("所有包都有 PACKAGE_POSITIONING.md 时通过且无发现", async () => {
        addPackage(fixture.root, "pkg-a", { hasPositioningDoc: true });
        addPackage(fixture.root, "pkg-b", { hasPositioningDoc: true });
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        const posCheck = report.checks.find((c) => c.checker === "positioning-doc");
        expect(posCheck).toBeDefined();
        expect(posCheck.passed).toBe(true);
        expect(posCheck.findings).toHaveLength(0);
    });
    // ── 测试文件首行标注检查 ─────────────────────────
    it("检测测试文件首行缺少 @ci 标注", async () => {
        addPackage(fixture.root, "bad-header", {
            testFiles: [
                { name: "bad.test.ts", content: "import { test } from 'vitest';\n" },
            ],
        });
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        const headerCheck = report.checks.find((c) => c.checker === "test-header");
        expect(headerCheck).toBeDefined();
        expect(headerCheck.passed).toBe(false);
        expect(headerCheck.findings.some((f) => f.id.startsWith("TEST-HDR-"))).toBe(true);
    });
    it("检测测试文件首行含合法 @ci 标注时通过", async () => {
        addPackage(fixture.root, "good-header", {
            testFiles: [
                { name: "good.test.ts", content: "// @ci: unit\nimport { test } from 'vitest';\n" },
            ],
        });
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        const headerCheck = report.checks.find((c) => c.checker === "test-header");
        expect(headerCheck).toBeDefined();
        expect(headerCheck.passed).toBe(true);
    });
    it("接受各种合法的 @ci 标注格式", async () => {
        addPackage(fixture.root, "variants", {
            testFiles: [
                { name: "unit.test.ts", content: "// @ci: unit\n" },
                { name: "llm.test.ts", content: "// @ci: llm\n" },
                { name: "integration.test.ts", content: "// @ci: integration\n" },
                { name: "e2e.test.ts", content: "// @ci: e2e\n" },
                { name: "manual.test.ts", content: "// @ci: manual\n" },
            ],
        });
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        const headerCheck = report.checks.find((c) => c.checker === "test-header");
        expect(headerCheck).toBeDefined();
        expect(headerCheck.passed).toBe(true);
    });
    it("无 tests 目录时不报错", async () => {
        addPackage(fixture.root, "no-tests-dir");
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        const headerCheck = report.checks.find((c) => c.checker === "test-header");
        expect(headerCheck).toBeDefined();
        expect(headerCheck.passed).toBe(true);
        expect(headerCheck.findings).toHaveLength(0);
    });
    // ── doctor() 便捷工厂 ───────────────────────────
    it("doctor() 工厂函数返回健康报告", async () => {
        addPackage(fixture.root, "simple", {
            testFiles: [
                { name: "simple.test.ts", content: "// @ci: unit\n" },
            ],
        });
        const report = await doctor(fixture.root);
        expect(report).toBeDefined();
        expect(report.status).toBe("healthy");
        expect(report.checks).toHaveLength(3);
        expect(report.meta.runId).toMatch(/^doctor-/);
    });
    // ── 检查器注册与覆盖 ─────────────────────────────
    it("registerChecker 可以注册新检查器", () => {
        const checker = new HealthChecker();
        const customChecker = {
            name: "custom-check",
            description: "自定义测试检查器",
            async check(_projectRoot) {
                return {
                    checker: this.name,
                    passed: true,
                    findings: [],
                    summary: { fatal: 0, error: 0, warning: 0, info: 0, total: 0 },
                    score: 100,
                    durationMs: 0,
                };
            },
        };
        checker.registerChecker(customChecker);
        expect(checker.getCheckers()).toHaveLength(4);
    });
    it("registerChecker 同名覆盖已有检查器", () => {
        const checker = new HealthChecker();
        const overrideChecker = {
            name: "package-json", // 同名覆盖
            description: "覆盖版本",
            async check(_projectRoot) {
                return {
                    checker: this.name,
                    passed: true,
                    findings: [],
                    summary: { fatal: 0, error: 0, warning: 0, info: 0, total: 0 },
                    score: 100,
                    durationMs: 0,
                };
            },
        };
        checker.registerChecker(overrideChecker);
        const checkers = checker.getCheckers();
        expect(checkers).toHaveLength(3);
        const pkgJsonChecker = checkers.find((c) => c.name === "package-json");
        expect(pkgJsonChecker.description).toBe("覆盖版本");
    });
    // ── only / skip 过滤 ────────────────────────────
    it("only 参数只运行指定检查器", async () => {
        addPackage(fixture.root, "test-pkg");
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root, {
            only: "package-json",
        });
        expect(report.checks).toHaveLength(1);
        expect(report.checks[0].checker).toBe("package-json");
    });
    it("skip 参数跳过指定检查器", async () => {
        addPackage(fixture.root, "test-pkg");
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root, {
            skip: "package-json,positioning-doc",
        });
        expect(report.checks).toHaveLength(1);
        expect(report.checks[0].checker).toBe("test-header");
    });
    // ── runOnly 方法 ────────────────────────────────
    it("runOnly 只运行指定检查器", async () => {
        addPackage(fixture.root, "test-pkg");
        const checker = new HealthChecker();
        const report = await checker.runOnly(["test-header"], fixture.root);
        expect(report.checks).toHaveLength(1);
        expect(report.checks[0].checker).toBe("test-header");
    });
    // ── 边界条件 ─────────────────────────────────────
    it("空项目目录不崩溃", async () => {
        const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-empty-"));
        try {
            const checker = new HealthChecker();
            const report = await checker.diagnose(emptyDir);
            expect(report.status).toBe("healthy");
            expect(report.meta.packageCount).toBe(0);
            expect(report.checks).toHaveLength(3);
            // 所有检查器在无包时都应通过
            for (const check of report.checks) {
                expect(check.passed).toBe(true);
            }
        }
        finally {
            fs.rmSync(emptyDir, { recursive: true, force: true });
        }
    });
    it("不存在 packages 目录不崩溃", async () => {
        const noPkgDir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-nopkg-"));
        // 不创建 packages 目录
        try {
            const checker = new HealthChecker();
            const report = await checker.diagnose(noPkgDir);
            expect(report.status).toBe("healthy");
            expect(report.meta.packageCount).toBe(0);
        }
        finally {
            fs.rmSync(noPkgDir, { recursive: true, force: true });
        }
    });
    it("package.json 包含非法 JSON 时不崩溃", async () => {
        const badPkgDir = path.join(fixture.root, "packages", "bad-json");
        fs.mkdirSync(badPkgDir, { recursive: true });
        fs.writeFileSync(path.join(badPkgDir, "package.json"), "{ invalid json }", "utf-8");
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        const pkgCheck = report.checks.find((c) => c.checker === "package-json");
        expect(pkgCheck).toBeDefined();
        // 即使解析失败也应返回结果而非抛异常
        expect(pkgCheck.findings.length).toBeGreaterThan(0);
        expect(pkgCheck.passed).toBe(false);
    });
    // ── Finding 结构完整性 ───────────────────────────
    it("每个 Finding 包含完整字段", async () => {
        addPackage(fixture.root, "incomplete", {
            hasPositioningDoc: false,
            useExactPkgJson: true,
            pkgJson: {
                // 只给 name，其余全部缺失
                name: "@cortex/incomplete",
            },
            testFiles: [
                { name: "bad.test.ts", content: "no ci tag here\n" },
            ],
        });
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        for (const check of report.checks) {
            for (const finding of check.findings) {
                // 验证每个 finding 的必需字段
                expect(finding.id).toBeTruthy();
                expect(["fatal", "error", "warning", "info"]).toContain(finding.severity);
                expect(finding.checker).toBeTruthy();
                expect(finding.title).toBeTruthy();
                expect(finding.message).toBeTruthy();
                expect(Array.isArray(finding.files)).toBe(true);
                // suggestion 可为 null，但必须存在该字段
                expect(finding).toHaveProperty("suggestion");
            }
        }
    });
    // ── 健康报告状态逻辑 ─────────────────────────────
    it("存在 error 级别发现时报告状态为 unhealthy", async () => {
        addPackage(fixture.root, "bad-pkg", {
            useExactPkgJson: true,
            pkgJson: {
                // 缺失大量字段触发 error
                name: "@cortex/bad-pkg",
            },
        });
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        expect(report.status).toBe("unhealthy");
    });
    it("仅有 warning 级别发现时报告状态为 warning", async () => {
        addPackage(fixture.root, "no-doc-pkg", {
            hasPositioningDoc: false,
        });
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root);
        expect(report.status).toBe("warning");
    });
    it("only 为空列表时返回空检查结果", async () => {
        addPackage(fixture.root, "test-pkg");
        const checker = new HealthChecker();
        const report = await checker.diagnose(fixture.root, {
            only: "",
        });
        expect(report.checks).toHaveLength(0);
        expect(report.status).toBe("healthy");
        expect(report.meta.packageCount).toBe(0);
    });
});
//# sourceMappingURL=doctor.test.js.map