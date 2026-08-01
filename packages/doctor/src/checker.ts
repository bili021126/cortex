// ============================================================
// @cortex/doctor —— 健康检查管线实现
//
// @file-overview
// HealthChecker 是 @cortex/doctor 的核心入口，负责编排多个
// 检查器的执行管线，聚合结果并产出 HealthReport。
//
// 内置检查器：
//   - packageJsonChecker:  检查各包 package.json 必须字段
//   - positioningDocChecker: 检查各包 PACKAGE_POSITIONING.md 存在
//   - testHeaderChecker:   检查测试文件首行 `// @ci:` 标注
//   - auditTrailChecker:   读取 audit.jsonl 审计跟踪（spec S2-8）
//
// @module-convention
// 1. 所有检查器通过 registerChecker 注册，管线自动编排。
// 2. 禁止空 catch 块——异常必须记录上下文再抛出/吞没。
// 3. 禁止使用 var——统一 const/let。
// 4. 禁止裸 console.warn——使用 Finding 机制上报警告。
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

import {
  REQUIRED_PKG_FIELDS,
  type IChecker,
  type CheckerOptions,
  type CheckResult,
  type Finding,
  type HealthReport,
  type DoctorOptions,
  type PackageMeta,
} from "./types.js";
import { AuditTrailChecker } from "./audit-checker.js";

// ============================================================
// 常量定义
// ============================================================

/** 测试文件首行标注的正则 */
const CI_TAG_REGEX = /^\/\/\s*@ci:\s*(unit|llm|integration|e2e|manual)/;

/** 评分扣分常量 */
const ERROR_PENALTY_POINTS = 15;
const WARNING_PENALTY_POINTS = 10;

/** runId 生成参数 */
const RUN_ID_RADIX = 36;

// ============================================================
// 工具函数
// ============================================================

/**
 * 从项目根目录扫描所有子包。
 * 查找 packages/ 目录下所有含 package.json 的目录。
 */
function scanPackages(projectRoot: string): PackageMeta[] {
  const packagesDir = path.join(projectRoot, "packages");
  const results: PackageMeta[] = [];

  let entryNames: string[];
  try {
    entryNames = fs.readdirSync(packagesDir);
  } catch (err: unknown) {
    // packages 目录不存在或不可读，返回空结果
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`scanPackages: 读取 ${packagesDir} 失败: ${errMsg}`);
    return results;
  }

  for (const name of entryNames) {
    const pkgPath = path.join(packagesDir, name);
    let stat: fs.Stats;

    try {
      stat = fs.statSync(pkgPath);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`scanPackages: 获取 ${pkgPath} 状态失败: ${errMsg}`);
      continue;
    }

    if (!stat.isDirectory()) {
      continue;
    }

    const pkgJsonPath = path.join(pkgPath, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      continue;
    }

    let pkgName = name;
    const pkgJsonIssues: string[] = [];

    try {
      const raw = fs.readFileSync(pkgJsonPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.name === "string") {
        pkgName = parsed.name;
      }
      pkgJsonIssues.push(...checkPackageJsonFields(parsed));
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      pkgJsonIssues.push(`无法解析 package.json: ${errMsg}`);
    }

    const hasPositioningDoc = fs.existsSync(
      path.join(pkgPath, "PACKAGE_POSITIONING.md"),
    );

    const testHeaderIssues = checkTestHeaders(pkgPath);

    results.push({
      name: pkgName,
      path: `packages/${name}`,
      absolutePath: pkgPath,
      hasPositioningDoc,
      pkgJsonIssues,
      testHeaderIssues,
    });
  }

  return results;
}

/**
 * 检查 package.json 的必检字段。
 * 支持点号路径嵌套（如 "scripts.build" 表示 scripts 对象下的 build 字段）。
 */
function checkPackageJsonFields(pkgJson: Record<string, unknown>): string[] {
  const issues: string[] = [];

  for (const field of REQUIRED_PKG_FIELDS) {
    const parts = field.split(".");
    let current: unknown = pkgJson;

    let missing = false;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== "object") {
        issues.push(`缺少字段: ${field}`);
        missing = true;
        break;
      }
      const obj = current as Record<string, unknown>;
      if (!(part in obj)) {
        issues.push(`缺少字段: ${field}`);
        missing = true;
        break;
      }
      current = obj[part];
    }

    if (missing) {
      continue;
    }

    // 根字段值检查
    if (parts.length === 1 && current !== undefined) {
      if (field === "name" && typeof current !== "string") {
        issues.push(`${field} 应为 string，实际为 ${typeof current}`);
      } else if (field === "version" && typeof current !== "string") {
        issues.push(`${field} 应为 string，实际为 ${typeof current}`);
      } else if (field === "private" && typeof current !== "boolean") {
        issues.push(`${field} 应为 boolean，实际为 ${typeof current}`);
      } else if (field === "type" && current !== "module") {
        issues.push(`${field} 应为 "module"，实际为 ${JSON.stringify(current)}`);
      } else if (field === "scripts" && typeof current !== "object") {
        issues.push(`${field} 应为 object，实际为 ${typeof current}`);
      }
    }
  }

  // 检查 scripts 中各字段的值类型
  const scripts = pkgJson.scripts;
  if (scripts && typeof scripts === "object") {
    const scriptObj = scripts as Record<string, unknown>;
    for (const key of ["build", "typecheck", "test"]) {
      if (key in scriptObj && typeof scriptObj[key] !== "string") {
        issues.push(`scripts.${key} 应为 string`);
      }
    }
  }

  return issues;
}

/**
 * 检查包目录下的测试文件首行是否包含合法的 `// @ci:` 标注。
 * 扫描 tests/ 目录下所有 *.test.ts 文件。
 */
function checkTestHeaders(pkgPath: string): string[] {
  const issues: string[] = [];
  const testsDir = path.join(pkgPath, "tests");

  if (!fs.existsSync(testsDir)) {
    return []; // 无 tests 目录不报错（有些包可能还没有测试）
  }

  let testFileNames: string[];
  try {
    testFileNames = fs.readdirSync(testsDir).filter((f) => f.endsWith(".test.ts"));
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`checkTestHeaders: 读取 ${testsDir} 失败: ${errMsg}`);
    return issues;
  }

  for (const file of testFileNames) {
    const filePath = path.join(testsDir, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const firstLine = content.split("\n")[0]!.trim();

      if (!CI_TAG_REGEX.test(firstLine)) {
        issues.push(
          `${file}: 首行缺少合法的 @ci 标注（应为 // @ci: unit | llm | integration | e2e | manual），实际首行: "${firstLine}"`,
        );
      }
    } catch {
      issues.push(`${file}: 无法读取`);
    }
  }

  return issues;
}

// ============================================================
// 检查器：package.json 字段检查
// ============================================================

class PackageJsonChecker implements IChecker {
  readonly name = "package-json";
  readonly description = "检查各包 package.json 的必须字段存在性和类型正确性";

  async check(projectRoot: string, _options?: CheckerOptions): Promise<CheckResult> {
    const startTime = Date.now();
    const packages = scanPackages(projectRoot);
    const findings: Finding[] = [];

    for (const pkg of packages) {
      for (const issue of pkg.pkgJsonIssues) {
        findings.push({
          id: `PKG-FIELD-${findings.length + 1}`,
          severity: "error",
          checker: this.name,
          title: `${pkg.name}: ${issue}`,
          message: `包 ${pkg.name}（${pkg.path}）的 package.json ${issue}`,
          files: [path.join(pkg.absolutePath, "package.json")],
          suggestion: issue.startsWith("缺少字段")
            ? `在 ${pkg.path}/package.json 中添加 ${issue.replace("缺少字段: ", "")} 字段`
            : `修复 ${pkg.path}/package.json 中的 ${issue}`,
        });
      }
    }

    const summary = computeSummary(findings);
    const passed = summary.error === 0 && summary.fatal === 0;

    return {
      checker: this.name,
      passed,
      findings,
      summary,
      score: passed ? 100 : Math.max(0, 100 - summary.error * ERROR_PENALTY_POINTS),
      durationMs: Date.now() - startTime,
    };
  }
}

// ============================================================
// 检查器：PACKAGE_POSITIONING.md 存在性检查
// ============================================================

class PositioningDocChecker implements IChecker {
  readonly name = "positioning-doc";
  readonly description = "检查各包是否存在 PACKAGE_POSITIONING.md 定位文档";

  async check(projectRoot: string, _options?: CheckerOptions): Promise<CheckResult> {
    const startTime = Date.now();
    const packages = scanPackages(projectRoot);
    const findings: Finding[] = [];

    for (const pkg of packages) {
      if (!pkg.hasPositioningDoc) {
        findings.push({
          id: `POS-DOC-${findings.length + 1}`,
          severity: "warning",
          checker: this.name,
          title: `${pkg.name}: 缺少 PACKAGE_POSITIONING.md`,
          message: `包 ${pkg.name}（${pkg.path}）未提供 PACKAGE_POSITIONING.md，无法确认其定位和补足声明`,
          files: [pkg.absolutePath],
          suggestion: `在 ${pkg.path}/ 下创建 PACKAGE_POSITIONING.md，说明该包补足了什么、定位是什么、值得合入的原因`,
          reference: "宪法 §五 补足声明机制",
        });
      }
    }

    const summary = computeSummary(findings);
    const passed = summary.error === 0 && summary.fatal === 0;

    return {
      checker: this.name,
      passed,
      findings,
      summary,
      score: passed
        ? 100
        : Math.max(0, 100 - findings.length * WARNING_PENALTY_POINTS),
      durationMs: Date.now() - startTime,
    };
  }
}

// ============================================================
// 检查器：测试文件首行标注检查
// ============================================================

class TestHeaderChecker implements IChecker {
  readonly name = "test-header";
  readonly description = "检查各包测试文件首行是否包含合法的 // @ci: 标注";

  async check(projectRoot: string, _options?: CheckerOptions): Promise<CheckResult> {
    const startTime = Date.now();
    const packages = scanPackages(projectRoot);
    const findings: Finding[] = [];

    for (const pkg of packages) {
      for (const issue of pkg.testHeaderIssues) {
        findings.push({
          id: `TEST-HDR-${findings.length + 1}`,
          severity: "error",
          checker: this.name,
          title: `${pkg.name}: 测试文件首行标注不合规`,
          message: `包 ${pkg.name}（${pkg.path}）的测试文件问题：${issue}`,
          files: [path.join(pkg.absolutePath, "tests")],
          suggestion: `在测试文件首行添加 // @ci: unit | llm | integration | e2e | manual 标注`,
          reference: "宪法 §十四·一 测试门禁自声明机制",
        });
      }
    }

    const summary = computeSummary(findings);
    const passed = summary.error === 0 && summary.fatal === 0;

    return {
      checker: this.name,
      passed,
      findings,
      summary,
      score: passed
        ? 100
        : Math.max(0, 100 - findings.length * WARNING_PENALTY_POINTS),
      durationMs: Date.now() - startTime,
    };
  }
}

// ============================================================
// 工具：计算 summary 统计
// ============================================================

function computeSummary(findings: Finding[]): CheckResult["summary"] {
  let fatal = 0;
  let error = 0;
  let warning = 0;
  let info = 0;

  for (const f of findings) {
    switch (f.severity) {
      case "fatal": {
        fatal++;
        break;
      }
      case "error": {
        error++;
        break;
      }
      case "warning": {
        warning++;
        break;
      }
      case "info": {
        info++;
        break;
      }
    }
  }

  return { fatal, error, warning, info, total: findings.length };
}

// ============================================================
// 运行 ID 生成
// ============================================================

/** 生成唯一运行 ID */
function generateRunId(): string {
  const ts = Date.now().toString(RUN_ID_RADIX);
  const rand = crypto.randomUUID().slice(0, 4);
  return `doctor-${ts}-${rand}`;
}

// ============================================================
// HealthChecker —— 统一健康检查入口
// ============================================================

/**
 * HealthChecker 是 @cortex/doctor 的核心入口。
 * 它注册内置检查器（packageJson、positioningDoc、testHeader），
 * 并提供 diagnose() 方法执行完整检查管线。
 *
 * 用法：
 * ```typescript
 * const checker = new HealthChecker();
 * const report = await checker.diagnose("/path/to/monorepo");
 * console.log(report.status); // "healthy" | "warning" | "unhealthy" | "error"
 * ```
 */
export class HealthChecker {
  private checkers: IChecker[];

  constructor() {
    this.checkers = [
      new PackageJsonChecker(),
      new PositioningDocChecker(),
      new TestHeaderChecker(),
      new AuditTrailChecker(),
    ];
  }

  /**
   * 注册自定义检查器。
   * 同名检查器（name 相同）会覆盖已注册的检查器。
   */
  registerChecker(checker: IChecker): void {
    const existing = this.checkers.findIndex((c) => c.name === checker.name);
    if (existing >= 0) {
      this.checkers[existing] = checker;
    } else {
      this.checkers.push(checker);
    }
  }

  /** 获取已注册的所有检查器 */
  getCheckers(): IChecker[] {
    return [...this.checkers];
  }

  /**
   * 执行完整健康检查。
   *
   * @param projectRoot - 项目根目录（默认 process.cwd()）
   * @param options - 诊断选项
   * @returns HealthReport 健康报告
   */
  async diagnose(
    projectRoot?: string,
    options?: Partial<DoctorOptions>,
  ): Promise<HealthReport> {
    const root = projectRoot ?? process.cwd();
    const verbose = options?.verbose ?? false;
    const only = options?.only;
    const skip = options?.skip;

    // 解析 only/skip 过滤器
    // 注意：需区分 "未提供参数"（undefined → null，不过滤）
    // 和 "提供了空字符串"（"" → []，过滤出空集）
    const onlyNames = only !== undefined
      ? only.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
    const skipNames = skip !== undefined
      ? skip.split(",").map((s) => s.trim()).filter(Boolean)
      : null;

    // 过滤检查器
    let activeCheckers = this.checkers;
    if (onlyNames) {
      const o = onlyNames;
      activeCheckers = activeCheckers.filter((c) => o.includes(c.name));
    }
    if (skipNames) {
      const s = skipNames;
      activeCheckers = activeCheckers.filter((c) => !s.includes(c.name));
    }

    if (activeCheckers.length === 0) {
      return {
        meta: {
          scannedAt: new Date().toISOString(),
          projectRoot: root,
          runId: generateRunId(),
          durationMs: 0,
          packageCount: 0,
        },
        checks: [],
        status: "healthy",
      };
    }

    // 扫描包（供元信息使用，各检查器内部也会扫描）
    const packages = scanPackages(root);

    // 并行执行所有检查器
    const startTime = Date.now();
    // spec S2-8：透传扩展选项（如 auditSpanId）给检查器——
    // 仅复制 DoctorOptions 之外的键，避免 only/skip 等过滤语义泄漏
    const extraCheckerOpts: CheckerOptions = { verbose, projectRoot: root };
    if (options) {
      for (const [k, v] of Object.entries(options)) {
        if (!(k in extraCheckerOpts) && k !== "only" && k !== "skip" && k !== "format" && k !== "threshold" && k !== "output") {
          extraCheckerOpts[k] = v;
        }
      }
    }
    const results = await Promise.all(
      activeCheckers.map((checker) =>
        checker.check(root, extraCheckerOpts).catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          const failedResult: CheckResult = {
            checker: checker.name,
            passed: false,
            findings: [
              {
                id: `CHECKER-ERR-${checker.name}`,
                severity: "fatal",
                checker: checker.name,
                title: `${checker.name} 检查器执行异常`,
                message: `检查器 ${checker.name} 执行时发生未预期错误: ${errMsg}`,
                files: [],
                suggestion: `请检查项目结构是否正确，或查看完整错误日志`,
              },
            ],
            summary: { fatal: 1, error: 0, warning: 0, info: 0, total: 1 },
            score: 0,
            durationMs: 0,
          };
          return failedResult;
        }),
      ),
    );
    const totalDuration = Date.now() - startTime;

    // 计算总体状态
    const allFindings = results.flatMap((r) => r.findings);
    const hasFatal = allFindings.some((f) => f.severity === "fatal");
    const hasError = allFindings.some((f) => f.severity === "error");
    const hasWarning = allFindings.some((f) => f.severity === "warning");

    // 区分"检查器自身异常"与"项目健康问题"
    const hasCheckerCrash = allFindings.some(
      (f) => f.severity === "fatal" && f.id.startsWith("CHECKER-ERR-"),
    );

    let status: HealthReport["status"];
    if (hasCheckerCrash) {
      status = "error";  // 检查器执行异常（与健康问题区分）
    } else if (hasFatal || hasError) {
      status = "unhealthy";
    } else if (hasWarning) {
      status = "warning";
    } else {
      status = "healthy";
    }

    return {
      meta: {
        scannedAt: new Date().toISOString(),
        projectRoot: root,
        runId: generateRunId(),
        durationMs: totalDuration,
        packageCount: packages.length,
      },
      checks: results,
      status,
    };
  }

  /**
   * 运行指定名称的检查器，跳过其他检查器。
   * 等价于 diagnose 设置 only 参数。
   */
  async runOnly(checkerNames: string[], projectRoot?: string): Promise<HealthReport> {
    return await this.diagnose(projectRoot, { only: checkerNames.join(",") });
  }
}

// ============================================================
// 便捷工厂函数
// ============================================================

/**
 * 创建默认 HealthChecker 实例并执行诊断。
 * 适合 CLI 或 CI 脚本直接调用。
 *
 * @example
 * ```typescript
 * import { doctor } from '@cortex/doctor';
 * const report = await doctor();
 * console.log(report.status);
 * ```
 */
export async function doctor(projectRoot?: string): Promise<HealthReport> {
  const checker = new HealthChecker();
  return await checker.diagnose(projectRoot);
}
