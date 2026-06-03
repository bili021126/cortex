/**
 * 第二轮修复：针对性处理残留的 v2→v3 错误
 * 用法: npx tsx scripts/fix-test-v3-pass2.ts
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

function applyFixesPass2(content: string): string {
  let c = content;

  // ── 1. 还原错误转换: .source.agentType → .agentType (仅 NodeResult/SkillTemplate 等非 MemoryEntry 类型) ──
  // NodeResult 类型使用 .agentType，脚本错误转换成了 .source.agentType
  // 安全策略：还原 .source.agentType 出现在非 MemoryEntry 上下文
  c = c.replace(/result\.source\.agentType/g, "result.agentType");
  c = c.replace(/\.results\[\d+\]\.source\.agentType/g, (m) => m.replace(".source.agentType", ".agentType"));
  
  // ── 2. content: → content_blob: (仅 MemoryWriteInput 对象字面量) ──
  // 匹配 write({ ... content: ... }) 或 writePending({ ... content: ... })
  c = c.replace(/(write(?:Pending)?\(\{[^}]*?)\bcontent:\s*/g, "$1content_blob: ");
  
  // 更广泛的 content: 在对象字面量中的修复（需要在 write/memory 上下文中）
  // 匹配行级 content: 后跟值的情况
  c = c.replace(/^(\s*)content:\s*(\{)/gm, "$1content_blob: $2");

  // ── 3. 移除残留的 subType: ──
  c = c.replace(/^\s*subType:\s*[^,\n]+,?\s*$/gm, "");
  c = c.replace(/MemorySubType\.\w+/g, '""');
  
  // ── 4. 移除残留的 MemoryState 引用 ──
  c = c.replace(/MemoryState\.\w+/g, (m) => {
    if (m === "MemoryState.Active") return '"Active"';
    if (m === "MemoryState.Archived") return '"Archived"';
    if (m === "MemoryState.Obliterated") return '"Obliterated"';
    return '""';
  });

  // ── 5. 移除残留的 memoryTypes: ──
  c = c.replace(/^\s*memoryTypes:\s*\[[^\]]*\],?\s*$/gm, "");

  // ── 6. 移除残留的 includePrivate/trackAccess/states ──
  c = c.replace(/^\s*includePrivate:\s*[^,\n]+,?\s*$/gm, "");
  c = c.replace(/^\s*trackAccess:\s*[^,\n]+,?\s*$/gm, "");
  c = c.replace(/^\s*states:\s*\[[^\]]*\],?\s*$/gm, "");

  // ── 7. 还原 .content_blob → .content (非 MemoryEntry 类型: LlmMessage, MockScriptStep) ──
  c = c.replace(/res\.content_blob\b/g, "res.content");
  c = c.replace(/msg\.content_blob\b/g, "msg.content");
  c = c.replace(/message\.content_blob\b/g, "message.content");
  c = c.replace(/step\.content_blob\b/g, "step.content");
  c = c.replace(/response\.content_blob\b/g, "response.content");
  c = c.replace(/chunk\.content_blob\b/g, "chunk.content");

  // ── 8. 清理空行 ──
  c = c.replace(/,\s*,/g, ",");
  c = c.replace(/\{\s*,/g, "{");
  c = c.replace(/,\s*\}/g, "}");

  return c;
}

const testDir = join(__dirname, "..", "packages", "engine", "tests");
console.log(`Processing test files in: ${testDir}`);

const files = walkDir(testDir);
let fixedCount = 0;

for (const file of files) {
  const original = readFileSync(file, "utf-8");
  const fixed = applyFixesPass2(original);
  if (fixed !== original) {
    writeFileSync(file, fixed, "utf-8");
    fixedCount++;
  }
}

console.log(`Fixed ${fixedCount} files.`);
