#!/usr/bin/env npx tsx
/**
 * CI 门禁脚本 —— 两件事：同步 + 统一
 *
 *   同步 —— 测试文件通过 @ci 标签自声明身份，脚本自动扫描，零手动配置
 *   统一 —— 本地 `npx tsx scripts/ci-gate.ts` 与 GitHub Actions 完全一致
 *
 * 用法:
 *   npx tsx scripts/ci-gate.ts                正常门禁（只跑 @ci: unit）
 *   npx tsx scripts/ci-gate.ts --all          全量（包括 @ci: llm / integration）
 *   npx tsx scripts/ci-gate.ts --dry-run      仅扫描，不执行
 *   npx tsx scripts/ci-gate.ts --scope=pkg1,pkg2  仅扫描指定包（并发 solo-flight 隔离）
 *
 * @ci 标签规范（写在测试文件第一行注释中）:
 *   // @ci: unit         CI 必跑（默认值，不写标签等同 unit）
 *   // @ci: llm          需要 LLM API，CI 跳过
 *   // @ci: integration  需要外部服务，CI 跳过
 *   // @ci: e2e          端到端测试，CI 跳过
 *   // @ci: manual       人工触发，永远不自动跑
 */

import { execSync } from "node:child_process";
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
  /** vitest 配置文件名（相对于包目录），默认 "vitest.ci.config.ts" */
  config?: string;
  /** 仅测试条目（跳过 build/typecheck，避免同 filter 重复编译） */
  testOnly?: boolean;
  /** 强制 --exclude glob（vitest 2.1.x config exclude 有 bug，走 CLI 保证生效） */
  hardExcludes?: string[];
}

interface GateResult {
  configValid: boolean;
  build: boolean;
  typecheck: boolean;
  lint: boolean;
  test: boolean;
  testDetails: { total: number; passed: number; skipped: number };
}

// ─── 配置 ────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, "..");

/** 需要构建和类型检查的包（按依赖顺序） */
const PACKAGES: PackageInfo[] = [
  { name: "config",       dir: join(ROOT, "packages", "config"),       filter: "@cortex/config" },
  { name: "shared",       dir: join(ROOT, "packages", "shared"),       filter: "@cortex/shared" },
  { name: "notification", dir: join(ROOT, "packages", "notification"), filter: "@cortex/notification" },
  { name: "factory",      dir: join(ROOT, "packages", "factory"),      filter: "@cortex/factory" },
  { name: "parser",       dir: join(ROOT, "packages", "parser"),       filter: "@cortex/parser" },
  { name: "pm",           dir: join(ROOT, "packages", "pm"),           filter: "@cortex/pm" },
  { name: "data",         dir: join(ROOT, "packages", "data"),         filter: "@cortex/data" },
  { name: "tools",        dir: join(ROOT, "packages", "tools"),        filter: "@cortex/tools" },
  { name: "llm",          dir: join(ROOT, "packages", "llm"),          filter: "@cortex/llm" },
  { name: "telemetry",    dir: join(ROOT, "packages", "telemetry"),    filter: "@cortex/telemetry" },
  { name: "engine",       dir: join(ROOT, "packages", "engine"),       filter: "@cortex/engine",       config: "vitest.ci.config.ts",
    hardExcludes: ["tests/bootstrap-integration*", "tests/skill-bootstrap*", "tests/skill-system-integration*", "tests/system-stress*"],
  },
  { name: "engine-slow",  dir: join(ROOT, "packages", "engine"),       filter: "@cortex/engine",       config: "vitest.ci-slow.config.ts", testOnly: true },
  { name: "skill-kit",    dir: join(ROOT, "packages", "skill-kit"),    filter: "@cortex/skill-kit" },
  { name: "testing",      dir: join(ROOT, "packages", "testing"),      filter: "@cortex/testing" },
  { name: "prompt-kit",   dir: join(ROOT, "packages", "prompt-kit"),   filter: "@cortex/prompt-kit" },
  { name: "cli",          dir: join(ROOT, "packages", "cli"),          filter: "@cortex/cli" },
  { name: "plugin-runner", dir: join(ROOT, "packages", "plugin-runner"), filter: "@cortex/plugin-runner" },
  { name: "fsm-compiler",  dir: join(ROOT, "packages", "fsm-compiler"),  filter: "@cortex/fsm-compiler" },
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
    const fullCmd = [cmd, ...args].map(a => a.includes(" ") ? `"${a}"` : a).join(" ");
    const stdout = execSync(fullCmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000, // 5 分钟超时
      windowsHide: true,
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

/** 检查文件头是否有 @ci 标签（不限标签值，只要写了 @ci 就算有） */
function hasCiTag(filePath: string): boolean {
  try {
    const head = readFileSync(filePath, "utf-8").split("\n").slice(0, 10).join("\n");
    return /@ci\b/.test(head);
  } catch {
    return false;
  }
}

/**
 * 扫描全项目测试文件，检查是否都有 @ci 标签。
 * 缺失标签的文件输出警告但不断路（渐进式推行）。
 *
 * @returns 缺失 @ci 标签的文件绝对路径列表
 */
function checkAllTestsTagged(): string[] {
  const untagged: string[] = [];

  for (const pkg of PACKAGES) {
    if (pkg.testOnly) continue;
    const testDir = join(pkg.dir, "tests");
    const files = walkTests(testDir);
    for (const f of files) {
      if (!hasCiTag(f)) {
        untagged.push(f);
      }
    }
  }

  if (untagged.length > 0) {
    console.warn(`\n⚠️  @ci 标签缺失 (${untagged.length} 个文件) —— 请为以下测试文件添加 @ci 标签（渐进式推行，暂不断路）:`);
    for (const f of untagged) {
      console.warn(`   📄 ${relative(ROOT, f)}`);
    }
  } else {
    console.log("\n✅ 所有测试文件均已声明 @ci 标签");
  }

  return untagged;
}

/** 扫描全项目测试文件并分类 */
function scanAllTests(): { unit: TestFile[]; skipped: TestFile[] } {
  const unit: TestFile[] = [];
  const skipped: TestFile[] = [];

  for (const pkg of PACKAGES) {
    if (pkg.testOnly) continue;
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
    if (pkg.testOnly) continue;
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
    if (pkg.testOnly) continue;
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
    const pkgExcludes = [...perPkgExclude.get(pkg.filter)!];
    // vitest 2.1.x config exclude 字段有 bug，改为 CLI --exclude 注入（仅快速模式）
    if (pkg.hardExcludes && pkg.config !== "vitest.ci-slow.config.ts") {
      for (const exc of pkg.hardExcludes) pkgExcludes.push(exc);
    }

    if (!runAll && pkgUnit.length === 0) {
      console.log(`   ⬜ ${pkg.name} — 无 @ci: unit 测试，跳过`);
      continue;
    }

    // 在包目录下跑 vitest，使用 CI 专用配置（vitest.ci.config.ts）
    const vConfig = pkg.config ?? "vitest.ci.config.ts";
    const args = ["--filter", pkg.filter, "exec", "vitest", "run", "--config", vConfig];
    if (pkgExcludes.length > 0) {
      // vitest 2.1.x 要求 --exclude=pattern 格式，空格分隔不生效
      for (const exc of pkgExcludes) {
        args.push(`--exclude=${exc}`);
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

// ─── Schema 校验 ─────────────────────────────────────────

/**
 * 校验 cortex-agents.json 是否符合 cortex-agents.schema.json 约束。
 * 仅做结构性校验（必填字段、枚举值、ID 一致性），不做完整 JSON Schema 验证。
 * 完整 Schema 验证由 VS Code + ajv 在编辑期和使用时完成。
 */
function validateConfig(): boolean {
  console.log("\n📋 Schema 校验 cortex-agents.json …");

  const configPath = join(ROOT, "cortex-agents.json");
  const schemaPath = join(ROOT, "cortex-agents.schema.json");

  if (!existsSync(configPath)) {
    console.error("   ❌ cortex-agents.json 不存在");
    return false;
  }
  if (!existsSync(schemaPath)) {
    console.error("   ❌ cortex-agents.schema.json 不存在");
    return false;
  }

  let config: any;
  let schema: any;

  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (e: any) {
    console.error(`   ❌ cortex-agents.json JSON 解析失败: ${e.message}`);
    return false;
  }

  try {
    schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
  } catch (e: any) {
    console.error(`   ❌ cortex-agents.schema.json JSON 解析失败: ${e.message}`);
    return false;
  }

  const errors: string[] = [];

  // 1. $schema 引用检查
  if (!config.$schema) {
    errors.push("缺少 $schema 字段——请添加对 cortex-agents.schema.json 的引用");
  }

  // 2. 顶层必填: agents
  if (!config.agents || typeof config.agents !== "object") {
    errors.push("缺少必需的 'agents' 域");
  } else {
    // 从 schema 提取合法 type 枚举
    const agentSchema =
      schema.properties?.agents?.patternProperties?.["^[a-z][a-z0-9-]*$"]?.properties;
    const validAgentTypes: string[] = agentSchema?.type?.enum ?? [];

    for (const [key, agent] of Object.entries(config.agents) as [string, any][]) {
      // 必填字段
      for (const req of ["id", "type", "role", "model", "key"]) {
        if (!agent[req]) {
          errors.push(`agents.${key}: 缺少必需的 '${req}' 字段`);
        }
      }

      // type 枚举校验
      if (agent.type && validAgentTypes.length > 0 && !validAgentTypes.includes(agent.type)) {
        errors.push(
          `agents.${key}: 'type' 值 "${agent.type}" 不在允许的枚举中 [${validAgentTypes.join(", ")}]`,
        );
      }

      // ID 一致性
      if (agent.id && agent.id !== key) {
        errors.push(`agents.${key}: 'id' 值 "${agent.id}" 与 key "${key}" 不一致`);
      }

      // systemPrompt 与 systemPromptFile 必须至少有一个
      if (!agent.systemPrompt && !agent.systemPromptFile) {
        errors.push(`agents.${key}: 缺少 'systemPrompt' 或 'systemPromptFile'（必须至少指定一个）`);
      }
    }
  }

  // 3. tools 枚举校验（如果存在）
  if (config.tools && typeof config.tools === "object") {
    const toolSchema =
      schema.properties?.tools?.patternProperties?.["^[a-z][a-z0-9_]*$"]?.properties;
    const validCategories: string[] = toolSchema?.category?.enum ?? [];
    const validLevels: string[] = toolSchema?.level?.enum ?? [];

    for (const [key, tool] of Object.entries(config.tools) as [string, any][]) {
      if (tool.category && validCategories.length > 0 && !validCategories.includes(tool.category)) {
        errors.push(
          `tools.${key}: 'category' 值 "${tool.category}" 不在允许的枚举中 [${validCategories.join(", ")}]`,
        );
      }
      if (tool.level && validLevels.length > 0 && !validLevels.includes(tool.level)) {
        errors.push(
          `tools.${key}: 'level' 值 "${tool.level}" 不在允许的枚举中 [${validLevels.join(", ")}]`,
        );
      }
    }
  }

  // 报告
  if (errors.length === 0) {
    console.log("   ✅ cortex-agents.json 校验通过");
    return true;
  }

  console.error(`   ❌ 校验失败 (${errors.length} 个错误):`);
  for (const err of errors) {
    console.error(`      - ${err}`);
  }
  return false;
}

// ─── Lint ────────────────────────────────────────────────

function runLint(): boolean {
  console.log("\n📏 ESLint 代码规范…");
  const r = run("pnpm", ["-r", "--if-present", "lint"], ROOT);
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
  // 修复 Windows PowerShell 中文/emoji 乱码：设置控制台输出代码页为 UTF-8
  try { execSync("chcp 65001", { stdio: "pipe" }); } catch { /* 非 Windows 环境忽略 */ }

  const args = process.argv.slice(2);
  const runAll = args.includes("--all");
  const dryRun = args.includes("--dry-run");
  const jsonMode = args.includes("--json");

  // ─── --scope 并发隔离：仅扫描指定包 ───
  const scopeArg = args.find((a) => a.startsWith("--scope=")) ?? args.find((a) => a === "--scope");
  let scopeNames: Set<string> | null = null;
  if (scopeArg) {
    const scopeValue = scopeArg.includes("=") ? scopeArg.split("=")[1] : "";
    scopeNames = new Set(scopeValue.split(",").map((s) => s.trim()).filter(Boolean));
    // 过滤全局 PACKAGES 为仅指定的包
    const filtered = PACKAGES.filter((p) => scopeNames!.has(p.name));
    if (filtered.length === 0) {
      console.error(`❌ --scope 指定的包不存在于 PACKAGES 列表中: ${scopeValue}`);
      process.exit(1);
    }
    PACKAGES.length = 0;
    PACKAGES.push(...filtered);
  }

  console.log("╔══════════════════════════════╗");
  console.log("║  🔒 Cortex CI 门禁          ║");
  console.log(`║  ${dryRun ? "干跑模式（仅扫描）" : runAll ? "全量模式" : "标准门禁（仅 unit）"}   ║`);
  console.log("╚══════════════════════════════╝\n");

  if (dryRun) {
    checkAllTestsTagged();
    const { unit, skipped } = scanAllTests();
    if (jsonMode) {
      const grouped = groupByTag([...unit, ...skipped]);
      const summary: Record<string, { count: number; files: string[] }> = {};
      for (const [tag, files] of Object.entries(grouped)) {
        summary[tag] = { count: files.length, files: files.map((f) => f.path.replace(ROOT, "").replace(/^[\\/]/, "")) };
      }
      console.log(JSON.stringify({ mode: "dry-run", total: unit.length + skipped.length, byTag: summary }));
      return;
    }
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
    configValid: false,
    build: false,
    typecheck: false,
    lint: false,
    test: false,
    testDetails: { total: 0, passed: 0, skipped: 0 },
  };

  // 0. Schema 校验
  result.configValid = validateConfig();
  if (!result.configValid) {
    console.error("\n❌ 配置校验失败，请修正 cortex-agents.json 后重试");
    process.exit(1);
  }

  // 1. 构建
  result.build = buildAll();
  if (!result.build) {
    console.error("\n❌ 构建失败，跳过后续步骤");
    process.exit(1);
  }

  // 2. 类型检查
  result.typecheck = typecheckAll();

  // 2.5 @ci 标签审计（警告不阻断）
  checkAllTestsTagged();

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
  console.log(`  config    ${result.configValid ? "✅" : "❌"}`);
  console.log(`  build     ${result.build ? "✅" : "❌"}`);
  console.log(`  typecheck ${result.typecheck ? "✅" : "❌"}`);
  console.log(`  test      ${result.test ? "✅" : "❌"} (${result.testDetails.passed}/${result.testDetails.total} passed)`);
  console.log(`  lint      ${result.lint ? "✅" : "❌"}`);
  console.log("──────────────────────────────────");

  const allPassed = result.configValid && result.build && result.typecheck && result.test && result.lint;

  if (jsonMode) {
    console.log(JSON.stringify({ ...result, allPassed }));
  }

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
