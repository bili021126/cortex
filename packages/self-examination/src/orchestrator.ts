// ============================================================
// @cortex/self-examination/orchestrator — Phase 1-5 编排
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { PipelinePriority } from "@cortex/shared";
import type { ExamConfig, ExamResult } from "./config.js";
import type { Platform } from "./platform.js";

/**
 * 完整自审视编排：
 *   Phase 1: 平台准备 + 种子记忆注入
 *   Phase 2: 甘雨规划（MetaAgent 生成审查计划）
 *   Phase 3: 执行 + 事件追踪
 *   Phase 4: 结果汇总
 *   Phase 5: 清理归档
 */
export async function orchestrate(config: ExamConfig, platform: Platform): Promise<ExamResult> {
  const startTime = Date.now();
  const events: any[] = [];

  // ── Phase 0: 事件监听 ──
  platform.observer.on(PipelinePriority.HIGH, (e: any) => {
    events.push({ type: e.type, payload: e.payload, ts: e.timestamp ?? Date.now() });
  });

  // ── Phase 1: 种子记忆注入 ──
  console.log("[Phase 1] 平台就绪, Agent: 11 位");
  for (const seedPath of config.seedMemories) {
    const absPath = path.resolve(config.workspaceRoot ?? "", seedPath);
    if (fs.existsSync(absPath)) {
      try {
        const content = fs.readFileSync(absPath, "utf-8");
        await platform.memory.write({
          source: { agentType: "analysis" as any, taskId: `seed-${path.basename(seedPath)}` },
          kind: "Insight",
          content_blob: { content: content.slice(0, 2000) },
          semantic_gist: `种子记忆: ${seedPath}`,
          content_hash: `seed-${seedPath}`,
          summary: `种子记忆: ${seedPath}`,
        });
      } catch (err) {
        process.stderr.write(`[orchestrator] 种子记忆注入失败: ${err}\n`);
      }
    }
  }

  // ── Phase 2: 甘雨规划 ──
  console.log("[Phase 2] 甘雨规划...");
  const planStart = Date.now();
  let nodes: any[] = [];
  try {
    nodes = await platform.metaAgent.plan(config.task, {
      existingTags: ["code", "review", "inspector", "analysis", "doc-govern", "ops", "loop", "api", "data"],
    });
  } catch (e: any) {
    console.error(`  规划失败: ${e.message}`);
    return { config, startTime, endTime: Date.now(), exitCode: 1, events, plan: null, auditResults: [], crossCheck: [], consensus: null, archive: null, error: e.message };
  }
  console.log(`  规划完成: ${nodes.length} 节点 (${Date.now() - planStart}ms)`);

  if (nodes.length === 0) {
    return { config, startTime, endTime: Date.now(), exitCode: 0, events, plan: nodes, auditResults: [], crossCheck: [], consensus: null, archive: null };
  }

  for (const n of nodes) {
    platform.board.addNode(n);
  }

  // ── Phase 3: 执行 ──
  console.log("[Phase 3] 执行...");
  const execStart = Date.now();
  const report = await platform.scheduler.executeAll();
  const execMs = Date.now() - execStart;
  console.log(`  执行完成: ${report.completed}/${nodes.length} (${(execMs / 1000).toFixed(1)}s)`);

  const auditResults = report.results ?? [];

  // ── Phase 4: 汇总 ──
  console.log("[Phase 4] 汇总...");
  const crossCheck = auditResults.map((r: any) => ({
    nodeId: r.nodeId,
    agentType: r.agentType,
    success: r.success,
    summary: (r.output ?? "").slice(0, 300),
  }));

  // ── Phase 5: 归档 ──
  const outputDir = path.resolve(config.workspaceRoot ?? "", config.outputDir);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const archivePath = path.join(outputDir, `exam-${config.id}-${Date.now()}.json`);
  const archive = { path: archivePath, size: 0 };

  const result: ExamResult = {
    config,
    startTime,
    endTime: Date.now(),
    exitCode: 0,
    events,
    plan: nodes,
    auditResults,
    crossCheck,
    consensus: null,
    archive,
  };

  fs.writeFileSync(archivePath, JSON.stringify(result, null, 2));
  archive.size = fs.statSync(archivePath).size;

  return result;
}
