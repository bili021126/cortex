/**
 * 莫娜技能沉淀闭环验证 —— 从 pattern.md 提取模式 → 持久化到 MemoryStore → 回读验证
 *
 * 用法: npx tsx scripts/test-mona-skill-crystallize.ts
 *
 * 闭环链路:
 *   1. 收集 workspace 下所有 pattern.md / patterns.md
 *   2. 用 scanOutputFilesForSkills 扫描提取 SkillTemplate
 *   3. persistSkillsToMemory 写入 MemoryStore (MemoryType.Skill)
 *   4. loadSkillsFromMemory 回读验证
 *   5. 断言：提取数 > 0 且 回读匹配
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { MemoryStore } from "../packages/engine/dist/memory/memory-store.js";
import { SkillRegistry } from "../packages/shared/dist/skill-registry.js";
import { MemoryType, MemorySubType, AgentType } from "../packages/shared/dist/index.js";
import {
  scanOutputFilesForSkills,
  loadSkillsFromMemory,
  persistSkillsToMemory,
} from "../packages/engine/dist/components/skill-persister.js";

// ══════════════════════════════════════════════
// 0. 收集所有 pattern.md 文件
// ══════════════════════════════════════════════

const WORKSPACE = process.cwd();
const TEMP_DB = path.resolve(WORKSPACE, ".cortex", "memory-mona-crystallize.db");

function collectPatternFiles(root: string): string[] {
  const results: string[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 6) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.name === "pattern.md" || entry.name === "patterns.md") {
          results.push(fullPath);
        }
      }
    } catch {
      // 权限错误忽略
    }
  }

  walk(root, 0);
  return results;
}

// ══════════════════════════════════════════════
// 1. 主流程
// ══════════════════════════════════════════════

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🔮 莫娜技能沉淀 —— pattern.md → Skill 记忆闭环  ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // ── Step 1: 收集 pattern.md 文件 ──
  console.log("🟢 [Step 1] 收集 pattern.md 文件...\n");

  const patternFiles = collectPatternFiles(WORKSPACE);
  console.log(`   发现 ${patternFiles.length} 个 pattern 文件:`);
  for (const f of patternFiles) {
    const relative = path.relative(WORKSPACE, f);
    const size = fs.statSync(f).size;
    console.log(`     📄 ${relative} (${(size / 1024).toFixed(1)} KB)`);
  }

  if (patternFiles.length === 0) {
    console.log("\n   ⚠️ 未发现任何 pattern.md/patterns.md 文件，跳过。");
    process.exit(0);
  }

  // ── Step 2: 扫描提取技能模板 ──
  console.log("\n🟢 [Step 2] 扫描提取技能模板...\n");

  const skillRegistry = new SkillRegistry();
  const scannedSkills = scanOutputFilesForSkills(WORKSPACE);

  // 只保留从 pattern 文件中提取的技能（排除其他文件扫描的）
  const patternSkills = scannedSkills.filter((s) =>
    s.discoveredBy === "mona-pattern-scan" || s.discoveredBy === "file-scanner"
  );

  if (patternSkills.length > 0) {
    skillRegistry.registerAll(patternSkills);
  }

  console.log(`   总扫描技能: ${scannedSkills.length} 个`);
  console.log(`   模式提取技能: ${patternSkills.length} 个`);
  console.log(`   SkillRegistry 注册: ${skillRegistry.totalCount} 个\n`);

  if (patternSkills.length === 0) {
    console.log("   ❌ 未从 pattern.md 中提取到任何技能模板！");
    console.log("   ⚠️ 检查 extractPNSections 是否正确匹配 P0-P9 格式。\n");
    // 打印文件前 200 字符帮助诊断
    for (const f of patternFiles) {
      const content = fs.readFileSync(f, "utf-8").slice(0, 300);
      console.log(`   ── ${path.relative(WORKSPACE, f)} 前 300 字符: ──`);
      console.log(content);
    }
    process.exit(1);
  }

  // 打印提取的技能
  console.log("   ── 提取的技能列表 ──");
  for (const skill of patternSkills) {
    console.log(`     🔧 [${skill.agentType}] ${skill.name}`);
    console.log(`        tags: [${skill.triggerTags.join(", ")}]`);
    console.log(`        trigger: ${skill.trigger.slice(0, 80)}`);
    console.log(`        steps: ${skill.steps.length} 步 → ${skill.steps[0]?.slice(0, 60)}...`);
    console.log(`        expectedOutput: ${skill.expectedOutput.slice(0, 80)}`);
    console.log();
  }

  // ── Step 3: 持久化到 MemoryStore ──
  console.log("🟢 [Step 3] 持久化技能到 MemoryStore...\n");

  // 清理旧数据库
  if (fs.existsSync(TEMP_DB)) {
    fs.unlinkSync(TEMP_DB);
    // 清理 WAL/SHM
    for (const ext of ["-wal", "-shm"]) {
      const f = TEMP_DB + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }

  const memory = new MemoryStore();
  await memory.init(TEMP_DB);

  const persisted = persistSkillsToMemory(patternSkills, memory);
  console.log(`   持久化: ${persisted}/${patternSkills.length} 个技能写入 MemoryStore`);
  console.log(`   数据库: ${TEMP_DB}\n`);

  if (persisted === 0) {
    console.log("   ❌ 持久化失败！");
    await memory.close();
    process.exit(1);
  }

  // ── Step 4: 回读验证（闭环） ──
  console.log("🟢 [Step 4] 回读验证——从 MemoryStore 加载技能...\n");

  const loadedSkills = loadSkillsFromMemory(memory);
  console.log(`   回读技能: ${loadedSkills.length} 个`);

  // 验证数量 >= 提取数（因为可能有之前遗留的）
  if (loadedSkills.length < patternSkills.length) {
    console.log(`   ❌ 回读数量 ${loadedSkills.length} < 提取数量 ${patternSkills.length}！`);
    await memory.close();
    process.exit(1);
  }

  // 逐个匹配验证
  let matchCount = 0;
  for (const extracted of patternSkills) {
    const found = loadedSkills.find((s) => s.id === extracted.id);
    if (found) {
      const nameMatch = found.name === extracted.name;
      const tagsMatch = found.triggerTags.length === extracted.triggerTags.length;
      const stepsMatch = found.steps.length === extracted.steps.length;
      if (nameMatch && tagsMatch && stepsMatch) {
        matchCount++;
        console.log(`     ✅ ${extracted.name}`);
      } else {
        console.log(`     ⚠️ ${extracted.name} —— 字段不匹配 (name:${nameMatch} tags:${tagsMatch} steps:${stepsMatch})`);
      }
    } else {
      console.log(`     ❌ ${extracted.name} —— 回读中未找到！`);
    }
  }

  console.log(`\n   匹配: ${matchCount}/${patternSkills.length}`);

  // ── Step 5: MemoryStore 原始查询验证 ──
  console.log("\n🟢 [Step 5] MemoryStore 原始查询验证...\n");

  const skillMemories = memory.read({
    memoryTypes: [MemoryType.Skill],
    trackAccess: false,
  });

  console.log(`   MemoryType.Skill 记忆数: ${skillMemories.length}`);
  for (const m of skillMemories.slice(0, 5)) {
    const c = m.content as Record<string, unknown> | undefined;
    console.log(`     📌 [${c?.agentType ?? "?"}] ${c?.name ?? "?"} — ${String(c?.trigger ?? "?").slice(0, 60)}`);
  }
  if (skillMemories.length > 5) console.log(`     ... 还有 ${skillMemories.length - 5} 个`);

  // ── Step 6: SkillRegistry JSON 持久化验证 ──
  console.log("\n🟢 [Step 6] SkillRegistry JSON 持久化验证...\n");

  const jsonPath = path.resolve(WORKSPACE, ".cortex", "skills-crystallized.json");
  skillRegistry.saveJson(jsonPath);
  console.log(`   保存 JSON: ${jsonPath} (${fs.statSync(jsonPath).size} bytes)`);

  const restored = SkillRegistry.loadJson(jsonPath);
  console.log(`   恢复注册表: ${restored.totalCount} 个技能`);

  if (restored.totalCount !== skillRegistry.totalCount) {
    console.log(`   ❌ JSON 持久化数量不匹配: ${restored.totalCount} vs ${skillRegistry.totalCount}`);
    await memory.close();
    process.exit(1);
  }
  console.log("   ✅ JSON 持久化闭环通过");

  // ── 收尾 ──
  await memory.close();

  // 清理测试数据库（保留 skills-crystallized.json 供后续使用）
  if (fs.existsSync(TEMP_DB)) fs.unlinkSync(TEMP_DB);
  for (const ext of ["-wal", "-shm"]) {
    const f = TEMP_DB + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   ✅ 莫娜技能沉淀 —— 全闭环验证通过               ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`   收集 pattern.md: ${patternFiles.length} 个文件`);
  console.log(`   提取技能模板:   ${patternSkills.length} 个`);
  console.log(`   持久化 MemoryStore: ${persisted} 个`);
  console.log(`   回读验证:       ${matchCount}/${patternSkills.length} 匹配`);
  console.log(`   JSON 持久化:    ${restored.totalCount} 个`);
  console.log(`   产出 JSON:      ${jsonPath}`);
  console.log();

  if (matchCount === patternSkills.length && restored.totalCount === skillRegistry.totalCount) {
    console.log("🎉 全闭环验证通过！莫娜已成功将 pattern.md 沉淀为可复用技能。\n");
    process.exit(0);
  } else {
    console.log("❌ 闭环验证失败。\n");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("💥 莫娜技能沉淀测试崩溃:", e);
  process.exit(1);
});
