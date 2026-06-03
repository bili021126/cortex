/**
 * 最终修复：核心测试文件中残余的 semantic_gist/content_hash/queryMode/memoryTypes/metadataFilter
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const testDir = join(import.meta.dirname!, "..", "packages", "engine", "tests");
const targets = [
  "memory-concurrency.test.ts",
  "memory-pipeline.test.ts",
  "memory-store-lifecycle.test.ts",
  "memory-store-save.test.ts",
  "system-stress.test.ts",
];

for (const name of targets) {
  const path = join(testDir, name);
  let c = readFileSync(path, "utf-8");
  const orig = c;

  // Add semantic_gist + content_hash after summary lines
  const lines = c.split("\n");
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    result.push(line);
    const m = trimmed.match(/^summary:\s*"([^"]*)",?$/);
    if (m) {
      const summaryText = m[1];
      const indent = line.match(/^(\s*)/)?.[1] ?? "      ";
      const nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : "";
      // Always add semantic_gist + content_hash if next line isn't already semantic_gist
      if (nextLine.startsWith("semantic_gist:")) continue;
      result.push(`${indent}semantic_gist: "${summaryText}",`);
      result.push(`${indent}content_hash: "",`);
    }
  }
  c = result.join("\n");

  // memoryTypes → kind
  c = c.replace(/\bmemoryTypes:\s*\["[^"]*"[^\]]*\]/g, "// memoryTypes removed in v3");

  // queryMode → remove
  c = c.replace(/,\s*queryMode:\s*"[^"]*"/g, "");
  c = c.replace(/queryMode:\s*"[^"]*",?\s*/g, "");

  // metadataFilter in write() → remove (not in MemoryWriteInput)
  c = c.replace(/,\s*metadataFilter:\s*\{[^}]*\}/g, "");
  c = c.replace(/metadataFilter:\s*\{[^}]*\},?\s*/g, "");

  if (c !== orig) {
    writeFileSync(path, c, "utf-8");
    console.log("Fixed:", name);
  }
}
