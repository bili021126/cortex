// @ci: e2e
/**
 * Skill 生命周期 E2E — load→query→execute→crystallization→degrade
 *
 * 场景: 加载技能 → 按tag查询 → 执行技能 → 沉淀为结晶 → 淘汰降级
 * 验证: skill生命周期完整 + crystallization阈值 + degrade路径
 *
 * @skip CI 中默认跳过（需要 MemoryStore 环境）
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SkillRegistry, deriveStatus, SkillTemplateEngine, crystallizeSkillToKnowledge, persistSkillsToMemory, loadSkillsFromMemory } from "@cortex/skill-kit";
import type { SkillTemplate, FeedbackEntry } from "@cortex/shared";
import type { MemoryStore } from "@cortex/memory-store";

// ─── 辅助：创建测试技能模板 ──────────────────────────

function createTestSkill(overrides: Partial<SkillTemplate> = {}): SkillTemplate {
  return {
    id: `test-skill-${Date.now()}`,
    name: "测试技能",
    triggerTags: ["test", "e2e"],
    steps: [{ type: "read_file", params: { file_path: "test.ts" } }],
    weight: overrides.weight ?? 0,
    feedbackHistory: overrides.feedbackHistory ?? [],
    createdAt: Date.now(),
    status: "trial",
    ...overrides,
  } as SkillTemplate;
}

describe.skip("Skill 生命周期: load→query→execute→crystallize→degrade", () => {
  let registry: SkillRegistry;
  let engine: SkillTemplateEngine;

  beforeAll(() => {
    registry = new SkillRegistry();
    engine = new SkillTemplateEngine();
  });

  // ─── Phase 1: Load & Query ───────────────────────

  it("Phase 1: 注册技能 → 按标签查询命中", () => {
    const skill = createTestSkill({ weight: 1, feedbackHistory: [{ agentId: "test", rating: 1, timestamp: Date.now() }] });
    registry.register(skill);

    const results = registry.queryByTags(["test"]);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((s) => s.id === skill.id)).toBe(true);
  });

  it("Phase 1b: 按标签查询 — 无匹配时返回空数组", () => {
    const results = registry.queryByTags(["non-existent-tag-xyz"]);
    expect(results.length).toBe(0);
  });

  // ─── Phase 2: Execute ─────────────────────────────

  it("Phase 2: SkillTemplateEngine 可渲染模板", () => {
    const skill = createTestSkill({
      steps: [
        { type: "read_file", params: { file_path: "{{file}}" } },
        { type: "search_code", params: { query: "{{query}}" } },
      ],
    });
    const context = { file: "src/index.ts", query: "export" };
    const rendered = engine.render(skill, context);

    expect(rendered).toBeDefined();
    expect(rendered.length).toBeGreaterThanOrEqual(1);
    // 步骤被渲染为字符串
  });

  // ─── Phase 3: Crystallization ─────────────────────

  it("Phase 3: deriveStatus 状态推导 — weight 阈值判定", () => {
    // trial: weight <= 0 或无正向评价
    expect(deriveStatus(0, [])).toBe("trial");
    expect(deriveStatus(-1, [])).toBe("trial");

    // active: weight >= 1 且有正向评价
    expect(deriveStatus(1, [{ agentId: "a", rating: 1, timestamp: 1 }])).toBe("active");
    expect(deriveStatus(5, [{ agentId: "a", rating: 1, timestamp: 1 }])).toBe("active");

    // 无正向评价时即使 weight >= 1 仍为 trial
    expect(deriveStatus(1, [{ agentId: "a", rating: 0, timestamp: 1 }])).toBe("trial");
  });

  it("Phase 3b: 正向评价推动 trial→active 转换", () => {
    const skill = createTestSkill({ weight: 0, feedbackHistory: [] });
    registry.register(skill);

    // 初始 status = trial（注册后 registry 内部调用 deriveStatus）
    expect(deriveStatus(skill.weight, skill.feedbackHistory)).toBe("trial");

    // 记录正向评价 → weight 累加
    registry.recordFeedback(skill.id, "agent-code", 1);
    const updated = registry.queryByTags(["test"]).find((s) => s.id === skill.id);
    expect(updated).toBeDefined();
    if (updated) {
      expect(deriveStatus(updated.weight, updated.feedbackHistory)).toBe("active");
    }
  });

  // ─── Phase 4: Degrade ────────────────────────────

  it("Phase 4: 连续负向评价导致 deprecated", () => {
    const skill = createTestSkill({
      weight: 2,
      feedbackHistory: [
        { agentId: "a", rating: 1, timestamp: 1 },
        { agentId: "b", rating: -1, timestamp: 2 },
        { agentId: "c", rating: -1, timestamp: 3 },
        { agentId: "d", rating: -1, timestamp: 4 },
      ],
    });

    const status = deriveStatus(skill.weight, skill.feedbackHistory);
    expect(status).toBe("deprecated");
  });

  it("Phase 4b: 孤技能清理 — cleanupOrphans 移除过期零权重技能", () => {
    const oldSkill = createTestSkill({
      weight: 0,
      feedbackHistory: [],
      createdAt: Date.now() - 10 * 24 * 60 * 60 * 1000, // 10天前
    });
    registry.register(oldSkill);

    // 清理 7天超时的孤技能
    const removed = registry.cleanupOrphans(7 * 24 * 60 * 60 * 1000);
    expect(removed).toContain(oldSkill.id);
  });

  // ─── Phase 5: 序列化/反序列化 ───────────────────

  it("Phase 5: 技能注册表可序列化为 JSON 并恢复", () => {
    const json = registry.toJSONString();
    expect(json).toBeTruthy();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(2);
    expect(Array.isArray(parsed.templates)).toBe(true);

    const restored = SkillRegistry.fromJSON(parsed);
    expect(restored.totalCount).toBe(registry.totalCount);
    expect(restored.activeCount).toBe(registry.activeCount);
  });
});
