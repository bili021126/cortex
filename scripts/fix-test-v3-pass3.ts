/**
 * 第三轮修复：为 write() 调用补充 semantic_gist + content_hash
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!entry.startsWith(".") && entry !== "node_modules") results.push(...walkDir(full));
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
    
    // Remove: isPrivate, agentType (standalone), queryMode, memoryTypes, trackAccess, states, includePrivate
    if (/^\s*(isPrivate|queryMode|memoryTypes|trackAccess|states|includePrivate):/.test(line) && !line.includes("//")) {
      continue; // skip this line
    }
    
    // Replace: agentType: → skip (should be in source now)
    if (/^\s*agentType:\s/.test(line) && !line.includes("source")) {
      continue;
    }
    
    result.push(line);
  }
  
  let c = result.join("\n");
  
  // Clean up double commas and empty objects
  c = c.replace(/,\s*,/g, ",");
  c = c.replace(/,\s*\n\s*\}/g, "\n}");
  
  return c;
}

const testDir = join(__dirname, "..", "packages", "engine", "tests");
console.log(`Processing: ${testDir}`);

const files = walkDir(testDir);
let fixedCount = 0;

for (const file of files) {
  const original = readFileSync(file, "utf-8");
  const fixed = fixFile(original);
  if (fixed !== original) {
    writeFileSync(file, fixed, "utf-8");
    fixedCount++;
  }
}

console.log(`Fixed ${fixedCount} files.`);
