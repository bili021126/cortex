/**
 * @cortex/skill-kit — 核心测试
 * 验证技能提取、注册表、JSON校验、管线订阅的端到端行为。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SkillRegistry, deriveStatus, extractSkillsFromOutput, validateExternalSkillJson, externalJsonToSkillTemplate, registerSkillPipeline, emitSkillReferenced, extractSkillUsageFromOutput, SkillTemplateEngine, } from "@cortex/skill-kit";
import { PipelinePriority, PipelineEventType } from "@cortex/shared";
class MockObserver {
    emitted = [];
    handlers = new Map();
    on(priority, handler) {
        const key = String(priority);
        const arr = this.handlers.get(key) ?? [];
        arr.push(handler);
        this.handlers.set(key, arr);
    }
    off(priority, handler) {
        if (!handler) {
            this.handlers.delete(String(priority));
            return;
        }
        const arr = this.handlers.get(String(priority));
        if (arr)
            this.handlers.set(String(priority), arr.filter((h) => h !== handler));
    }
    emit(event) {
        this.emitted.push({ type: String(event.type), priority: String(event.priority), payload: event.payload });
        const handlers = this.handlers.get(String(event.priority));
        if (handlers)
            for (const h of handlers)
                h(event);
    }
}
// ── SkillRegistry ──────────────────────────────
describe("SkillRegistry", () => {
    let registry;
    beforeEach(() => { registry = new SkillRegistry(); });
    it("should be empty initially", () => {
        expect(registry.totalCount).toBe(0);
        expect(registry.activeCount).toBe(0);
    });
    it("should register a skill template", () => {
        const tmpl = makeSkill({ id: "s1", name: "test-skill", triggerTags: ["fix"] });
        registry.register(tmpl);
        expect(registry.totalCount).toBe(1);
        expect(registry.get("s1")).toBeDefined();
    });
    it("should query by tags", () => {
        registry.register(makeSkill({ id: "a", triggerTags: ["fix", "refactor"], weight: 1 }));
        registry.register(makeSkill({ id: "b", triggerTags: ["test"] }));
        registry.register(makeSkill({ id: "c", triggerTags: ["fix"] }));
        const result = registry.queryByTags(["fix"]);
        expect(result.length).toBe(2);
        // weight高的排在前面
        expect(result[0].id).toBe("a");
    });
    it("should filter out deprecated skills in queryByTags", () => {
        const tmpl = makeSkill({ id: "d1", weight: -1 });
        tmpl.feedbackHistory = [{ agentId: "a1", rating: -1, timestamp: 0 }, { agentId: "a1", rating: -1, timestamp: 1 }, { agentId: "a1", rating: -1, timestamp: 2 }];
        registry.register(tmpl);
        expect(registry.queryByTags(["fix"]).length).toBe(0);
    });
    it("should record feedback and update weight", () => {
        registry.register(makeSkill({ id: "s", weight: 0 }));
        registry.recordFeedback("s", "agent1", 1);
        const skill = registry.get("s");
        expect(skill?.weight).toBe(1);
        expect(skill?.feedbackHistory.length).toBe(1);
    });
    it("should clear all entries", () => {
        registry.register(makeSkill({ id: "x" }));
        registry.clear();
        expect(registry.totalCount).toBe(0);
    });
    it("should serialize and deserialize", () => {
        registry.register(makeSkill({ id: "s1", name: "alpha" }));
        registry.register(makeSkill({ id: "s2", name: "beta" }));
        const json = registry.toJSON();
        expect(json.version).toBe(2);
        expect(json.templates.length).toBe(2);
        const restored = SkillRegistry.fromJSON(json);
        expect(restored.totalCount).toBe(2);
        expect(restored.get("s1")?.name).toBe("alpha");
    });
    it("should cleanup orphans older than maxAge", () => {
        const old = makeSkill({ id: "old", weight: 0, createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000 });
        registry.register(old);
        expect(registry.cleanupOrphans()).toContain("old");
        expect(registry.get("old")).toBeUndefined();
    });
});
// ── deriveStatus ────────────────────────────────
describe("deriveStatus", () => {
    it("should return trial when weight <= 0", () => {
        expect(deriveStatus(0, [])).toBe("trial");
        expect(deriveStatus(-1, [])).toBe("trial");
    });
    it("should return active when weight >= 1 and has positive feedback", () => {
        expect(deriveStatus(1, [{ agentId: "a", rating: 1, timestamp: 0 }])).toBe("active");
    });
    it("should return deprecated when 3+ consecutive negative", () => {
        expect(deriveStatus(5, [
            { agentId: "a", rating: -1, timestamp: 0 },
            { agentId: "a", rating: -1, timestamp: 1 },
            { agentId: "a", rating: -1, timestamp: 2 },
        ])).toBe("deprecated");
    });
    it("should handle null/undefined feedbackHistory", () => {
        expect(deriveStatus(1, undefined)).toBe("trial");
    });
});
// ── extractSkillsFromOutput ─────────────────────
describe("extractSkillsFromOutput", () => {
    it("should extract skill templates from JSON array", () => {
        const output = JSON.stringify([{
                id: "skill-1",
                kind: "action",
                name: "hex-fix",
                triggerTags: ["fix"],
                trigger: "When hex encoding fails",
                steps: ["step1"],
                expectedOutput: "Fixed",
                status: "trial",
                weight: 0,
                feedbackHistory: [],
                discoveredBy: "test",
                createdAt: 0,
            }]);
        const result = extractSkillsFromOutput(output);
        expect(result.skills.length).toBe(1);
        expect(result.skills[0].name).toBe("hex-fix");
    });
    it("should return empty skills for non-skill output", () => {
        const result = extractSkillsFromOutput("just some text without skills");
        expect(result.skills.length).toBe(0);
    });
});
// ── validateExternalSkillJson ───────────────────
describe("validateExternalSkillJson", () => {
    it("should validate a minimal correct skill JSON", () => {
        const json = {
            id: "ext-001",
            kind: "action",
            name: "ext-skill",
            triggerTags: ["fix"],
            trigger: "When fixing",
            steps: ["Do X"],
            expectedOutput: "Fixed",
            discoveredBy: "test",
        };
        const result = validateExternalSkillJson(json);
        expect(result.valid).toBe(true);
    });
    it("should reject JSON without required fields", () => {
        const result = validateExternalSkillJson({});
        expect(result.valid).toBe(false);
    });
});
// ── externalJsonToSkillTemplate ─────────────────
describe("externalJsonToSkillTemplate", () => {
    it("should convert valid JSON to SkillTemplate", () => {
        const json = {
            name: "converted",
            summary: "Converted skill",
            triggerTags: ["analysis"],
            category: "analysis",
            steps: [{ description: "Step 1", template: "do it" }],
            source: "external",
        };
        const tmpl = externalJsonToSkillTemplate(json);
        expect(tmpl.name).toBe("converted");
        expect(tmpl.triggerTags).toContain("analysis");
        expect(tmpl.status).toBe("trial");
        expect(tmpl.weight).toBe(0);
    });
});
// ── registerSkillPipeline + emitSkillReferenced ─
describe("skill-pipeline", () => {
    it("should register and emit skill referenced events", () => {
        const registry = new SkillRegistry();
        const observer = new MockObserver();
        const tmpl = makeSkill({ id: "ref-1", name: "reference" });
        registry.register(tmpl);
        emitSkillReferenced(observer, [tmpl], "node-1", "Code");
        expect(observer.emitted.length).toBe(1);
        expect(observer.emitted[0].type).toBe(String(PipelineEventType.SkillReferenced));
    });
    it("should extract skill usage from output", () => {
        const output = 'some text [技能参照: hex-fix] used=[0,1] skipped=[2] adaptation="adjusted TTL" more text';
        const result = extractSkillUsageFromOutput(output);
        expect(result).not.toBeNull();
        expect(result[0].skillName).toBe("hex-fix");
        expect(result[0].stepsUsed).toEqual([0, 1]);
        expect(result[0].stepsSkipped).toEqual([2]);
        expect(result[0].adaptation).toBe("adjusted TTL");
    });
    it("should register pipeline handler that extracts skills on NodeComplete", () => {
        const registry = new SkillRegistry();
        const observer = new MockObserver();
        const cancel = registerSkillPipeline(observer, registry);
        expect(cancel).toBeDefined();
        // Pipe a skill output
        const skillOutput = JSON.stringify([{
                id: "pipeline-skill",
                kind: "action",
                name: "pipe-extracted",
                triggerTags: ["test"],
                trigger: "On test",
                steps: ["s1"],
                expectedOutput: "Done",
                status: "trial",
                weight: 0,
                feedbackHistory: [],
                discoveredBy: "test",
                createdAt: 0,
            }]);
        observer.emit({
            type: PipelineEventType.NodeComplete,
            priority: PipelinePriority.HIGH,
            payload: { nodeId: "n1", agentType: "Code", success: true, output: skillOutput },
            timestamp: Date.now(),
        });
        // Should have registered the skill
        expect(registry.totalCount).toBe(1);
        expect(registry.get("pipeline-skill")?.name).toBe("pipe-extracted");
    });
});
// ── SkillTemplateEngine ─────────────────────────
describe("SkillTemplateEngine", () => {
    it("should render template with context variables", () => {
        const engine = new SkillTemplateEngine({});
        const result = engine.render("Hello {{name}}, your task is {{task}}.", { name: "Agent", task: "fix bug" });
        expect(result).toBe("Hello Agent, your task is fix bug.");
    });
    it("should replace missing variables with empty string", () => {
        const engine = new SkillTemplateEngine({});
        const result = engine.render("{{missing}} here", {});
        expect(result).toBe(" here");
    });
});
// ── Helpers ─────────────────────────────────────
function makeSkill(overrides) {
    return {
        kind: "action",
        name: overrides.name ?? "default-skill",
        triggerTags: overrides.triggerTags ?? ["fix"],
        trigger: "When fixing bugs",
        steps: overrides.steps ?? ["step 1"],
        expectedOutput: "Fixed code",
        status: overrides.status ?? "trial",
        weight: overrides.weight ?? 0,
        feedbackHistory: overrides.feedbackHistory ?? [],
        discoveredBy: "test",
        createdAt: overrides.createdAt ?? Date.now(),
        ...overrides,
    };
}
//# sourceMappingURL=core.test.js.map