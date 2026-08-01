#!/usr/bin/env tsx
/**
 * 迁移扫描器（阶段三 D4 —— 假迁移检出）
 *
 * 检测「注释声明已迁移但定义残留」的假迁移：
 *   1. 扫描 packages 各包 src 目录下注释中含「已迁至 / 已移至 / 迁移至」的行
 *   2. 提取声明的目标路径（如 "已迁至 config/vocabularies/tool-enums.ts"）
 *   3. 三重校验：
 *      a. 目标文件存在性（不存在 = 悬空声明）
 *      b. 声明文件是否仍含非注释代码（有 = 残留嫌疑，需人工确认）
 *      c. 输出报告（不自动改代码）
 *
 * 用法: npx tsx scripts/scan-migration-residue.ts [--json]
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PKG_ROOT = join(ROOT, "packages");

const MIGRATION_RE = /[已已]迁[至到]|迁移至|已迁移到|已移至/;
const TARGET_RE = /(?:已迁至|已迁到|迁移至|已迁移到|已移至)\s*[：:]\s*([^\s，。；;,）)]+)/;

interface Finding {
  file: string;
  line: number;
  snippet: string;
  target?: string;
  targetExists: boolean;
  hasResidue: boolean;
}

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === "dist" || entry === "coverage") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** 去掉注释/字符串后的代码行（粗略启发式） */
function hasCode(line: string): boolean {
  const stripped = line
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/, "")
    .trim();
  return stripped.length > 0;
}

function main(): void {
  const jsonMode = process.argv.includes("--json");
  const files = walkFiles(PKG_ROOT);
  const findings: Finding[] = [];

  for (const file of files) {
    const lines = readFileSync(file, "utf-8").split("\n");
    lines.forEach((line, idx) => {
      if (!MIGRATION_RE.test(line)) return;
      const m = line.match(TARGET_RE);
      const target = m?.[1]?.replace(/["'`]/g, "");
      const targetExists = target
        ? existsSync(join(ROOT, target)) || existsSync(join(ROOT, target + ".ts"))
        : false;
      // 残留启发式：声明行所在文件若还有非注释代码行 → 嫌疑
      const codeLines = lines.filter((l) => hasCode(l)).length;
      findings.push({
        file: relative(ROOT, file),
        line: idx + 1,
        snippet: line.trim().slice(0, 100),
        target,
        targetExists,
        hasResidue: codeLines > 0,
      });
    });
  }

  const dangling = findings.filter((f) => f.target && !f.targetExists);
  const residue = findings.filter((f) => f.hasResidue);

  if (jsonMode) {
    console.log(JSON.stringify({ total: findings.length, dangling, residue }, null, 2));
    return;
  }

  console.log(`\n📋 迁移声明扫描（${findings.length} 处）:`);
  for (const f of findings) {
    const flags = [
      f.target ? (f.targetExists ? "目标✅" : "目标❌悬空") : "无目标",
      f.hasResidue ? "残留⚠️" : "",
    ].filter(Boolean).join(" ");
    console.log(`   ${f.file}:${f.line} [${flags}] ${f.snippet}`);
  }

  const issues = dangling.length + residue.length;
  console.log(`\n${issues === 0 ? "✅ 无悬空声明" : `⚠️ 悬空 ${dangling.length} 处 / 残留嫌疑 ${residue.length} 处（人工确认）`}`);
  if (dangling.length > 0) process.exitCode = 1;
}

main();
