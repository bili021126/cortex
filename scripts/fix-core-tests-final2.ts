/**
 * 最终修复 v2：处理 backtick 模板字符串和其他边缘情况
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const testDir = join(import.meta.dirname!, "..", "packages", "engine", "tests");

function fixFile(name: string) {
  const path = join(testDir, name);
  let c = readFileSync(path, "utf-8");
  const orig = c;

  const lines = c.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    result.push(line);

    // Match summary: "..." or summary: `...`
    let m = trimmed.match(/^summary:\s*"([^"]*)",?$/);
    if (!m) m = trimmed.match(/^summary:\s*`([^`]*)`,?$/);
    if (m) {
      const summaryText = m[1];
      const indent = line.match(/^(\s*)/)?.[1] ?? "      ";
      const nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : "";
      if (nextLine.startsWith("semantic_gist:")) continue;
      // Escape backticks in template literal values
      const escaped = summaryText.replace(/`/g, "\\`");
      result.push(`${indent}semantic_gist: "${escaped}",`);
      result.push(`${indent}content_hash: "",`);
    }
  }
  c = result.join("\n");

  // queryMode
  c = c.replace(/,\s*queryMode:\s*"[^"]*"/g, "");
  c = c.replace(/queryMode:\s*"[^"]*",?\s*/g, "");

  // memoryTypes array
  c = c.replace(/\bmemoryTypes:\s*\[[^\]]*\],?\n/g, "");
  c = c.replace(/,\s*\bmemoryTypes:\s*\[[^\]]*\]/g, "");

  if (c !== orig) {
    writeFileSync(path, c, "utf-8");
    return true;
  }
  return false;
}

const targets = [
  "memory-concurrency.test.ts",
  "memory-pipeline.test.ts",
  "memory-store-lifecycle.test.ts",
  "system-stress.test.ts",
];

let fixed = 0;
for (const t of targets) {
  if (fixFile(t)) { fixed++; console.log("Fixed:", t); }
}
console.log(`Total: ${fixed} files`);
