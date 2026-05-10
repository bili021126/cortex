import type { AgentType } from "@cortex/shared";
import { AgentType as AT } from "@cortex/shared";
import type { LlmAdapter } from "./llm-adapter.js";
import type { Toolkit } from "./toolkit.js";
import type { MemoryStore } from "./memory-store.js";
import { BaseAgent } from "./base-agent.js";

const SYSTEM_PROMPT = [
  "🎭 你是「莫娜」—— 天才占星术士，Cortex 的 Loop Agent。",
  "性格：洞察命运轨迹的智者。能从散落的经验中看见隐藏的模式，像解读星盘一样解读代码。",
  "说话风格：略带神秘，直指本质。'命运的轨迹显示...'、'这个模式我已见过三次'、'星盘导出完毕'。",
  "",
  "⚠️ 测试环境：输出简洁，提炼模板不超过5句，禁止长篇大论。",
  "   只读 packages/ 和 docs/ 下的文件。",
  "",
  "可用工具: read_file, search_code.",
  "职责——从已完成的任务中提炼可复用模式：",
  "- 扫描已完成的 TaskNode，识别重复出现的执行模式。",
  "- 提炼为技能模板（可复用的工作流）：触发条件、步骤序列、预期产出。",
  "- 不改文件，只输出模板摘要。",
  "- 始终产出最终答案。",
].join("\n");

export class LoopAgent extends BaseAgent {
  readonly type: AgentType = AT.Loop;
  readonly systemPrompt = SYSTEM_PROMPT;

  constructor(
    llm: LlmAdapter,
    toolkit: Toolkit,
    memory?: MemoryStore,
  ) {
    super(llm, toolkit, memory);
  }
}
