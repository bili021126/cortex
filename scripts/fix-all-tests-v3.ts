/**
 * 批量修复所有测试文件中 write() 调用缺失 semantic_gist + content_hash
 * 同时清理 subType / states / trackAccess / queryMode 等废弃字段
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testsDir = join(__dirname, "..", "packages", "engine", "tests");

function walk(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!entry.startsWith(".") && entry !== "node_modules") {
        results.push(...walk(full));
      }
    } else if (extname(entry) === ".ts") {
      results.push(full);
    }
  }
  return results;
}

function fixFile(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 跳过已经修复过的行
    const nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : "";

    // ── 修复 1: 移除 subType 属性 ──
    if (trimmed.startsWith("subType:") || trimmed === "subType,") {
      continue; // skip this line
    }

    // ── 修复 2: 移除 state 属性（在 MemoryEntry 对象字面量中）──
    if (trimmed.startsWith("state:") && !trimmed.includes("semantic_state")) {
      continue;
    }

    result.push(line);

    // ── 修复 3: 在 summary: "..." 后插入 semantic_gist + content_hash ──
    const m = trimmed.match(/^summary:\s*"([^"]*)",?$/);
    if (m) {
      const summaryText = m[1];
      const indent = line.match(/^(\s*)/)?.[1] ?? "      ";

      if (nextLine.startsWith("semantic_gist:")) continue;

      result.push(`${indent}semantic_gist: "${summaryText}",`);
      result.push(`${indent}content_hash: "",`);
    }
  }

  return result.join("\n");
}

// ── 第二遍：移除 states/trackAccess/queryMode ──
function fixQueryFields(content: string): string {
  return content
    // states
    .replace(/,\s*states:\s*\[.*?\]/g, "")
    .replace(/states:\s*\[.*?\],?\s*/g, "")
    // trackAccess
    .replace(/,\s*trackAccess:\s*(true|false)/g, "")
    .replace(/trackAccess:\s*(true|false),?\s*/g, "")
    // queryMode
    .replace(/,\s*queryMode:\s*"[^"]*"/g, "")
    .replace(/queryMode:\s*"[^"]*",?\s*/g, "")
    // includePrivate
    .replace(/,\s*includePrivate:\s*(true|false)/g, "")
    .replace(/includePrivate:\s*(true|false),?\s*/g, "")
    // MemoryState import cleanup
    .replace(/,\s*MemoryState\b/g, "")
    .replace(/\bMemoryState,\s*/g, "")
    // MemorySubType import cleanup
    .replace(/,\s*MemorySubType\b/g, "")
    .replace(/\bMemorySubType,\s*/g, "");
}

const files = walk(testsDir);
let fixed = 0;

for (const file of files) {
  let content = readFileSync(file, "utf-8");
  const original = content;

  content = fixFile(content);
  content = fixQueryFields(content);

  if (content !== original) {
    writeFileSync(file, content, "utf-8");
    fixed++;
  }
}

console.log(`Fixed ${fixed} test files`);
