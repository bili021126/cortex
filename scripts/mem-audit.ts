/**
 * scripts/mem-audit.ts — 记忆库悬空审计（M1：auditMemoryStore 接线）
 *
 * 将 @cortex/memory 的 cyrene 记忆审计从"零调用死代码"接入可执行入口。
 * 用法：npx tsx scripts/mem-audit.ts [dbPath]
 * 默认 dbPath：<workspaceRoot>/.cortex/memory.db
 */
import { auditMemoryFile, summarizeMemoryAudit } from "@cortex/memory";
import { readFileSync } from "node:fs";
import * as path from "node:path";

const dbPath = process.argv[2] ?? path.join(process.cwd(), ".cortex", "memory.db");

async function main(): Promise<void> {
  console.log(`🔍 记忆库审计: ${dbPath}`);
  const result = auditMemoryFile(dbPath, { readFileSync });
  const summary = summarizeMemoryAudit(result.findings);
  console.log(summary);
  // 悬空引用（孤儿条目/断裂链接）为问题信号——退出码暴露
  process.exit(result.findings.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[mem-audit] 执行失败:", err instanceof Error ? err.message : String(err));
  process.exit(2);
});
