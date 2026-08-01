#!/usr/bin/env tsx
/**
 * @layer 标注覆盖率扫描器（阶段三 D3 —— 机制化第一步）
 *
 * 扫描 engine/src 全部 .ts 文件：
 *   1. 覆盖率统计：文件头 30 行内含 @layer 标注 = 已标注
 *   2. 词表校验：@layer 值必须来自六层词表，或「源层→目标层」跨层形式（两侧均在词表）
 *   3. 输出：覆盖率 + 未标注文件清单 + 非法标签清单（不自动改代码）
 *
 * 词表（从现有标注归纳，五流六层）：
 *   交互层 / 治理层 / 规划-执行层 / 执行层 / 记忆层 / 技能-工具层 / 观测层
 *
 * 用法: npx tsx scripts/layer-coverage.ts [--json] [--path packages/engine/src]
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const LAYER_VOCABULARY = [
  "交互层",
  "治理层",
  "规划-执行层",
  "执行层",
  "记忆层",
  "技能-工具层",
  "观测层",
] as const;

const LAYER_RE = /@layer\s+([^\n*]+)/;
const HEAD_SCAN_LINES = 30;

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

/** 校验单个 @layer 标注值：词表内 or 源层→目标层（两侧均在词表） */
function validateLayerValue(value: string): { ok: boolean; reason?: string } {
  const v = value.trim().replace(/[：:].*$/, "").trim(); // 去掉冒号后的说明文字
  if ((LAYER_VOCABULARY as readonly string[]).includes(v)) return { ok: true };
  const cross = v.split("→");
  if (cross.length === 2) {
    const [from, to] = cross.map((s) => s.trim());
    if (
      (LAYER_VOCABULARY as readonly string[]).includes(from) &&
      (LAYER_VOCABULARY as readonly string[]).includes(to)
    ) {
      return { ok: true };
    }
    return { ok: false, reason: `跨层标注两侧须在词表内: "${from}" / "${to}"` };
  }
  return { ok: false, reason: `不在词表内: "${v}"（词表: ${LAYER_VOCABULARY.join(" / ")}）` };
}

interface FileReport {
  file: string;
  tagged: boolean;
  value?: string;
  invalid?: string;
}

function main(): void {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const pathIdx = args.indexOf("--path");
  const targetDir = pathIdx >= 0 ? join(ROOT, args[pathIdx + 1]!) : join(ROOT, "packages", "engine", "src");

  const files = walkFiles(targetDir);
  const reports: FileReport[] = [];

  for (const file of files) {
    const head = readFileSync(file, "utf-8").split("\n").slice(0, HEAD_SCAN_LINES).join("\n");
    const m = head.match(LAYER_RE);
    if (!m) {
      reports.push({ file: relative(ROOT, file), tagged: false });
      continue;
    }
    const value = m[1]!.trim();
    const check = validateLayerValue(value);
    reports.push({
      file: relative(ROOT, file),
      tagged: true,
      value,
      invalid: check.ok ? undefined : check.reason,
    });
  }

  const tagged = reports.filter((r) => r.tagged).length;
  const untagged = reports.filter((r) => !r.tagged);
  const invalid = reports.filter((r) => r.invalid);
  const coverage = reports.length === 0 ? 0 : tagged / reports.length;

  if (jsonMode) {
    console.log(JSON.stringify({ total: reports.length, tagged, coverage, untagged, invalid }, null, 2));
    return;
  }

  console.log(`\n🏷️ @layer 标注覆盖率: ${tagged}/${reports.length} (${(coverage * 100).toFixed(1)}%)`);
  if (untagged.length > 0) {
    console.log(`\n未标注文件（${untagged.length}）:`);
    for (const u of untagged) console.log(`   ⚪ ${u.file}`);
  }
  if (invalid.length > 0) {
    console.log(`\n非法标签（${invalid.length}）:`);
    for (const v of invalid) console.log(`   ❌ ${v.file}: ${v.invalid}`);
  }
  if (untagged.length === 0 && invalid.length === 0) {
    console.log("✅ 全部文件已标注且词表合法");
  }
}

main();
