/**
 * Cortex WebUI 启动脚本
 * 用法: npx tsx scripts/start-webui.ts
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapEngine } from "@cortex/engine";
import { startWebUI } from "@cortex/tui";
import { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "@cortex/platform";
import { PipelinePriority } from "@cortex/shared";
import type { TaskNode } from "@cortex/shared";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");

async function main() {
  console.log("[webui] 启动引擎...");

  const apiKey = process.env.DEEPSEEK_API_KEY ?? "sk-placeholder";
  const llms = new Map<string, LlmAdapter>();
  llms.set("DEEPSEEK_CHAT", new LlmAdapter({ apiKey, chatModel: "deepseek-chat" }));
  const toolkit = new Toolkit();

  const engine = await bootstrapEngine(ROOT, { llms, toolkit });

  // ── 引擎组件引用 ──
  const scheduler = engine.scheduler;
  const observer = engine.observer;
  const taskBoard = engine.board;
  const agentPool = engine.pool;

  // ── 调试：引擎结构探查 ──
  console.log("[webui] engine keys:", Object.keys(engine));
  console.log("[webui] engine.scheduler:", typeof scheduler);
  console.log("[webui] engine.scheduler.executeAll:", typeof scheduler?.executeAll);
  if (scheduler) {
    console.log("[webui] scheduler keys:", Object.keys(scheduler));
  }
  // 查看已注册的 Agent 类型
  if (engine.agents) {
    console.log("[webui] 已注册 Agents:", [...engine.agents.keys()].join(", "));
  }

  if (!observer) {
    throw new Error("引擎未提供 PipelineObserver");
  }

  console.log("[webui] 启动 WebUI 服务...");
  const port = parseInt(process.env.CORTEX_WEBUI_PORT ?? "3001", 10);

  const { stop } = await startWebUI({
    port,
    observer,
    taskBoard,
    agentPool,
  });

  console.log(`[webui] 已启动 → http://localhost:${port}`);
  console.log("[webui] 前端开发：cd packages/tui/src/web/static && npm run dev");
  console.log("[webui] 按 Ctrl+C 停止");

  // ════════════════════════════════════════════════════════
  // Mock 数据注入函数（真实任务失败时 fallback）
  // ════════════════════════════════════════════════════════
  async function injectMockData() {
    console.log("[webui] 注入 Mock 数据...");

    const mockMissionId = "mock-mission-001";
    const now = Date.now();

    // ── 模拟 Agent 注册（使用 AgentPool 已注册的类型名，而非中文代号）──
    if (agentPool) {
      // 从 engine.agents 读取已注册的类型
      const registeredTypes = engine.agents ? [...engine.agents.keys()] : [];
      console.log("[webui] AgentPool 可用类型:", registeredTypes.join(", "));

      // 选几个可 spawn 的类型做 mock
      const spawnTargets = ["analysis", "review", "doc-govern", "code", "fix"];
      for (const type of spawnTargets) {
        if (registeredTypes.includes(type)) {
          const ok = agentPool.spawn(type as any, `${type}-webui-mock-1`);
          if (ok) {
            console.log(`[webui] spawn Agent: ${type}`);
          }
        }
      }
    }

    // ── 模拟 TaskNode（使用 TaskNode 标准字段）──
    if (taskBoard) {
      const rootNode: TaskNode = {
        id: "mock-root",
        type: "mission",
        tags: ["analysis" as any],
        needsMultiPerspective: false,
        status: "running",
        claimedBy: ["analysis" as any],
        payload: "Mock Mission: 验证全管线数据流 — 四个子节点代码分析→类型审查→宪法审计→缺陷修复",
        results: [],
        createdAt: Date.now(),
      };
      const children: TaskNode[] = [
        { id: "mock-node-1", type: "analysis", tags: ["analysis" as any], needsMultiPerspective: false, status: "running", claimedBy: ["analysis" as any], payload: "代码库分析", results: [], parentId: rootNode.id, createdAt: Date.now() },
        { id: "mock-node-2", type: "review", tags: ["review" as any], needsMultiPerspective: false, status: "pending", claimedBy: [], payload: "类型审查", results: [], parentId: rootNode.id, createdAt: Date.now() },
        { id: "mock-node-3", type: "doc-govern", tags: ["audit" as any], needsMultiPerspective: false, status: "pending", claimedBy: [], payload: "宪法审计", results: [], parentId: rootNode.id, createdAt: Date.now() },
        { id: "mock-node-4", type: "fix", tags: ["fix" as any], needsMultiPerspective: false, status: "pending", claimedBy: [], payload: "缺陷修复", results: [], parentId: rootNode.id, createdAt: Date.now() },
      ];
      taskBoard.addNode(rootNode);
      for (const child of children) {
        taskBoard.addNode(child);
      }
    }

    // ── 模拟 PipelineEvent 序列 ──
    const mockEvents = [
      { type: "exec.lifecycle_phase_changed", priority: 2, payload: { phase: "mission_start", from: "idle", to: "running", missionId: mockMissionId }, notificationType: "FYI", triggerSource: "governance" },
      { type: "node.start", priority: 2, payload: { nodeId: "mock-node-1", nodeType: "analysis", agent: "nahida", timestamp: now + 1000 }, notificationType: "FYI", triggerSource: "skill-tool" },
      { type: "exec.lifecycle_phase_changed", priority: 2, payload: { phase: "heartbeat", agent: "nahida", status: "running" }, notificationType: "FYI", triggerSource: "governance" },
      { type: "token_usage", priority: 2, payload: { agent: "nahida", promptTokens: 2450, completionTokens: 860, cacheHit: true, cost: 0.0035, model: "deepseek-v4" }, triggerSource: "skill-tool" },
      { type: "token_usage", priority: 2, payload: { agent: "keqing", promptTokens: 1120, completionTokens: 340, cacheHit: false, cost: 0.0018, model: "deepseek-v4-flash" }, triggerSource: "skill-tool" },
      { type: "governance.audit_report", priority: 1, payload: { title: "v3.2 宪法审计", date: "2026-06-28", conclusion: "合规，7项不一致中0项阻断", auditor: "凝光" }, notificationType: "FYI", triggerSource: "governance" },
      { type: "governance.constitution_updated", priority: 1, payload: { from: "v3.1", to: "v3.2", date: "2026-06-28", reason: "WebUI+自审视入宪" }, notificationType: "FYI", triggerSource: "governance" },
      { type: "governance.compliance_violation", priority: 0, payload: { principle: "原则三·边界集中", description: "shared 19处 export * 通配符导出", severity: "P1" }, notificationType: "WARNING", triggerSource: "governance" },
      { type: "node.complete", priority: 2, payload: { nodeId: "mock-node-1", agent: "nahida", output: "分析完成：26包无循环依赖", durationMs: 3200 }, triggerSource: "skill-tool" },
      { type: "permission_required", priority: 0, payload: { agent: "albedo", tool: "delete_file", input: { path: "src/legacy.ts" }, reversibilityLevel: 3, nodeId: "mock-node-4" }, notificationType: "DECISION_REQUIRED", triggerSource: "skill-tool" },
      { type: "memory.sql_degraded", priority: 1, payload: { reason: "write_lock_contention", retryCount: 3 }, notificationType: "WARNING", triggerSource: "skill-tool" },
      { type: "node.failed", priority: 1, payload: { nodeId: "mock-node-4", agent: "albedo", error: "TypeError: undefined.fn()" }, notificationType: "WARNING", triggerSource: "skill-tool" },
      { type: "node.replan.queued", priority: 1, payload: { nodeId: "mock-node-4", agent: "albedo", reason: "auto-replan" }, triggerSource: "skill-tool" },
      { type: "token_usage", priority: 2, payload: { agent: "self-exam", promptTokens: 18500, completionTokens: 4200, cacheHit: true, cost: 0.027, model: "deepseek-v4-flash", missionType: "self-exam" }, triggerSource: "governance" },
      { type: "governance.doc_code_gap", priority: 1, payload: { gapItems: 260, status: "indexed", lastAudit: "2026-06-28" }, notificationType: "WARNING", triggerSource: "governance" },

      // ═══ 破坏性测试事件 ═══
      { type: "exec.node.complete", priority: 2, eventId: "dup-test-001", payload: { nodeId: "mock-node-1", agent: "analysis", output: "完成（重复推送）", durationMs: 3200 }, triggerSource: "skill-tool" },
      { type: "exec.node.complete", priority: 2, eventId: "dup-test-001", payload: { nodeId: "mock-node-1", agent: "analysis", output: "完成（重复推送）", durationMs: 3200 }, triggerSource: "skill-tool" },
      { type: "exec.node.complete", priority: 2, eventId: "dup-test-001", payload: { nodeId: "mock-node-1", agent: "analysis", output: "完成（重复推送）", durationMs: 3200 }, triggerSource: "skill-tool" },
      { type: "exec.node.complete", priority: 2, payload: { nodeId: "mock-node-3", agent: "doc-govern", output: "审计完成（先到）", durationMs: 500 }, triggerSource: "governance" },
      { type: "exec.node.start", priority: 2, payload: { nodeId: "mock-node-3", agent: "doc-govern" }, triggerSource: "governance" },
      { type: "token_usage", priority: 2, payload: { agent: "stress-test", promptTokens: 999999, completionTokens: 999999, cacheHit: true, cost: 99.99, model: "deepseek-v4-max" }, triggerSource: "skill-tool" },
      { type: "unknown_event_type", priority: 2, payload: {} as any, triggerSource: "unknown" },
      { type: "exec.error.reported", priority: 0, payload: { message: "CRITICAL 风暴测试 #1" }, notificationType: "DECISION_REQUIRED", triggerSource: "skill-tool" },
      { type: "exec.error.reported", priority: 0, payload: { message: "CRITICAL 风暴测试 #2" }, notificationType: "DECISION_REQUIRED", triggerSource: "skill-tool" },
      { type: "exec.error.reported", priority: 0, payload: { message: "CRITICAL 风暴测试 #3" }, notificationType: "DECISION_REQUIRED", triggerSource: "skill-tool" },
    ];

    for (const evt of mockEvents) {
      await new Promise(r => setTimeout(r, 300));
      observer.emit({
        type: evt.type as any,
        priority: evt.priority as any,
        payload: evt.payload,
        timestamp: Date.now(),
        notificationType: evt.notificationType as any,
      } as any);
    }

    console.log(`[webui] Mock 数据注入完成：${mockEvents.length} 事件`);
  }

  // ════════════════════════════════════════════════════════
  // 注入 Mock 数据（跳过真实任务——placeholder API key 下 LLM 调用会挂起）
  // 真实任务需要有效 DEEPSEEK_API_KEY，scheduler.executeAll() 才能完成。
  // ════════════════════════════════════════════════════════
  async function runRealMission() {
    const hasValidKey = process.env.DEEPSEEK_API_KEY && !process.env.DEEPSEEK_API_KEY.startsWith("sk-placeholder");

    if (!hasValidKey) {
      console.log("[webui] DEEPSEEK_API_KEY 为占位符，跳过真实任务，直接注入 Mock 数据");
      await injectMockData();
      return;
    }

    if (!scheduler?.executeAll) {
      console.log("[webui] 引擎无 executeAll，回退 Mock");
      await injectMockData();
      return;
    }

    console.log("[webui] 发起真实任务...");
    try {
      // 在 TaskBoard 上注册一个轻量级自检节点
      const missionNode: TaskNode = {
        id: `webui-mission-${Date.now()}`,
        type: "analysis",
        tags: ["analysis" as any],
        needsMultiPerspective: false,
        status: "pending",
        claimedBy: [],
        payload: "WebUI 启动自检：简述 packages/engine/src/core/ 各模块职责，识别核心调度链路是否完整。不要修改文件，只读。",
        results: [],
        createdAt: Date.now(),
      };
      taskBoard.addNode(missionNode);

      const report = await scheduler.executeAll();
      console.log(`[webui] 真实任务完成: ${report?.totalNodes ?? '?'} 节点, ${report?.completed ?? '?'} 完成`);

      // 真实任务完成后也注入 Mock 事件，展示完整事件类型
      await injectMockData();
    } catch (err: any) {
      console.log(`[webui] 真实任务失败: ${err?.message}，回退 Mock`);
      await injectMockData();
    }
  }

  // 延迟 2 秒等引擎完全就绪后尝试真实任务
  setTimeout(() => runRealMission(), 2000);

  process.on("SIGINT", async () => {
    console.log("\n[webui] 正在停止...");
    await stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[webui] 启动失败:", err);
  process.exit(1);
});
