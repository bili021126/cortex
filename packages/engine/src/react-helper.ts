import type { TaskNode, NodeResult, AgentType, LlmMessage, ToolDef } from "@cortex/shared";
import type { LlmAdapter } from "./llm-adapter.js";
import type { Toolkit } from "./toolkit.js";

const DEFAULT_MAX_LOOPS = 48; // 主循环上限。pro 模型 thinking mode 需充裕轮次。loop 44 时注入"强制收束"提示。

/**
 * 共享 ReAct 循环——所有 Agent 共用。
 * 各 Agent 仅需提供 systemPrompt，循环结构与记忆写入由此 helper 统一处理。
 *
 * @param maxLoops 可选循环上限（默认 48）。InspectorAgent 等敏感 Agent 可降低。
 *
 * 工具参数 schema 从 Toolkit.listDefinitions() 的 ToolDefinition.parameters 读取，
 * 不再依赖本地 PARAMS_MAP/REQUIRED_MAP 常量。
 */
export async function runReActLoop(
  callerType: AgentType,
  llm: LlmAdapter,
  toolkit: Toolkit,
  systemPrompt: string,
  node: TaskNode,
  model: string,
  maxLoops: number = DEFAULT_MAX_LOOPS,
): Promise<NodeResult> {
  const toolDefs: ToolDef[] = toolkit.listDefinitions(callerType).map((d) => ({
    name: d.name,
    description: d.description,
    parameters: d.parameters ?? {
      type: "object",
      properties: {},
      required: [],
    },
  }));

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Task: ${node.payload}` },
  ];

  let loops = 0;
  let finalOutput: string | undefined;

  while (loops < maxLoops) {
    loops++;

    try {
      // ── 强制收束：倒数第 3 轮注入提示，让 agent 即刻产出最终答案 ──
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
        reasoning_content: res.reasoning_content, // V4-Flash 思考模式：回传推理链
      });

      for (const tc of res.toolCalls) {
        const result = await toolkit.execute(
          { toolName: tc.name, params: tc.arguments },
          callerType,
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
      // ReAct 循环崩溃：保留已完成轮次的中间输出在 output 中，但标记 success=false
      return {
        nodeId: node.id,
        agentType: callerType,
        success: false,
        output: `[partial output before crash at iteration ${loops}/${maxLoops}]`,
        error: `[ReAct loop crashed at iteration ${loops}/${maxLoops}: ${String(e)}]`,
      };
    }
  }

  return {
    nodeId: node.id,
    agentType: callerType,
    success: finalOutput !== undefined,
    output: finalOutput,
    error: finalOutput === undefined ? "Exceeded max loops without final answer" : undefined,
  };
}
