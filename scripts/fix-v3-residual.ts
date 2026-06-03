/**
 * 综合修复所有 v3 测试残留错误
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
      if (!entry.startsWith(".") && entry !== "node_modules") results.push(...walk(full));
    } else if (extname(entry) === ".ts") results.push(full);
  }
  return results;
}

function fixFile(path: string): boolean {
  let c = readFileSync(path, "utf-8");
  const orig = c;
  const name = path.replace(/\\/g, "/").split("/tests/").pop() || path;

  // ── 修复 1: 移除 AmendmentProposal 中误注入的 semantic_gist / content_hash ──
  if (name.includes("amendment") || name.includes("governance-loop")) {
    c = c.replace(/    semantic_gist: ".*",\n    content_hash: "",\n/g, "");
  }

  // ── 修复 2: metadata → metadataFilter (在 write() 调用中) ──
  if (name.includes("calculator-e2e") || name.includes("self-examination") || name.includes("self-fix") || name.includes("memory-store-save")) {
    c = c.replace(/\bmetadata:\s*\{/g, "metadataFilter: {");
  }

  // ── 修复 3: subType 属性访问 → cast 为 any (solo-flight) ──
  if (name.includes("solo-flight")) {
    c = c.replace(/\.subType\b/g, "(entry as any).subType");
    c = c.replace(/memoryType:\s*MemoryType\./g, "kind: ");
    c = c.replace(/\{ memoryType:/g, "{ kind:");
  }

  // ── 修复 4: memoryType → kind (roundtable, self-examination) ──
  c = c.replace(/\bmemoryType:\s*(MemoryKind|any|"[^"]*")/g, (m, val) => `kind: ${val}`);
  c = c.replace(/\bmemoryType:\s*MemoryType\./g, "kind: ");

  // ── 修复 5: roundtable-config.ts 中缺少 source/semantic_gist/content_hash ──
  if (name.includes("roundtable-config")) {
    c = c.replace(/memoryType:/g, "kind:");
  }

  if (c !== orig) {
    writeFileSync(path, c, "utf-8");
    return true;
  }
  return false;
}

const files = walk(testsDir);
let fixed = 0;
for (const f of files) {
  if (fixFile(f)) fixed++;
}
console.log(`Fixed ${fixed} files`);
