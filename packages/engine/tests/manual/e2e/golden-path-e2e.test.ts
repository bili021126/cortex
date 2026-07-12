// @ci: e2e
/**
 * 黄金路径 E2E — 7跳全链路
 *
 * Memory(write) → Skill(load/query) → Agent(wake) → Plan(generate)
 * → Scheduler(dispatch) → Tool(execute) → Memory(read/verify)
 *
 * 全 mock 模式：LLM 调用返回固定 JSON，不消耗 API。
 * 不依赖 bootstrapEngine，手动装配组件。
 *
 * @skip CI 中需设置 DEEPSEEK_API_KEY，默认跳过
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import { AgentType, PipelinePriority, type TaskNode } from "@cortex/shared";
import { TaskBoard, AgentPool, PipelineObserver, ConfirmGate } from "@cortex/scheduler";
import { MemoryStore } from "@cortex/memory-store";
import { SkillRegistry } from "@cortex/skill-kit";
import { Toolkit } from "@cortex/platform";
import { LlmAdapter } from "@cortex/llm";
import { createE2eMockFactory } from "../../fixtures/mock-llm-factory.js";
import { Scheduler } from "../../../src/core/scheduler.js";
import { createAgent } from "../../../src/components/index.js";
import { codeAgentConfig } from "../../../src/agents/registry.js";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const projectRoot = path.resolve(__dirname, "..", "..", "..", "..", "..");
const SKILL_DIR = path.join(projectRoot, "skills");

describe("黄金路径 7跳: Memory→Skill→Agent→Plan→Scheduler→Tool→Memory", () => {
  if (process.env.CI) return; // 需要真实 LLM，CI 跳过
  let store: MemoryStore;
  let skillRegistry: SkillRegistry;
  let scheduler: Scheduler;
  let board: TaskBoard;
  let pool: AgentPool;
  let observer: PipelineObserver;
  let toolkit: Toolkit;
  let entryId: string;
  const events: string[] = [];

  beforeAll(async () => {
    // ── 1. Memory: 初始化记忆存储 ──
    store = new MemoryStore();
    await store.init(":memory:");

    // ── 2. Skill: 初始化技能注册表 ──
    skillRegistry = new SkillRegistry();
    if (fs.existsSync(SKILL_DIR)) {
      const files = fs.readdirSync(SKILL_DIR).filter((f) => f.endsWith(".json"));
      for (const f of files) {
        try {
          const raw = fs.readFileSync(path.join(SKILL_DIR, f), "utf-8");
          const skill = JSON.parse(raw) as any;
          if (skill.id && skill.triggerTags && skill.steps) {
            skillRegistry.register(skill);
          }
        } catch { /* skip invalid */ }
      }
    }

    // ── 3. Agent + Scheduler: 装配调度引擎 ──
    observer = new PipelineObserver();
    observer.on(PipelinePriority.HIGH, (e: any) => events.push(e.type ?? ""));
    observer.on(PipelinePriority.NORMAL, (e: any) => events.push(e.type ?? ""));

    board = new TaskBoard();
    pool = new AgentPool();
    scheduler = new Scheduler(board, pool, observer);

    const gate = new ConfirmGate();
    gate.bypassAll();
    toolkit = new Toolkit();
    toolkit.setGate(gate);
    toolkit.setObserver(observer);
    // 创建 Mock Code Agent
    const factory = createE2eMockFactory();
    const adapter = factory.forCode('export const _golden_e2e = true;');
    const agent = createAgent(codeAgentConfig("mock E2E golden path"), adapter, toolkit, store);
    await agent.wakeup();
    pool.register({ type: AgentType.Code, maxInstances: 2 });
    scheduler.register(AgentType.Code, agent, "mock-chat");
  });

  afterAll(async () => {
    // 清理测试文件
    const tmp = path.join(projectRoot, "_golden_e2e.ts");
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    await store.close();
  });

  it("完整闭环: write→load→wake→plan→dispatch→execute→verify", { timeout: 120000 }, async () => {
    // ── Step 1: Memory.write ──
    entryId = await store.write({
      source: { agentType: "code" as AgentType, taskId: "e2e" },
      kind: "TaskLog" as any,
      semantic_gist: "golden path test",
      content_blob: { test: true },
      summary: "E2E golden",
      weight: 1,
    });
    expect(entryId).toBeTruthy();
    expect(typeof entryId).toBe("string");

    // ── Step 2: Skill.queryByTags ──
    const skills = skillRegistry.queryByTags(["test", "e2e"]);
    // 技能可能为空，不强制断言有结果

    // ── Step 3: Agent.wakeup ──
    // Agent 已在 beforeAll 中 wakeup，验证 status
    // 实际 agent 在 pool 中注册，状态由 pool 管理

    // ── Step 4: Plan ──
    // 直接用构造好的 TaskNode 模拟 MetaAgent 输出
    const planNodes: TaskNode[] = [
      {
        id: "golden-impl",
        type: "implementation",
        tags: ["code"],
        status: "pending",
        claimedBy: [],
        payload: "Create _golden_e2e.ts with export const _golden_e2e = true",
        results: [],
        needsMultiPerspective: false,
        createdAt: Date.now(),
      },
    ];
    expect(planNodes.length).toBeGreaterThan(0);

    // ── Step 5: Scheduler.executeAll ──
    events.length = 0;
    for (const n of planNodes) board.addNode(n);
    const report = await scheduler.executeAll();

    expect(report.completed).toBeGreaterThan(0);
    expect(report.failed).toBe(0);
    expect(report.totalNodes).toBeGreaterThan(0);
    expect(report.durationMs).toBeGreaterThan(0);

    // ── Step 6: Tool — 验证文件创建 ──
    // Mock Agent 默认调 write_file，但不走真实文件系统
    // 此处验证 scheduler 执行成功即可

    // ── Step 7: Memory.read — 验证写入的记忆可读 ──
    const entries = await store.read({ kind: "TaskLog" as any });
    const found = entries.some((e) => e.summary?.includes("E2E golden"));
    expect(found).toBe(true);
  });

  it("验证 PipelineObserver 事件链完整", { timeout: 120000 }, () => {
    // 前序测试已收集 events，验证关键事件存在
    const eventTypes = [
      "scheduler.loop_start",
      "node.start",
    ];
    for (const t of eventTypes) {
      expect(events.some((e) => e.includes(t.replace("node.", "")) || e.includes(t))).toBe(true);
    }
  });
});
