/**
 * WebUI 计算器生成产物验证
 *
 * 用法: npx tsx tests/manual/webui-calculator-verify.ts
 *
 * 场景：不调 LLM，纯静态验证 E2E 测试生成的 webui/ 下所有文件的完整性与正确性。
 * 验证维度：
 *   1. 文件存在性 (index.html, calculator.js, README.md)
 *   2. HTML 元素约定 ID (#expression, #calculateBtn, #result)
 *   3. calculator.js 表达式求值正确性
 *   4. 文档内容完备性
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── 配置 ────────────────────────────────────────────────────────────────
const WORKSPACE = process.cwd();
const WEBUI_DIR = path.join(WORKSPACE, "projects", "calculator", "webui");

// 可选：从嵌套路径读取（Agent 可能写到 projects/calculator/projects/calculator/webui/）
const NESTED_WEBUI_DIR = path.join(
  WORKSPACE,
  "projects",
  "calculator",
  "projects",
  "calculator",
  "webui",
);

// ─── 工具函数 ────────────────────────────────────────────────────────────
function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function fileSize(filePath: string): number {
  return fs.statSync(filePath).size;
}

/** 从 calculator.js 提取 evaluate 函数并返回 */
function loadEvaluate(calcPath: string): (expr: string) => number {
  const src = readFile(calcPath);
  // calculator.js 是纯浏览器 JS，定义全局函数 evaluate / tokenize
  // 用 new Function 在当前作用域执行并捕获
  const ctx: Record<string, unknown> = {};
  new Function("ctx", src + ";\nctx.evaluate = evaluate;\nctx.tokenize = tokenize;")(ctx);
  if (typeof ctx.evaluate !== "function") {
    throw new Error("calculator.js 未定义 evaluate 函数");
  }
  return ctx.evaluate as (expr: string) => number;
}

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const results: CheckResult[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  const mark = pass ? "✅" : "❌";
  console.log(`   ${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ─── 主流程 ──────────────────────────────────────────────────────────────
console.log("╔══════════════════════════════════════════════════╗");
console.log("║   📋 WebUI 计算器 — 生成产物静态验证              ║");
console.log("╚══════════════════════════════════════════════════╝\n");

// 确定实际文件路径——优先找有 index.html + calculator.js 的目录
let webuiDir = WEBUI_DIR;
const hasFilesAt = (dir: string) =>
  fs.existsSync(path.join(dir, "index.html")) &&
  fs.existsSync(path.join(dir, "calculator.js"));

if (!hasFilesAt(webuiDir)) {
  if (hasFilesAt(NESTED_WEBUI_DIR)) {
    webuiDir = NESTED_WEBUI_DIR;
    console.log(`   ⚠️ 文件在嵌套路径: ${path.relative(WORKSPACE, webuiDir)}\n`);
  }
}

const indexPath = path.join(webuiDir, "index.html");
const calcPath = path.join(webuiDir, "calculator.js");
const readmePath = path.join(webuiDir, "README.md");
const auditPath = path.join(webuiDir, "audit-report.md");
const archPath = path.join(webuiDir, "architecture.md");

// ═══════════════════════════════════════════════════
// 1. 文件存在性
// ═══════════════════════════════════════════════════
console.log("── 1. 文件存在性 ──");
check("index.html", fileExists(indexPath));
check("calculator.js", fileExists(calcPath));
check("README.md", fileExists(readmePath));
check("audit-report.md", fileExists(auditPath));
check("architecture.md", fileExists(archPath));

if (fileExists(indexPath)) check("index.html 大小 ≥ 500B", fileSize(indexPath) >= 500);
if (fileExists(calcPath)) check("calculator.js 大小 ≥ 500B", fileSize(calcPath) >= 500);
if (fileExists(readmePath)) check("README.md 大小 ≥ 500B", fileSize(readmePath) >= 500);

if (!fileExists(indexPath) || !fileExists(calcPath)) {
  console.log("\n   ❌ 核心文件缺失，跳过后续验证。");
  printSummary();
  process.exit(1);
}

// ═══════════════════════════════════════════════════
// 2. HTML 元素约定 ID
// ═══════════════════════════════════════════════════
console.log("\n── 2. HTML 元素约定 ID ──");
const html = readFile(indexPath);
check("#expression 输入框", /id=["']expression["']/.test(html));
check("#calculateBtn 按钮", /id=["']calculateBtn["']/.test(html));
check("#result 结果区", /id=["']result["']/.test(html));
check("引用 calculator.js", /<script[^>]*src=["']calculator\.js["']/.test(html));
check("调用 evaluate 函数", /evaluate\s*\(/.test(html));
check("键盘 Enter 绑定", /key.*Enter|Enter.*key/.test(html));
check("错误处理 (catch)", /catch\s*\(/.test(html));

// ═══════════════════════════════════════════════════
// 3. calculator.js 表达式求值
// ═══════════════════════════════════════════════════
console.log("\n── 3. 表达式求值正确性 ──");
const evaluate = loadEvaluate(calcPath);

interface ExprCase {
  expr: string;
  expect: number | string; // string = 期望抛错的消息片段
}

const exprCases: ExprCase[] = [
  { expr: "2+3*4", expect: 14 },
  { expr: "(10-2)/4", expect: 2 },
  { expr: "1/0", expect: NaN },
  { expr: "3 + 4 * 2", expect: 11 },
  { expr: "(3 + 4) * 2", expect: 14 },
  { expr: "10 - -3", expect: 13 },
  { expr: "-5 + 3", expect: -2 },
  { expr: "2.5 * 4", expect: 10 },
  { expr: "((2+3)*4)", expect: 20 },
];

for (const { expr, expect } of exprCases) {
  try {
    const val = evaluate(expr);
    const pass = typeof expect === "number"
      ? (Number.isNaN(expect) ? Number.isNaN(val) : Math.abs(val - expect) < 1e-10)
      : false;
    check(`evaluate('${expr}') = ${expect}`, pass, pass ? undefined : `实际: ${val}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (typeof expect === "string" && msg.includes(expect)) {
      check(`evaluate('${expr}') 抛错: ${expect}`, true);
    } else {
      check(`evaluate('${expr}') = ${expect}`, false, `抛错: ${msg}`);
    }
  }
}

// 边界 & 异常
const errCases: [string, string][] = [
  ["", "Empty"],
  ["2 + a", "Unexpected"],
  ["(2+3", "Missing"],
  ["2++3", "Unexpected"],
];

for (const [expr, expectedMsg] of errCases) {
  try {
    evaluate(expr);
    check(`evaluate('${expr}') 应抛错`, false, "未抛错");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    check(`evaluate('${expr}') 抛错`, msg.includes(expectedMsg), `消息: ${msg}`);
  }
}

// 检查 tokenize 函数存在
const ctx: Record<string, unknown> = {};
new Function("ctx", readFile(calcPath) + ";\nctx.tokenize = tokenize;")(ctx);
check("tokenize 函数存在", typeof ctx.tokenize === "function");

// ═══════════════════════════════════════════════════
// 4. 文档内容完备性
// ═══════════════════════════════════════════════════
if (fileExists(readmePath)) {
  console.log("\n── 4. README 文档内容 ──");
  const readme = readFile(readmePath);
  check("项目标题 (#)", /^#\s+.+/m.test(readme));
  check("使用方法 / 快速开始", /用[法途]|快速|安装|打开/.test(readme));
  check("API 文档 / 签名", /evaluate|API/.test(readme));
  check("文件结构", /文件结[构图]|项目结构|目录/.test(readme));
  check("代码示例", /```/.test(readme));
  const wordCount = readme.replace(/\s/g, "").length;
  check("内容量 ≥ 200 字符", wordCount >= 200, `实际: ${wordCount}`);

  // 架构相关
  check("解析器类型说明", /递归|parser|解析|文法|grammar/i.test(readme), "递归下降/解析器架构");
}

if (fileExists(auditPath)) {
  console.log("\n── 5. audit-report.md ──");
  const audit = readFile(auditPath);
  check("审计标题", /审计|audit/i.test(audit));
  check("合规检查项", /规范|安全|标准|合规|检查/.test(audit));
  check("问题/建议列表", /问题|风险|建议|改进/.test(audit));
}

if (fileExists(archPath)) {
  console.log("\n── 6. architecture.md ──");
  const arch = readFile(archPath);
  check("架构标题", /架构|architecture/i.test(arch));
  check("模块划分", /模块|组件|component|module/i.test(arch));
  check("职责分离", /职责|层|layer|tier/i.test(arch));
  check("可扩展性评估", /扩展|演[进化]|未来|scal/i.test(arch));
}

// ═══════════════════════════════════════════════════
// 汇总
// ═══════════════════════════════════════════════════
printSummary();

function printSummary() {
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`   总计: ${passed}/${total} 通过`);

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.log(`   未通过:`);
    for (const f of failed) {
      console.log(`     ❌ ${f.name}${f.detail ? ` [${f.detail}]` : ""}`);
    }
  }
  console.log(`══════════════════════════════════════════════════`);

  if (passed === total) {
    console.log("\n   🎉 所有检查通过！产物质量合格。");
  }
  process.exit(failed.length > 0 ? 1 : 0);
}
