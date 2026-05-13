import type { TaskNode, NodeResult, AgentType, LlmMessage, ToolDef, SafeErrorReporter } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "../toolkit.js";
import type { MemoryStore } from "../memory-store.js";

const DEFAULT_MAX_LOOPS = 64;

/**
 * ReAct 循环上下文——解耦 BaseAgent 继承链。
 * 所有执行型 Agent 通过此上下文注入依赖，不再依赖 this.llm / this.toolkit 等隐式耦合。
 */
export interface ReActContext {
  agentType: AgentType;
  llm: LlmAdapter;
  toolkit: Toolkit;
  systemPrompt: string;
  maxLoops: number;
  memory?: MemoryStore;
  safeReporter?: SafeErrorReporter;
}

/**
 * 共享 ReAct 循环——所有 Agent 共用。
 * 从 react-helper.ts 提取，增加 ReActContext 封装。
 *
 * @param ctx ReAct 上下文——Agent 类型 + 注入依赖
 * @param node 任务节点
 * @param model LLM 模型名
 */
export async function runReActLoop(
  ctx: ReActContext,
  node: TaskNode,
  model: string,
): Promise<NodeResult> {
  const { agentType, llm, toolkit, systemPrompt, maxLoops } = ctx;

  const toolDefs: ToolDef[] = toolkit.listDefinitions(agentType).map((d) => ({
    name: d.name,
    description: d.description,
    parameters: d.parameters ?? {
      type: "object",
      properties: {},
      required: [],
    },
  }));

  const TOOL_DISCIPLINE = [
    "──── ⚠️ 工具使用硬约束（违反将导致任务失败）────",
    "",
    "· 文件搜索 → 必须用 search_code，禁止用 run_shell 执行 grep/findstr/rg/dir",
    "· 目录浏览 → 必须用 list_files，禁止用 run_shell 执行 ls/dir/Get-ChildItem",
    "· 文件读取 → 必须用 read_file，禁止用 run_shell 执行 cat/type/Get-Content",
    "· 文件写入 → 必须用 write_file，禁止用 run_shell 执行 echo/copy/Out-File",
    "· run_shell 仅用于构建/测试/包管理命令（如 pnpm build, npx vitest, npm install），",
    "  绝不用于文件搜索、目录浏览、文件读写等已有专用工具的操作。",
    "",
    "违反此约束 = 你根本没在执行任务，是在浪费时间。",
  ].join("\n");

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "system", content: TOOL_DISCIPLINE },
    { role: "user", content: `Task: ${node.payload}` },
  ];

  let loops = 0;
  let finalOutput: string | undefined;

  while (loops < maxLoops) {
    loops++;

    try {
      if (loops === maxLoops - 4) {
        messages.push({
          role: "user",
          content: "⚠️ You have only 4 tool-call turns left. Start wrapping up and produce a final answer summarising what you have found or done so far. It's OK if the work is incomplete.",
        });
      }

      const res = await llm.chat(model, messages, toolDefs, node.reasoningEffort);

      if (res.toolCalls.length === 0) {
        finalOutput = res.content ?? undefined;
        break;
      }

      messages.push({
        role: "assistant",
        content: res.content ?? "",
        tool_calls: res.toolCalls,
        reasoning_content: res.reasoning_content,
      });

      for (const tc of res.toolCalls) {
        const result = await toolkit.execute(
          { toolName: tc.name, params: tc.arguments },
          agentType,
        );

        messages.push({
          role: "tool",
          content: result.success
            ? (result.output ?? "success")
            : `ERROR: ${result.error}`,
          tool_call_id: tc.id,
        });
      }
    } catch (e) {
      return {
        nodeId: node.id,
        agentType: agentType,
        success: false,
        output: `[partial output before crash at iteration ${loops}/${maxLoops}]`,
        error: `[ReAct loop crashed at iteration ${loops}/${maxLoops}: ${String(e)}]`,
      };
    }
  }

  return {
    nodeId: node.id,
    agentType: agentType,
    success: finalOutput !== undefined,
    output: finalOutput,
    error: finalOutput === undefined ? "Exceeded max loops without final answer" : undefined,
  };
}
