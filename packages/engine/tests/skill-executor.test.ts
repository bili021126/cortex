// @ci: llm
/**
 * SkillExecutor E2E tests — full pipeline validation.
 *
 * Scene A: Skill matching and prompt injection
 * Scene B: Multi-node parallel skill matching by tags
 * Scene C: Feedback loop — adopt/reject auto promote/demote
 * Scene D: Scheduler + SkillExecutor full pipeline
 * Scene E: validate skill completeness
 *
 * @since v2.5.25 SkillExecutor Core-1
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  SkillRegistry,
  SkillExecutor,
  TaskBoard,
  AgentPool,
  PipelineObserver,
  Scheduler,
  MetaAgent,
  Toolkit,
  MemoryStore,
  createAgent,
  codeAgentConfig,
  reviewAgentConfig,
  fixAgentConfig} from "@cortex/engine";
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
    agentType: overrides.agentType ?? AgentType.Fix,
    name: overrides.name ?? "Test Skill",
    triggerTags: (overrides.triggerTags ?? ["fix", "bugfix"]) as Tag[],
    trigger: overrides.trigger ?? "Trigger on build or config error",
    steps: overrides.steps ?? ["Locate error file", "Analyze root cause", "Apply fix"],
    expectedOutput: overrides.expectedOutput ?? "Fixed code",
    status: overrides.status ?? "trial",
    adoptionCount: overrides.adoptionCount ?? 0,
    rejectionCount: overrides.rejectionCount ?? 0,
    discoveredBy: overrides.discoveredBy ?? "LoopAgent",
    createdAt: overrides.createdAt ?? Date.now()};
}

function makeNode(overrides: Partial<{
  id: string; type: string; tags: string[]; payload: string;
}> = {}) {
  return {
    id: overrides.id ?? "n1",
    type: overrides.type ?? "implementation",
    tags: (overrides.tags ?? ["implementation"]) as any,
    needsMultiPerspective: false,
    status: "pending" as const,
    claimedBy: [] as never[],
    payload: overrides.payload ?? "do something",
    results: [] as never[],
    createdAt: Date.now()};
}

// ═══════════════════════════════════════════════════════════
// Scene A: Skill matching and prompt injection
// ═══════════════════════════════════════════════════════════

describe("Scene A: Skill matching and prompt injection", () => {
  let registry: SkillRegistry;
  let executor: SkillExecutor;

  beforeEach(() => {
    registry = new SkillRegistry();
    executor = new SkillExecutor(registry);
  });

  it("matchSkill — tag-based best match (active priority over trial)", () => {
    registry.registerAll([
      makeSkill({ id: "s-trial", name: "Trial CI Fix", status: "trial", triggerTags: ["fix"] as Tag[], adoptionCount: 10 }),
      makeSkill({ id: "s-active", name: "Active CI Fix", status: "active", triggerTags: ["fix"] as Tag[], adoptionCount: 2 }),
    ]);

    const matched = executor.matchSkill(["fix" as Tag]);
    expect(matched).not.toBeNull();
    expect(matched!.id).toBe("s-active");
    expect(matched!.name).toBe("Active CI Fix");
  });

  it("matchSkill — same status sorted by adoptionCount desc", () => {
    registry.registerAll([
      makeSkill({ id: "s-low", name: "Low Adopt", status: "trial", triggerTags: ["fix"] as Tag[], adoptionCount: 1 }),
      makeSkill({ id: "s-high", name: "High Adopt", status: "trial", triggerTags: ["fix"] as Tag[], adoptionCount: 10 }),
    ]);

    const matched = executor.matchSkill(["fix" as Tag]);
    expect(matched!.id).toBe("s-high");
  });

  it("matchSkill — no matching tag returns null", () => {
    registry.register(makeSkill({ triggerTags: ["review"] as Tag[] }));
    const matched = executor.matchSkill(["unknown_tag" as Tag]);
    expect(matched).toBeNull();
  });

  it("matchSkill — empty tags returns null", () => {
    registry.register(makeSkill());
    const matched = executor.matchSkill([]);
    expect(matched).toBeNull();
  });

  it("matchSkill — deprecated skill not matched", () => {
    registry.register(makeSkill({ id: "s-dep", status: "deprecated", triggerTags: ["fix"] as Tag[] }));
    const matched = executor.matchSkill(["fix" as Tag]);
    expect(matched).toBeNull();
  });

  it("injectSkillContext — generates correct prompt injection format", () => {
    registry.register(makeSkill({
      id: "ci-fix-flow",
      name: "CI Build Fix Flow",
      trigger: "CI build fails with dependency or config error",
      steps: [
        "read_file package.json to check dependency versions",
        "run_shell pnpm install to verify dependency resolution",
        "read_file tsconfig.json to check compile config",
        "Locate and fix the specific file based on error",
        "run_shell pnpm build to verify the fix",
      ],
      expectedOutput: "Fixed config + CI pass",
      status: "active"}));

    const injected = executor.injectSkillContext("ci-fix-flow");
    expect(injected).not.toBeNull();
    expect(injected!).toContain("[技能注入: CI Build Fix Flow]");
    expect(injected!).toContain("触发条件: CI build fails with dependency or config error");
    expect(injected!).toContain("1. read_file package.json to check dependency versions");
    expect(injected!).toContain("5. run_shell pnpm build to verify the fix");
    expect(injected!).toContain("预期产出: Fixed config + CI pass");
    expect(injected!).toContain("技能状态: 已验证");
  });

  it("injectSkillContext — deprecated skill returns null", () => {
    registry.register(makeSkill({ id: "old-skill", status: "deprecated" }));
    const injected = executor.injectSkillContext("old-skill");
    expect(injected).toBeNull();
  });

  it("injectSkillContext — nonexistent skill returns null", () => {
    const injected = executor.injectSkillContext("nonexistent");
    expect(injected).toBeNull();
  });

  it("injectByTags — combined tag matching and injection", () => {
    registry.register(makeSkill({
      id: "combo-test",
      name: "Combo Test Skill",
      trigger: "Combo operation detected",
      steps: ["Step 1", "Step 2"],
      triggerTags: ["ops", "deploy"] as Tag[]}));

    const injected = executor.injectByTags(["ops" as Tag]);
    expect(injected).toContain("[技能注入: Combo Test Skill]");
    expect(injected).toContain("技能状态: 试用期");
  });
});

// ═══════════════════════════════════════════════════════════
// Scene B: Multi-node parallel — skill matching by tags
// ═══════════════════════════════════════════════════════════

describe("Scene B: Multi-node parallel skill matching", () => {
  let registry: SkillRegistry;
  let executor: SkillExecutor;

  beforeEach(() => {
    registry = new SkillRegistry();
    executor = new SkillExecutor(registry);

    registry.registerAll([
      makeSkill({
        id: "skill-fix", name: "Bug Fix Skill",
        triggerTags: ["fix", "bugfix"] as Tag[],
        steps: ["Locate bug", "Fix code", "Verify fix"]}),
      makeSkill({
        id: "skill-review", name: "Code Review Skill",
        agentType: AgentType.Review,
        triggerTags: ["review", "audit"] as Tag[],
        steps: ["Check code style", "Review logic correctness", "Output review report"]}),
      makeSkill({
        id: "skill-code", name: "Feature Implementation Skill",
        agentType: AgentType.Code,
        triggerTags: ["implementation", "feature"] as Tag[],
        steps: ["Understand requirements", "Design solution", "Implement code"]}),
    ]);
  });

  it("fix tag matches fix skill not review skill", () => {
    const matched = executor.matchSkill(["fix" as Tag]);
    expect(matched!.id).toBe("skill-fix");
  });

  it("review tag matches review skill", () => {
    const matched = executor.matchSkill(["review" as Tag]);
    expect(matched!.id).toBe("skill-review");
  });

  it("implementation tag matches code skill", () => {
    const matched = executor.matchSkill(["implementation" as Tag]);
    expect(matched!.id).toBe("skill-code");
  });

  it("cross-domain tags do not leak skills", () => {
    const reviewMatch = executor.matchSkill(["audit" as Tag]);
    expect(reviewMatch!.id).toBe("skill-review");
    expect(reviewMatch!.agentType).toBe(AgentType.Review);

    const fixMatch = executor.matchSkill(["bugfix" as Tag]);
    expect(fixMatch!.id).toBe("skill-fix");
    expect(fixMatch!.agentType).toBe(AgentType.Fix);
  });

  it("multi-tag query returns best match", () => {
    const matched = executor.matchSkill(["fix", "review"]);
    expect(matched).not.toBeNull();
    expect(["skill-fix", "skill-review"]).toContain(matched!.id);
  });
});

// ═══════════════════════════════════════════════════════════
// Scene C: Feedback loop — adopt/reject auto promote/demote
// ═══════════════════════════════════════════════════════════

describe("Scene C: Feedback loop — adopt/reject auto promote/demote", () => {
  let registry: SkillRegistry;
  let executor: SkillExecutor;

  beforeEach(() => {
    registry = new SkillRegistry();
    executor = new SkillExecutor(registry);
  });

  it("5 consecutive adopts: trial -> active", () => {
    registry.register(makeSkill({
      id: "trial-to-active",
      status: "trial",
      adoptionCount: 0}));

    for (let i = 1; i <= 5; i++) {
      executor.recordFeedback("trial-to-active", true);
      const skill = registry.get("trial-to-active");
      expect(skill!.adoptionCount).toBe(i);
      expect(skill!.rejectionCount).toBe(0);
    }

    const skill = registry.get("trial-to-active");
    expect(skill!.status).toBe("active");
    expect(skill!.adoptionCount).toBe(5);
  });

  it("adopt resets rejectionCount", () => {
    registry.register(makeSkill({
      id: "reset-reject",
      status: "trial",
      rejectionCount: 2}));

    executor.recordFeedback("reset-reject", true);
    const skill = registry.get("reset-reject")!;
    expect(skill.rejectionCount).toBe(0);
    expect(skill.adoptionCount).toBe(1);
  });

  it("3 consecutive rejects -> deprecated", () => {
    registry.register(makeSkill({
      id: "will-deprecate",
      status: "trial",
      rejectionCount: 0}));

    for (let i = 1; i <= 3; i++) {
      executor.recordFeedback("will-deprecate", false);
      const skill = registry.get("will-deprecate");
      expect(skill!.rejectionCount).toBe(i);
    }

    const skill = registry.get("will-deprecate");
    expect(skill!.status).toBe("deprecated");
  });

  it("reject resets adoptionCount", () => {
    registry.register(makeSkill({
      id: "reset-adopt",
      status: "trial",
      adoptionCount: 4}));

    executor.recordFeedback("reset-adopt", false);
    const skill = registry.get("reset-adopt")!;
    expect(skill.adoptionCount).toBe(0);
    expect(skill.rejectionCount).toBe(1);
    expect(skill.status).toBe("trial");
  });

  it("active skill can still be adopted (no regression)", () => {
    registry.register(makeSkill({
      id: "stay-active",
      status: "active",
      adoptionCount: 10,
      rejectionCount: 0}));

    executor.recordFeedback("stay-active", true);
    const skill = registry.get("stay-active")!;
    expect(skill.status).toBe("active");
    expect(skill.adoptionCount).toBe(11);
  });

  it("nonexistent skill does not throw", () => {
    expect(() => executor.recordFeedback("nonexistent", true)).not.toThrow();
  });

  it("full lifecycle: trial -> adopt5x -> active -> reject3x -> deprecated", () => {
    registry.register(makeSkill({ id: "full-lifecycle", status: "trial" }));

    for (let i = 0; i < 5; i++) executor.recordFeedback("full-lifecycle", true);
    expect(registry.get("full-lifecycle")!.status).toBe("active");

    for (let i = 0; i < 3; i++) executor.recordFeedback("full-lifecycle", false);
    expect(registry.get("full-lifecycle")!.status).toBe("deprecated");
  });
});

// ═══════════════════════════════════════════════════════════
// Scene D: Scheduler + SkillExecutor full pipeline
// ═══════════════════════════════════════════════════════════

describe("Scene D: Scheduler + SkillExecutor pipeline", () => {
  let board: TaskBoard;
  let pool: AgentPool;
  let observer: PipelineObserver;
  let scheduler: Scheduler;
  let registry: SkillRegistry;
  let executor: SkillExecutor;

  beforeEach(() => {
    board = new TaskBoard();
    pool = new AgentPool();
    observer = new PipelineObserver();

    pool.register({ type: AgentType.Fix, maxInstances: 3 });
    pool.register({ type: AgentType.Code, maxInstances: 3 });
    pool.register({ type: AgentType.Review, maxInstances: 3 });

    const metaAgent = new MetaAgent(mockAdapter("plan: [fix-n1]"));
    scheduler = new Scheduler(board, pool, observer, metaAgent);

    registry = new SkillRegistry();
    executor = new SkillExecutor(registry);
  });

  it("FixAgent execution — SkillExecutor injects matching skill", async () => {
    registry.register(makeSkill({
      id: "ci-build-fix",
      name: "CI Build Fix Flow",
      triggerTags: ["fix", "config"] as Tag[],
      trigger: "CI build failed",
      steps: ["Check package.json", "Run pnpm install", "Verify fix"],
      status: "active"}));

    const node = makeNode({
      id: "fix-n1",
      type: "fix",
      tags: ["fix", "config", "ci"],
      payload: "CI build failed: module not found"});
    board.addNode(node);

    const matched = executor.matchSkill(["fix", "config", "ci"] as Tag[]);
    expect(matched).not.toBeNull();
    expect(matched!.id).toBe("ci-build-fix");

    const injected = executor.injectSkillContext("ci-build-fix");
    expect(injected).toContain("[技能注入: CI Build Fix Flow]");

    const fixAdapter = mockAdapter("Fixed package.json dependency updated to workspace:*, pnpm install success");
    const fixAgent = createAgent(fixAgentConfig("You are a test agent."), fixAdapter, new Toolkit());
    await fixAgent.wakeup();

    scheduler.register(AgentType.Fix, fixAgent, "mock");

    await scheduler.executeAll();

    const finalNode = board.getNode("fix-n1");
    expect(finalNode!.status).toBe("done");
    expect(finalNode!.results.length).toBeGreaterThan(0);
    expect(finalNode!.results[0].success).toBe(true);

    executor.recordFeedback("ci-build-fix", true);
    const skill = registry.get("ci-build-fix")!;
    expect(skill.adoptionCount).toBe(1);
  });

  it("skill matching should not cross Agent types — FixAgent does not match Review skill", () => {
    registry.registerAll([
      makeSkill({
        id: "fix-skill", name: "Fix", agentType: AgentType.Fix,
        triggerTags: ["fix"] as Tag[], steps: ["Fix step"]}),
      makeSkill({
        id: "review-skill", name: "Review", agentType: AgentType.Review,
        triggerTags: ["review"] as Tag[], steps: ["Review step"]}),
    ]);

    const fixMatch = executor.matchSkill(["fix" as Tag]);
    expect(fixMatch!.agentType).toBe(AgentType.Fix);

    const reviewMatch = executor.matchSkill(["review" as Tag]);
    expect(reviewMatch!.agentType).toBe(AgentType.Review);

    expect(fixMatch!.id).not.toBe(reviewMatch!.id);
  });

  it("prompt injection can be safely appended to system prompt", () => {
    registry.register(makeSkill({
      id: "append-safe",
      name: "Append Safety Test",
      trigger: "Test scenario",
      steps: ["Verify append safety"],
      triggerTags: ["test"] as Tag[]}));

    const systemPrompt = "You are a code review agent. Check code quality.";
    const injected = executor.injectSkillContext("append-safe")!;
    const combined = systemPrompt + "\n\n" + injected;

    expect(combined).toContain(systemPrompt);
    expect(combined).toContain("[技能注入: Append Safety Test]");
    expect(combined).toContain("1. Verify append safety");
  });
});

// ═══════════════════════════════════════════════════════════
// Scene E: validate skill completeness
// ═══════════════════════════════════════════════════════════

describe("Scene E: validate skill completeness", () => {
  let registry: SkillRegistry;
  let executor: SkillExecutor;

  beforeEach(() => {
    registry = new SkillRegistry();
    executor = new SkillExecutor(registry);
  });

  it("complete skill passes validation", () => {
    registry.register(makeSkill({ id: "valid-skill" }));
    const result = executor.validate("valid-skill");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("missing name returns error", () => {
    registry.register(makeSkill({ id: "no-name", name: "" }));
    const result = executor.validate("no-name");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("技能 no-name: 缺少 name");
  });

  it("missing triggerTags returns error", () => {
    registry.register(makeSkill({ id: "no-tags", triggerTags: [] }));
    const result = executor.validate("no-tags");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("缺少 triggerTags"))).toBe(true);
  });

  it("missing steps returns error", () => {
    registry.register(makeSkill({ id: "no-steps", steps: [] }));
    const result = executor.validate("no-steps");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("缺少 steps"))).toBe(true);
  });

  it("deprecated skill fails validation", () => {
    registry.register(makeSkill({ id: "dep-skill", status: "deprecated" }));
    const result = executor.validate("dep-skill");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("已废弃"))).toBe(true);
  });

  it("nonexistent skill fails validation", () => {
    const result = executor.validate("ghost-skill");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("不在注册表中");
  });

  it("available skill count is accurate", () => {
    registry.register(makeSkill({ id: "a1", status: "active" }));
    registry.register(makeSkill({ id: "a2", status: "active" }));
    registry.register(makeSkill({ id: "d1", status: "deprecated" }));
    registry.register(makeSkill({ id: "t1", status: "trial" }));

    expect(executor.availableCount).toBe(3);
  });
});
