#!/usr/bin/env node
// ============================================================
// @cortex/config —— 把 src/data/*.json 镜像到 dist/data
//
// 为什么需要它：src/data 里混着两类东西——配置域数据（*.json）和编译型 TS 模块
// （context-policies.ts → dist/data/*.js）。tsc 只负责后者，前者靠这一步复制。
//
// 为什么必须在门禁里跑：loader 在 VITEST 下把 data 目录解析到 dist/data
// （isTestEnv() 短路，见 loader.ts resolveConfigDataDir）。如果 dist/data 陈旧，
// **整个测试套件会拿旧配置做验证**。实测曾因此漏掉两处：
//   - event-routing.json 缺 mergeRules → bootstrap-engine 传 setMergeRules([])，
//     NotificationPipe 的归并静默失效
//   - architecture-flows.json 整个文件缺失 → 新配置域在运行时读不到
// 而 dist/ 被 gitignore，门禁第 1 步只有 `tsc -b`（不跑包 build 脚本），
// 所以干净检出上门禁根本没有配置数据。
//
// 镜像语义：src 有什么就有什么——dist 里多余的 .json 会被删掉
// （旧构建残留的孤儿 agents.json 就是这么来的：无任何域引用它）。
// 只处理 .json，不碰编译产物。
// ============================================================

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(pkgRoot, "src", "data");
const dstDir = join(pkgRoot, "dist", "data");

if (!existsSync(srcDir)) {
  console.error(`[copy-data] 源目录不存在: ${srcDir}`);
  process.exit(1);
}

// dist/data 也可能还不存在（干净检出的 tsc -b 会建它，但这里不假设）
mkdirSync(dstDir, { recursive: true });

const srcFiles = readdirSync(srcDir).filter((f) => f.endsWith(".json")).sort();
const dstFiles = readdirSync(dstDir).filter((f) => f.endsWith(".json")).sort();

const srcSet = new Set(srcFiles);
let copied = 0;
let skipped = 0;
for (const f of srcFiles) {
  const from = join(srcDir, f);
  const to = join(dstDir, f);
  // 内容逐字节相同则跳过，避免无谓的 mtime 变动
  if (existsSync(to) && readFileSync(from).equals(readFileSync(to))) {
    skipped++;
    continue;
  }
  copyFileSync(from, to);
  copied++;
}

const pruned = dstFiles.filter((f) => !srcSet.has(f));
for (const f of pruned) {
  rmSync(join(dstDir, f), { force: true });
}

console.log(
  `[copy-data] src/data → dist/data: 复制 ${copied} 个 json` +
    (skipped ? `，未变 ${skipped} 个` : "") +
    (pruned.length ? `，清除孤儿 ${pruned.length} 个（${pruned.join(", ")}）` : ""),
);
