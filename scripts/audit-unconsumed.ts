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
 *   - **re-export 不算消费**（2026-09-26 修正）
 *   - **包内引用不算消费**（2026-09-26 修正）——「零消费」= 无包外引用
 *   - 与 v4 审计（DEAD/LEAK/PUB_API_UNCONSUMED）口径不同，不可直接对比
 *
 * ── 为什么这两条要改（2026-09-26）────────────────────────────────
 *
 * 修正前有两处假阴性，合起来使这个审计**看不到它自己存在要找的东西**：
 *
 * ① **barrel 的再导出被当成消费**：`index.ts` 里 `export { foo } from "./foo.js"`
 *    命中了 `\bfoo\b` → 记为「有引用」。于是任何带 barrel 的包恒报 0% 零消费。
 * ② **包自己的测试文件被当成消费**：只为被测而存在的符号同样「被引用」，
 *    于是「测了但没人用」的公开面看起来是活的。
 *
 * 实测证据：`design-tokens` 报「导出 25 / 零消费 0 (0.0%)」，而其中
 * `generateCssVariables` / `generateFullStylesheet` / `DEFAULT_PERSONA`
 * 的**包外**引用为 0——全仓唯一的引用点就是它自己的 barrel 和它自己的测试。
 * `--cx-*` 变量一个外部消费方都没有，`css-variables.ts` 却写着「供 WebUI 和
 * Desktop 使用」。死面之所以长期存活，正是因为这份审计说它被消费了。
 *
 * 现在：统计前先剥掉 `export { ... }` 列表，且引用语料**排除被审计包自身**。
 * 跨包 `import { foo } from "@scope/pkg"` 仍是真实引用，不受影响。
 *
 * 含义提醒：本口径下的「零消费」= 无包外引用，**不等于死代码**——
 * 一个仅在本包内部使用的导出仍可能是有意的内部 API。判定要人工看。
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
  for (const m of src.matchAll(EXPORT_DECL_RE)) {
    // 捕获组 1 必有值（正则要求至少一个标识符字符）；守卫保持原假定
    const declared = m[1];
    if (declared !== undefined) names.add(declared);
  }
  for (const m of src.matchAll(EXPORT_LIST_RE)) {
    const list = m[1];
    if (list === undefined) continue; // 同上：捕获组必有值
    for (const item of list.split(",")) {
      const name = (item.trim().split(/\s+as\s+/)[0] ?? "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

/**
 * 剥掉 `export { ... }` / `export type { ... }`（含 `... from "..."`）列表。
 *
 * 这些只是包的公开面（barrel 的再导出），不是使用。若不剥掉，
 * 任何带 `index.ts` 再导出的包都会恒报 0% 零消费——见文件头说明。
 *
 * 注意只剥离**列表形式**；`export const foo = ...` 这类声明保留不动
 * （其定义文件本来就被排除在统计外）。`export type {` 也要剥——
 * 类型导出同样只是公开面，漏掉它会让类型符号永远显示「包内有引用」。
 */
function stripReExportLists(src: string): string {
  return src.replace(/export\s+(?:type\s+)?\{[^}]*\}/g, "");
}

// ─── 文件遍历 ─────────────────────────────────────────────

/**
 * 遍历 .ts / .tsx。
 *
 * 2026-09-26 修正：此前只收 `.ts`，**`.tsx` 完全不可见**。于是「只被 TSX 组件引用」
 * 的符号（`cli/src/tui/ink/**` 那批、desktop 的 renderer 组件）会被当成死面——
 * 实测 `cli` 的死面数因此虚高。.mts/.cts 一并收，免得下次换个扩展名又瞎。
 */
function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === "dist" || entry === "coverage") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(entry)) out.push(full);
  }
  return out;
}

// ─── 主流程 ───────────────────────────────────────────────

interface PkgReport {
  pkg: string;
  total: number;
  zeroConsumed: number;
  ratio: number;
  /** insideRefs > 0 = 只在包内被用（非死代码）；0 = 包内外都没人用 */
  zeroList: { symbol: string; file: string; insideRefs: number }[];
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

  // 包**外**引用扫描（packages/ 下其余包的 src + tests + scripts）。
  // 排除被审计包自身：包内引用（含它自己的测试）不构成「消费」——
  // 一个只为被测而存在的符号，在包内看来永远是「有引用」的。
  const selfDir = join(PKG_ROOT, pkg);
  const corpus: string[] = [];
  for (const p of readdirSync(PKG_ROOT)) {
    if (p.startsWith(".") || p === "node_modules") continue;
    const full = join(PKG_ROOT, p);
    if (full === selfDir) continue;
    if (statSync(full).isDirectory()) {
      corpus.push(...walkFiles(full));
    } else if (p.endsWith(".ts")) {
      corpus.push(full);
    }
  }

  const zeroList: { symbol: string; file: string; insideRefs: number }[] = [];
  for (const [symbol, defFile] of exports) {
    const defName = symbol;
    const re = new RegExp(`\\b${defName}\\b`, "g");
    const countRefs = (targets: string[], skipDefFile: boolean): number => {
      let n = 0;
      for (const file of targets) {
        if (skipDefFile && file === defFile) continue;
        // 先剥 barrel 再导出列表：只出现在 `export { X }` 里不等于被使用
        const content = stripReExportLists(readFileSync(file, "utf-8"));
        n += content.match(re)?.length ?? 0;
      }
      return n;
    };

    // 包外引用：定义文件自身不算（声明处必含一次）
    const outsideRefs = countRefs(corpus, true);
    if (outsideRefs === 0) {
      // 包内引用：**必须含定义文件**——否则「只在自己文件里用」的符号会被误判成死面。
      // 实测踩过：desktop 的 PRESENCE_IPC_CHANNEL 在第 17 行定义、第 65 行同一文件里
      // 就被 webContents.send 用了，先前把定义文件一并排除，于是它被错列进死面名单。
      // 再减 1 是扣掉声明处那一次。
      const insideRefs = Math.max(0, countRefs(walkFiles(join(PKG_ROOT, pkg)), false) - 1);
      zeroList.push({ symbol, file: relative(ROOT, defFile), insideRefs });
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
    const truly = r.zeroList.filter((z) => z.insideRefs === 0).length;
    console.log(
      `\n📦 ${r.pkg} — 导出 ${r.total} / 无包外引用 ${r.zeroConsumed} (${(r.ratio * 100).toFixed(1)}%)` +
        `  (其中包内外皆无人用 ${truly})`,
    );
    for (const z of r.zeroList) {
      const tag = z.insideRefs === 0 ? "（包内亦无引用）" : `（仅包内 ${z.insideRefs} 处）`;
      console.log(`   ⚪ ${z.symbol.padEnd(32)} ${z.file.padEnd(46)} ${tag}`);
    }
  }
  console.log(
    `\n合计: 导出 ${total} / 无包外引用 ${zero} (${((zero / Math.max(total, 1)) * 100).toFixed(1)}%)`,
  );
}

main();
