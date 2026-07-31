#!/usr/bin/env npx tsx
/**
 * bench-gate.ts —— 基准回归门禁
 *
 * 运行 bench-memory-pipeline.test.ts，解析 BENCH_METRIC:<name>=<value> 输出行，
 * 与 scripts/bench-baseline.json 基线对比：
 *   - 退化超过阈值（默认 15%）→ 失败退出码 1
 *   - 基线中不存在的新指标 → 通过（并提示先跑 --update-baseline 固化基线）
 *
 * 用法:
 *   npx tsx scripts/bench-gate.ts                    正常门禁
 *   npx tsx scripts/bench-gate.ts --update-baseline  更新基线（人工确认性能后执行）
 *   npx tsx scripts/bench-gate.ts --threshold 0.10   自定义退化阈值（默认 0.15）
 *   npx tsx scripts/bench-gate.ts --json             机器可读 JSON 输出
 *
 * 基线文件: scripts/bench-baseline.json
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── 常量 ────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, "..");
const BASELINE_PATH = resolve(ROOT, "scripts/bench-baseline.json");
const BENCH_FILE = "packages/engine/tests/bench-memory-pipeline.test.ts";
const BENCH_METRIC_RE = /BENCH_METRIC:([a-zA-Z0-9_.-]+)=([0-9.]+)/g;

interface Baseline {
  version: number;
  updatedAt: string;
  metrics: Record<string, number>;
}

// ─── 参数解析 ────────────────────────────────────────────

const args = process.argv.slice(2);
const updateBaseline = args.includes("--update-baseline");
const jsonOut = args.includes("--json");
const thresholdArg = args.find((a) => a.startsWith("--threshold="));
const threshold = thresholdArg ? Number(thresholdArg.split("=")[1]) : 0.15;

// ─── 工具 ────────────────────────────────────────────────

function run(cmd: string, argsList: string[], cwd: string): string {
  let spawnCmd = cmd;
  let spawnArgs = argsList;
  if (process.platform === "win32") {
    const joined = [cmd, ...argsList]
      .map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
      .join(" ");
    spawnCmd = "cmd.exe";
    spawnArgs = ["/c", joined];
  }
  return execFileSync(spawnCmd, spawnArgs, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

function loadBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) {
    return { version: 1, updatedAt: "", metrics: {} };
  }
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

function saveBaseline(baseline: Baseline): void {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ ...baseline, updatedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8",
  );
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ─── 主流程 ──────────────────────────────────────────────

function main(): void {
  console.log(`[bench-gate] 运行 ${BENCH_FILE} ...`);
  const raw = run("pnpm", ["exec", "vitest", "run", "--pool=forks", "--poolOptions.forks.maxForks=1", "--poolOptions.forks.minForks=1", BENCH_FILE], ROOT);
  const stdout = stripAnsi(raw);

  // 解析指标
  const metrics: Record<string, number> = {};
  for (const m of stdout.matchAll(BENCH_METRIC_RE)) {
    metrics[m[1]] = Number(m[2]);
  }

  const names = Object.keys(metrics);
  if (names.length === 0) {
    console.error("[bench-gate] FAIL: 未解析到任何 BENCH_METRIC 指标行（测试是否被跳过/改名？）");
    process.exit(1);
  }
  console.log(`[bench-gate] 解析到 ${names.length} 个指标:`);
  for (const n of names) {
    console.log(`  ${n} = ${metrics[n].toFixed(6)}`);
  }

  const baseline = loadBaseline();

  if (updateBaseline) {
    baseline.metrics = { ...baseline.metrics, ...metrics };
    saveBaseline(baseline);
    console.log(`[bench-gate] 基线已更新 → ${BASELINE_PATH}`);
    if (jsonOut) {
      console.log(JSON.stringify({ ok: true, updated: true, metrics }, null, 2));
    }
    return;
  }

  // 回归对比
  const failures: string[] = [];
  const newMetrics: string[] = [];
  for (const n of names) {
    const base = baseline.metrics[n];
    if (base === undefined) {
      newMetrics.push(n);
      continue;
    }
    const ratio = metrics[n] / base;
    if (ratio < 1 - threshold) {
      failures.push(`${n}: ${metrics[n].toFixed(6)} vs 基线 ${base.toFixed(6)}（退化 ${((1 - ratio) * 100).toFixed(2)}% > ${(threshold * 100).toFixed(0)}%）`);
    }
  }

  if (newMetrics.length > 0) {
    console.log(`[bench-gate] 新指标（基线无记录，放行；建议跑 --update-baseline 固化）: ${newMetrics.join(", ")}`);
  }

  if (failures.length > 0) {
    console.error("[bench-gate] FAIL: 存在回归:");
    for (const f of failures) {
      console.error(`  ✗ ${f}`);
    }
    console.error("[bench-gate] 确认是真实性能回退而非抖动 → 修复后重跑；确认是预期变化 → 跑 bench:update 更新基线。");
    if (jsonOut) {
      console.log(JSON.stringify({ ok: false, failures }, null, 2));
    }
    process.exit(1);
  }

  console.log(`[bench-gate] PASS: 全部 ${names.length} 个指标无回归（阈值 ${(threshold * 100).toFixed(0)}%）`);
  if (jsonOut) {
    console.log(JSON.stringify({ ok: true, metrics }, null, 2));
  }
}

main();
