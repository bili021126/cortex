#!/usr/bin/env npx tsx
/**
 * scripts/doc-drift-check.ts — 文档漂移盘点（inventory）
 *
 * 用途：列出「文档里提到、但源码里找不到」的标识符，按**所属文档**归并，供人工判断。
 * 它不是门禁——默认 exit 0；要拿它阻断用 `--strict`。
 *
 * ── 为什么默认不阻断（2026-09-26 定案，附证据）──────────────────────
 *
 * 原实现扫整棵 docs/、对任何 refs>=3 的缺失标识符 exit 1，结果恒红（272 条），
 * 于是这个信号等于不存在。逐层查过它的判据，两条便宜的修法都试了、都不成立：
 *
 *   ① 「按目录分角色」（archive/report 不算，只看活文档）——成立，但**不足以**支撑阻断：
 *      活跃口径下仍余 32 条，而**逐条核对后 32/32 全部落在设计稿或虚构文本里**
 *      （Committee-session-协议设计.md 7 条、cortex-tui-v2-final-design.md 6 条、
 *        consistency-design.md 3 条、循环策略注册表设计.md 2 条… plus
 *        constitution/翁法罗斯游记.md 的 LOCK_CHARACTER）。**真阳性为零。**
 *   ② 「按编辑距离认改名」（源码里有近似物 = 疑似改名后失修）——**不成立**：
 *      Seated→started、Voting→routing、Footer→filter、Dreaming→streaming 全是短词巧合，
 *      精度不足以自动判定。
 *
 * 而且文档角色**无法可靠自动推断**：206 篇里 34 篇前 12 行没有任何角色标记，
 * 其中就包含最该判定为「当前态」的 core/full-flow-map.md。任何启发式过滤都是猜，
 * 猜出来的门禁就是同一种病。所以这里只做客观范围收敛（归档/报告类不计入判定）+ 明确呈现。
 *
 * ── 范围规则（按相对路径，见下方 roleOf）────────────────────────
 *
 *   archive  路径含 archive 或 backup 段  → 不进判定（归档/备份文档描述的就是过去的状态）
 *   report   analysis / auditing / audit / reviews / review / inspection /
 *            amendments / superpowers
 *                                        → 计入统计、不进判定（调研与审计报告，含大量第三方产品名）
 *   live     其余（core/**、constitution/** 非归档、docs 根）→ **判定范围**
 *
 *   实测该规则下的读数（2026-09-26）：全库缺失 272 条 → 活跃口径 90 条。
 *   其中 13 条来自 constitution/backup/**，已按 backup 段排除。
 *
 * ── 已知口径局限（有意保留，以便与历史读数可比）────────────────
 *
 *   源码语料是「原始文本」而非「去注释后」——只出现在注释里的名字会被算作「存在」。
 *   这会使缺失数**偏少**。保持原样是为了让总数与 2026-09-26 报告记的 272 条可比。
 *
 * Usage:
 *   npx tsx scripts/doc-drift-check.ts            # 盘点（exit 0）
 *   npx tsx scripts/doc-drift-check.ts --strict   # 活跃口径有缺失即 exit 1
 *   npx tsx scripts/doc-drift-check.ts --json     # 机器可读
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const DOCS_DIR = path.join(ROOT, "docs");
const PKG_DIR = path.join(ROOT, "packages");

const strict = process.argv.includes("--strict");
const jsonMode = process.argv.includes("--json");

// ─── 源码语料 ────────────────────────────────────────────────

const srcText: string[] = [];
function walkSrc(d: string): void {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walkSrc(p);
    else if (f.name.endsWith(".ts")) srcText.push(fs.readFileSync(p, "utf-8"));
  }
}
for (const p of fs.readdirSync(PKG_DIR)) {
  const base = path.join(PKG_DIR, p, "src");
  if (fs.existsSync(base)) walkSrc(base);
}
const allSrc = srcText.join("\n").toLowerCase();

// ─── 文档扫描 ────────────────────────────────────────────────

const STOP = new Set([
  "the", "and", "for", "with", "from", "this", "that", "type", "interface", "function",
  "const", "class", "export", "import", "return", "async", "await", "new", "true", "false",
  "null", "undefined", "void", "string", "number", "boolean", "Promise", "default", "data",
  "Task", "Core", "Agent", "Mode", "Node", "State", "Item", "List", "Panel", "View",
]);

type Role = "archive" | "report" | "live";

const REPORT_DIRS = new Set([
  "analysis", "auditing", "audit", "reviews", "review", "inspection", "amendments", "superpowers",
]);

/** 归档语义的路径段：归档与备份目录描述的都是过去的状态，不进判定。 */
const ARCHIVED_SEGMENTS = new Set(["archive", "backup"]);

/** 按相对路径判定文档角色。 */
function roleOf(rel: string): Role {
  const segs = rel.split("/");
  if (segs.some((s) => ARCHIVED_SEGMENTS.has(s))) return "archive";
  const top = segs[0] ?? "";
  if (REPORT_DIRS.has(top)) return "report";
  return "live";
}

interface IdRecord {
  refs: number;
  byRole: Map<Role, number>;
  byFile: Map<string, number>;
}

const identifiers = new Map<string, IdRecord>();

function scanDocs(d: string, rel: string): void {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    const r = rel ? `${rel}/${f.name}` : f.name;
    if (f.isDirectory()) {
      scanDocs(p, r);
    } else if (f.name.endsWith(".md")) {
      const text = fs.readFileSync(p, "utf-8");
      const role = roleOf(r);
      for (const m of text.matchAll(/\b[A-Z][A-Za-z0-9_]{5,}\b/g)) {
        const id = m[0];
        if (STOP.has(id)) continue;
        let rec = identifiers.get(id);
        if (!rec) {
          rec = { refs: 0, byRole: new Map(), byFile: new Map() };
          identifiers.set(id, rec);
        }
        rec.refs += 1;
        rec.byRole.set(role, (rec.byRole.get(role) ?? 0) + 1);
        rec.byFile.set(r, (rec.byFile.get(r) ?? 0) + 1);
      }
    }
  }
}
scanDocs(DOCS_DIR, "");

// ─── 判定 ────────────────────────────────────────────────────

interface Drift {
  id: string;
  refs: number;
  liveRefs: number;
  /** 该标识符在活跃文档里出现最多的那一篇——归并分组用它，而不是全库最多的那篇 */
  primaryLiveFile: string;
  /** 全库出现最多的那一篇，仅作背景 */
  primaryFile: string;
}

const drift: Drift[] = [];
for (const [id, rec] of identifiers) {
  if (rec.refs < 3) continue;
  if (new RegExp(`\\b${id.toLowerCase()}\\b`).test(allSrc)) continue;

  let primaryFile = "";
  let primaryCount = -1;
  let primaryLiveFile = "";
  let primaryLiveCount = -1;
  for (const [f, n] of rec.byFile) {
    if (n > primaryCount) {
      primaryCount = n;
      primaryFile = f;
    }
    if (roleOf(f) === "live" && n > primaryLiveCount) {
      primaryLiveCount = n;
      primaryLiveFile = f;
    }
  }
  drift.push({
    id,
    refs: rec.refs,
    liveRefs: rec.byRole.get("live") ?? 0,
    primaryLiveFile,
    primaryFile,
  });
}
drift.sort((a, b) => b.refs - a.refs);

const liveDrift = drift.filter((d) => d.liveRefs > 0);

// ─── 输出 ────────────────────────────────────────────────────

if (jsonMode) {
  const byFile = new Map<string, string[]>();
  for (const d of liveDrift) {
    const list = byFile.get(d.primaryLiveFile) ?? [];
    list.push(d.id);
    byFile.set(d.primaryLiveFile, list);
  }
  console.log(JSON.stringify({
    identifiersScanned: identifiers.size,
    driftTotal: drift.length,
    liveDrift: liveDrift.length,
    strict,
    byFile: Object.fromEntries(byFile),
    drift,
  }));
  process.exit(strict && liveDrift.length > 0 ? 1 : 0);
}

console.log(`\n[doc-drift] 扫描标识符 ${identifiers.size} 个；缺失（refs>=3）${drift.length} 条`);
console.log(`[doc-drift]   其中出现在活跃文档的：${liveDrift.length} 条`);
console.log("[doc-drift] 说明：这是盘点不是门禁。归档/报告类文档不进判定（默认 exit 0，--strict 才阻断）。\n");

if (liveDrift.length === 0) {
  console.log("[doc-drift] 活跃文档口径干净。\n");
  process.exit(0);
}

const byFile = new Map<string, Drift[]>();
for (const d of liveDrift) {
  const list = byFile.get(d.primaryLiveFile) ?? [];
  list.push(d);
  byFile.set(d.primaryLiveFile, list);
}

console.log("[doc-drift] 活跃文档里提到、源码中缺失的标识符（按所属**活跃**文档归并）：\n");
for (const [file, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${file}  (${list.length})`);
  console.log(`     ${list.map((d) => `${d.id}[${d.refs}]`).join(", ")}\n`);
}

console.log("[doc-drift] 判断提示：落在「设计/提案」文档里的属前瞻设计，不是失修；");
console.log("[doc-drift]           落在当前态文档（如 core/full-flow-map.md）里的才值得追。\n");

if (strict) {
  console.log(`[doc-drift] --strict：活跃口径存在 ${liveDrift.length} 条缺失 → exit 1\n`);
  process.exit(1);
}
process.exit(0);
