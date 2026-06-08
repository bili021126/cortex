/* eslint-disable no-console */
import type { TaskNode, NodeResult, AgentType, LlmMessage, ToolDef, SafeErrorReporter } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "../platform/toolkit.js";
import type { MemoryStore } from "../memory/memory-store.js";

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
  /** 单 Agent ReAct 循环墙钟超时 (ms)。超时后返回 partial output + error 信息，不会被调度器视为异常崩溃。 */
  reactLoopTimeoutMs: number;
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
    "· 文件搜索 → 优先用 search_code。若 search_code 返回错误，立即改用 list_files + read_file。禁止用 run_shell 执行 grep/findstr/rg/dir",
    "· 目录浏览 → 必须用 list_files，禁止用 run_shell 执行 ls/dir/Get-ChildItem",
    "· 文件读取 → 必须用 read_file，禁止用 run_shell 执行 cat/type/Get-Content",
    "· 文件写入 → 必须用 write_file，禁止用 run_shell 执行 echo/copy/Out-File",
    "· run_shell 仅用于构建/测试/包管理命令（如 pnpm build, npx vitest, npm install），",
    "  绝不用于文件搜索、目录浏览、文件读写等已有专用工具的操作。",
    "",
    "· run_shell 通过 Windows cmd.exe 执行命令。不能使用 PowerShell 语法（如 Get-ChildItem）",
    "  或 Unix/bash 语法（如 mkdir -p, ls -la, find . -name）。",
    "",
    "违反此约束 = 你根本没在执行任务，是在浪费时间。",
    "工具报错一次就换方案——不要反复重试同一个已失败的工具调用。",
  ].join("\n");

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "system", content: TOOL_DISCIPLINE },
    { role: "user", content: `Task: ${node.payload}` },
  ];

  let loops = 0;
  let finalOutput: string | undefined;
  const startTime = Date.now();
  const deadline = startTime + ctx.reactLoopTimeoutMs;

  const diagnostic = (msg: string): void => {
    console.log(`  🔁 [ReAct-${agentType}#${loops}] ${msg}`);
  };

  diagnostic(`启动——maxLoops=${maxLoops}, timeout=${ctx.reactLoopTimeoutMs}ms, tools=${toolDefs.length}个`);

  while (loops < maxLoops) {
    // ── 墙钟超时检查 ──
    if (Date.now() >= deadline) {
      return {
        nodeId: node.id,
        agentType: agentType,
        success: false,
        output: finalOutput ?? `[partial output — wall-clock timeout at ${Date.now() - startTime}ms]`,
        error: `ReAct loop wall-clock timeout after ${ctx.reactLoopTimeoutMs}ms (iteration ${loops}/${maxLoops})`,
      };
    }

    loops++;

    try {
      if (loops === maxLoops - 4) {
        diagnostic("接近循环上限，注入截止提示");
        messages.push({
          role: "user",
          content: "⚠️ You have only 4 tool-call turns left. Start wrapping up and produce a final answer summarising what you have found or done so far. It's OK if the work is incomplete.",
        });
      }

      const msgCount = messages.length;
      diagnostic(`🛰️  调用 LLM (${model})——上下文 ${msgCount} 条消息，工具 ${toolDefs.length} 个...`);
      const callStart = Date.now();
      const res = await llm.chat(model, messages, toolDefs, node.reasoningEffort);
      const callElapsed = Date.now() - callStart;

      // ── 思维链诊断：打印推理内容 ──
      if (res.reasoning_content) {
        const preview = res.reasoning_content.slice(0, 300);
        console.log(`  💭 [ReAct-${agentType}#${loops}] 思维链预览: ${preview}${res.reasoning_content.length > 300 ? "...(截断)" : ""}`);
      }
      if (res.content) {
        const preview = res.content.slice(0, 200);
        console.log(`  📝 [ReAct-${agentType}#${loops}] 文本响应: ${preview}${res.content.length > 200 ? "...(截断)" : ""}`);
      }

      const toolCallCount = (res.tool_calls ?? []).length;
      diagnostic(`✅ LLM 响应耗时 ${callElapsed}ms——工具调用 ${toolCallCount} 个`);

      if (toolCallCount === 0) {
        finalOutput = res.content ?? undefined;
        diagnostic(`🛑 无工具调用，本轮结束——output=${(finalOutput ?? "(空)").slice(0, 100)}`);
        break;
      }

      messages.push({
        role: "assistant",
        content: res.content ?? "",
        tool_calls: res.tool_calls,
        reasoning_content: res.reasoning_content,
      });

      for (const tc of (res.tool_calls ?? [])) {
        diagnostic(`🔧 执行工具 ${tc.name}`);
        const toolStart = Date.now();
        const result = await toolkit.execute(
          { toolName: tc.name, params: tc.arguments },
          agentType,
        );
        const toolElapsed = Date.now() - toolStart;
        const outcome = result.success ? `✅ 成功 (${toolElapsed}ms)` : `❌ 失败: ${(result.error ?? "未知").slice(0, 100)}`;
        diagnostic(`🔧 ${tc.name} → ${outcome}`);

        messages.push({
          role: "tool",
          content: result.success
            ? (result.output ?? "success")
            : `ERROR: ${result.error}`,
          tool_call_id: tc.id,
        });
      }
    } catch (e) {
      diagnostic(`💥 崩溃: ${String(e).slice(0, 200)}`);
      return {
        nodeId: node.id,
        agentType: agentType,
        success: false,
        output: `[partial output before crash at iteration ${loops}/${maxLoops}]`,
        error: `[ReAct loop crashed at iteration ${loops}/${maxLoops}: ${String(e)}]`,
      };
    }
  }

  const totalElapsed = Date.now() - startTime;
  diagnostic(`🏁 循环结束——耗时 ${totalElapsed}ms, loops=${loops}/${maxLoops}, success=${finalOutput !== undefined}`);

  return {
    nodeId: node.id,
    agentType: agentType,
    success: finalOutput !== undefined,
    output: finalOutput,
    error: finalOutput === undefined ? "Exceeded max loops without final answer" : undefined,
  };
}
