/**
 * scripts/verify/cli-frozen.ts — CLI 冻结边界守护（D3）
 *
 * CLI 包冻结声明（2026-08-06）：daemon 唯一宿主，CLI 内嵌 engine 第二宿主
 * 路径已冻结——仅安全修复。本脚本把声明实体化：
 *   - packages/cli/src 有未提交/最近提交变更 → 需显式 CORTEX_ALLOW_CLI_CHANGES=true
 *     （声明"此为经审查的安全修复"），否则 exit 1 阻断。
 *   - packages/cli/tests 永远允许（测试不是运行时代码，门禁合规优先）。
 *
 * 用法：npx tsx scripts/verify/cli-frozen.ts（ci.yml 中作为独立门禁步骤）
 */
import { execFileSync } from "node:child_process";

const ALLOW = process.env["CORTEX_ALLOW_CLI_CHANGES"] === "true";

function changedCliSrcFiles(): string[] {
  try {
    const diff = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "packages/cli/src"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return diff.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    // 非 git 环境（如 CI 的干净 checkout 无未提交变更）——HEAD 对比为空即无变更
    return [];
  }
}

const changed = changedCliSrcFiles();
if (changed.length === 0) {
  console.log("✅ [cli-frozen] packages/cli/src 无变更——冻结边界保持");
  process.exit(0);
}

if (ALLOW) {
  console.log(`⚠️ [cli-frozen] 检测到 cli/src 变更（${changed.length} 文件），已获 CORTEX_ALLOW_CLI_CHANGES 显式授权`);
  console.log(changed.map((f) => `   ${f}`).join("\n"));
  process.exit(0);
}

console.error(`❌ [cli-frozen] packages/cli/src 存在 ${changed.length} 个变更文件——CLI 已冻结（2026-08-06，仅安全修复）：`);
console.error(changed.map((f) => `   ${f}`).join("\n"));
console.error("   如确认是经审查的安全修复，设置 CORTEX_ALLOW_CLI_CHANGES=true 显式授权；否则应避免触碰冻结面。");
process.exit(1);
