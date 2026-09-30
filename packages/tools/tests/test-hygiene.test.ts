// @ci: contract
// ============================================================
// @cortex/tools — 测试卫生守卫（G-4）
//
// 守的是「有测试」⇔「会被跑到」这条不变量（docs/core/core-3-invariants.md · G-4）。
// 事故原型：
//   · desktop 曾有 37 个测试但没有 `test` 脚本，而根 `pnpm test = pnpm -r test` 只跑有脚本的包
//     → 退出 0、零输出、报告成功、什么都没跑。
//   · design-tokens 曾同时踩中「vitest include 指向 src/」+「passWithNoTests: true」
//     → 测试退回零个也静默通过，本包悄悄落在门禁矩阵之外。
// 实例早已修好，但**没有东西防止下一个包再漏**——这条守卫补的就是那个「防复发」。
//
// 两条断言（双向 / 全称；因 tools 包默认被 ci-gate 扫描，红了会在第 4 步拦住）：
//   1. 每个 workspace 包：(包内存在 *.test.ts) ⇔ (package.json 有非空 test 脚本)
//   2. 任何包的 vitest.config 不得把 passWithNoTests 设为 true
//      —— 匹配前先剥掉注释，避免把「注释里提到 passWithNoTests」误判成真配置
//      （这正是 G-8「统计前必须剥掉注释」那条前置修正的落地）。
//
// 包枚举复用 collectPackages —— 与 layer-contract / flow-contract 同一「什么算 workspace 包」
// 的单一来源，避免这里再长出第三份表示而漂开。
// ============================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectRoot, collectPackages } from "../src/index.js";

const projectRoot = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
const workspacePkgs = collectPackages(projectRoot).filter((p) => !p.isRoot);

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage"]);

/** 递归收集包内所有 *.test.ts（跳过构建产物 / 依赖目录 / 隐藏目录） */
function collectTestFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let isDir = false;
    let isFile = false;
    try {
      const st = statSync(full);
      isDir = st.isDirectory();
      isFile = st.isFile();
    } catch {
      continue;
    }
    if (isDir) collectTestFiles(full, acc);
    else if (isFile && entry.endsWith(".test.ts")) acc.push(full);
  }
  return acc;
}

/** 剥掉块注释与行注释后的源码：块注释 → 整行 // → 行尾 //（避开 URL 里的 ://） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:])\/\/.*$/gm, "$1");
}

const VITEST_CONFIG_NAMES = ["vitest.config.ts", "vitest.config.mts", "vitest.config.cts", "vitest.config.js"];

describe("测试卫生守卫 G-4 · 「有测试」⇔「会被跑到」", () => {
  it("每个包：包内有 *.test.ts ⇔ package.json 有非空 test 脚本", () => {
    const testNoScript: string[] = []; // 有测试却缺脚本 → 根 pnpm test 静默跳过它（desktop 事故）
    const scriptNoTest: string[] = []; // 有脚本却零测试文件 → 跑 0 个还报成功
    for (const p of workspacePkgs) {
      const pkgDir = dirname(p.filePath);
      const pkgJson = JSON.parse(readFileSync(p.filePath, "utf-8")) as {
        scripts?: Record<string, string>;
      };
      const testScript = pkgJson.scripts?.test;
      const hasTestScript = typeof testScript === "string" && testScript.trim() !== "";
      const hasTests = collectTestFiles(pkgDir).length > 0;
      if (hasTests && !hasTestScript) testNoScript.push(p.id);
      if (hasTestScript && !hasTests) scriptNoTest.push(p.id);
    }
    expect(
      testNoScript,
      `这些包有测试但没有 test 脚本（根 pnpm test 会静默跳过）: ${testNoScript.join(", ")}`,
    ).toEqual([]);
    expect(
      scriptNoTest,
      `这些包有 test 脚本却找不到任何 *.test.ts（会跑 0 个测试还报成功）: ${scriptNoTest.join(", ")}`,
    ).toEqual([]);
  });

  it("任何包的 vitest.config 不得设 passWithNoTests: true（匹配前先剥注释）", () => {
    const offenders: string[] = [];
    for (const p of workspacePkgs) {
      const pkgDir = dirname(p.filePath);
      for (const cfgName of VITEST_CONFIG_NAMES) {
        const cfgPath = join(pkgDir, cfgName);
        if (!existsSync(cfgPath)) continue;
        const code = stripComments(readFileSync(cfgPath, "utf-8"));
        if (/passWithNoTests\s*:\s*true\b/.test(code)) offenders.push(`${p.id}/${cfgName}`);
      }
    }
    expect(
      offenders,
      `这些包把 passWithNoTests 设为 true——零测试也会静默通过: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
