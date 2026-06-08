/**
 * 测试技能模块——用于 DynamicImportLoader 的单元测试。
 *
 * 遵循技能模块规范：
 * - export default 导出 SkillDefinition
 * - 包含 meta / execute / validateInput
 */
import type { SkillDefinition, SkillContext } from "../../dist/types.js";
import { SkillCategory } from "../../dist/types.js";

interface TestInput {
  name: string;
  count?: number;
}

interface TestOutput {
  greeting: string;
  count: number;
}

const testSkill: SkillDefinition<TestInput, TestOutput> = {
  meta: {
    id: "test-skill",
    name: "测试技能",
    version: "1.0.0",
    description: "用于单元测试的示例技能",
    category: SkillCategory.TOOL,
    triggerTags: ["test"],
    trigger: "需要测试时触发",
    steps: ["接收输入参数", "生成问候语", "返回结果"],
    expectedOutput: "返回问候语和计数",
    author: "阿贝多",
  },

  validateInput(input: unknown): input is TestInput {
    return (
      typeof input === "object" &&
      input !== null &&
      "name" in input &&
      typeof (input as Record<string, unknown>).name === "string"
    );
  },

  async execute(ctx: SkillContext<TestInput>) {
    const { name, count = 1 } = ctx.input;
    ctx.logger.info(`执行测试技能：name=${name}, count=${count}`);

    return {
      success: true,
      data: {
        greeting: `你好，${name}！`,
        count,
      },
    };
  },
};

export default testSkill;
