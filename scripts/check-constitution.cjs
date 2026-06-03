const db = require("better-sqlite3")("./.cortex/cyrene-memory.db");

const r = db.prepare(
  "SELECT summary, weight FROM memories WHERE summary LIKE ? OR summary LIKE ? ORDER BY summary"
).all("%宪法%", "%总纲%");

console.log("=== 宪法条文 ===\n");
r.forEach((x) => console.log("w:" + x.weight + "  " + x.summary));
console.log("\n宪法相关: " + r.length + " 条");

const all = db.prepare("SELECT COUNT(*) AS cnt FROM memories").get();
console.log("\n总计: " + all.cnt + " 条记忆");

db.close();
