#!/usr/bin/env npx tsx
/**
 * verify-docs-registry.ts — 文档注册表路径完整性验证
 *
 * 验证 cortex-docs.json 中所有注册的文档路径是否存在且可读。
 * 这是本项目"文档构建"的核心验证环节。
 *
 * 用法:
 *   npx tsx scripts/verify-docs-registry.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

interface DocEntry {
  path: string;
  type: string;
  version: string;
  canonical: boolean;
}

interface DocRegistry {
  constitutionPath: string;
  docRegistry: DocEntry[];
}

function main(): void {
  const configPath = resolve(ROOT, "cortex-docs.json");
  if (!existsSync(configPath)) {
    console.error(`❌ cortex-docs.json 不存在于 ${configPath}`);
    process.exit(1);
  }

  const raw = readFileSync(configPath, "utf-8");
  let registry: DocRegistry;
  try {
    registry = JSON.parse(raw) as DocRegistry;
  } catch {
    console.error("❌ cortex-docs.json JSON 解析失败");
    process.exit(1);
  }

  console.log("=".repeat(64));
  console.log("📜 cortex-docs.json 文档注册表路径完整性验证");
  console.log("=".repeat(64));

  // 1. 验证 constitutionPath
  const constPath = resolve(ROOT, registry.constitutionPath);
  const constOk = existsSync(constPath);
  console.log(`\n📌 宪法路径: ${registry.constitutionPath}`);
  console.log(`   ${constOk ? "✅ 存在" : "❌ 不存在"}`);

  // 2. 验证 docRegistry 中的所有路径
  let total = registry.docRegistry.length;
  let passed = 0;
  let failed = 0;
  const failures: { path: string; type: string; version: string }[] = [];

  console.log(`\n📌 文档注册条目 (共 ${total} 条):\n`);

  for (const entry of registry.docRegistry) {
    const fullPath = resolve(ROOT, entry.path);
    const exists = existsSync(fullPath);

    if (exists) {
      passed++;
      console.log(`   ✅ [${entry.type}] ${entry.path}`);
    } else {
      failed++;
      failures.push({ path: entry.path, type: entry.type, version: entry.version });
      console.log(`   ❌ [${entry.type}] ${entry.path}  — 文件不存在`);
    }
  }

  // 3. 汇总
  console.log("\n" + "=".repeat(64));
  console.log("📊 验证汇总");
  console.log("=".repeat(64));
  console.log(`   总计: ${total} 条`);
  console.log(`   通过: ${passed} 条 ✅`);
  console.log(`   失败: ${failed} 条 ${failed > 0 ? "❌" : "✅"}`);

  if (failures.length > 0) {
    console.log("\n📋 失败详情:");
    for (const f of failures) {
      console.log(`   - [${f.type}] ${f.path} (v${f.version})`);
    }
  }

  // 额外检查：docs/ 下未注册的文件
  console.log("\n" + "=".repeat(64));
  console.log("🔍 补充扫描：docs/ 下未注册的文件");
  console.log("=".repeat(64));

  const registeredPaths = new Set(registry.docRegistry.map(e => e.path.replace(/\\/g, "/")));
  registeredPaths.add(registry.constitutionPath.replace(/\\/g, "/"));

  const { readdirSync, statSync } = await import("node:fs");
  const { join, relative } = await import("node:path");

  function walkDir(dir: string, depth: number = 0): string[] {
    if (depth > 4) return [];  // 防止无限递归
    if (!existsSync(dir)) return [];
    const results: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (entry.startsWith(".") || entry === "node_modules") continue;
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          results.push(...walkDir(full, depth + 1));
        } else if (entry.endsWith(".md")) {
          const relPath = relative(ROOT, full).replace(/\\/g, "/");
          if (!registeredPaths.has(relPath)) {
            results.push(relPath);
          }
        }
      } catch { /* skip */ }
    }
    return results;
  }

  const unregistered = walkDir(join(ROOT, "docs"));
  if (unregistered.length > 0) {
    console.log(`\n⚠️  ${unregistered.length} 个 .md 文件未在 cortex-docs.json 中注册:`);
    for (const f of unregistered.slice(0, 20)) {
      console.log(`   📄 ${f}`);
    }
    if (unregistered.length > 20) {
      console.log(`   ... 还有 ${unregistered.length - 20} 个未列出`);
    }
  } else {
    console.log("   ✅ 所有 .md 文件均已注册");
  }

  // 退出码
  if (failed > 0) {
    console.error(`\n❌ 文档注册表验证失败: ${failed} 条路径不存在`);
    process.exit(1);
  }

  console.log("\n✅ 文档注册表路径完整性验证通过");
  process.exit(0);
}

main().catch((e) => {
  console.error("验证脚本异常:", e);
  process.exit(1);
});
