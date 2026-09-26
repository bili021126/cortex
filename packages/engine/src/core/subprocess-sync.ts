// ============================================================
// @cortex/engine/core/subprocess-sync —— 同步子进程查询（单一来源）
//
// @layer 规划-执行层
//
// 为什么存在：`git diff --name-only` 与 `eslint --quiet --format compact`
// 的同步查询，此前在
//   execution/zero-token-validator.ts
//   planning/hard-verification-gate.ts
// 各实现了一遍——命令、超时、解析正则完全相同（两份都是「零 token 硬验证」
// 的同一关切）。于是同一件事有两处同步子进程调用，也就是**两处事件循环阻塞点**，
// 任何调整（超时、命令、输出格式）都要改两遍且容易漏一边。
//
// 本模块把它收成单一来源：命令、超时、解析只此一处。
// 缓存**仍由调用方各自持有**——两类的缓存失效时机不同，强行合并会改变
// 既有测试可观察到的行为，属于另一件事。
//
// ⚠️ 已知代价：execSync / execFileSync 会同步阻塞事件循环（eslint 那条
//   理论上限 10 秒，靠 TTL 缓存摊薄）。要根治需把 `ZeroTokenRule.validate`
//   改成 async——那是**接口变更**，会波及事件处理器路径，须单独设计。
//   届时只改本模块即可：这正是收成单一来源的目的。
// ============================================================

import { execFileSync } from "node:child_process";

/** git diff 查询超时——本地仓库操作，短超时即可 */
export const GIT_DIFF_TIMEOUT_MS = 3_000;

/**
 * eslint 全仓扫描超时。
 * 原为 30s，两处各自下调到 10s（其中一处注释写明「降低同步 eslint 对事件循环的阻塞」）——
 * 现在这个取舍只写一次。
 */
export const ESLINT_COMPACT_TIMEOUT_MS = 10_000;

/** eslint `--format compact` 的一行：`<file>(<line>,<col>): error <msg> <rule>` */
export const ESLINT_COMPACT_LINE = /^(.+)\((\d+),\d+\):\s+error\s+.+?\s+(\S+)$/;

/** 一条 eslint compact 错误 */
export interface EslintCompactError {
  file: string;
  line: number;
  rule: string;
}

/**
 * `git diff --name-only HEAD~1` —— 返回改动文件列表。
 * 失败时抛错，由调用方按其模块名上报退化（DegradationBoundary）。
 */
export function runGitDiffNameOnly(cwd: string = process.cwd()): string[] {
  const out = execFileSync("git", ["diff", "--name-only", "HEAD~1"], {
    encoding: "utf-8",
    timeout: GIT_DIFF_TIMEOUT_MS,
    cwd,
  });
  return out.split("\n").filter(Boolean);
}

/**
 * 解析 eslint `--format compact` 输出。
 * 纯函数——便于在不跑子进程的情况下测试。
 */
export function parseEslintCompact(output: string): EslintCompactError[] {
  const errors: EslintCompactError[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(ESLINT_COMPACT_LINE);
    if (m) errors.push({ file: m[1] ?? "", line: parseInt(m[2] ?? "0", 10), rule: m[3] ?? "" });
  }
  return errors;
}

/**
 * 同步跑 `eslint --quiet --format compact packages/` 并解析。
 * 失败时抛错，由调用方按其模块名上报退化。
 */
export function runEslintCompact(cwd: string = process.cwd()): EslintCompactError[] {
  const out = execFileSync("pnpm", ["exec", "eslint", "--quiet", "--format", "compact", "packages/"], {
    encoding: "utf-8",
    timeout: ESLINT_COMPACT_TIMEOUT_MS,
    cwd,
  });
  return parseEslintCompact(out);
}
