import { MemoryStore } from "../packages/engine/dist/memory/memory-store.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "..", ".cortex", "cyrene-memory.db");

const store = new MemoryStore();
await store.init(dbPath);

const entries = await store.read({ keywords: ["宪法"], limit: 20, queryMode: "hca", includePrivate: true });

console.log("=== CLI 昔涟记忆库 — 宪法条目 ===\n");
for (const e of entries) {
  console.log(`w:${e.weight}  [${e.id.slice(0, 8)}]  ${e.summary}`);
}
console.log(`\n匹配 "宪法" 的记忆: ${entries.length} 条`);

const all = await store.read({ limit: 0, queryMode: "hca", includePrivate: true });
console.log(`记忆库总量: ${all.length} 条`);

await store.close();
