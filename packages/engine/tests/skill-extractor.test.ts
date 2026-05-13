// @ci: unit
import { describe, it, expect } from "vitest";
import { extractSkillsFromOutput } from "../src/components/skill-extractor.js";

/** 构造完整的 SkillTemplate JSON 输出 */
function skillOutput(skill: Record<string, unknown> | Record<string, unknown>[]): string {
  return `\`\`\`json\n${JSON.stringify(skill, null, 2)}\n\`\`\``;
}

const VALID_SKILL = {
  id: "skill-pattern-scan",
  agentType: "loop",
  name: "模式扫描",
  triggerTags: ["pattern_scan", "loop"],
  trigger: "当需要从已完成任务中寻找重复模式时触发",
  steps: [
    "用 read_file 读取 memory-store.ts 中的记忆写入逻辑",
    "用 search_code 搜索与当前任务标签匹配的历史记忆",
    "分析重复出现的执行模式",
    "输出 SkillTemplate JSON",
  ],
  expectedOutput: "技能模板 JSON",
  outputFile: "docs/skills/pattern-scan.json",
  status: "trial",
  adoptionCount: 0,
  rejectionCount: 0,
  discoveredBy: "LoopAgent",
};

describe("SkillExtractor", () => {
  it("should extract a single skill from JSON fence", () => {
    const result = extractSkillsFromOutput(skillOutput(VALID_SKILL));
    expect(result.skills.length).toBe(1);
    expect(result.skills[0].name).toBe("模式扫描");
    expect(result.skills[0].agentType).toBe("loop");
    expect(result.skills[0].steps.length).toBe(4);
  });

  it("should extract multiple skills from JSON array fence", () => {
    const output = skillOutput([
      { ...VALID_SKILL, id: "skill-1", name: "Skill One" },
      { ...VALID_SKILL, id: "skill-2", name: "Skill Two" },
    ]);
    const result = extractSkillsFromOutput(output);
    expect(result.skills.length).toBe(2);
    expect(result.skills[0].name).toBe("Skill One");
    expect(result.skills[1].name).toBe("Skill Two");
  });

  it("should extract from bare JSON (no fence)", () => {
    const result = extractSkillsFromOutput(JSON.stringify(VALID_SKILL));
    expect(result.skills.length).toBe(1);
    expect(result.skills[0].id).toBe("skill-pattern-scan");
  });

  it("should extract from bare JSON array (no fence)", () => {
    const result = extractSkillsFromOutput(JSON.stringify([VALID_SKILL]));
    expect(result.skills.length).toBe(1);
  });

  it("should generate id when missing", () => {
    const { id, ...noId } = VALID_SKILL;
    const result = extractSkillsFromOutput(JSON.stringify(noId));
    expect(result.skills.length).toBe(1);
    expect(result.skills[0].id).toMatch(/^skill-\d+-/);
  });

  it("should skip entry without name", () => {
    const { name, ...noName } = VALID_SKILL;
    const result = extractSkillsFromOutput(JSON.stringify(noName));
    expect(result.skills.length).toBe(0);
    expect(result.diagnostics.some((d: string) => d.includes("缺少 name"))).toBe(true);
  });

  it("should skip entry without steps", () => {
    const { steps, ...noSteps } = VALID_SKILL;
    const result = extractSkillsFromOutput(JSON.stringify(noSteps));
    expect(result.skills.length).toBe(0);
    expect(result.diagnostics.some((d: string) => d.includes("缺少 steps"))).toBe(true);
  });

  it("should default status to trial", () => {
    const { status, ...noStatus } = VALID_SKILL;
    const result = extractSkillsFromOutput(JSON.stringify(noStatus));
    expect(result.skills.length).toBe(1);
    expect(result.skills[0].status).toBe("trial");
  });

  it("should downgrade active status to trial", () => {
    const skill = { ...VALID_SKILL, status: "active" };
    const result = extractSkillsFromOutput(JSON.stringify(skill));
    expect(result.skills.length).toBe(1);
    expect(result.skills[0].status).toBe("trial");
    expect(result.diagnostics.some((d: string) => d.includes("降级"))).toBe(true);
  });

  it("should filter tags not in vocabulary", () => {
    const skill = {
      ...VALID_SKILL,
      triggerTags: ["implementation", "not_a_tag", "refactor"],
    };
    const result = extractSkillsFromOutput(JSON.stringify(skill));
    expect(result.skills.length).toBe(1);
    expect(result.skills[0].triggerTags).toEqual(["implementation", "refactor"]);
    expect(result.diagnostics.some((d: string) => d.includes("not_a_tag"))).toBe(true);
  });

  it("should handle snake_case field aliases", () => {
    const output = JSON.stringify({
      id: "skill-1",
      name: "Test",
      agentType: "code",
      trigger_tags: ["implementation"],
      trigger: "test",
      steps_json: ["step 1", "step 2"],
      expected_output: "file",
      output_file: "test.md",
    });
    const result = extractSkillsFromOutput(output);
    expect(result.skills.length).toBe(1);
    expect(result.skills[0].triggerTags).toEqual(["implementation"]);
    expect(result.skills[0].steps).toEqual(["step 1", "step 2"]);
    expect(result.skills[0].expectedOutput).toBe("file");
    expect(result.skills[0].outputFile).toBe("test.md");
  });

  it("should handle comma-separated steps string", () => {
    const skill = { ...VALID_SKILL, steps: "step A, step B, step C" };
    const result = extractSkillsFromOutput(JSON.stringify(skill));
    expect(result.skills.length).toBe(1);
    expect(result.skills[0].steps).toEqual(["step A", "step B", "step C"]);
  });

  it("should return empty for empty input", () => {
    const result = extractSkillsFromOutput("");
    expect(result.skills.length).toBe(0);
    expect(result.diagnostics.some((d: string) => d.includes("空输出"))).toBe(true);
  });

  it("should return empty for non-JSON input", () => {
    const result = extractSkillsFromOutput("This is just plain text, no JSON here.");
    expect(result.skills.length).toBe(0);
    expect(result.diagnostics.some((d: string) => d.includes("无法"))).toBe(true);
  });

  it("should extract JSON from text with surrounding noise", () => {
    const output = `Here is my analysis...\n\n${JSON.stringify(VALID_SKILL)}\n\nI hope this helps!`;
    const result = extractSkillsFromOutput(output);
    expect(result.skills.length).toBe(1);
    expect(result.skills[0].name).toBe("模式扫描");
  });

  it("should normalize unknown agentType to code", () => {
    const skill = { ...VALID_SKILL, agentType: "nonexistent" };
    const result = extractSkillsFromOutput(JSON.stringify(skill));
    expect(result.skills.length).toBe(1);
    expect(result.skills[0].agentType).toBe("code");
    expect(result.diagnostics.some((d: string) => d.includes("agentType"))).toBe(true);
  });

  it("should handle mixed valid/invalid entries in array", () => {
    const output = JSON.stringify([
      VALID_SKILL,
      { invalid: "no name or steps" },
      { ...VALID_SKILL, id: "skill-2", name: "Valid Two", steps: [] },
    ]);
    const result = extractSkillsFromOutput(output);
    expect(result.skills.length).toBe(1); // only VALID_SKILL passes
    expect(result.skills[0].id).toBe("skill-pattern-scan");
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);
  });

  it("should extract JSON array without fence containing newlines", () => {
    const output = `[\n${JSON.stringify(VALID_SKILL, null, 2)}\n]`;
    const result = extractSkillsFromOutput(output);
    expect(result.skills.length).toBe(1);
  });
});
