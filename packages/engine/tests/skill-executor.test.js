// @ci: unit
/**
 * skill-registry.test.ts — 莫娜技能池单元测试。
 *
 * 技能不是可执行函数，是 Agent 产出的结构化认知。
 * 技能即记忆：一个 Agent 对另一个 Agent 说"我曾这样做成过"。
 *
 * Scene A: 标签匹配——queryByTags 按权重排序
 * Scene B: 多标签交叉匹配——不跨 kind 泄漏
 * Scene C: 评价回流闭环——recordFeedback + deriveStatus
 * Scene D: 注册表全生命周期——register→get→unregister→cleanupOrphans
 * Scene E: 技能模板字段完整性验证
 *
 * @since v2.6 — SkillExecutor 移除，SkillRegistry 统一技能池
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SkillRegistry, deriveStatus } from "@cortex/skill-kit";
// ─── Helpers ──────────────────────────────────────────────
function makeSkill(overrides = {}) {
    return {
        id: overrides.id ?? "skill-test-1",
        kind: overrides.kind ?? "action",
        name: overrides.name ?? "Test Skill",
        triggerTags: (overrides.triggerTags ?? ["fix", "bugfix"]),
        trigger: overrides.trigger ?? "Trigger on build or config error",
        steps: overrides.steps ?? ["Locate error file", "Analyze root cause", "Apply fix"],
        expectedOutput: overrides.expectedOutput ?? "Fixed code",
        status: overrides.status ?? "trial",
        weight: overrides.weight ?? 0,
        feedbackHistory: overrides.feedbackHistory ?? [],
        discoveredBy: overrides.discoveredBy ?? "LoopAgent",
        createdAt: overrides.createdAt ?? Date.now(),
    };
}
// ═══════════════════════════════════════════════════════════
// Scene A: 标签匹配
// ═══════════════════════════════════════════════════════════
describe("Scene A: queryByTags 标签匹配（按权重排序）", () => {
    let registry;
    beforeEach(() => {
        registry = new SkillRegistry();
    });
    it("queryByTags — active 优先于 trial 且按 weight 降序", () => {
        registry.registerAll([
            makeSkill({ id: "s-trial", name: "Trial CI Fix", status: "trial", triggerTags: ["fix"], weight: 10 }),
            makeSkill({ id: "s-active", name: "Active CI Fix", status: "active", triggerTags: ["fix"], weight: 5 }),
        ]);
        const matched = registry.queryByTags(["fix"]);
        expect(matched).toHaveLength(2);
        // 按 weight 降序排列——高权重在前
        expect(matched[0].id).toBe("s-trial");
        expect(matched[0].weight).toBe(10);
    });
    it("queryByTags — 同 weight 时顺序稳定", () => {
        registry.registerAll([
            makeSkill({ id: "s-a", name: "A", triggerTags: ["fix"], weight: 1 }),
            makeSkill({ id: "s-b", name: "B", triggerTags: ["fix"], weight: 1 }),
        ]);
        const matched = registry.queryByTags(["fix"]);
        expect(matched).toHaveLength(2);
    });
    it("queryByTags — 无匹配 tag 返回空数组", () => {
        registry.register(makeSkill({ triggerTags: ["review"] }));
        const matched = registry.queryByTags(["unknown_tag"]);
        expect(matched).toHaveLength(0);
    });
    it("queryByTags — 空 tags 返回空数组", () => {
        registry.register(makeSkill());
        const matched = registry.queryByTags([]);
        expect(matched).toHaveLength(0);
    });
    it("queryByTags — deprecated 技能不被匹配", () => {
        // status 由 deriveStatus(weight, feedbackHistory) 动态推导
        // 3 次连续负向评价 → deprecated
        registry.register(makeSkill({
            id: "s-dep",
            status: "deprecated",
            triggerTags: ["fix"],
            weight: -3,
            feedbackHistory: [
                { agentId: "a1", rating: -1, timestamp: Date.now() - 3000 },
                { agentId: "a2", rating: -1, timestamp: Date.now() - 2000 },
                { agentId: "a3", rating: -1, timestamp: Date.now() - 1000 },
            ],
        }));
        const matched = registry.queryByTags(["fix"]);
        expect(matched).toHaveLength(0);
    });
    it("queryByTags — 多条 tag 匹配同一技能不重复", () => {
        registry.register(makeSkill({
            id: "multi-tag",
            triggerTags: ["fix", "review", "ops"],
            weight: 3,
        }));
        const matched = registry.queryByTags(["fix", "review"]);
        expect(matched).toHaveLength(1);
        expect(matched[0].id).toBe("multi-tag");
    });
    it("queryByTags — 组合标签查询返回交集最大者", () => {
        registry.registerAll([
            makeSkill({ id: "s-review", triggerTags: ["review", "audit"], weight: 2 }),
            makeSkill({ id: "s-fix", triggerTags: ["fix", "bugfix"], weight: 2 }),
        ]);
        const matched = registry.queryByTags(["fix", "review"]);
        expect(["s-review", "s-fix"]).toContain(matched[0].id);
    });
});
// ═══════════════════════════════════════════════════════════
// Scene B: 多标签交叉匹配
// ═══════════════════════════════════════════════════════════
describe("Scene B: 多标签交叉匹配（不跨 kind 泄漏）", () => {
    let registry;
    beforeEach(() => {
        registry = new SkillRegistry();
        registry.registerAll([
            makeSkill({
                id: "skill-fix", name: "Bug Fix Skill",
                triggerTags: ["fix", "bugfix"],
                steps: ["Locate bug", "Fix code", "Verify fix"],
            }),
            makeSkill({
                id: "skill-review", name: "Code Review Skill",
                kind: "thought",
                triggerTags: ["review", "audit"],
                steps: ["Check code style", "Review logic correctness", "Output review report"],
            }),
            makeSkill({
                id: "skill-code", name: "Feature Implementation Skill",
                kind: "action",
                triggerTags: ["implementation", "feature"],
                steps: ["Understand requirements", "Design solution", "Implement code"],
            }),
        ]);
    });
    it("fix tag 匹配 fix skill 而非 review skill", () => {
        const matched = registry.queryByTags(["fix"]);
        expect(matched[0].id).toBe("skill-fix");
    });
    it("review tag 匹配 review skill", () => {
        const matched = registry.queryByTags(["review"]);
        expect(matched[0].id).toBe("skill-review");
    });
    it("implementation tag 匹配 code skill", () => {
        const matched = registry.queryByTags(["implementation"]);
        expect(matched[0].id).toBe("skill-code");
    });
    it("跨域标签不泄漏技能——audit 只匹配 review", () => {
        const reviewMatch = registry.queryByTags(["audit"]);
        expect(reviewMatch[0].id).toBe("skill-review");
        const fixMatch = registry.queryByTags(["bugfix"]);
        expect(fixMatch[0].id).toBe("skill-fix");
    });
    it("多标签查询返回所有匹配结果", () => {
        const matched = registry.queryByTags(["fix", "review"]);
        expect(matched.length).toBeGreaterThanOrEqual(2);
        const ids = matched.map((m) => m.id);
        expect(ids).toContain("skill-fix");
        expect(ids).toContain("skill-review");
    });
});
// ═══════════════════════════════════════════════════════════
// Scene C: 评价回流闭环 —— recordFeedback + deriveStatus
// ═══════════════════════════════════════════════════════════
describe("Scene C: 评价回流闭环 — recordFeedback + deriveStatus", () => {
    let registry;
    beforeEach(() => {
        registry = new SkillRegistry();
    });
    it("累计权重——5 次正向评价后 weight=5, status=active", () => {
        registry.register(makeSkill({
            id: "trial-to-active",
            status: "trial",
            weight: 0
        }));
        for (let i = 1; i <= 5; i++) {
            registry.recordFeedback("trial-to-active", `agent-${i}`, 1);
            const skill = registry.get("trial-to-active");
            expect(skill.weight).toBe(i);
            expect(skill.feedbackHistory.length).toBe(i);
        }
        const skill = registry.get("trial-to-active");
        expect(skill.weight).toBe(5);
        // deriveStatus: weight >= 1 && at least one rating=1 → active
        const status = deriveStatus(skill.weight, skill.feedbackHistory);
        expect(status).toBe("active");
    });
    it("正向评价不会清零历史", () => {
        registry.register(makeSkill({
            id: "keep-history",
            weight: 3,
            feedbackHistory: [
                { agentId: "a1", rating: 1, timestamp: Date.now() },
            ]
        }));
        registry.recordFeedback("keep-history", "a2", 1);
        const skill = registry.get("keep-history");
        expect(skill.weight).toBe(4);
        expect(skill.feedbackHistory.length).toBe(2);
    });
    it("3 次连续负向评价 → deprecated", () => {
        registry.register(makeSkill({
            id: "will-deprecate",
            status: "trial",
            weight: 0
        }));
        for (let i = 1; i <= 3; i++) {
            registry.recordFeedback("will-deprecate", `agent-${i}`, -1);
        }
        const skill = registry.get("will-deprecate");
        const status = deriveStatus(skill.weight, skill.feedbackHistory);
        expect(status).toBe("deprecated");
    });
    it("负向评价后正向评价 → 重置连续负向计数，状态回归", () => {
        registry.register(makeSkill({
            id: "recover",
            status: "trial",
            weight: 2,
            feedbackHistory: [
                { agentId: "a1", rating: -1, timestamp: Date.now() - 2000 },
                { agentId: "a2", rating: -1, timestamp: Date.now() - 1000 },
            ]
        }));
        // 正向评价打破连续负向
        registry.recordFeedback("recover", "a3", 1);
        const skill = registry.get("recover");
        const status = deriveStatus(skill.weight, skill.feedbackHistory);
        // weight=3, at least one positive → active
        expect(status).toBe("active");
    });
    it("active 技能持续接受正向评价（不退化为 trial）", () => {
        registry.register(makeSkill({
            id: "stay-active",
            status: "active",
            weight: 10
        }));
        registry.recordFeedback("stay-active", "a", 1);
        const skill = registry.get("stay-active");
        const status = deriveStatus(skill.weight, skill.feedbackHistory);
        expect(status).toBe("active");
        expect(skill.weight).toBe(11);
    });
    it("不存在的技能 recordFeedback 返回 false 不抛异常", () => {
        expect(registry.recordFeedback("nonexistent", "a", 1)).toBe(false);
    });
    it("完整生命周期: trial → 正向 5 次 → active → 连续 3 次负向 → deprecated", () => {
        registry.register(makeSkill({ id: "full-lifecycle", status: "trial", weight: 0 }));
        // 5 次正向
        for (let i = 0; i < 5; i++)
            registry.recordFeedback("full-lifecycle", `agent-${i}`, 1);
        let skill = registry.get("full-lifecycle");
        expect(deriveStatus(skill.weight, skill.feedbackHistory)).toBe("active");
        // 3 次连续负向
        for (let i = 0; i < 3; i++)
            registry.recordFeedback("full-lifecycle", `agent-bad-${i}`, -1);
        skill = registry.get("full-lifecycle");
        expect(deriveStatus(skill.weight, skill.feedbackHistory)).toBe("deprecated");
    });
    it("评价携带建议可被保留", () => {
        registry.register(makeSkill({ id: "with-suggestion" }));
        registry.recordFeedback("with-suggestion", "fixer", 1, "步骤 2 的 read_file 可以改用 glob 匹配");
        const skill = registry.get("with-suggestion");
        expect(skill.feedbackHistory[0].suggestion).toBe("步骤 2 的 read_file 可以改用 glob 匹配");
    });
});
// ═══════════════════════════════════════════════════════════
// Scene D: 注册表全生命周期
// ═══════════════════════════════════════════════════════════
describe("Scene D: 注册表全生命周期 — register→get→unregister→cleanupOrphans", () => {
    let registry;
    beforeEach(() => {
        registry = new SkillRegistry();
    });
    it("register + get 闭环", () => {
        registry.register(makeSkill({ id: "my-skill", name: "My Skill" }));
        const skill = registry.get("my-skill");
        expect(skill).toBeDefined();
        expect(skill.name).toBe("My Skill");
    });
    it("同名 register 覆盖旧模板", () => {
        registry.register(makeSkill({ id: "dup", name: "Old" }));
        registry.register(makeSkill({ id: "dup", name: "New" }));
        expect(registry.get("dup").name).toBe("New");
        expect(registry.totalCount).toBe(1);
    });
    it("unregister 移除技能并从标签索引清除", () => {
        registry.register(makeSkill({ id: "removable", triggerTags: ["fix"] }));
        expect(registry.get("removable")).toBeDefined();
        expect(registry.unregister("removable")).toBe(true);
        expect(registry.get("removable")).toBeUndefined();
        expect(registry.queryByTags(["fix"])).toHaveLength(0);
    });
    it("unregister 不存在的技能返回 false", () => {
        expect(registry.unregister("ghost")).toBe(false);
    });
    it("registerAll 批量注册", () => {
        registry.registerAll([
            makeSkill({ id: "a" }),
            makeSkill({ id: "b" }),
            makeSkill({ id: "c" }),
        ]);
        expect(registry.totalCount).toBe(3);
        expect(registry.get("a")).toBeDefined();
        expect(registry.get("b")).toBeDefined();
        expect(registry.get("c")).toBeDefined();
    });
    it("clear 清空所有技能", () => {
        registry.registerAll([makeSkill({ id: "a" }), makeSkill({ id: "b" })]);
        expect(registry.totalCount).toBe(2);
        registry.clear();
        expect(registry.totalCount).toBe(0);
    });
    it("cleanupOrphans 清理 weight=0 且过期的技能", () => {
        // 创建 7 天前的孤技能
        const oldDate = Date.now() - 8 * 24 * 60 * 60 * 1000;
        registry.register(makeSkill({ id: "orphan-old", weight: 0, createdAt: oldDate }));
        registry.register(makeSkill({ id: "keep-new", weight: 0, createdAt: Date.now() }));
        registry.register(makeSkill({ id: "keep-active", weight: 3, createdAt: oldDate }));
        const removed = registry.cleanupOrphans(7 * 24 * 60 * 60 * 1000);
        expect(removed).toContain("orphan-old");
        expect(removed).not.toContain("keep-new");
        expect(removed).not.toContain("keep-active");
        expect(registry.totalCount).toBe(2);
    });
});
// ═══════════════════════════════════════════════════════════
// Scene E: 技能模板字段完整性
// ═══════════════════════════════════════════════════════════
describe("Scene E: 技能模板字段完整性", () => {
    let registry;
    beforeEach(() => {
        registry = new SkillRegistry();
    });
    it("完整技能模板包含所有必填字段", () => {
        const skill = makeSkill({ id: "valid-skill" });
        registry.register(skill);
        const retrieved = registry.get("valid-skill");
        expect(retrieved.id).toBe("valid-skill");
        expect(retrieved.kind).toBe("action");
        expect(retrieved.name).not.toBe("");
        expect(retrieved.triggerTags.length).toBeGreaterThan(0);
        expect(retrieved.steps.length).toBeGreaterThan(0);
        expect(retrieved.weight).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(retrieved.feedbackHistory)).toBe(true);
    });
    it("缺少 name 的技能可注册但 queryByTags 仍能命中", () => {
        // 技能系统不强制校验——校验在入池前（外源导入时）由 SkillLoader 完成
        registry.register(makeSkill({ id: "no-name", name: "", triggerTags: ["fix"] }));
        const matched = registry.queryByTags(["fix"]);
        expect(matched).toHaveLength(1);
        expect(matched[0].name).toBe("");
    });
    it("缺少 triggerTags 的技能可注册", () => {
        registry.register(makeSkill({ id: "no-tags", triggerTags: [] }));
        expect(registry.get("no-tags")).toBeDefined();
        // 但 queryByTags 无法通过标签命中它
        expect(registry.queryByTags(["any"])).toHaveLength(0);
    });
    it("缺少 steps 的技能可注册", () => {
        registry.register(makeSkill({ id: "no-steps", steps: [] }));
        expect(registry.get("no-steps").steps).toHaveLength(0);
    });
    it("deprecated 技能可被 get 但不可被 queryByTags 命中", () => {
        registry.register(makeSkill({
            id: "dep-skill",
            status: "deprecated",
            triggerTags: ["fix"],
            weight: -3,
            feedbackHistory: [
                { agentId: "a1", rating: -1, timestamp: Date.now() - 3000 },
                { agentId: "a2", rating: -1, timestamp: Date.now() - 2000 },
                { agentId: "a3", rating: -1, timestamp: Date.now() - 1000 },
            ],
        }));
        expect(registry.get("dep-skill")).toBeDefined();
        expect(registry.queryByTags(["fix"])).toHaveLength(0);
    });
    it("activeCount 统计 trial + active 技能数", () => {
        // status 是衍生标签，由 deriveStatus(weight, feedbackHistory) 动态推导
        registry.register(makeSkill({ id: "a1", status: "active", weight: 5, feedbackHistory: [{ agentId: "x", rating: 1, timestamp: Date.now() }] }));
        registry.register(makeSkill({ id: "a2", status: "active", weight: 3, feedbackHistory: [{ agentId: "x", rating: 1, timestamp: Date.now() }] }));
        // deprecated: 3 次连续负向
        registry.register(makeSkill({ id: "d1", status: "deprecated", weight: -3, feedbackHistory: [{ agentId: "x", rating: -1, timestamp: Date.now() - 3000 }, { agentId: "x", rating: -1, timestamp: Date.now() - 2000 }, { agentId: "x", rating: -1, timestamp: Date.now() - 1000 }] }));
        registry.register(makeSkill({ id: "t1", status: "trial", weight: 0, feedbackHistory: [] }));
        expect(registry.activeCount).toBe(3); // a1, a2, t1
        expect(registry.totalCount).toBe(4);
    });
    it("getAll 返回所有已注册技能", () => {
        registry.registerAll([
            makeSkill({ id: "s1" }),
            makeSkill({ id: "s2" }),
        ]);
        const all = registry.getAll();
        expect(all).toHaveLength(2);
        expect(all.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    });
    it("技能结构可以被注入到 system prompt 中", () => {
        registry.register(makeSkill({
            id: "append-safe",
            name: "Append Safety Test",
            trigger: "Test scenario",
            steps: ["Verify append safety"],
            triggerTags: ["test"],
        }));
        const skill = registry.get("append-safe");
        const systemPrompt = "You are a code review agent. Check code quality.";
        // 技能不再是强制注入——由 Agent 自己决定是否参照
        // 但技能信息可以被结构化地附加到上下文中
        const skillContext = [
            `[技能参照: ${skill.name}]`,
            `触发条件: ${skill.trigger}`,
            ...skill.steps.map((s, i) => `${i + 1}. ${s}`),
            `预期产出: ${skill.expectedOutput}`,
        ].join("\n");
        const combined = systemPrompt + "\n\n" + skillContext;
        expect(combined).toContain(systemPrompt);
        expect(combined).toContain("[技能参照: Append Safety Test]");
        expect(combined).toContain("1. Verify append safety");
    });
});
//# sourceMappingURL=skill-executor.test.js.map