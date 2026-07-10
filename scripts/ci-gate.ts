#!/usr/bin/env npx tsx
/**
 * CI 门禁脚本 —— 薄壳
 *
 *   @ci 标签扫描 + 按包串行 vitest 调用 + 结果汇总
 *
 * vitest 2.1.9 + Node 24 下 workspace 模式存在启动错误，
 * 根级聚合 config 会导致单进程 OOM。改用按包逐个跑，简单可靠。
 *
 * 用法:
 *   npx tsx scripts/ci-gate.ts                正常门禁（只跑 @ci: unit）
 *   npx tsx scripts/ci-gate.ts --all          全量（包括 @ci: llm / integration）
 *   npx tsx scripts/ci-gate.ts --dry-run      仅扫描 @ci 标签，不执行
 *   npx tsx scripts/ci-gate.ts --json         机器可读 JSON 输出
 *
 * @ci 标签规范（写在测试文件第一行注释中）:
 *   // @ci: unit         CI 必跑（默认值）
 *   // @ci: verify       关键修复验证，CI 必跑（与 unit 同级）
 *   // @ci: llm          需要 LLM API，CI 跳过
 *   // @ci: integration  需要外部服务，CI 跳过
 *   // @ci: e2e          端到端测试，CI 跳过
 *   // @ci: manual       人工触发，永远不自动跑
 *   // @ci: contract     跨包接口契约验证，CI 必跑（与 unit 同级）
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

// ─── 类型 ────────────────────────────────────────────────

type CiTag = "unit" | "verify" | "contract" | "llm" | "integration" | "e2e" | "manual";

interface TestFile {
  path: string;
  ciTag: CiTag;
}

// ─── 常量 ────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, "..");
const CI_TAG_RE = /@ci\s*:\s*(unit|verify|contract|llm|integration|e2e|manual)/;
const TEST_FILE_RE = /\.test\.ts$/;

// ─── 工具 ────────────────────────────────────────────────

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function run(cmd: string, args: string[], cwd: string): { ok: boolean; stdout: string } {
  try {
    const fullCmd = [cmd, ...args].map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
    const stdout = execSync(fullCmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600_000,
      maxBuffer: 50 * 1024 * 1024, // 50MB：引擎包 vitest 日志量极大
      windowsHide: true,
    });
    return { ok: true, stdout };
  } catch (e: any) {
    return { ok: false, stdout: (e.stdout ?? "") + "\n" + (e.stderr ?? "") };
  }
}

// ─── @ci 扫描 ────────────────────────────────────────────

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
      } else if (TEST_FILE_RE.test(entry)) {
        results.push(full);
      }
    } catch {
      /* 权限等问题，跳过 */
    }
  }
  return results;
}

function extractCiTag(filePath: string): CiTag {
  try {
    const head = readFileSync(filePath, "utf-8").split("\n").slice(0, 10).join("\n");
    const m = head.match(CI_TAG_RE);
    return (m?.[1] as CiTag) ?? "unit";
  } catch {
    return "unit";
  }
}

function hasCiTag(filePath: string): boolean {
  try {
    const head = readFileSync(filePath, "utf-8").split("\n").slice(0, 10).join("\n");
    return /@ci\b/.test(head);
  } catch {
    return false;
  }
}

/** 从文件路径中提取包根目录（packages/<name>） */
function extractPackageRoot(filePath: string): string {
  const rel = relative(join(ROOT, "packages"), filePath);
  const seg = rel.replace(/\\/g, "/").split("/");
  if (seg.length > 0) {
    return join(ROOT, "packages", seg[0]!);
  }
  return dirname(filePath);
}

/** 解析单次 vitest 输出，返回 passed/total。兼容新旧两种 vitest 格式 */
function parseVitestLine(output: string): { passed: number; total: number } {
  // 新格式: "     Tests  793 passed (793)" 带前导空格
  // 旧格式: "Tests 793 passed (793)" 或 "Tests  1 failed | 792 passed (793)"
  // global match 遍历所有匹配，取最后一组
  const re = /Tests\s+(?:\d+\s+(?:failed|skipped)\s+\|\s+)?(\d+)\s+passed(?:\s+\|\s+\d+\s+(?:failed|skipped))?\s*\((\d+)\)/g;
  let last: { passed: number; total: number } = { passed: 0, total: 0 };
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    last = { passed: parseInt(m[1]!, 10), total: parseInt(m[2]!, 10) };
  }
  return last;
}

/** 扫描 packages/ 下所有测试文件 */
function scanAllTests(): TestFile[] {
  const pkgRoot = join(ROOT, "packages");
  const files = walkTests(pkgRoot);
  return files.map((f) => ({ path: f, ciTag: extractCiTag(f) }));
}

// ─── 入口 ────────────────────────────────────────────────

async function main() {
  try {
    execSync("chcp 65001", { stdio: "pipe" });
  } catch {
    /* 非 Windows 环境忽略 */
  }

  const args = process.argv.slice(2);
  const runAll = args.includes("--all");
  const dryRun = args.includes("--dry-run");
  const jsonMode = args.includes("--json");

  // ── 门禁栈：类型检查 → Lint → 修复验证 → 契约验证 → 单元测试 ──
  if (!dryRun) {
    console.log("\n🔒 [门禁 1/4] tsc --noEmit 全量类型检查...");
    try {
      const tscResult = run("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], ROOT);
      if (!tscResult.ok) {
        console.error("❌ tsc --noEmit 失败，阻断");
        process.exit(1);
      }
      console.log("   ✅ 类型检查通过\n");
    } catch (e) {
      console.error(`❌ tsc 执行异常: ${e}`);
      process.exit(1);
    }

    // ── 门禁 2/4：ESLint ──
    console.log("\n🔒 [门禁 2/4] eslint packages/engine/src...");
    try {
      const eslintResult = run("npx", ["eslint", "packages/engine/src", "--max-warnings", "999"], ROOT);
      if (!eslintResult.ok) {
        const problems = eslintResult.stdout.match(/✖ \d+ problems?/);
        console.error(`❌ eslint 失败${problems ? " — " + problems[0] : ""}`);
        process.exit(1);
      }
      console.log("   ✅ lint 通过\n");
    } catch (e) {
      console.error(`❌ eslint 执行异常: ${e}`);
      process.exit(1);
    }
  }

  // ── 扫描测试文件 ──
  const all = scanAllTests();
  // 默认运行：unit + verify + contract（verify 和 contract 是新门禁层）
  const targetFiles = all.filter((t) => t.ciTag === "unit" || t.ciTag === "verify" || t.ciTag === "contract");
  const skipped = all.filter((t) => t.ciTag !== "unit" && t.ciTag !== "verify" && t.ciTag !== "contract");

  // @ci 标签审计
  const untagged = all.filter((t) => !hasCiTag(t.path));
  if (untagged.length > 0) {
    console.warn(
      `\n⚠️  @ci 标签缺失 (${untagged.length} 个文件) — 默认视为 unit（渐进式推行，暂不断路）:`,
    );
    for (const f of untagged) {
      console.warn(`   📄 ${relative(ROOT, f.path)}`);
    }
  }

  if (dryRun) {
    console.log(`\n📋 @ci 标签扫描 (${all.length} 个测试文件):\n`);
    const groups = new Map<string, TestFile[]>();
    for (const t of all) {
      const g = groups.get(t.ciTag) ?? [];
      g.push(t);
      groups.set(t.ciTag, g);
    }
    for (const [tag, files] of [...groups.entries()].sort()) {
      console.log(`   @ci: ${tag.padEnd(12)} ${files.length} 个文件`);
    }

    if (jsonMode) {
      const summary: Record<string, { count: number; files: string[] }> = {};
      for (const [tag, files] of groups) {
        summary[tag] = {
          count: files.length,
          files: files.map((f) => relative(ROOT, f.path)),
        };
      }
      console.log(JSON.stringify(summary));
    }
    return;
  }

  console.log(`\n🧪 vitest 按包串行 — ${runAll ? "全量模式" : `unit + verify + contract (${targetFiles.length} 个文件)`}`);
  console.log(`   @ci: llm/integration/e2e/manual → ${skipped.length} 个文件跳过\n`);

  // 按包分组
  const pkgMap = new Map<string, TestFile[]>();
  for (const t of all) {
    const pkg = extractPackageRoot(t.path);
    const group = pkgMap.get(pkg) ?? [];
    group.push(t);
    pkgMap.set(pkg, group);
  }

  let totalPassed = 0;
  let totalTests = 0;
  let allOk = true;

  for (const [pkgDir, files] of pkgMap) {
    const pkgTarget = files.filter((f) => f.ciTag === "unit" || f.ciTag === "verify" || f.ciTag === "contract");
    const pkgSkipped = files.filter((f) => f.ciTag !== "unit" && f.ciTag !== "verify" && f.ciTag !== "contract");

    // 非全量模式下，如果此包没有 target 测试，跳过
    if (!runAll && pkgTarget.length === 0) {
      if (files.length > 0) {
        console.log(`   ⏭ ${relative(ROOT, pkgDir)} — 无 @ci: unit/verify/contract 测试 (${files.length} 个文件跳过)`);
      }
      continue;
    }

    // 构建 vitest 参数
    // 引擎包测试文件巨多，多线程 OOM；强制单线程
    const vitestArgs = ["vitest", "run", "--pool=threads"];
    if (files.length > 40) {
      vitestArgs.push("--poolOptions.threads.maxThreads=1", "--poolOptions.threads.minThreads=1");
    }
    if (!runAll) {
      for (const s of pkgSkipped) {
        const relPath = relative(pkgDir, s.path).replace(/\\/g, "/");
        vitestArgs.push(`--exclude=${relPath}`);
      }
    }

    const r = run("pnpm", vitestArgs, pkgDir);
    const clean = stripAnsi(r.stdout);
    const { passed, total } = parseVitestLine(clean);

    totalPassed += passed;
    totalTests += total;
    if (!r.ok) allOk = false;

    const pkgLabel = relative(ROOT, pkgDir);
    const status = r.ok ? "✅" : "❌";
    console.log(`   ${status} ${pkgLabel} — ${passed}/${total} passed`);
  }

  console.log("");
  console.log(allOk ? "✅ 门禁通过" : "❌ 门禁未通过");
  console.log(`   Tests: ${totalPassed}/${totalTests} passed` + (skipped.length > 0 ? ` | ${skipped.length} skipped` : ""));

  if (jsonMode) {
    console.log(
      JSON.stringify({
        allPassed: allOk,
        total: totalTests,
        passed: totalPassed,
        skipped: skipped.length,
      }),
    );
  }

  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error("门禁脚本异常:", e);
  process.exit(1);
});
