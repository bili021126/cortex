#!/usr/bin/env tsx
/**
 * 零消费导出审计脚本（阶段三 D1 —— 闭合 phase1 遗留 5）
 *
 * 扫描指定包的导出符号，统计全仓（packages/）引用次数，
 * 输出零消费清单与零消费率。沉淀自阶段一调研期的临时脚本（.tmp-audit-v4.mjs）。
 *
 * 口径（正则近似，文档固化）：
 *   - 导出识别：`export (declare )?(type|interface|class|function|const|enum) Name` 与 `export { A, B }`
 *   - 引用统计：词边界匹配（含注释/字符串误命中，结果偏保守）
 *   - 排除：定义文件自身、dist/、node_modules/
 *   - 与 v4 审计（DEAD/LEAK/PUB_API_UNCONSUMED）口径不同，不可直接对比
 *
 * 用法:
 *   npx tsx scripts/audit-unconsumed.ts                 # 默认 protocol
 *   npx tsx scripts/audit-unconsumed.ts cli memory config protocol
 *   npx tsx scripts/audit-unconsumed.ts --json protocol # 机器可读
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PKG_ROOT = join(ROOT, "packages");

// ─── 导出符号提取 ─────────────────────────────────────────

const EXPORT_DECL_RE =
  /export\s+(?:declare\s+)?(?:type|interface|class|function|const|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST_RE = /export\s*\{([^}]+)\}/g;

function extractExports(src: string): Set<string> {
  const names = new Set<string>();
  for (const m of src.matchAll(EXPORT_DECL_RE)) names.add(m[1]!);
  for (const m of src.matchAll(EXPORT_LIST_RE)) {
    for (const item of m[1]!.split(",")) {
      const name = item.trim().split(/\s+as\s+/)[0]!.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

// ─── 文件遍历 ─────────────────────────────────────────────

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === "dist" || entry === "coverage") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

// ─── 主流程 ───────────────────────────────────────────────

interface PkgReport {
  pkg: string;
  total: number;
  zeroConsumed: number;
  ratio: number;
  zeroList: { symbol: string; file: string }[];
}

function auditPkg(pkg: string): PkgReport {
  const srcDir = join(PKG_ROOT, pkg, "src");
  const files = walkFiles(srcDir);

  // 包内导出符号 → 定义文件
  const exports = new Map<string, string>();
  for (const file of files) {
    const src = readFileSync(file, "utf-8");
    for (const name of extractExports(src)) {
      // 首次定义为准
      if (!exports.has(name)) exports.set(name, file);
    }
  }

  // 全仓引用扫描（packages/ 下所有 src + tests + scripts）
  const corpus: string[] = [];
  for (const p of readdirSync(PKG_ROOT)) {
    if (p.startsWith(".") || p === "node_modules") continue;
    const full = join(PKG_ROOT, p);
    if (statSync(full).isDirectory()) {
      corpus.push(...walkFiles(full));
    } else if (p.endsWith(".ts")) {
      corpus.push(full);
    }
  }

  const zeroList: { symbol: string; file: string }[] = [];
  for (const [symbol, defFile] of exports) {
    const defName = symbol;
    // 定义文件自身内的引用不算（声明处必含一次）
    let refs = 0;
    for (const file of corpus) {
      if (file === defFile) continue;
      const content = readFileSync(file, "utf-8");
      const re = new RegExp(`\\b${defName}\\b`, "g");
      const count = content.match(re)?.length ?? 0;
      if (count > 0) {
        refs += count;
        break; // 只要有一处引用即不算零消费
      }
    }
    if (refs === 0) {
      zeroList.push({ symbol, file: relative(ROOT, defFile) });
    }
  }

  zeroList.sort((a, b) => a.file.localeCompare(b.file));
  return {
    pkg,
    total: exports.size,
    zeroConsumed: zeroList.length,
    ratio: exports.size === 0 ? 0 : zeroList.length / exports.size,
    zeroList,
  };
}

// ─── 入口 ─────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const pkgs = args.filter((a) => !a.startsWith("--"));
  const targets = pkgs.length > 0 ? pkgs : ["protocol"];

  const reports = targets.map(auditPkg);
  const total = reports.reduce((s, r) => s + r.total, 0);
  const zero = reports.reduce((s, r) => s + r.zeroConsumed, 0);

  if (jsonMode) {
    console.log(JSON.stringify({ reports, total, zero, ratio: total === 0 ? 0 : zero / total }, null, 2));
    return;
  }

  for (const r of reports) {
    console.log(`\n📦 ${r.pkg} — 导出 ${r.total} / 零消费 ${r.zeroConsumed} (${(r.ratio * 100).toFixed(1)}%)`);
    for (const z of r.zeroList) {
      console.log(`   ⚪ ${z.symbol.padEnd(32)} ${z.file}`);
    }
  }
  console.log(`\n合计: 导出 ${total} / 零消费 ${zero} (${((zero / Math.max(total, 1)) * 100).toFixed(1)}%)`);
}

main();
