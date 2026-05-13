// @ci: integration
import { describe, it, expect, beforeEach } from "vitest";
import { SkillRegistry, AgentType } from "@cortex/shared";
import type { SkillTemplate, Tag } from "@cortex/shared";
import { extractSkillsFromOutput } from "../src/components/skill-extractor.js";

/** 模拟 LoopAgent 输出：模式提炼 + SkillTemplate JSON */
function mockLoopAgentOutput(skills: Record<string, unknown>[]): string {
  return "```json\n" + JSON.stringify(skills, null, 2) + "\n```";
}

/**
 * 技能系统集成测试。
 * 验证完整的技能生命周期：
 *   LoopAgent 输出 → SkillExtractor 解析 → SkillRegistry 注册 → MetaAgent 查询
 */
describe("Skill System Integration", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  /**
   * 模拟完整的技能沉淀流程：
   * 1. LoopAgent 检测到重复模式，输出 SkillTemplate JSON
   * 2. SkillExtractor 解析输出
   * 3. 注册到 SkillRegistry
   * 4. MetaAgent 可查询使用
   */
  it("full lifecycle: LoopAgent output → register → MetaAgent query", () => {
    // 阶段1：LoopAgent 输出
    const loopOutput = mockLoopAgentOutput([
      {
        id: "skill-ci-fix",
        name: "CI 构建修复流程",
        agentType: "fix",
        triggerTags: ["fix", "bugfix", "config"],
        trigger: "当 CI 构建失败且错误与依赖或配置相关时触发",
        steps: [
          "用 read_file 读取 package.json 检查依赖版本",
          "用 run_shell 执行 pnpm install 验证依赖解析",
          "用 read_file 读取 tsconfig.json 检查编译配置",
          "根据错误信息定位具体文件并修复",
          "用 run_shell 执行 pnpm build 验证修复",
        ],
        expectedOutput: "修复后的配置文件 + CI 通过",
        outputFile: "docs/fixes/{date}-ci-fix.md",
        status: "trial",
      },
      {
        id: "skill-memory-cleanup",
        name: "记忆清理巡检",
        agentType: "loop",
        triggerTags: ["loop", "pattern_scan", "skill_precipitate"],
        trigger: "当 MemoryStore 中存在超过30天的废弃记忆时触发",
        steps: [
          "用 read_file 读取 memory-store.ts 了解清理 API",
          "用 search_code 搜索过期的 Episodic 记忆",
          "冻结超过30天未访问的记忆",
          "归档已冻结超过7天的记忆",
          "清理湮灭态记忆的关联边",
        ],
        expectedOutput: "清理报告：冻结/归档/湮灭计数",
        status: "trial",
      },
    ]);

    // 阶段2：SkillExtractor 解析
    const { skills, diagnostics } = extractSkillsFromOutput(loopOutput);
    expect(skills.length).toBe(2);
    // status "active" 会被降级为 "trial"，每个产生一条诊断

    // 阶段3：注册到 SkillRegistry
    registry.registerAll(skills);
    expect(registry.totalCount).toBe(2);
    expect(registry.activeCount).toBe(2); // trial status is active

    // 阶段4：MetaAgent 查询
    // fix 类型查询
    const fixSkills = registry.queryByTags(["fix" as Tag]);
    expect(fixSkills.length).toBe(1);
    expect(fixSkills[0].name).toBe("CI 构建修复流程");
    expect(fixSkills[0].steps.length).toBe(5);

    // loop 类型查询
    const loopSkills = registry.queryByAgent(AgentType.Loop);
    expect(loopSkills.length).toBe(1);
    expect(loopSkills[0].name).toBe("记忆清理巡检");

    // 按标签查询
    const patternScanSkills = registry.queryByTags(["skill_precipitate" as Tag]);
    expect(patternScanSkills.length).toBe(1);

    // 不匹配的标签
    const noMatch = registry.queryByTags(["browser" as Tag]);
    expect(noMatch.length).toBe(0);
  });

  it("should auto-generate id and track via registry", () => {
    const output = mockLoopAgentOutput([
      {
        name: "Auto-generated Skill",
        agentType: "code",
        triggerTags: ["implementation"],
        trigger: "auto trigger",
        steps: ["step 1", "step 2"],
      },
    ]);

    const { skills } = extractSkillsFromOutput(output);
    expect(skills.length).toBe(1);
    expect(skills[0].id).toMatch(/^skill-/);

    registry.register(skills[0]);
    expect(registry.get(skills[0].id)).toBeDefined();
  });

  it("should handle duplicate registration (overwrite)", () => {
    const skill: SkillTemplate = {
      id: "skill-v1",
      agentType: AgentType.Code,
      name: "Version 1",
      triggerTags: ["implementation" as Tag],
      trigger: "test",
      steps: ["step 1"],
      expectedOutput: "output",
      status: "trial",
      adoptionCount: 0,
      rejectionCount: 0,
      discoveredBy: "LoopAgent",
      createdAt: Date.now(),
    };

    registry.register(skill);
    expect(registry.get("skill-v1")?.name).toBe("Version 1");

    const updated: SkillTemplate = {
      ...skill,
      name: "Version 2",
      steps: ["step 1", "step 2"],
    };
    registry.register(updated);
    expect(registry.get("skill-v1")?.name).toBe("Version 2");
    expect(registry.get("skill-v1")?.steps.length).toBe(2);
    expect(registry.totalCount).toBe(1); // no duplicate
  });

  it("should filter deprecated skills from queries", () => {
    registry.register({
      id: "skill-active",
      agentType: AgentType.Code,
      name: "Active Skill",
      triggerTags: ["implementation" as Tag],
      trigger: "test",
      steps: ["step"],
      expectedOutput: "ok",
      status: "active",
      adoptionCount: 0,
      rejectionCount: 0,
      discoveredBy: "LoopAgent",
      createdAt: Date.now(),
    });

    registry.register({
      id: "skill-deprecated",
      agentType: AgentType.Code,
      name: "Deprecated Skill",
      triggerTags: ["implementation" as Tag],
      trigger: "test",
      steps: ["step"],
      expectedOutput: "ok",
      status: "deprecated",
      adoptionCount: 0,
      rejectionCount: 5,
      discoveredBy: "LoopAgent",
      createdAt: Date.now(),
    });

    expect(registry.totalCount).toBe(2);
    expect(registry.activeCount).toBe(1);

    const byTag = registry.queryByTags(["implementation" as Tag]);
    expect(byTag.length).toBe(1);
    expect(byTag[0].id).toBe("skill-active");

    const byAgent = registry.queryByAgent(AgentType.Code);
    expect(byAgent.length).toBe(1);
  });

  it("should round-trip skills through persistence", () => {
    // 注册
    const loopOutput = mockLoopAgentOutput([
      {
        id: "skill-persist-1",
        name: "Persist Test",
        agentType: "review",
        triggerTags: ["review", "audit"],
        trigger: "test persistence",
        steps: ["step 1", "step 2"],
        status: "active",
      },
    ]);

    const { skills } = extractSkillsFromOutput(loopOutput);
    expect(skills.length).toBe(1);
    registry.registerAll(skills);

    // 持久化
    const json = registry.toJSON();
    expect(json.templates.length).toBe(1);
    expect(json.version).toBe(1);

    // 恢复
    const restored = SkillRegistry.fromJSON(json);
    expect(restored.totalCount).toBe(1);
    expect(restored.get("skill-persist-1")?.name).toBe("Persist Test");
    expect(restored.queryByAgent(AgentType.Review).length).toBe(1);
  });

  it("should unregister and clean indexes", () => {
    registry.register({
      id: "skill-to-remove",
      agentType: AgentType.Fix,
      name: "To Remove",
      triggerTags: ["fix" as Tag, "bugfix" as Tag],
      trigger: "test",
      steps: ["step"],
      expectedOutput: "ok",
      status: "active",
      adoptionCount: 0,
      rejectionCount: 0,
      discoveredBy: "LoopAgent",
      createdAt: Date.now(),
    });

    expect(registry.queryByTags(["fix" as Tag]).length).toBe(1);
    expect(registry.queryByAgent(AgentType.Fix).length).toBe(1);

    registry.unregister("skill-to-remove");

    expect(registry.totalCount).toBe(0);
    expect(registry.queryByTags(["fix" as Tag]).length).toBe(0);
    expect(registry.queryByAgent(AgentType.Fix).length).toBe(0);
  });

  it("should handle empty LoopAgent output gracefully", () => {
    // LoopAgent 有时候输出解释性文字而非 JSON
    const output = "经过分析，当前任务中没有发现可重复的模式。所有执行路径都是首次出现。";

    const { skills, diagnostics } = extractSkillsFromOutput(output);
    expect(skills.length).toBe(0);
    expect(diagnostics.length).toBeGreaterThan(0);

    // 不应崩溃
    registry.registerAll(skills);
    expect(registry.totalCount).toBe(0);
  });
});
