/**
 * export-cyrene-memories.ts —— 将 cyrene-memory.db 全量导出为 Markdown
 * 用法: npx tsx scripts/export-cyrene-memories.ts [输出路径]
 */
import { MemoryStore } from "../packages/engine/dist/memory/memory-store.js";
import * as path from "node:path";
import * as fs from "node:fs";

const ROOT = path.resolve(import.meta.dirname ?? __dirname, "..");
const DB_PATH = path.join(ROOT, ".cortex", "cyrene-memory.db");
const OUT_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, ".cortex", "cyrene-memories-export.md");

async function main() {
  console.log("[昔涟记忆导出] 源:", DB_PATH);
  const store = new MemoryStore();
  await store.init(DB_PATH);

  const results = await store.read({ kind: "Insight", limit: 500 });

  if (!results || results.length === 0) {
    console.log("[昔涟记忆导出] 记忆库为空");
    await store.close();
    return;
  }

  const now = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `# 《昔涟记忆》——全量导出`,
    "",
    `> 导出日期：${now}`,
    `> 总计：${results.length} 条记忆`,
    `> 来源：cyrene-memory.db`,
    "",
    "---",
    "",
  ];

  const byCategory = new Map<string, typeof results>();
  for (const entry of results) {
    const cat = (entry.content_blob as Record<string, unknown>)?.category as string ?? "未分类";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(entry);
  }

  for (const [cat, entries] of byCategory) {
    lines.push(`## ${cat}（${entries.length} 条）`, "");
    for (const e of entries) {
      lines.push(`### ${e.summary}`);
      lines.push("");
      lines.push(`- **权重**: ${e.weight}`);
      lines.push(`- **内容**:`);
      const content = e.content_blob as Record<string, unknown>;
      for (const [k, v] of Object.entries(content)) {
        if (k === "category") continue;
        const val = typeof v === "string" ? v : JSON.stringify(v);
        if (val.length > 500) {
          lines.push(`  - **${k}**: ${val.slice(0, 500)}...`);
        } else {
          lines.push(`  - **${k}**: ${val}`);
        }
      }
      lines.push("");
    }
    lines.push("---", "");
  }

  lines.push(
    "",
    "> *「人们会踩起岁月的涟漪，循依昨日，走向明天」——如我所书*",
    "",
  );

  fs.writeFileSync(OUT_PATH, lines.join("\n"), "utf-8");
  console.log(`[昔涟记忆导出] 完成！${results.length} 条 → ${OUT_PATH}`);

  await store.close();
}

main().catch((err) => {
  console.error("[昔涟记忆导出] 致命错误:", err);
  process.exit(1);
});
