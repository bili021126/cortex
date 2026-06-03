/**
 * 行级修复：为 memory-store.test.ts 中所有 write() 调用补充 semantic_gist + content_hash
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const filePath = join(import.meta.dirname!, "..", "packages", "engine", "tests", "memory-store.test.ts");
const lines = readFileSync(filePath, "utf-8").split("\n");
const result: string[] = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();

  result.push(line);

  // 检测 summary: "..." 行（在 write() 调用中）
  const m = trimmed.match(/^summary:\s*"([^"]*)",?$/);
  if (m) {
    const summaryText = m[1];
    const indent = line.match(/^(\s*)/)?.[1] ?? "      ";

    // 如果下一行已经是 semantic_gist，跳过
    const nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : "";
    if (nextLine.startsWith("semantic_gist:")) continue;

    // 插入 semantic_gist 和 content_hash
    result.push(`${indent}semantic_gist: "${summaryText}",`);
    result.push(`${indent}content_hash: "",`);
  }
}

writeFileSync(filePath, result.join("\n"), "utf-8");
console.log("Fixed memory-store.test.ts (insert semantic_gist + content_hash)");
