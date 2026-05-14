#!/usr/bin/env npx tsx
/**
 * CI 门禁脚本 —— 两件事：同步 + 统一
 *
 *   同步 —— 测试文件通过 @ci 标签自声明身份，脚本自动扫描，零手动配置
 *   统一 —— 本地 `npx tsx scripts/ci-gate.ts` 与 GitHub Actions 完全一致
 *
 * 用法:
 *   npx tsx scripts/ci-gate.ts           正常门禁（只跑 @ci: unit）
 *   npx tsx scripts/ci-gate.ts --all     全量（包括 @ci: llm / integration）
 *   npx tsx scripts/ci-gate.ts --dry-run 仅扫描，不执行
 *
 * @ci 标签规范（写在测试文件第一行注释中）:
 *   // @ci: unit         CI 必跑（默认值，不写标签等同 unit）
 *   // @ci: llm          需要 LLM API，CI 跳过
 *   // @ci: integration  需要外部服务，CI 跳过
 *   // @ci: e2e          端到端测试，CI 跳过
 *   // @ci: manual       人工触发，永远不自动跑
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

// ─── 类型 ────────────────────────────────────────────────

type CiTag = "unit" | "llm" | "integration" | "e2e" | "manual";

interface TestFile {
  /** 绝对路径 */
  path: string;
  /** 解析后的 CI 标签 */
  ciTag: CiTag;
}

interface PackageInfo {
  name: string;
  dir: string;
  /** pnpm filter 名 */
  filter: string;
}

interface GateResult {
  build: boolean;
  typecheck: boolean;
  lint: boolean;
  test: boolean;
  testDetails: { total: number; passed: number; skipped: number };
}

// ─── 配置 ────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");

/** 需要构建和类型检查的包（按依赖顺序） */
const PACKAGES: PackageInfo[] = [
  { name: "shared",  dir: join(ROOT, "packages", "shared"),  filter: "@cortex/shared" },
  { name: "parser",  dir: join(ROOT, "packages", "parser"),  filter: "@cortex/parser" },
  { name: "pm",      dir: join(ROOT, "packages", "pm"),      filter: "@cortex/pm" },
  { name: "data",    dir: join(ROOT, "packages", "data"),    filter: "@cortex/data" },
  { name: "tools",   dir: join(ROOT, "packages", "tools"),   filter: "@cortex/tools" },
  { name: "llm",     dir: join(ROOT, "packages", "llm"),     filter: "@cortex/llm" },
  { name: "testing", dir: join(ROOT, "packages", "testing"), filter: "@cortex/testing" },
  { name: "cli",     dir: join(ROOT, "packages", "cli"),     filter: "@cortex/cli" },
  { name: "engine",  dir: join(ROOT, "packages", "engine"),  filter: "@cortex/engine" },
];

const TEST_FILE_PATTERN = /\.test\.ts$/;

const CI_TAG_RE = /@ci\s*:\s*(unit|llm|integration|e2e|manual)/;

/** 剥离 ANSI 转义码（vitest 管道输出仍可能带色） */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ─── 工具 ────────────────────────────────────────────────

function run(cmd: string, args: string[], cwd: string): { ok: boolean; stdout: string } {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000, // 5 分钟超时
      windowsHide: true,
      shell: process.platform === "win32", // Windows 需要 shell 解析 PATH 找到 pnpm
    });
    return { ok: true, stdout };
  } catch (e: any) {
    const stderr = e.stderr ?? "";
    const stdout = e.stdout ?? "";
    return { ok: false, stdout: stdout + "\n" + stderr };
  }
}

// ─── 扫描 ────────────────────────────────────────────────

/** 递归扫描目录下所有 .test.ts 文件 */
function walkTests(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry.startsWith(".") || entry === "node_modules") continue;
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        results.push(...walkTests(full));
      } else if (TEST_FILE_PATTERN.test(entry)) {
        results.push(full);
      }
    } catch { /* 权限等问题，跳过 */ }
  }
  return results;
}

/** 从测试文件提取 @ci 标签，无标签默认 unit */
function extractCiTag(filePath: string): CiTag {
  try {
    // 读前 10 行足够找到标签
    const head = readFileSync(filePath, "utf-8").split("\n").slice(0, 10).join("\n");
    const m = head.match(CI_TAG_RE);
    return (m?.[1] as CiTag) ?? "unit";
  } catch {
    return "unit";
  }
}

/** 扫描全项目测试文件并分类 */
function scanAllTests(): { unit: TestFile[]; skipped: TestFile[] } {
  const unit: TestFile[] = [];
  const skipped: TestFile[] = [];

  for (const pkg of PACKAGES) {
    const testDir = join(pkg.dir, "tests");
    const files = walkTests(testDir);
    for (const f of files) {
      const tag = extractCiTag(f);
      const tf: TestFile = { path: f, ciTag: tag };
      if (tag === "unit") {
        unit.push(tf);
      } else {
        skipped.push(tf);
      }
    }
  }

  return { unit, skipped };
}

// ─── 构建 & 类型检查 ────────────────────────────────────

function buildAll(): boolean {
  console.log("\n🔨 构建（按依赖顺序）…");
  let ok = true;
  for (const pkg of PACKAGES) {
    const r = run("pnpm", ["--filter", pkg.filter, "build"], ROOT);
    if (r.ok) {
      console.log(`   ✅ ${pkg.name} build`);
    } else {
      console.error(`   ❌ ${pkg.name} build 失败\n${r.stdout.slice(-500)}`);
      ok = false;
      // 后续包可能依赖此包，停止构建
      break;
    }
  }
  return ok;
}

function typecheckAll(): boolean {
  console.log("\n🔍 TypeScript 类型检查…");
  let ok = true;
  for (const pkg of PACKAGES) {
    const r = run("pnpm", ["--filter", pkg.filter, "typecheck"], ROOT);
    if (r.ok) {
      console.log(`   ✅ ${pkg.name} typecheck`);
    } else {
      // typecheck 输出较长，截取尾部
      const tail = r.stdout.split("\n").slice(-20).join("\n");
      console.error(`   ❌ ${pkg.name} typecheck 失败\n${tail}`);
      ok = false;
    }
  }
  return ok;
}

// ─── 测试 ────────────────────────────────────────────────

/** 按包逐执行 vitest，自动注入 @ci 标签对应的 exclude 列表 */
function runTests(runAll: boolean): { ok: boolean; details: GateResult["testDetails"] } {
  const { unit, skipped } = scanAllTests();

  console.log(`\n🧪 测试（按包逐执行）:`);
  if (!runAll) {
    console.log(`   @ci: unit  → ${unit.length} 个文件`);
    console.log(`   @ci: llm / integration / e2e / manual → ${skipped.length} 个文件（跳过）`);
  } else {
    console.log(`   --all 模式 → ${unit.length + skipped.length} 个文件（全部）`);
  }

  // 构建 per-package exclude 列表（相对路径，vitest 需要相对于 cwd）
  const perPkgExclude = new Map<string, string[]>();
  for (const pkg of PACKAGES) perPkgExclude.set(pkg.filter, []);

  if (!runAll) {
    for (const s of skipped) {
      for (const pkg of PACKAGES) {
        if (s.path.startsWith(pkg.dir + (pkg.dir.endsWith("\\") || pkg.dir.endsWith("/") ? "" : "\\"))) {
          // vitest exclude 需要 posix 风格相对路径
          const rel = relative(pkg.dir, s.path).replace(/\\/g, "/");
          perPkgExclude.get(pkg.filter)!.push(rel);
          break;
        }
      }
    }
  }

  let allOk = true;
  let grandPassed = 0;
  let grandTotal = 0;

  for (const pkg of PACKAGES) {
    const pkgUnit = unit.filter((u) => u.path.startsWith(pkg.dir));
    const pkgExcludes = perPkgExclude.get(pkg.filter)!;

    if (!runAll && pkgUnit.length === 0) {
      console.log(`   ⬜ ${pkg.name} — 无 @ci: unit 测试，跳过`);
      continue;
    }

    // 在包目录下跑 vitest，使用 CI 专用配置（vitest.ci.config.ts）
    const args = ["--filter", pkg.filter, "exec", "vitest", "run", "--config", "vitest.ci.config.ts", "--reporter=verbose"];
    if (pkgExcludes.length > 0) {
      // vitest --exclude 每次只接受单个 glob，需逐文件追加
      for (const exc of pkgExcludes) {
        args.push("--exclude", exc);
      }
    }

    console.log(`\n   📦 ${pkg.name} (${runAll ? "全量" : "unit"}模式):`);
    const r = run("pnpm", args, ROOT);

    // 匹配两种 vitest 输出格式（先剥离 ANSI 色码）：
    //   全通过: "Tests  29 passed (29)"
    //   有失败: "Tests  2 failed | 27 passed (29)"
    const clean = stripAnsi(r.stdout);
    const testsMatch = clean.match(/Tests\s+(?:(\d+)\s+failed\s+\|\s+)?(\d+)\s+passed\s*\((\d+)\)/);
    const passed = testsMatch ? parseInt(testsMatch[2], 10) : 0;
    const total = testsMatch ? parseInt(testsMatch[3], 10) : 0;

    if (r.ok) {
      console.log(`      ✅ ${pkg.name} 测试通过 (${passed}/${total})`);
    } else {
      console.error(`      ❌ ${pkg.name} 测试失败 (${passed}/${total})`);
      const tail = clean.split("\n").slice(-20).join("\n");
      console.error(tail);
      allOk = false;
    }

    grandPassed += passed;
    grandTotal += total;
  }

  return { ok: allOk, details: { total: grandTotal, passed: grandPassed, skipped: skipped.length } };
}

// ─── Lint ────────────────────────────────────────────────

function runLint(): boolean {
  console.log("\n📏 ESLint 代码规范…");
  const r = run("pnpm", ["-r", "lint"], ROOT);
  if (r.ok) {
    console.log("   ✅ lint 通过");
  } else {
    const tail = r.stdout.split("\n").slice(-15).join("\n");
    console.error(`   ❌ lint 未通过\n${tail}`);
  }
  return r.ok;
}

// ─── 入口 ────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const runAll = args.includes("--all");
  const dryRun = args.includes("--dry-run");

  console.log("╔══════════════════════════════╗");
  console.log("║  🔒 Cortex CI 门禁          ║");
  console.log(`║  ${dryRun ? "干跑模式（仅扫描）" : runAll ? "全量模式" : "标准门禁（仅 unit）"}   ║`);
  console.log("╚══════════════════════════════╝\n");

  if (dryRun) {
    const { unit, skipped } = scanAllTests();
    console.log("📋 测试文件扫描（干跑）:\n");
    for (const [tag, files] of Object.entries(groupByTag([...unit, ...skipped]))) {
      console.log(`   @ci: ${tag} (${files.length} 个):`);
      for (const f of files) {
        console.log(`      ${f.path.replace(ROOT, "").replace(/^[\\/]/, "")}`);
      }
    }
    console.log(`\n   合计: ${unit.length + skipped.length} 个测试文件`);
    return;
  }

  const result: GateResult = {
    build: false,
    typecheck: false,
    lint: false,
    test: false,
    testDetails: { total: 0, passed: 0, skipped: 0 },
  };

  // 1. 构建
  result.build = buildAll();
  if (!result.build) {
    console.error("\n❌ 构建失败，跳过后续步骤");
    process.exit(1);
  }

  // 2. 类型检查
  result.typecheck = typecheckAll();

  // 3. 测试（仅 unit，除非 --all）
  const testResult = runTests(runAll);
  result.test = testResult.ok;
  result.testDetails = testResult.details;

  // 4. Lint
  result.lint = runLint();

  // ── 判定 ──
  console.log("\n══════════════════════════════════");
  console.log("  门禁判定");
  console.log("══════════════════════════════════");
  console.log(`  build     ${result.build ? "✅" : "❌"}`);
  console.log(`  typecheck ${result.typecheck ? "✅" : "❌"}`);
  console.log(`  test      ${result.test ? "✅" : "❌"} (${result.testDetails.passed}/${result.testDetails.total} passed)`);
  console.log(`  lint      ${result.lint ? "✅" : "❌"}`);
  console.log("──────────────────────────────────");

  const allPassed = result.build && result.typecheck && result.test && result.lint;

  if (allPassed) {
    console.log("\n✅ 全部门禁通过\n");
    process.exit(0);
  } else {
    console.error("\n❌ 门禁未通过\n");
    process.exit(1);
  }
}

function groupByTag(files: TestFile[]): Record<string, TestFile[]> {
  const map: Record<string, TestFile[]> = {};
  for (const f of files) {
    (map[f.ciTag] ??= []).push(f);
  }
  return map;
}

main().catch((e) => {
  console.error("门禁脚本异常:", e);
  process.exit(1);
});
