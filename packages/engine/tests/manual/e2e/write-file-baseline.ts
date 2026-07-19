/**
 * @e2e: write-file-baseline
 * @covers: ReAct 硬检测基准线采集
 * @covers-chain: TUI 执行链 ×10
 * @cost: ~5元/次（10 次 LLM 调用）
 * @overlap: core-smoke（本文件是 core-smoke ×10 + 统计）
 *
 * 跑 10 次 e2e-minimal 全链路，采集 ReAct 优化所需的基准线数据。
 * 用法: npx tsx packages/engine/tests/manual/e2e/write-file-baseline.ts
 * 注意: 写完后不要跑——太贵，用户自己决定什么时候跑。🔧
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { PipelinePriority } from "@cortex/shared";
import type { ExecutionReport } from "@cortex/shared";
import { bootstrapEngine } from "@cortex/engine";
import { e2eBootstrap, log } from "./e2e-utils.js";

// ─── 常量 ────────────────────────────────────────

const TARGET = "test-output/write-file-baseline.ts";
const TARGET_CONTENT = "// write-file-baseline auto-generated\nexport const baseline = true;\n";
const RUN_COUNT = 10;

// ─── 类型 ────────────────────────────────────────

interface BaselineRecord {
  run: number;
  loopsUntilWrite: number;
  hardReminders: number;
  toolsBeforeWrite: string[];
  totalLoops: number;
  llmCalls: number;
  success: boolean;
  durationMs: number;
}

// ─── TRACE 日志捕获 ──────────────────────────────

interface LogCapture {
  logs: string[];
  restore: () => void;
}

function captureLogs(): LogCapture {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const msg = args.join(" ");
    logs.push(msg);
    originalLog.apply(console, args);
  };
  return {
    logs,
    restore: () => {
      console.log = originalLog;
    },
  };
}

/** 从 TRACE 日志解析 ReAct 指标 */
function parseTraceMetrics(
  logs: string[],
): Pick<BaselineRecord, "loopsUntilWrite" | "hardReminders" | "toolsBeforeWrite" | "totalLoops" | "llmCalls"> {
  let lastLoop = 0;
  let loopsUntilWrite = 0; // 0 = write_file 未被调用
  let hardReminders = 0;
  const toolsBeforeWrite: string[] = [];
  const seenTools = new Set<string>();
  let writeFileCalled = false;

  for (const line of logs) {
    // 提取当前循环数
    const loopMatch = line.match(/loops=(\d+)/);
    if (loopMatch) {
      lastLoop = Math.max(lastLoop, parseInt(loopMatch[1]!, 10));
    }

    // 硬检测提醒
    if (line.includes("强制追加 write_file 提醒")) {
      hardReminders++;
    }

    // 工具调用记录（在 write_file 首次出现之前）
    if (!writeFileCalled) {
      const toolMatch = line.match(/\[TRACE write_file\] agent=.+ calling tool=(\w+)/);
      if (toolMatch) {
        if (toolMatch[1] === "write_file") {
          writeFileCalled = true;
          // 用最后记录的 loops 作为 write_file 首次调用的轮次
          loopsUntilWrite = lastLoop;
        } else if (!seenTools.has(toolMatch[1]!)) {
          seenTools.add(toolMatch[1]!);
          toolsBeforeWrite.push(toolMatch[1]!);
        }
      }
    }
  }

  return {
    loopsUntilWrite,
    hardReminders,
    toolsBeforeWrite,
    totalLoops: lastLoop,
    llmCalls: lastLoop, // ReAct 循环中每轮一次 LLM 调用
  };
}

// ─── 输出 ────────────────────────────────────────

function printTable(records: BaselineRecord[]): void {
  log("run | loopsUntilWrite | hardReminders | toolsBefore | totalLoops | llmCalls | success | ms");
  log("----|-----------------|---------------|-------------|------------|----------|---------|----");
  for (const r of records) {
    const tools = r.toolsBeforeWrite.join(",") || "—";
    const ok = r.success ? "✅" : "❌";
    log(
      ` ${String(r.run).padStart(2)} | ${String(r.loopsUntilWrite).padStart(13)} | ${String(r.hardReminders).padStart(11)} | ${tools.padEnd(11)} | ${String(r.totalLoops).padStart(10)} | ${String(r.llmCalls).padStart(8)} | ${ok}      | ${r.durationMs}`,
    );
  }
}

function printSummary(records: BaselineRecord[]): void {
  const n = records.length;
  const avgLoops = records.reduce((s, r) => s + r.loopsUntilWrite, 0) / n;
  const avgReminders = records.reduce((s, r) => s + r.hardReminders, 0) / n;
  const successRate = (records.filter((r) => r.success).length / n) * 100;
  const firstCallCount = records.filter((r) => r.loopsUntilWrite === 1).length;
  const firstCallRatio = (firstCallCount / n) * 100;

  log("\n汇总统计：");
  log(`平均 loopsUntilWrite: ${avgLoops.toFixed(1)}`);
  log(`平均 hardReminders: ${avgReminders.toFixed(1)}`);
  log(`成功率: ${successRate.toFixed(0)}%`);
  log(`首次就调的占比: ${firstCallRatio.toFixed(0)}%`);
  log(`总耗时: ${records.reduce((s, r) => s + r.durationMs, 0)}ms`);
}

function saveJson(records: BaselineRecord[]): string {
  const now = new Date();
  const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const outputDir = path.resolve(import.meta.dirname!, "..", "..", "..", "..", "..", "test-output");
  fs.mkdirSync(outputDir, { recursive: true });
  const fp = path.join(outputDir, `write-file-baseline-${yyyymmdd}.json`);
  fs.writeFileSync(fp, JSON.stringify({ generatedAt: now.toISOString(), records }, null, 2), "utf-8");
  return fp;
}

// ─── 主流程 ──────────────────────────────────────

async function main() {
  log("⚡ write-file-baseline — ReAct 硬检测基准线采集 ×10\n");

  const { root, llm, toolkit } = e2eBootstrap();
  const records: BaselineRecord[] = [];
  const targetAbs = path.join(root, TARGET);

  for (let run = 1; run <= RUN_COUNT; run++) {
    log(`\n═══ Run ${run}/${RUN_COUNT} ═══`);
    const runStart = Date.now();

    // ── 清理 ──
    if (fs.existsSync(targetAbs)) {
      fs.unlinkSync(targetAbs);
      log("  清理: 删除上次目标文件");
    }

    // ── 启动引擎 ──
    const db = path.join(root, ".cortex", "test", `write-file-baseline-${run}.db`);
    if (fs.existsSync(db)) fs.unlinkSync(db);

    // 捕获 TRACE 日志
    const capture = captureLogs();

    const engine = await bootstrapEngine(root, {
      llms: new Map([["default", llm]]),
      toolkit,
      dbPath: db,
    } as any);

    try {
      (toolkit as any).gate?.bypassAll?.();
    } catch {
      /* 容错 */
    }

    // Observer 事件收集
    const events: string[] = [];
    engine.observer.on(PipelinePriority.HIGH, (e: any) => events.push(e.type ?? ""));
    engine.observer.on(PipelinePriority.NORMAL, (e: any) => events.push(e.type ?? ""));

    // ── 规划 ──
    if (!engine.metaAgent) {
      log("  ❌ no MetaAgent");
      await engine.shutdown();
      capture.restore();
      continue;
    }
    log("  🧠 Plan...");
    const nodes = await engine.metaAgent.plan(
      `创建 ${TARGET}，内容为：${TARGET_CONTENT}。直接调用 write_file 写入，不要描述。`,
    );
    log(`     ${nodes.length} nodes`);

    if (nodes.length === 0) {
      await engine.shutdown();
      capture.restore();
      continue;
    }

    // ── 执行 ──
    for (const n of nodes) engine.board.addNode(n);
    log("  ⚡ Exec...");
    const rpt: ExecutionReport = await engine.scheduler.executeAll();
    for (const r of rpt.results) {
      log(`     ${r.success ? "✅" : "❌"} ${r.agentType ?? "?"}: ${(r.output ?? r.error ?? "").slice(0, 120)}`);
    }

    // ── 验证 ──
    const fileExists = fs.existsSync(targetAbs);
    log(`  📁 ${TARGET}: ${fileExists ? "✅ EXISTS" : "❌ ABSENT"}`);

    // ── 解析指标 ──
    const metrics = parseTraceMetrics(capture.logs);
    capture.restore();

    const durationMs = Date.now() - runStart;

    records.push({
      run,
      ...metrics,
      success: fileExists,
      durationMs,
    });

    log(`  📊 loopsUntilWrite=${metrics.loopsUntilWrite} hardReminders=${metrics.hardReminders} totalLoops=${metrics.totalLoops} ms=${durationMs}`);

    await engine.shutdown();
  }

  // ── 输出 ──
  log("\n\n📊 基准线数据");
  printTable(records);
  printSummary(records);

  const jsonPath = saveJson(records);
  log(`\n💾 JSON 已写入: ${jsonPath}`);

  log("\ndone — 用户决定什么时候跑。🔧");
}

main().catch((e) => {
  log(`💥 ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
