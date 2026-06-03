/**
 * 批量修复测试文件中的 v2→v3 类型引用
 * 用法: npx tsx scripts/fix-test-v3.ts
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function walkDir(dir: string, ext = ".ts"): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!entry.startsWith(".") && entry !== "node_modules") results.push(...walkDir(full, ext));
    } else if (extname(entry) === ext) {
      results.push(full);
    }
  }
  return results;
}

function applyFixes(content: string): string {
  let c = content;

  // ── 1. 移除废弃的 imports ──
  c = c.replace(/import\s*\{([^}]*)\}\s*from\s*"@cortex\/shared"/g, (match, inner: string) => {
    // 移除 MemoryType, MemoryState, MemorySubType
    const cleaned = inner
      .split(",")
      .map((s: string) => s.trim())
      .filter((s: string) => s && !s.startsWith("MemoryType") && !s.startsWith("MemoryState") && !s.startsWith("MemorySubType"))
      .join(", ");
    if (!cleaned) return ""; // empty import
    return `import { ${cleaned} } from "@cortex/shared"`;
  });

  // Clean empty import lines
  c = c.replace(/^import\s*\{\s*\}\s*from\s*"@cortex\/shared";?\s*\n/gm, "");

  // ── 2. MemoryType 枚举引用 → 字面量 ──
  c = c.replace(/MemoryType\.Episodic/g, '"TaskLog"');
  c = c.replace(/MemoryType\.Conceptual/g, '"Insight"');
  c = c.replace(/MemoryType\.Knowledge/g, '"Insight"');
  c = c.replace(/MemoryType\.Skill/g, '"Skill"');

  // ── 3. MemoryState 枚举引用 → 字面量 ──
  c = c.replace(/MemoryState\.Active/g, '"Active"');
  c = c.replace(/MemoryState\.Archived/g, '"Archived"');
  c = c.replace(/MemoryState\.Obliterated/g, '"Obliterated"');

  // ── 4. MemoryWriteInput 字段重命名 ──
  // memoryType: → kind:
  c = c.replace(/\bmemoryType:\s*(MemoryType\.\w+|"[^"]*")/g, (match) => {
    const val = match.split(":")[1].trim();
    return `kind: ${val}`;
  });

  // content: (in object literal, not .content) → content_blob:
  // Only in writeInput context or object literals, but we do safe replacement
  // .content → .content_blob (on entry)
  c = c.replace(/\.content\b(?!_blob)(?!_hash)/g, ".content_blob");

  // .memoryType → .kind
  c = c.replace(/\.memoryType\b/g, ".kind");

  // .state → .semantic_state
  c = c.replace(/\.state\b(?!_)/g, ".semantic_state");

  // .agentType (on entry) → .source.agentType
  c = c.replace(/\.agentType\b/g, ".source.agentType");

  // .metadata → .content_blob
  c = c.replace(/\.metadata\b(?!Filter)/g, ".content_blob");

  // ── 5. memoryTypes: [...] → kind: ... ──
  c = c.replace(/\bmemoryTypes:\s*\[([^\]]*)\]/, (match, inner: string) => {
    const cleaned = inner.trim().replace(/MemoryType\.\w+/g, (m: string) => {
      if (m === "MemoryType.Episodic") return '"TaskLog"';
      if (m === "MemoryType.Conceptual") return '"Insight"';
      if (m === "MemoryType.Knowledge") return '"Insight"';
      if (m === "MemoryType.Skill") return '"Skill"';
      return m;
    });
    return `kind: ${cleaned}`;
  });

  // ── 6. agentType: XXX, creatorId: XXX → source: { agentType: XXX, taskId: "" }, ──
  // Match agentType followed by creatorId on same or next line
  c = c.replace(
    /agentType:\s*(AgentType\.\w+),\s*\n\s*creatorId:\s*[^,\n]+/g,
    "source: { agentType: $1, taskId: \"\" }"
  );

  // ── 7. 孤立的 creatorId: → 移除 ──
  c = c.replace(/^\s*creatorId:\s*[^,\n]+,?\s*$/gm, "");

  // ── 8. 孤立的 subType: → 移除 ──
  c = c.replace(/^\s*subType:\s*[^,\n]+,?\s*$/gm, "");
  c = c.replace(/MemorySubType\.\w+/g, '""');

  // ── 9. queryMode / trackAccess / includePrivate / states → 移除 ──
  c = c.replace(/^\s*queryMode:\s*[^,\n]+,?\s*$/gm, "");
  c = c.replace(/^\s*trackAccess:\s*[^,\n]+,?\s*$/gm, "");
  c = c.replace(/^\s*includePrivate:\s*[^,\n]+,?\s*$/gm, "");
  c = c.replace(/^\s*states:\s*\[[^\]]*\],?\s*$/gm, "");

  // ── 10. LinkType 旧值 → v3 ──
  c = c.replace(/LinkType\.DependsOn/g, "LinkType.DerivedFrom");
  c = c.replace(/LinkType\.AccessedDuring/g, "LinkType.DerivedFrom");
  c = c.replace(/LinkType\.RefactoredFrom/g, "LinkType.DerivedFrom");
  c = c.replace(/LinkType\.CascadeTo/g, "LinkType.DerivedFrom");
  c = c.replace(/LinkType\.CitedInCommittee/g, "LinkType.DerivedFrom");

  // ── 11. "hca"/"csa" → "HCA"/"CSA" (ReadMode literal) ──
  // Only in queryMode/read mode context
  c = c.replace(/queryMode:\s*"hca"/g, 'read({ ... }, "HCA")'); // approximate fix
  c = c.replace(/filterRead\([^)]*,\s*"hca"/g, (m) => m.replace('"hca"', '"HCA"'));
  c = c.replace(/filterRead\([^)]*,\s*"csa"/g, (m) => m.replace('"csa"', '"CSA"'));

  // ── 12. Clean up double commas from removed fields ──
  c = c.replace(/,\s*,/g, ",");
  c = c.replace(/\{\s*,/g, "{");
  c = c.replace(/,\s*\}/g, "}");

  return c;
}

const testDir = join(__dirname, "..", "packages", "engine", "tests");
console.log(`Processing test files in: ${testDir}`);

const files = walkDir(testDir);

for (const file of files) {
  const original = readFileSync(file, "utf-8");
  const fixed = applyFixes(original);
  if (fixed !== original) {
    writeFileSync(file, fixed, "utf-8");
    console.log(`  Fixed: ${file}`);
  }
}

console.log("Done.");
