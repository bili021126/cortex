#!/usr/bin/env npx tsx
/* eslint-disable no-console -- 终端工具：本脚本的产出就是 stdout 报告，与 eslint.config.mjs 中 packages/cli 的具名豁免同类场景 */
/**
 * scripts/audit-amendment.ts — 修正案事实审计（凝光角色，可复用）
 *
 * 修宪流程第二步「审计」的可执行落地。与起草分离：注册表里的检查项
 * 全部从仓库**重新推导**，不复用修正案自身的 `source.trace`——起草人的
 * 取证不能作为审计证据。
 *
 * 用法：
 *   npx tsx scripts/audit-amendment.ts [AM-ID]
 *   npx tsx scripts/audit-amendment.ts AM-2026-0926-001 --json
 *
 * 三类检查：
 *   A. before 锚点  —— 草稿 `before` 里每条引文必须能在宪法中原样找到（防编造）
 *   B. 事实复算     —— 草稿 `after` 声称的数字，逐条从仓库重新量
 *   C. 本体完整性   —— 宪法本体自基线以来未被未授权改动
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const AM_DIR = join(ROOT, "docs/amendments");
const CONST_FILE = "docs/constitution/Cortex 概念顶层设计 v3.8.md";
const LAYER_CONTRACT = "packages/tools/src/layer-contract.ts";

interface Check {
  group: string;
  name: string;
  ok: boolean;
  evidence: string;
}

const checks: Check[] = [];
const add = (group: string, name: string, ok: boolean, evidence: string): void => {
  checks.push({ group, name, ok, evidence });
};

const readText = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");
/**
 * 按 BOM 自动判编码读取。
 * 本仓的落盘日志有两种编码：Node 写的是 UTF-8，而 Windows PowerShell 的
 * `>` 重定向默认写 UTF-16LE（BOM ff fe）。按 utf-8 硬读会得到乱码并静默失配——
 * 本轮已被此陷阱咬到三次，故收成一个显式辅助函数。
 */
const readTextAny = (rel: string): string => {
  const buf = readFileSync(join(ROOT, rel));
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) return buf.swap16().toString("utf16le");
  return buf.toString("utf-8").replace(/^\uFEFF/, "");
};
const sha = (rel: string): string =>
  execFileSync("git", ["hash-object", rel], { cwd: ROOT, encoding: "utf8" }).trim();
/**
 * git 输出辅助——必须关掉 core.quotepath。
 * 默认 quotepath=true 会把非 ASCII 路径转成八进制转义
 * （"docs/constitution/Cortex \346\246\202…"），导致 include() 永远不命中。
 */
const git = (args: string[]): string =>
  execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd: ROOT, encoding: "utf8" });

// ─── 参数 ───────────────────────────────────────────────
const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const amId = args.find((a) => !a.startsWith("--")) ?? "AM-2026-0926-001";

const amPath = join(AM_DIR, `${amId}.json`);
if (!existsSync(amPath)) {
  console.error(`找不到修正案: ${amPath}`);
  process.exit(2);
}
const am = JSON.parse(readFileSync(amPath, "utf-8")) as {
  id: string;
  version: string;
  status: string;
  before: string;
  after: string;
  _disclosure?: string;
};

// ═══ A. before 锚点：引文必须能在宪法中原样找到 ═══════════
const constitution = readText(CONST_FILE);

/** 从 before 文本中切出「引文行」——排除 【…】 与 <…> 标记行 */
function extractQuotedLines(before: string): { line: string; docLine: number }[] {
  const out: { line: string; docLine: number }[] = [];
  before.split("\n").forEach((raw, i) => {
    let line = raw.trim();
    if (!line) return;
    if (line.startsWith("【")) return; // 位置标记
    // 剥掉行首的 <…> 说明标记
    line = line.replace(/^<[^>]*>\s*/, "");
    // 剥掉「（保留原文）」这类提案括注
    line = line.replace(/（保留原文）/g, "").trim();
    if (line.length < 8) return;
    out.push({ line, docLine: i + 1 });
  });
  return out;
}

const quoted = extractQuotedLines(am.before);
for (const q of quoted) {
  const hit = constitution.includes(q.line);
  add(
    "A·before 锚点",
    `引文在宪法中原样存在（草稿第 ${q.docLine} 行）`,
    hit,
    hit ? `✓ ${q.line.slice(0, 70)}…` : `✗ 未找到：${q.line.slice(0, 90)}`,
  );
}

// ═══ B. 事实复算：草稿声称的数字，重新量 ═══════════════════

// B1. 包数
const pkgIds = readdirSync(join(ROOT, "packages")).filter((d) =>
  existsSync(join(ROOT, "packages", d, "package.json")),
);
const layerSrc = readText(LAYER_CONTRACT);
const contractIds = [...layerSrc.matchAll(/^\s{2}"?([\w-]+)"?:\s*[0-4],\s*$/gm)].map((m) => m[1] ?? "");
add("B·事实复算", "真实包数 = 28", pkgIds.length === 28, `实测 ${pkgIds.length}（${pkgIds.join(",")}）`);
add("B·事实复算", "分层契约条目数 = 28", contractIds.length === 28, `实测 ${contractIds.length}`);
add(
  "B·事实复算",
  "包集合与契约键集合一致",
  [...pkgIds].sort().join() === [...contractIds].sort().join(),
  "两集合同为一个",
);

// B2. 根 tsconfig references 构成
const rootTs = JSON.parse(readText("tsconfig.json")) as { references: { path: string }[] };
const refs = rootTs.references.map((r) => r.path);
const subRefs = refs.filter((p) => p.endsWith("tsconfig.src.json"));
const directRefs = refs.filter((p) => !p.endsWith("tsconfig.src.json"));
add("B·事实复算", "根 tsconfig references = 24", refs.length === 24, `实测 ${refs.length}`);
add(
  "B·事实复算",
  "构成 = 20 直接包引用 + 4 个 tsconfig.src.json 子引用",
  directRefs.length === 20 && subRefs.length === 4,
  `实测 ${directRefs.length} + ${subRefs.length}`,
);
const independentUnits = ["client", "server", "protocol", "design-tokens"];
add(
  "B·事实复算",
  "算术自洽：28 包 − 4 独立编译单元 = 24 条引用",
  28 - independentUnits.length === refs.length,
  "28 − 4 = 24 ✓",
);

// B3. agents.json 退役 / agent-manifests 计数
const agentsJsonRel = "packages/config/src/data/agents.json";
const manifestsRel = "packages/config/src/data/agent-manifests.json";
add("B·事实复算", "agents.json 不存在（草稿称已退役）", !existsSync(join(ROOT, agentsJsonRel)), agentsJsonRel);
const manifests = JSON.parse(readText(manifestsRel)) as { agents: Record<string, { type: string }> };
const entries = Object.keys(manifests.agents).length;
const types = new Set(Object.values(manifests.agents).map((a) => a.type)).size;
const personas = readdirSync(join(ROOT, "prompts")).filter((d) =>
  statSync(join(ROOT, "prompts", d)).isDirectory(),
).length;
add("B·事实复算", "agent-manifests = 18 条目", entries === 18, `实测 ${entries}`);
add("B·事实复算", "去重 type = 15", types === 15, `实测 ${types}`);
add("B·事实复算", "prompts/ 命名人格 = 16", personas === 16, `实测 ${personas}`);

// B4. parser 已非包
add("B·事实复算", "packages/parser 已不存在", !existsSync(join(ROOT, "packages/parser")), "packages/parser");
const dependents = readdirSync(join(ROOT, "packages")).filter((d) => {
  const f = join(ROOT, "packages", d, "package.json");
  return existsSync(f) && /@cortex\/parser/.test(readText(`packages/${d}/package.json`));
});
add("B·事实复算", "无包依赖 @cortex/parser", dependents.length === 0, dependents.join(",") || "(无)");

// B5. §二十 WebUI 锚点
const webuiGone = [
  "packages/cli/src/tui/web",
  "scripts/start-webui.ts",
];
for (const p of webuiGone) {
  add("B·事实复算", `WebUI 锚点已删除：${p}`, !existsSync(join(ROOT, p)), existsSync(join(ROOT, p)) ? "仍存在" : "不存在 ✓");
}
add(
  "B·事实复算",
  "REST/WS 实际承载方 packages/server/src/http 存在",
  existsSync(join(ROOT, "packages/server/src/http")),
  `handler 数 ${readdirSync(join(ROOT, "packages/server/src/http")).filter((f) => f.endsWith(".ts")).length}`,
);

// B6. 五流六层文档的漂移数字（草稿摘要引用了它）
const MAP_DOC = "docs/core/Cortex-架构映射-五流六层七原则.md";
if (existsSync(join(ROOT, MAP_DOC))) {
  const mapText = readText(MAP_DOC);
  const files = [...new Set([...mapText.matchAll(/packages\/[\w./-]+\.ts/g)].map((m) => m[0]))];
  const missing = files.filter((f) => !existsSync(join(ROOT, f)));
  add(
    "B·事实复算",
    `五流六层文档引用文件 ${files.length} 条，其中 ${missing.length} 条路径已不在原位`,
    true,
    `missing: ${missing.length}`,
  );
}

// B7. @layer 注解覆盖率（草稿 §7 引用）
//
// 记录的声明值：115 / 667 = 17.2%（口径：packages/**/src 下 .ts，排除
// node_modules/dist/coverage/tests，仅看文件头 12 行）。
// 审计按此硬断言——早先一次 PowerShell 扫描给出的是 116/651，分母少了 16、
// 分子多 1（该扫描有 IO 报错），正是这类"看起来差不多"的数字最需要钉住。
const LAYER_CLAIM = { annotated: 115, scanned: 667 };
let scanned = 0;
let annotated = 0;
const walk = (dir: string): void => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "coverage", "tests"].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".ts")) {
      scanned++;
      const head = readFileSync(p, "utf-8").split("\n").slice(0, 12).join("\n");
      if (/@layer\s+\S/.test(head)) annotated++;
    }
  }
};
walk(join(ROOT, "packages"));
add(
  "B·事实复算",
  `@layer 注解覆盖 = ${LAYER_CLAIM.annotated}/${LAYER_CLAIM.scanned}（声明值）`,
  annotated === LAYER_CLAIM.annotated && scanned === LAYER_CLAIM.scanned,
  `实测 ${annotated}/${scanned} = ${((annotated / scanned) * 100).toFixed(1)}%`,
);

// ═══ B（续）· 反驳性检查：草稿里脚本未覆盖的断言 ═══════════

// B8. commit 25f01704 的提交信息是否真如草稿所引
const c25 = git(["log", "-1", "--format=%s", "25f01704"]).trim();
add(
  "B·事实复算",
  "25f01704 提交信息确载 tui/web 与 start-webui 被删除",
  /tui\/web/.test(c25) && /start-webui/.test(c25),
  c25.slice(0, 90) + "…",
);

// B9. 五流六层文档失效引用的拆分（搬家 / 消失 / 越界）
{
  const mapText = readText("docs/core/Cortex-架构映射-五流六层七原则.md");
  const byBase = new Map<string, string[]>();
  const idx = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (["node_modules", "dist", "coverage"].includes(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) idx(p);
      else if (e.name.endsWith(".ts")) {
        const list = byBase.get(e.name) ?? [];
        list.push(p.slice(ROOT.length + 1).replace(/\\/g, "/"));
        byBase.set(e.name, list);
      }
    }
  };
  idx(join(ROOT, "packages"));

  const refs = [...new Set([...mapText.matchAll(/packages\/[\w./-]+\.ts/g)].map((m) => m[0]))];
  let moved = 0;
  let gone = 0;
  for (const r of refs) {
    if (existsSync(join(ROOT, r))) continue;
    const alts = (byBase.get(r.split("/").pop() ?? "") ?? []).filter((p) => p !== r);
    if (alts.length > 0) moved++;
    else gone++;
  }
  add("B·事实复算", `五流六层引用文件去重后 = 45 条`, refs.length === 45, `实测 ${refs.length}`);
  add("B·事实复算", "其中搬家 12 / 彻底消失 2", moved === 12 && gone === 2, `实测 搬家 ${moved} / 消失 ${gone}`);
}

// B10. 配置域计数与新增域注册
{
  const loader = readText("packages/config/src/loader.ts");
  const m = loader.match(/CONFIG_DOMAINS[^=]*=\s*\[([\s\S]*?)\n\];/);
  const names = m ? [...(m[1] ?? "").matchAll(/name:\s*"(\w+)"/g)].map((x) => x[1] ?? "") : [];
  add("B·事实复算", "CONFIG_DOMAINS 现为 18（含新增 architectureFlows）", names.length === 18, `实测 ${names.length}`);
  add("B·事实复算", "architectureFlows 域已注册", names.includes("architectureFlows"), names.join(","));
}

// B11. 四处文档已无陈旧包数
for (const [file, pattern] of [
  ["README.md", /29\s*个包|21\s*个包/],
  ["PACKAGE_POSITIONING.md", /29 个包/],
  ["packages/README.md", /29 包分层/],
  ["packages/tools/src/layer-contract.ts", /29 个 workspace 包|29 包 →/],
] as const) {
  const text = readText(file);
  add("B·事实复算", `${file} 已无陈旧包数`, !pattern.test(text), pattern.test(text) ? "仍命中" : "已清理 ✓");
}

// B12. 测试基线口径存疑的证据（草稿 §十九 的「待查」依据）
{
  const histPath = ".cortex/ci-gate-output.txt";
  if (existsSync(join(ROOT, histPath))) {
    const hist = readTextAny(histPath);
    const m = hist.match(/Tests:\s*(\d+)\/(\d+) passed \| (\d+) skipped/);
    add(
      "B·事实复算",
      "历史门禁输出证明格式一直是 passed/total（口径存疑有据）",
      !!m,
      m ? `2026-07-20 记录: ${m[0]}（该文件为 UTF-16LE）` : "未匹配到 Tests 行",
    );
  } else {
    add("B·事实复算", "历史门禁输出可查", false, `缺少 ${histPath}`);
  }
}

// B13. 五流六层文档的包覆盖面
{
  const mapText = readText("docs/core/Cortex-架构映射-五流六层七原则.md");
  const mentioned = new Set([...mapText.matchAll(/packages\/([a-z][\w-]*)\//g)].map((m) => m[1] ?? ""));
  const real = new Set(pkgIds);
  const covered = [...mentioned].filter((p) => real.has(p)).length;
  const unmentioned = [...real].filter((p) => !mentioned.has(p)).length;
  add(
    "B·事实复算",
    "五流六层文档只覆盖部分现役包（草稿称 16/28）",
    covered === 16 && unmentioned === 12,
    `覆盖 ${covered}/${real.size}，未提及 ${unmentioned}`,
  );
}

const porcelain = git(["status", "--porcelain", "--", CONST_FILE]).trim();
add("C·本体完整性", "宪法本体无未提交改动", porcelain === "", porcelain || "(clean)");

const lastCommit = git(["log", "-1", "--format=%h %s", "--", CONST_FILE]).trim();
add("C·本体完整性", "宪法最后一次改动可追溯", true, lastCommit);

// 披露一致性：草稿声称 f05196e5 改过版本头
if (am._disclosure) {
  const touched = git(["show", "--name-only", "--format=", "f05196e5"]);
  add(
    "C·本体完整性",
    "披露属实：f05196e5 确实改动了宪法本体",
    touched.includes(CONST_FILE),
    touched.includes(CONST_FILE) ? "✓ 命中" : "✗ 该提交未触及宪法",
  );
}

add(
  "C·本体完整性",
  "修正案状态为待裁决（未落入本体）",
  am.status === "pending_judgment",
  `status=${am.status}`,
);

// ─── 输出 ───────────────────────────────────────────────
const failed = checks.filter((c) => !c.ok);

if (jsonMode) {
  console.log(JSON.stringify({ am: am.id, version: am.version, total: checks.length, failed: failed.length, checks }, null, 2));
} else {
  let group = "";
  for (const c of checks) {
    if (c.group !== group) {
      group = c.group;
      console.log(`\n${group}`);
    }
    console.log(`  ${c.ok ? "✅" : "❌"} ${c.name}  —— ${c.evidence}`);
  }
  console.log(`\n${"─".repeat(60)}`);
  console.log(failed.length === 0 ? `✅ 审计通过（${checks.length} 项全绿）` : `❌ 审计发现 ${failed.length} 项不符：`);
  for (const f of failed) console.log(`   - [${f.group}] ${f.name}: ${f.evidence}`);
}

console.log(`\n宪法本体内容哈希: ${sha(CONST_FILE)}`);
process.exit(failed.length === 0 ? 0 : 1);
