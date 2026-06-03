import Database from "better-sqlite3";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "..", ".cortex", "cyrene-memory.db");
const db = new Database(dbPath);

console.log("=== 宪法条文 ===\n");
const constitution = db.prepare(
  "SELECT summary, weight FROM memories WHERE summary LIKE @p1 OR summary LIKE @p2 ORDER BY summary"
).all({ p1: "%宪法%", p2: "%总纲%" }) as any[];
constitution.forEach((r: any) => console.log(`w:${r.weight}  ${r.summary}`));

console.log(`\n宪法相关: ${constitution.length} 条`);

console.log("\n=== 全量统计 ===\n");
const all = db.prepare("SELECT COUNT(*) as cnt FROM memories").get() as any;
console.log(`总计: ${all.cnt} 条记忆`);

const byCategory = db.prepare(
  "SELECT json_extract(content, '$.category') as cat, COUNT(*) as cnt FROM memories GROUP BY cat ORDER BY cnt DESC"
).all() as any[];
console.log("\n按分类:");
byCategory.forEach((r: any) => console.log(`  ${r.cat || "(none)"}: ${r.cnt}`));

db.close();
