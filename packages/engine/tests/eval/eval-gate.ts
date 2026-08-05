#!/usr/bin/env npx tsx
// ============================================================
// @cortex/engine/tests/eval/eval-gate —— 活性层门禁入口（v1）
//
// 加载 golden → 逐条执行 → 控制台打表 → 报告写 .cortex/eval-report.json
// report 模式 exit 恒 0（评分算法/L1-L3 门禁一概不建——以后数据够了再说）
// 用法：npx tsx packages/engine/tests/eval/eval-gate.ts [--golden=<path>]
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { runGoldenCase } from "./eval-runner.js";
import type { GoldenCase } from "./eval-types.js";

const GOLDEN_PATH = process.argv.find((a) => a.startsWith("--golden="))?.slice("--golden=".length)
  ?? path.join(import.meta.dirname, "golden", "liveness.json");
const REPORT_PATH = path.join(process.cwd(), ".cortex", "eval-report.json");

async function main(): Promise<void> {
  const goldens = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf-8")) as GoldenCase[];
  console.log(`\n🧪 活性层评测（${goldens.length} 条 golden——${GOLDEN_PATH}）\n`);

  const results = [];
  for (const g of goldens) {
    const r = await runGoldenCase(g);
    results.push(r);
    const mark = r.passed ? "✅" : "❌";
    console.log(`  ${mark} ${g.id.padEnd(24)} ${String(r.durationMs).padStart(5)}ms ${r.passed ? "" : `— ${r.error ?? "断言失败"}`}`);
    for (const a of r.asserts) {
      console.log(`      ${a.passed ? "✓" : "✗"} ${a.verb.padEnd(12)} ${a.eventType} — ${a.detail}`);
    }
    if (r.traceSummary.length > 0) {
      console.log(`      轨迹: ${r.traceSummary.join(" → ")}`);
    }
  }

  const passed = results.filter((r) => r.passed).length;
  console.log(`\n  结果: ${passed}/${results.length} 通过（by-design 视为通过）`);

  // 报告写盘（决策台账——审计不再翻旧账的可读部分）
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf-8");
  console.log(`  报告: ${REPORT_PATH}\n`);

  // report 模式 exit 恒 0
  process.exit(0);
}

main().catch((err) => {
  console.error("[eval-gate] 执行异常:", err);
  process.exit(1);
});
