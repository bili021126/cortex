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
  // auditMemoryFile 的 fs 形参要求 (p: string, enc: string) => string，
  // 而 node:fs 的 readFileSync 是重载签名——直接传会因重载集不匹配报 TS2322。
  // 显式收窄到该契约（运行语义完全一致：恒以显式编码读文本）。
  const result = auditMemoryFile(dbPath, {
    readFileSync: (p: string, enc: string): string => readFileSync(p, enc as BufferEncoding),
  });
  const summary = summarizeMemoryAudit(result.findings);
  console.log(summary);
  // 悬空引用（孤儿条目/断裂链接）为问题信号——退出码暴露
  process.exit(result.findings.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[mem-audit] 执行失败:", err instanceof Error ? err.message : String(err));
  process.exit(2);
});
