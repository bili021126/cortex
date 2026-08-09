#!/usr/bin/env npx tsx
/**
 * scripts/doc-drift-check.ts — M3 doc drift check.
 * Compare identifiers referenced in docs/ against packages src existence.
 * Usage: npx tsx scripts/doc-drift-check.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const DOCS_DIR = path.join(ROOT, "docs");
const PKG_DIR = path.join(ROOT, "packages");

const srcText = new Set<string>();
for (const p of fs.readdirSync(PKG_DIR)) {
  const base = path.join(PKG_DIR, p, "src");
  if (fs.existsSync(base)) walk(base);
}
function walk(d: string): void {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith(".ts")) srcText.add(fs.readFileSync(p, "utf-8"));
  }
}
const allSrc = [...srcText].join("\n").toLowerCase();

const STOP = new Set([
  "the", "and", "for", "with", "from", "this", "that", "type", "interface", "function",
  "const", "class", "export", "import", "return", "async", "await", "new", "true", "false",
  "null", "undefined", "void", "string", "number", "boolean", "Promise", "default", "data",
  "Task", "Core", "Agent", "Mode", "Node", "State", "Item", "List", "Panel", "View",
]);
const identifiers = new Map<string, number>();
function scanDocs(d: string): void {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) scanDocs(p);
    else if (f.name.endsWith(".md")) {
      const text = fs.readFileSync(p, "utf-8");
      for (const m of text.matchAll(/\b[A-Z][A-Za-z0-9_]{5,}\b/g)) {
        const id = m[0];
        if (!STOP.has(id)) identifiers.set(id, (identifiers.get(id) ?? 0) + 1);
      }
    }
  }
}
scanDocs(DOCS_DIR);

const drift: Array<{ id: string; refs: number }> = [];
for (const [id, refs] of [...identifiers.entries()].sort((a, b) => b[1] - a[1])) {
  if (refs < 3) continue;
  if (!new RegExp(`\\b${id.toLowerCase()}\\b`).test(allSrc)) drift.push({ id, refs });
}

// --report 模式：不阻塞（exit 0）——只输出报告（CI 每周/提交时留档）
const reportOnly = process.argv.includes("--report");

console.log(`\n[doc-drift] docs identifiers=${identifiers.size} checked\n`);
if (drift.length === 0) {
  console.log("[doc-drift] OK - no drift\n");
  process.exit(0);
}
console.log(`[doc-drift] ${drift.length} drift identifiers (refs>=3, missing in code):\n`);
for (const d of drift) {
  console.log(`  MISS ${d.id.padEnd(40)} refs=${d.refs}`);
}
if (reportOnly) {
  console.log("\n(report mode - non-blocking)\n");
  process.exit(0);
}
console.log("\n(note: may be forward-design or deprecated symbols - manual check)\n");
process.exit(1);
