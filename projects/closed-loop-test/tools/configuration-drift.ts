/**
 * ═══ 配置漂移探测器 ═══
 *
 * 扫描 packages 下各子包的 package.json + 根 package.json，
 * 检测同名依赖的版本声明是否一致。
 *
 * 用法:
 *   npx tsx tools/configuration-drift.ts           # 终端报告
 *   npx tsx tools/configuration-drift.ts --json    # JSON 输出
 *
 * 退出码:
 *   0 = 干净（无漂移）
 *   1 = 检测到漂移（开放版本不计入）
 *   2 = 扫描异常
 *
 * @license MIT
 */

import { readFileSync } from "node:fs";
import { readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { cwd, exit, argv } from "node:process";

/* ── 类型 ── */

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface DepEntry {
  /** 依赖名（如 "typescript", "vitest"） */
  depName: string;
  /** 包标识（如 "root", "engine", "llm"） */
  pkg: string;
  /** 包名（如 "@cortex/engine"） */
  pkgName: string;
  /** 文件路径 */
  filePath: string;
  /** 依赖段名 */
  section: "dependencies" | "devDependencies";
  /** 版本声明（已 trim） */
  version: string;
  /** 是否为 workspace:* 协议 */
  isWorkspaceStar: boolean;
  /** 是否为开放版本（* 或 latest） */
  isOpenVersion: boolean;
}

interface DepGroup {
  depName: string;
  entries: DepEntry[];
  /** 去重后的版本集合 */
  uniqueVersions: string[];
  /** 是否漂移 */
  hasDrift: boolean;
  /** 是否包含开放版本（* / latest） */
  hasOpenVersion: boolean;
}

interface DriftItem {
  dependency: string;
  occurrences: number;
  versions: Record<string, string>;
  recommended: string;
  reason: string;
}

interface ReportMeta {
  scannedAt: string;
  filesScanned: number;
  dependenciesChecked: number;
  status: "clean" | "drift" | "error";
}

interface JsonReport {
  meta: ReportMeta;
  dependencies: Record<string, unknown>;
  drifts: DriftItem[];
}

/* ── 常量 ── */

const ROOT_DIR = cwd();
const PACKAGES_DIR = join(ROOT_DIR, "packages");
const ROOT_PKG_PATH = join(ROOT_DIR, "package.json");

/* ── 辅助函数 ── */

/** 判断版本声明是否为 workspace:* */
function isWorkspaceStar(v: string): boolean {
  return v === "workspace:*";
}

/** 判断是否为开放版本（* 或 latest） */
function isOpenVersion(v: string): boolean {
  return v === "*" || v === "latest";
}

/** 判断是否应跳过漂移检测（仅 workspace:* 跳过，* / latest 不再跳过） */
function shouldSkipDrift(v: string): boolean {
  return v === "workspace:*";
}

/** 获取当前时间戳 */
function nowISO(): string {
  return new Date().toISOString();
}

/** 计算推荐版本（三级优先级） */
function recommendVersion(entries: DepEntry[]): { version: string; reason: string } {
  // 收集非 workspace:* 的版本
  const versions = entries
    .filter((e) => e.version !== "workspace:*")
    .map((e) => e.version);

  if (versions.length === 0) {
    return { version: "workspace:*", reason: "仅 workspace:* 出现" };
  }

  // 统计各版本出现次数
  const counts = new Map<string, number>();
  for (const v of versions) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  // 按出现次数降序，同次按 semver 降序
  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    // 第 3 优先级：根版本优先（平局时，root 使用的版本优先）
    const aIsRoot = entries.some((e) => e.pkg === "root" && e.version === a[0]);
    const bIsRoot = entries.some((e) => e.pkg === "root" && e.version === b[0]);
    if (aIsRoot && !bIsRoot) return -1;
    if (!aIsRoot && bIsRoot) return 1;
    return compareVersions(b[0], a[0]);
  });

  const bestVersion = sorted[0][0];
  const bestCount = sorted[0][1];
  const total = versions.length;

  // 第 1 优先：多数派版本
  if (bestCount > 1) {
    return {
      version: bestVersion,
      reason: `多数派版本（${bestCount}/${total}）`,
    };
  }

  // 第 2 优先：最高版本（仅出现一次时）
  return {
    version: bestVersion,
    reason: "最高版本",
  };
}

/** 简单版本号比较（数字部分） */
function compareVersions(a: string, b: string): number {
  const extractNum = (v: string): number => {
    const match = v.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return 0;
    return parseInt(match[1]) * 10000 + parseInt(match[2]) * 100 + parseInt(match[3]);
  };
  return extractNum(b) - extractNum(a);
}

/** 从文件路径提取简短包标识 */
function getPkgId(filePath: string): string {
  const rel = relative(ROOT_DIR, filePath);
  if (rel === "package.json") return "root";
  const match = rel.match(/packages[\\/]([^\\/]+)/);
  return match ? match[1] : rel;
}

/** 读取并解析 package.json */
function readPackageJson(filePath: string): PackageJson | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }
}

/** 获取所有要扫描的 package.json 文件路径 */
function getPackageJsonPaths(): string[] {
  const paths: string[] = [];

  // root
  if (existsSync(ROOT_PKG_PATH)) {
    paths.push(ROOT_PKG_PATH);
  }

  // packages 下各子包
  if (existsSync(PACKAGES_DIR)) {
    const dirs = readdirSync(PACKAGES_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (dir.isDirectory()) {
        const pkgPath = join(PACKAGES_DIR, dir.name, "package.json");
        if (existsSync(pkgPath)) {
          paths.push(pkgPath);
        }
      }
    }
  }

  return paths.sort();
}

/* ── 核心扫描 ── */

/** Phase 0 + Phase 1: 收集并聚合所有依赖（版本已 trim 规范化） */
function collectDependencies(): DepEntry[] {
  const entries: DepEntry[] = [];
  const files = getPackageJsonPaths();

  for (const filePath of files) {
    const pkg = readPackageJson(filePath);
    if (!pkg) continue;

    const pkgId = getPkgId(filePath);
    const pkgName = pkg.name ?? pkgId;

    const sections: Array<"dependencies" | "devDependencies"> = [
      "dependencies",
      "devDependencies",
    ];

    for (const section of sections) {
      const deps = pkg[section];
      if (!deps) continue;

      for (const [depName, version] of Object.entries(deps)) {
        const trimmedVersion = version.trim();
        entries.push({
          depName,
          pkg: pkgId,
          pkgName,
          filePath,
          section,
          version: trimmedVersion,
          isWorkspaceStar: isWorkspaceStar(trimmedVersion),
          isOpenVersion: isOpenVersion(trimmedVersion),
        });
      }
    }
  }

  return entries;
}

/** Phase 2: 检测漂移 */
function detectDrift(entries: DepEntry[]): DepGroup[] {
  // 按依赖名分组
  const groups = new Map<string, DepEntry[]>();
  for (const entry of entries) {
    const existing = groups.get(entry.depName);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(entry.depName, [entry]);
    }
  }

  const results: DepGroup[] = [];

  for (const [depName, groupEntries] of groups) {
    // 去重版本
    const versionSet = new Set(groupEntries.map((e) => e.version));
    const uniqueVersions = [...versionSet];

    // 判断漂移：过滤掉 workspace:* 后，版本数 > 1 则漂移
    const nonWorkspaceVersions = groupEntries
      .filter((e) => !e.isWorkspaceStar)
      .map((e) => e.version);
    const uniqueNonWorkspace = new Set(nonWorkspaceVersions);

    // 单出现不构成漂移；
    // 开放版本（* / latest）参与漂移检测，但标记为 hasOpenVersion
    const hasDrift =
      groupEntries.length > 1 &&
      groupEntries.filter((e) => !shouldSkipDrift(e.version)).length > 1 &&
      uniqueNonWorkspace.size > 1;

    const hasOpenVersion = groupEntries.some((e) => e.isOpenVersion);

    results.push({
      depName,
      entries: groupEntries,
      uniqueVersions,
      hasDrift,
      hasOpenVersion,
    });
  }

  // 按依赖名排序
  results.sort((a, b) => a.depName.localeCompare(b.depName));

  return results;
}

/* ── 输出 ── */

/** 输出人类可读报告 */
function printHumanReport(
  groups: DepGroup[],
  filesScanned: number,
  totalDeps: number,
): void {
  const drifts = groups.filter((g) => g.hasDrift);

  console.log();
  console.log("═══ 配置漂移报告 ═══");
  console.log(`扫描范围: ${filesScanned} 个文件（根 + 包）`);
  console.log(`检查依赖: ${totalDeps} 项（去重）`);
  console.log();

  if (drifts.length === 0) {
    console.log("✅ 未发现版本漂移（所有同名依赖版本一致）");
  } else {
    console.log(`❌ 发现 ${drifts.length} 处版本漂移:\n`);

    for (let i = 0; i < drifts.length; i++) {
      const drift = drifts[i];
      const rec = recommendVersion(drift.entries);

      const openMark = drift.hasOpenVersion ? " [含开放版本 * / latest]" : "";
      console.log(`  ${i + 1}. ${drift.depName}${openMark}`);

      for (const entry of drift.entries) {
        const marker =
          entry.version !== rec.version && !shouldSkipDrift(entry.version)
            ? "  ← 偏移"
            : "";
        const openTag = entry.isOpenVersion ? " [开放版本]" : "";
        const fileLabel = relative(ROOT_DIR, entry.filePath);
        console.log(`     ${entry.pkg}: ${(entry.version + openTag).padEnd(24)} ${fileLabel}${marker}`);
      }

      console.log(`     → 建议统一为 ${rec.version}（${rec.reason}）`);
      console.log();
    }
  }

  // 快照摘要
  console.log("─── 快照摘要 ───");
  const nameWidth = 22;
  const countWidth = 12;
  const versionWidth = 20;
  console.log(
    `${"依赖名".padEnd(nameWidth)} ${"出现次数".padEnd(countWidth)} ${"版本".padEnd(versionWidth)} 涉及包`,
  );
  console.log("─".repeat(nameWidth + countWidth + versionWidth + 20));

  for (const group of groups) {
    const depName = group.depName.padEnd(nameWidth);
    const count = String(group.entries.length).padEnd(countWidth);
    const version =
      group.uniqueVersions.length === 1
        ? group.uniqueVersions[0]
        : "(多个版本)";
    const versionDisplay = version.padEnd(versionWidth);
    const pkgs = group.entries.map((e) => e.pkg).join(", ");
    const driftMark = group.hasDrift ? "  ⚠️" : "";
    const openMark = group.hasOpenVersion && !group.hasDrift ? "  🟡" : "";

    console.log(`${depName} ${count} ${versionDisplay} ${pkgs}${driftMark}${openMark}`);
  }

  console.log();
}

/** 输出 JSON 报告 */
function printJsonReport(
  groups: DepGroup[],
  filesScanned: number,
  totalDeps: number,
): void {
  const drifts: DriftItem[] = [];
  const depsMap: Record<string, unknown> = {};

  for (const group of groups) {
    const versions: Record<string, string> = {};
    for (const entry of group.entries) {
      versions[entry.pkg] = entry.version;
    }

    depsMap[group.depName] = {
      versions,
      drift: group.hasDrift,
      hasOpenVersion: group.hasOpenVersion,
    };

    if (group.hasDrift) {
      const rec = recommendVersion(group.entries);
      drifts.push({
        dependency: group.depName,
        occurrences: group.entries.length,
        versions,
        recommended: rec.version,
        reason: rec.reason,
      });
    }
  }

  const report: JsonReport = {
    meta: {
      scannedAt: nowISO(),
      filesScanned,
      dependenciesChecked: totalDeps,
      status: drifts.length > 0 ? "drift" : "clean",
    },
    dependencies: depsMap,
    drifts,
  };

  console.log(JSON.stringify(report, null, 2));
}

/* ── 入口 ── */

function main(): void {
  const isJson = argv.includes("--json");

  try {
    // Phase 0 + 1: 收集
    const allEntries = collectDependencies();
    const filesScanned = getPackageJsonPaths().length;

    // 去重统计（依赖名去重）
    const uniqueDepNames = new Set(allEntries.map((e) => e.depName));

    // Phase 2: 检测
    const groups = detectDrift(allEntries);

    // Phase 3 + 4: 建议 + 输出
    if (isJson) {
      printJsonReport(groups, filesScanned, uniqueDepNames.size);
    } else {
      printHumanReport(groups, filesScanned, uniqueDepNames.size);
    }

    // 退出码：开放版本不计入退出码（标记但不告警）
    const hasRealDrift = groups.some((g) => g.hasDrift && !g.hasOpenVersion);
    exit(hasRealDrift ? 1 : 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (isJson) {
      const report: JsonReport = {
        meta: {
          scannedAt: nowISO(),
          filesScanned: 0,
          dependenciesChecked: 0,
          status: "error",
        },
        dependencies: {},
        drifts: [],
      };
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.error("💥 扫描异常:", message);
    }

    exit(2);
  }
}

main();
