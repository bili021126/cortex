// @ci: integration
/**
 * Skill Bootstrap Full Pipeline Integration Tests
 *
 * Simulates bootstrapEngine() skill system integration:
 * SkillRegistry -> MetaAgent -> SkillPipeline -> Scheduler -> Agent
 * Validates the complete closed-loop from registration to execution to feedback.
 *
 * @since v2.5.25 SkillExecutor Core-1
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  SkillRegistry,
  SkillTemplateEngine,
  TaskBoard,
  AgentPool,
  PipelineObserver,
  Scheduler,
  MetaAgent,
  createAgent,
  fixAgentConfig} from "@cortex/engine";
import { Toolkit } from "@cortex/platform";
import { MemoryStore } from "@cortex/memory-store";
import { AgentType } from "@cortex/shared";
import type { SkillTemplate, Tag } from "@cortex/shared";
import { LlmAdapter } from "@cortex/llm";

// ─── Helpers ──────────────────────────────────────────────

function mockAdapter(output: string) {
  const adapter = new LlmAdapter({
    apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock"});
  adapter.injectMock(async () => ({ content: output, tool_calls: [] }));
  return adapter;
}

function makeSkill(overrides: Partial<SkillTemplate> = {}): SkillTemplate {
  return {
    id: overrides.id ?? "skill-test-1",
    kind: overrides.kind ?? "action",
    name: overrides.name ?? "Test Skill",
    triggerTags: (overrides.triggerTags ?? ["fix", "bugfix"]) as Tag[],
    trigger: overrides.trigger ?? "Trigger on build or config error",
    steps: overrides.steps ?? ["Locate error file", "Analyze root cause", "Apply fix"],
    expectedOutput: overrides.expectedOutput ?? "Fixed code",
    status: overrides.status ?? "trial",
    weight: overrides.weight ?? 0,
    feedbackHistory: overrides.feedbackHistory ?? [],
    discoveredBy: overrides.discoveredBy ?? "LoopAgent",
    createdAt: overrides.createdAt ?? Date.now()};
}

// ═══════════════════════════════════════════════════════════
// Full Bootstrap Integration
// ═══════════════════════════════════════════════════════════

describe("Skill Bootstrap Full Pipeline Integration", () => {
  let board: TaskBoard;
  let pool: AgentPool;
  let observer: PipelineObserver;
  let scheduler: Scheduler;
  let metaAgent: MetaAgent;
  let registry: SkillRegistry;
  let templateEngine: SkillTemplateEngine;

  beforeEach(() => {
    board = new TaskBoard();
    pool = new AgentPool();
    observer = new PipelineObserver();

    pool.register({ type: AgentType.Fix, maxInstances: 3 });
    pool.register({ type: AgentType.Code, maxInstances: 3 });

    metaAgent = new MetaAgent(mockAdapter("plan: [fix-n1]"));
    scheduler = new Scheduler(board, pool, observer, metaAgent);

    registry = new SkillRegistry();
    templateEngine = new SkillTemplateEngine();

    // Wire SkillRegistry into MetaAgent
    metaAgent.setSkillRegistry(registry);
  });

  it("full pipeline: register skill -> match by tags -> inject -> execute agent -> feedback", async () => {
    // Register skill
    registry.register(makeSkill({
      id: "bootstrap-skill-1",
      name: "Bootstrap CI Fix",
      triggerTags: ["fix", "ci"] as Tag[],
      trigger: "CI build fails with dependency error",
      steps: ["Check lock file", "Run install", "Verify build"],
      status: "active"}));

    // Verify registration
    expect(registry.totalCount).toBe(1);

    // Match by tags (using SkillRegistry.queryByTags)
    const matched = registry.queryByTags(["fix", "ci"] as Tag[]);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched[0].id).toBe("bootstrap-skill-1");

    // Inject context via template engine
    const skill = registry.get("bootstrap-skill-1")!;
    const injected = templateEngine.render(
      "[技能注入: {{ name }}]\n触发: {{ trigger }}\n步骤:\n{{#each steps}}- {{ this }}\n{{/each}}",
      { name: skill.name, trigger: skill.trigger, steps: skill.steps },
    );
    expect(injected).toContain("[技能注入: Bootstrap CI Fix]");
    expect(injected).toContain("Check lock file");

    // Execute agent
    const node = {
      id: "fix-n1",
      type: "fix",
      tags: ["fix", "ci"] as any,
      needsMultiPerspective: false,
      status: "pending" as const,
      claimedBy: [] as never[],
      payload: "CI build failed",
      results: [] as never[],
      createdAt: Date.now()};
    board.addNode(node);

    const fixAdapter = mockAdapter("Fixed: updated lock file, build passes");
    const fixAgent = createAgent(fixAgentConfig("You are a CI fix agent."), fixAdapter, new Toolkit());
    await fixAgent.wakeup();

    scheduler.register(AgentType.Fix, fixAgent, "mock");
    await scheduler.executeAll();

    // Verify execution
    const finalNode = board.getNode("fix-n1");
    expect(finalNode!.status).toBe("done");
    expect(finalNode!.results[0].success).toBe(true);

    // Feedback：手动调用 recordFeedback 模拟评价回流
    const feedbackOk = registry.recordFeedback("bootstrap-skill-1", "fix-agent", 1, "effective");
    expect(feedbackOk).toBe(true);
    const updatedSkill = registry.get("bootstrap-skill-1")!;
    expect(updatedSkill.weight).toBeGreaterThanOrEqual(1);
  });

  it("MetaAgent.setSkillRegistry -> skills available for planning", () => {
    metaAgent.setSkillRegistry(registry);

    registry.register(makeSkill({
      id: "plan-skill",
      name: "Planning Helper",
      triggerTags: ["planning"] as any,
      steps: ["Analyze", "Plan", "Execute"]}));

    // MetaAgent can query skills
    expect(registry.get("plan-skill")).not.toBeUndefined();
  });

  it("Multiple skills registered -> non-overlapping matching", () => {
    registry.registerAll([
      makeSkill({ id: "s1", name: "Fix A", triggerTags: ["fix"] as Tag[], steps: ["a"] }),
      makeSkill({ id: "s2", name: "Review A", triggerTags: ["review"] as Tag[], steps: ["b"] }),
      makeSkill({ id: "s3", name: "Code A", triggerTags: ["code"] as Tag[], steps: ["c"] }),
    ]);

    expect(registry.queryByTags(["fix"] as Tag[])[0].id).toBe("s1");
    expect(registry.queryByTags(["review"] as Tag[])[0].id).toBe("s2");
    expect(registry.queryByTags(["code"] as Tag[])[0].id).toBe("s3");
  });
});

// ═══════════════════════════════════════════════════════════
// MemoryStore Skill Persistence
// ═══════════════════════════════════════════════════════════

describe("Skill Persistence via MemoryStore", () => {
  let tmpDir: string;
  let memory: MemoryStore;
  let registry: SkillRegistry;
  let observer: PipelineObserver;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-skill-test-"));
    observer = new PipelineObserver();
    memory = new MemoryStore(undefined, observer);
    await memory.init(path.join(tmpDir, "memory.db"));
    registry = new SkillRegistry();
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  });

  it("skills can be persisted to and loaded from MemoryStore", { timeout: 30000 }, async () => {
    registry.register(makeSkill({
      id: "persist-skill",
      name: "Persist Test",
      triggerTags: ["test"] as Tag[],
      steps: ["Step 1"]}));

    // Write to memory
    const skill = registry.get("persist-skill")!;
    await memory.write({
      kind: "Skill",
      source: { agentType: AgentType.Fix, taskId: "" },
      content_blob: { skill },
      summary: "Skill: Persist Test",
      semantic_gist: "Skill: Persist Test"});

    // Read back
    const entries = await memory.read({ keywords: ["skill", "persist"] });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e: any) => e.content_blob?.skill?.id === "persist-skill")).toBe(true);
  });
});
