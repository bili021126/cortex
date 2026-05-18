#!/usr/bin/env npx tsx
/**
 * 修复：根 package.json 添加 "type": "module"
 *
 * NG-AUDIT-2026-005 — 所有子包均已声明 "type": "module"，
 * 根配置缺失该字段，违背模块化契约一致性。
 *
 * 运行: npx tsx scripts/fix-root-type-module.ts
 *
 * ---
 * 诊断报告 (2026-07-20)
 *
 * 症状:  根 package.json 缺少 "type": "module" 声明。
 *        所有 11 个子包均已声明 "type": "module"，根配置不一致。
 *
 * 根因:  项目已全面迁移至 ESM（tsconfig "module": "Node16"），
 *        但根 package.json 未同步更新，违反宪法 §2 模块化原则。
 *
 * 影响:  低（当前 pnpm workspace 子包独立加载，不受根配置影响），
 *        但根目录新增 ESM 脚本或工具链升级时将因默认 CJS 导致加载失败。
 *
 * 修复:  在根 package.json 的 "name" 字段后插入 "type": "module"。
 *
 * 验证:  grep '"type": "module"' package.json 应返回匹配行。
 *        npx tsx -e "console.log(typeof import.meta.resolve)" 应不报错。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PKG_PATH = resolve(ROOT, "package.json");

const pkg = JSON.parse(readFileSync(PKG_PATH, "utf-8"));

if (pkg.type === "module") {
  console.log("✅ 根 package.json 已包含 \"type\": \"module\"，无需修复。");
  process.exit(0);
}

pkg.type = "module";

// 保持 JSON 格式与原有风格一致（2 空格缩进）
writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
console.log("✅ 已修复：根 package.json 添加 \"type\": \"module\"");
