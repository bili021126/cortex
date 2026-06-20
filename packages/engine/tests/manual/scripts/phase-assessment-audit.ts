/**
 * Cortex v2.6.9 阶段研判——宪法-代码一致性审计
 *
 * 用法: npx tsx packages/engine/tests/manual/scripts/phase-assessment-audit.ts
 *
 * 审查范围（全确定性，零 LLM 依赖）:
 *   1. 包数量验证（27）
 *   2. 新包存在性（fsm-compiler/plugin-runner/policy-validator/telemetry）
 *   3. Engine 纯净度（governance/platform 目录是否已从 engine 拆出）
 *   4. 拆出包独立性（governance/platform/memory-store/consistency 有独立 package.json）
 *   5. 依赖链宪法对齐（逐包验证 workspace 依赖与宪法声明一致）
 *   6. 旧 REPL 清除验证
 *   7. Config 子目录结构验证
 *   8. 编译验证（tsc --noEmit）
 *
 * 产出: 结构化审计报告 → 输出至 test-output/phase-assessment/
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════

interface Finding {
  id: string;
  severity: "PASS" | "WARN" | "FAIL";
  category: string;
  claim: string;
  actual: string;
  detail?: string;
}

interface AuditReport {
  version: "v2.6.9-phase-assessment";
  timestamp: string;
  summary: { total: number; pass: number; warn: number; fail: number };
  findings: Finding[];
  verdict: "ALIGNED" | "MISALIGNED" | "NEEDS_ATTENTION";
  phaseAssessment: {
    core1Closure: boolean;
    core2Preconditions: string[];
    blockingGaps: string[];
  };
}

// ═══════════════════════════════════════════════
// 宪法声明的依赖关系（v2.6.9 权威源）
// ═══════════════════════════════════════════════

const CONSTITUTION_DEPS: Record<string, string[]> = {
  shared: [],
  parser: [],
  pm: [],
  data: [],
  tools: [],
  config: [],
  "pattern-extractor": ["shared"],
  resilience: ["shared"],
  llm: ["shared", "resilience"],
  notification: ["shared"],
  factory: ["config", "shared", "notification"],
  memory: ["config", "shared"],
  "memory-store": ["config", "memory", "shared"],
  consistency: ["config", "memory-store", "shared"],
  scheduler: ["config", "shared"],
  platform: ["config", "scheduler", "shared"],
  governance: ["shared"],
  engine: [
    "config", "consistency", "factory", "governance", "llm",
    "memory", "memory-store", "pattern-extractor", "platform",
    "scheduler", "shared", "telemetry",
  ],
  cli: [
    "config", "doctor", "engine", "memory-store", "platform",
    "scheduler", "llm", "parser", "pm", "prompt-kit", "shared", "tools",
  ],
  testing: ["shared"],
  doctor: ["shared", "tools"],
  "prompt-kit": ["config", "shared"],
  "skill-kit": ["engine"],
  "skill-validator": ["engine", "shared"],
  "fsm-compiler": [],
  "plugin-runner": ["engine"],
  "policy-validator": ["config", "shared"],
  telemetry: [],
};

const EXPECTED_PACKAGE_COUNT = Object.keys(CONSTITUTION_DEPS).length;

// Engineer 拆出的子目录——这些不应再存在于 engine/src/ 下
const ENGINE_SPLIT_OUT = ["governance", "platform"];

// 旧 REPL 路径
const OLD_REPL_PATHS = [
  "packages/cli/src/commands/repl.ts",
  "packages/cli/src/commands/repl",
];

// Config src 目录结构——interfaces/ + constants/ 为子目录，其余为扁平文件
const CONFIG_SRC_ITEMS: { name: string; type: "dir" | "file" }[] = [
  { name: "interfaces", type: "dir" },
  { name: "constants", type: "dir" },
  { name: "defaults.ts", type: "file" },
  { name: "loader.ts", type: "file" },
  { name: "index.ts", type: "file" },
];

// ═══════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════

function resolveProjectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("无法定位项目根目录");
}

function getWorkspacePackages(root: string): Map<string, string> {
  const pkgs = new Map<string, string>();
  const packagesDir = path.join(root, "packages");
  if (!fs.existsSync(packagesDir)) return pkgs;

  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(packagesDir, entry.name, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      const name = pkgJson.name;
      if (name && name.startsWith("@cortex/")) {
        pkgs.set(name.replace("@cortex/", ""), path.join(packagesDir, entry.name));
      }
    } catch {
      // 跳过无效 package.json
    }
  }
  return pkgs;
}

function getActualDeps(pkgDir: string): string[] {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return [];
  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    const deps: string[] = [];
    const allDeps = { ...pkgJson.dependencies };
    for (const [name, version] of Object.entries(allDeps)) {
      if (name.startsWith("@cortex/") && (version === "workspace:*" || version === "workspace:^")) {
        deps.push(name.replace("@cortex/", ""));
      }
    }
    return deps.sort();
  } catch {
    return [];
  }
}

function formatDeps(deps: string[]): string {
  return deps.length === 0 ? "无" : deps.join(", ");
}

// ═══════════════════════════════════════════════
// 审查逻辑
// ═══════════════════════════════════════════════

function auditPackageCount(packages: Map<string, string>): Finding {
  const actual = packages.size;
  if (actual === EXPECTED_PACKAGE_COUNT) {
    return { id: "PKG-001", severity: "PASS", category: "包数量", claim: `宪法声明 ${EXPECTED_PACKAGE_COUNT} 包`, actual: `实际 ${actual} 包` };
  }
  return {
    id: "PKG-001", severity: "FAIL", category: "包数量",
    claim: `宪法声明 ${EXPECTED_PACKAGE_COUNT} 包`, actual: `实际 ${actual} 包`,
    detail: actual > EXPECTED_PACKAGE_COUNT
      ? `多出 ${actual - EXPECTED_PACKAGE_COUNT} 包: ${[...packages.keys()].filter(k => !CONSTITUTION_DEPS[k]).join(", ") || "未知"}`
      : `缺少 ${EXPECTED_PACKAGE_COUNT - actual} 包: ${Object.keys(CONSTITUTION_DEPS).filter(k => !packages.has(k)).join(", ")}`,
  };
}

function auditNewPackages(packages: Map<string, string>): Finding[] {
  const newPkgs = ["fsm-compiler", "plugin-runner", "policy-validator", "telemetry"];
  return newPkgs.map(name => {
    if (packages.has(name)) {
      return { id: `PKG-NEW-${name}`, severity: "PASS" as const, category: "新包存在性", claim: `@cortex/${name} 应存在`, actual: "已存在" };
    }
    return { id: `PKG-NEW-${name}`, severity: "FAIL" as const, category: "新包存在性", claim: `@cortex/${name} 应存在`, actual: "不存在" };
  });
}

function auditEnginePurity(root: string): Finding[] {
  const engineSrc = path.join(root, "packages", "engine", "src");
  const findings: Finding[] = [];

  for (const subdir of ENGINE_SPLIT_OUT) {
    const subdirPath = path.join(engineSrc, subdir);
    const exists = fs.existsSync(subdirPath) && fs.statSync(subdirPath).isDirectory();
    const files = exists ? fs.readdirSync(subdirPath).filter(f => f.endsWith(".ts")).length : 0;

    if (exists && files > 0) {
      findings.push({
        id: `ENG-${subdir.toUpperCase()}`,
        severity: "FAIL",
        category: "Engine 纯净度",
        claim: `@cortex/engine 不应包含 ${subdir}/ 子目录（已拆出为独立包）`,
        actual: `${subdir}/ 仍存在 (${files} ts 文件)`,
      });
    } else if (exists && files === 0) {
      findings.push({
        id: `ENG-${subdir.toUpperCase()}`,
        severity: "WARN",
        category: "Engine 纯净度",
        claim: `@cortex/engine 不应包含 ${subdir}/ 子目录`,
        actual: `${subdir}/ 目录存在但无 .ts 文件（可能是空壳残留）`,
      });
    } else {
      findings.push({
        id: `ENG-${subdir.toUpperCase()}`,
        severity: "PASS",
        category: "Engine 纯净度",
        claim: `@cortex/engine 不应包含 ${subdir}/ 子目录`,
        actual: `${subdir}/ 已移除`,
      });
    }
  }

  return findings;
}

function auditSplitPackages(packages: Map<string, string>): Finding[] {
  const splitPkgs = ["governance", "platform", "memory-store", "consistency", "memory"];
  return splitPkgs.map(name => {
    const pkgDir = packages.get(name);
    if (!pkgDir) {
      return {
        id: `SPLIT-${name.toUpperCase()}`,
        severity: "FAIL" as const,
        category: "拆出包独立性",
        claim: `@cortex/${name} 应作为独立包存在`,
        actual: "包不存在",
      };
    }
    const hasPkgJson = fs.existsSync(path.join(pkgDir, "package.json"));
    const hasSrc = fs.existsSync(path.join(pkgDir, "src"));
    const tsFiles = hasSrc
      ? (fs.readdirSync(path.join(pkgDir, "src"), { recursive: true }) as string[]).filter(f => f.endsWith(".ts")).length
      : 0;

    if (!hasPkgJson || tsFiles === 0) {
      return {
        id: `SPLIT-${name.toUpperCase()}`,
        severity: "WARN" as const,
        category: "拆出包独立性",
        claim: `@cortex/${name} 应为有代码的独立包`,
        actual: hasPkgJson ? `package.json 存在但仅 ${tsFiles} ts 文件` : "缺少 package.json",
      };
    }
    return {
      id: `SPLIT-${name.toUpperCase()}`,
      severity: "PASS" as const,
      category: "拆出包独立性",
      claim: `@cortex/${name} 应为有代码的独立包`,
      actual: `${tsFiles} ts 文件`,
    };
  });
}

function auditDependencyAlignment(packages: Map<string, string>): Finding[] {
  const findings: Finding[] = [];

  for (const [pkgName, expectedDeps] of Object.entries(CONSTITUTION_DEPS)) {
    const pkgDir = packages.get(pkgName);
    if (!pkgDir) {
      findings.push({
        id: `DEP-${pkgName.toUpperCase()}`,
        severity: "FAIL",
        category: "依赖对齐",
        claim: `@cortex/${pkgName} 应存在`,
        actual: "包不存在",
      });
      continue;
    }

    const actualDeps = getActualDeps(pkgDir);
    const expectedSet = new Set(expectedDeps);
    const actualSet = new Set(actualDeps);

    const missing = expectedDeps.filter(d => !actualSet.has(d));
    const extra = actualDeps.filter(d => !expectedSet.has(d));

    if (missing.length === 0 && extra.length === 0) {
      findings.push({
        id: `DEP-${pkgName.toUpperCase()}`,
        severity: "PASS",
        category: "依赖对齐",
        claim: `@cortex/${pkgName} → [${formatDeps(expectedDeps)}]`,
        actual: "完全一致",
      });
    } else {
      const detail: string[] = [];
      if (missing.length > 0) detail.push(`缺少: ${missing.join(", ")}`);
      if (extra.length > 0) detail.push(`多余: ${extra.join(", ")}`);
      findings.push({
        id: `DEP-${pkgName.toUpperCase()}`,
        severity: extra.length === 0 && missing.length > 0 ? "FAIL" : "WARN",
        category: "依赖对齐",
        claim: `@cortex/${pkgName} → [${formatDeps(expectedDeps)}]`,
        actual: `实际 → [${formatDeps(actualDeps)}]`,
        detail: detail.join("; "),
      });
    }
  }

  return findings;
}

function auditOldReplRemoval(root: string): Finding[] {
  return OLD_REPL_PATHS.map(replPath => {
    const fullPath = path.join(root, replPath);
    const exists = fs.existsSync(fullPath);
    return {
      id: `REPL-${replPath.includes("repl.ts") ? "MAIN" : "DIR"}`,
      severity: exists ? "FAIL" as const : "PASS" as const,
      category: "旧 REPL 清除",
      claim: `${replPath} 应已被删除`,
      actual: exists ? "仍存在" : "已删除",
    };
  });
}

function auditConfigStructure(root: string): Finding[] {
  const configSrc = path.join(root, "packages", "config", "src");
  return CONFIG_SRC_ITEMS.map(({ name, type }) => {
    const fullPath = path.join(configSrc, name);
    const exists = fs.existsSync(fullPath);
    const isCorrect = type === "dir" ? (exists && fs.statSync(fullPath).isDirectory()) : (exists && fs.statSync(fullPath).isFile());
    return {
      id: `CFG-${name.toUpperCase().replace(/\./g, "_")}`,
      severity: isCorrect ? "PASS" as const : "WARN" as const,
      category: "Config 目录结构",
      claim: `packages/config/src/${name} 应为 ${type === "dir" ? "子目录" : "扁平文件"}`,
      actual: isCorrect ? "正确" : (exists ? `存在但类型不对（期望${type}）` : "不存在"),
    };
  });
}

function auditCompileCheck(root: string): Finding {
  try {
    execSync("npx tsc --noEmit", { cwd: root, stdio: "pipe", timeout: 120_000 });
    return { id: "CMP-001", severity: "PASS", category: "编译验证", claim: "tsc --noEmit 应零错误通过", actual: "通过" };
  } catch (e: any) {
    const stderr = e.stderr?.toString() || "";
    const errorCount = (stderr.match(/error TS\d+/g) || []).length;
    return {
      id: "CMP-001",
      severity: "FAIL",
      category: "编译验证",
      claim: "tsc --noEmit 应零错误通过",
      actual: `${errorCount} 个 TS 错误`,
      detail: stderr.split("\n").filter((l: string) => l.includes("error TS")).slice(0, 5).join("\n"),
    };
  }
}

function auditNewTuiExists(root: string): Finding {
  const tuiDir = path.join(root, "packages", "cli", "src", "tui");
  const exists = fs.existsSync(tuiDir) && fs.statSync(tuiDir).isDirectory();
  if (!exists) {
    return { id: "TUI-001", severity: "FAIL", category: "新 TUI 架构", claim: "packages/cli/src/tui/ 应存在", actual: "不存在" };
  }
  const tsFiles = (fs.readdirSync(tuiDir, { recursive: true }) as string[]).filter(f => f.endsWith(".ts")).length;
  const hasModes = fs.existsSync(path.join(tuiDir, "modes"));
  const hasRenderer = fs.existsSync(path.join(tuiDir, "renderer"));

  if (tsFiles >= 20 && hasModes && hasRenderer) {
    return {
      id: "TUI-001",
      severity: "PASS",
      category: "新 TUI 架构",
      claim: "新 TUI 应包含 ~25 ts 文件 + modes/ + renderer/",
      actual: `${tsFiles} ts 文件, modes=${hasModes ? "✓" : "✗"}, renderer=${hasRenderer ? "✓" : "✗"}`,
    };
  }
  return {
    id: "TUI-001",
    severity: "WARN",
    category: "新 TUI 架构",
    claim: "新 TUI 应包含 ~25 ts 文件 + modes/ + renderer/",
    actual: `${tsFiles} ts 文件, modes=${hasModes ? "✓" : "✗"}, renderer=${hasRenderer ? "✓" : "✗"}`,
    detail: "文件数或子目录结构不符合预期",
  };
}

// ═══════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════

async function main() {
  console.log("=".repeat(60));
  console.log("Cortex v2.6.9 阶段研判——宪法-代码一致性审计");
  console.log("=".repeat(60));
  console.log();

  const root = resolveProjectRoot();
  console.log(`[INFO] 项目根目录: ${root}`);
  console.log();

  const packages = getWorkspacePackages(root);
  console.log(`[INFO] 发现 ${packages.size} 个 workspace 包`);
  console.log();

  // ═══ 执行全部审查 ═══
  const allFindings: Finding[] = [];

  console.log("[1/9] 包数量验证...");
  allFindings.push(auditPackageCount(packages));

  console.log("[2/9] 新包存在性...");
  allFindings.push(...auditNewPackages(packages));

  console.log("[3/9] Engine 纯净度...");
  allFindings.push(...auditEnginePurity(root));

  console.log("[4/9] 拆出包独立性...");
  allFindings.push(...auditSplitPackages(packages));

  console.log("[5/9] 依赖链对齐...");
  allFindings.push(...auditDependencyAlignment(packages));

  console.log("[6/9] 旧 REPL 清除...");
  allFindings.push(...auditOldReplRemoval(root));

  console.log("[7/9] Config 子目录结构...");
  allFindings.push(...auditConfigStructure(root));

  console.log("[8/9] 新 TUI 架构...");
  allFindings.push(auditNewTuiExists(root));

  console.log("[9/9] 编译验证...");
  allFindings.push(auditCompileCheck(root));

  // ═══ 汇总 ═══
  const pass = allFindings.filter(f => f.severity === "PASS").length;
  const warn = allFindings.filter(f => f.severity === "WARN").length;
  const fail = allFindings.filter(f => f.severity === "FAIL").length;

  const report: AuditReport = {
    version: "v2.6.9-phase-assessment",
    timestamp: new Date().toISOString(),
    summary: { total: allFindings.length, pass, warn, fail },
    findings: allFindings,
    verdict: fail === 0 ? (warn === 0 ? "ALIGNED" : "NEEDS_ATTENTION") : "MISALIGNED",
    phaseAssessment: {
      core1Closure: fail === 0,
      core2Preconditions: [
        "约束层独立包全部存在（governance/platform/memory-store/consistency）",
        "Engine 不再包含已拆出子系统",
        "TUI 旧 REPL 全量清除",
        "包数量 27",
        "tsc 零错误",
      ],
      blockingGaps: allFindings
        .filter(f => f.severity === "FAIL")
        .map(f => `[${f.id}] ${f.claim}: ${f.actual}`),
    },
  };

  // ═══ 输出 ═══
  console.log();
  console.log("=".repeat(60));
  console.log("审计结果");
  console.log("=".repeat(60));

  // 按严重度分组输出
  for (const sev of ["FAIL", "WARN", "PASS"] as const) {
    const items = allFindings.filter(f => f.severity === sev);
    if (items.length === 0) continue;
    const icon = sev === "FAIL" ? "❌" : sev === "WARN" ? "⚠️" : "✅";
    console.log(`\n${icon} ${sev} (${items.length})`);
    for (const item of items) {
      console.log(`   [${item.id}] ${item.category}`);
      console.log(`     宪法声明: ${item.claim}`);
      console.log(`     实际状态: ${item.actual}`);
      if (item.detail) console.log(`     详情: ${item.detail}`);
    }
  }

  console.log();
  console.log("-".repeat(60));
  console.log(`总计: ${report.summary.total} | ✅ ${report.summary.pass} | ⚠️ ${report.summary.warn} | ❌ ${report.summary.fail}`);
  console.log(`判据: ${report.verdict}`);
  console.log(`Core-1 闭环: ${report.phaseAssessment.core1Closure ? "✅ 成立" : "❌ 不成立（存在阻塞缺口）"}`);

  if (report.phaseAssessment.blockingGaps.length > 0) {
    console.log("\n⚠️ 阻塞缺口:");
    for (const gap of report.phaseAssessment.blockingGaps) {
      console.log(`   - ${gap}`);
    }
  }

  // ═══ 写入文件 ═══
  const outDir = path.join(root, "test-output", "phase-assessment");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `audit-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\n[INFO] 完整审计报告已写入: ${outPath}`);

  // 同时生成 Markdown 摘要
  const mdPath = path.join(outDir, "phase-assessment-summary.md");
  const mdContent = generateMarkdownSummary(report);
  fs.writeFileSync(mdPath, mdContent, "utf-8");
  console.log(`[INFO] Markdown 摘要已写入: ${mdPath}`);

  process.exit(fail > 0 ? 1 : 0);
}

function generateMarkdownSummary(report: AuditReport): string {
  const lines: string[] = [
    "# Cortex v2.6.9 阶段研判审计报告",
    "",
    `**时间**: ${report.timestamp}`,
    `**判据**: ${report.verdict}`,
    `**Core-1 闭环**: ${report.phaseAssessment.core1Closure ? "✅ 成立" : "❌ 不成立"}`,
    "",
    `| 状态 | 数量 |`,
    `|------|------|`,
    `| ✅ PASS | ${report.summary.pass} |`,
    `| ⚠️ WARN | ${report.summary.warn} |`,
    `| ❌ FAIL | ${report.summary.fail} |`,
    `| **总计** | **${report.summary.total}** |`,
    "",
  ];

  // 按严重度分组
  for (const sev of ["FAIL", "WARN", "PASS"] as const) {
    const items = report.findings.filter(f => f.severity === sev);
    if (items.length === 0) continue;
    lines.push(`## ${sev === "FAIL" ? "❌ 失败项" : sev === "WARN" ? "⚠️ 警告项" : "✅ 通过项"}`);
    lines.push("");
    for (const item of items) {
      lines.push(`### [${item.id}] ${item.category}`);
      lines.push(`- **宪法声明**: ${item.claim}`);
      lines.push(`- **实际状态**: ${item.actual}`);
      if (item.detail) lines.push(`- **详情**: ${item.detail}`);
      lines.push("");
    }
  }

  if (report.phaseAssessment.blockingGaps.length > 0) {
    lines.push("## ⚠️ Core-2 阻塞缺口");
    lines.push("");
    for (const gap of report.phaseAssessment.blockingGaps) {
      lines.push(`- ${gap}`);
    }
    lines.push("");
  }

  lines.push("## Core-2 前置条件清单");
  lines.push("");
  for (const cond of report.phaseAssessment.core2Preconditions) {
    lines.push(`- [ ] ${cond}`);
  }
  lines.push("");

  return lines.join("\n");
}

main().catch(err => {
  console.error("审计脚本执行失败:", err);
  process.exit(1);
});
