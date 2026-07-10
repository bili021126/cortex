/**
 * @e2e: budget-cap-e2e
 * @covers: 自审视预算熔断（maxTokens 限制）
 * @cost: ~0.3元/次
 * @overlap: self-exam-soft
 *
 * 验证 self-exam-soft.ts 的 1M token 硬限设计是否有效。
 * 设 SELF_EXAM_MAX_TOKENS=50000 模拟低预算场景，验证提前终止不崩。
 *
 * 用法: set SELF_EXAM_MAX_TOKENS=50000 && npx tsx packages/engine/tests/manual/e2e/budget-cap-e2e.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY, DEEPSEEK_CYRENE_KEY
 */

import { execSync } from "node:child_process";

const t0 = Date.now();

// 以超低预算运行自审视——self-exam-soft 内部通过 process.env.SELF_EXAM_MAX_TOKENS 读取
const result = execSync(
  `set SELF_EXAM_MAX_TOKENS=50000 && npx tsx packages/engine/tests/manual/e2e/self-exam-soft.ts`,
  { encoding: "utf-8", timeout: 300000, cwd: "d:/cortex", shell: "cmd.exe" }
);

const elapsed = ((Date.now() - t0) / 1000).toFixed(0);

// 验证三点：
// 1. 不崩溃（exit code 0）——execSync 无异常即满足
// 2. 输出包含 budget exhausted 或预算耗尽提示
// 3. 没有未捕获异常 / crash 字样

const hasBudgetEnd = result.includes("budget") || result.includes("预算");
const noCrash = !result.includes("Uncaught") && !result.includes("crash") && !result.includes("未捕获");

const passed = hasBudgetEnd && noCrash;

if (passed) {
  console.log(`✅ budget-cap: 熔断生效，无崩溃 (⏱ ${elapsed}s)`);
} else {
  console.log(`❌ budget-cap: 异常 (⏱ ${elapsed}s)`);
  if (!noCrash) console.log("  发现崩溃迹象");
  if (!hasBudgetEnd) console.log("  未检测到预算耗尽提示（可能未触发熔断）");
  console.log("── 末尾 500 chars ──");
  console.log(result.slice(-500));
}
