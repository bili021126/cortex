// @layer 规划-执行层
// @role ReAct 循环——共享执行引擎

 
import type { TaskNode, NodeResult, LlmMessage, ToolDef, SafeErrorReporter } from "@cortex/shared";
import { AgentType } from "@cortex/shared";
import { REACT_CONTEXT_HARD_LIMIT, REACT_FORCE_WRITE_LOOP, REACT_HARD_REMINDER_LOOP, ENV_CORTEX_DEBUG, ENV_REACT_DEBUG, envTruthy, ReversibilityLevel as RL } from "@cortex/config";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "@cortex/platform";
import type { MemoryStore } from "@cortex/memory-store";
// 原则五（统一可观测）：遥测走 recordTelemetry，禁止裸 console
import { recordTelemetry } from "@cortex/telemetry";
import { resilienceFactory } from "./resilience-integration.js";

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

  // 从 toolkit 获取工具使用约束——替代硬编码 TOOL_DISCIPLINE
  // Core-2 Batch1: 约束收敛到工具定义中，由 toolkit.getConstraint() 提供
  const constraintParts: string[] = [];
  for (const td of toolDefs) {
    const c = toolkit.getConstraint(td.name, agentType as string);
    if (c) constraintParts.push(c);
  }
  const TOOL_DISCIPLINE = constraintParts.length > 0
    ? ["──── 工具使用约束（违反将导致任务失败）────", ...constraintParts].join("\n")
    : "";

  const messages: LlmMessage[] = [
    // DeepSeek V4 行为前置——指令越短越精确，越早注入 attention 权重越高
    { role: "system", content: "你是 Cortex 代码执行引擎。使用 DeepSeek V4 API。遵循以下规则：1) 每次 tool_call 必须使用正确的 JSON Schema 参数 2) tool_call_id 必须与上一条 assistant 消息中的 id 完全一致 3) 当 thinking 模式启用时，reasoning_content 已预填入思考链——请直接引用而非重复推理 4) 上下文预算充裕——不需要过度压缩输出" },
    { role: "system", content: systemPrompt },
    { role: "system", content: TOOL_DISCIPLINE },
    { role: "user", content: `Task: ${node.payload}` },
  ];

  // 如果节点携带 _outputPath，注入目标文件路径到第一条系统消息
  const outputPath = node._outputPath;
  if (outputPath) {
    messages.unshift({
      role: "system",
      content: `你的任务只有一个文件要写，路径是 ${outputPath}，内容已经给你了，不需要探索代码库。`,
    });
  }

  let loops = 0;
  let finalOutput: string | undefined;
  let bestEffortOutput: string | undefined;
  const startTime = Date.now();
  /** 本轮 ReAct 所有工具调用记录，用于检测 write_file 是否被调用 */
  const toolCallHistory: Array<{name: string}> = [];
  /** 遥测：本轮所有 LLM 调用的 token 消耗记录 */
  const usageLog: Array<{prompt_tokens?: number; completion_tokens?: number}> = [];
  const deadline = startTime + ctx.reactLoopTimeoutMs;

  // R11-16：统一真值词汇（1/true/yes/on）——CORTEX_DEBUG=true 此前被忽略
  const REACT_DEBUG = envTruthy(ENV_CORTEX_DEBUG) === true || envTruthy(ENV_REACT_DEBUG) === true;
  const diagnostic = (msg: string): void => {
    if (REACT_DEBUG) console.error(`  🔁 [ReAct-${agentType}#${loops}] ${msg}`);
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

    // P0-03: 上下文大小检查——CJK 感知 token 估算
    const totalContent = messages.map(m => m.content ?? '').join('');
    const cjkChars = (totalContent.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
    const estimatedTokens = Math.round(totalContent.length * 0.25 + cjkChars * 1.5);
    if (estimatedTokens > REACT_CONTEXT_HARD_LIMIT) {
      diagnostic(`上下文超限（估算 ~${Math.round(estimatedTokens)} tokens），强制终止循环`);
      finalOutput = "(上下文超限，任务在中途终止)";
      break;
    }

    try {
      if (loops === maxLoops - REACT_HARD_REMINDER_LOOP) {
        diagnostic("接近循环上限，注入截止提示");
        messages.push({
          role: "user",
          content: "⚠️ You have only 4 tool-call turns left. Start wrapping up and produce a final answer summarising what you have found or done so far. It's OK if the work is incomplete.",
        });
      }

      const msgCount = messages.length;
      // ── 遥测：Context 膨胀 ──
      const totalChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
      const avgPerMsg = messages.length > 0 ? Math.round(totalChars / messages.length) : 0;
      // H10 fix: 遥测走 recordTelemetry 正式通道
      void recordTelemetry("react_loop.context_inflate", totalChars, [
        { key: "agent", value: agentType },
        { key: "loops", value: String(loops) },
        { key: "msgs", value: String(messages.length) },
        { key: "avgPerMsg", value: String(avgPerMsg) },
      ]).catch(() => {});
      diagnostic(`🛰️  调用 LLM (${model})——上下文 ${msgCount} 条消息，工具 ${toolDefs.length} 个...`);
      if (REACT_DEBUG) {
        console.error(`  📋 [ReAct-${agentType}#${loops}] 系统消息: ${(messages[0]?.content ?? "(空)").slice(0, 100)}`);
        console.error(`  📋 [ReAct-${agentType}#${loops}] 工具列表: ${toolDefs.map(t=>t.name).join(", ")}`);
      }
      const callStart = Date.now();
      // 🎯 硬核：code/fix/ops 类 Agent 首次 LLM 调用必须选工具（不指定具体工具名，兼容 DeepSeek）
      const forceWrite = (loops === REACT_FORCE_WRITE_LOOP && [AgentType.Code, AgentType.Fix, AgentType.Ops].includes(agentType as AgentType) && toolDefs.some(t => t.name === "write_file"))
        ? "required" : undefined;
      if (forceWrite && REACT_DEBUG)
        console.error(`[TRACE write_file] react-loop: forceTool=required (loops=${loops})`);
      // reasoning_effort 和 tool_choice 均不发送——DeepSeek Flash 不支持，Pro 需 extra_body 配套
      // FIX-02: forceWrite 仅对支持 tool_choice 的模型发送（由 capabilities.supportsToolChoice 声明）
      const shouldForce = forceWrite && (llm.capabilities?.supportsToolChoice === true);
      const res = await resilienceFactory.execute("llm-call", async () => await llm.chat(model, messages, toolDefs, undefined, shouldForce ? forceWrite : undefined));
      const callElapsed = Date.now() - callStart;

      // ── 遥测：Token 消耗记录 ──
      if (res.usage) {
        usageLog.push(res.usage);
      } else {
        const allContent = messages.map(m => m.content ?? '').join('');
        const cjkChars2 = (allContent.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
        const estPrompt = Math.round(allContent.length * 0.25 + cjkChars2 * 1.5);
        usageLog.push({ prompt_tokens: estPrompt, completion_tokens: 0 });
      }

      // ── 思维链诊断：打印推理内容 ──
      if (res.reasoning_content) {
        if (REACT_DEBUG) {
          const preview = res.reasoning_content.slice(0, 300);
          console.error(`  💭 [ReAct-${agentType}#${loops}] 思维链预览: ${preview}${res.reasoning_content.length > 300 ? "...(截断)" : ""}`);
        }
      }
      if (res.content) {
        if (REACT_DEBUG) {
          const preview = res.content.slice(0, 200);
          console.error(`  📝 [ReAct-${agentType}#${loops}] 文本响应: ${preview}${res.content.length > 200 ? "...(截断)" : ""}`);
        }
      }

      // R12-D3：SSE 半途失败（degraded）——截断的 tool_call 不当完整轮次执行（此前零消费）
      if (res.degraded && (res.tool_calls ?? []).length > 0) {
        diagnostic(`⚠️ LLM 响应 degraded（SSE 半途失败）——丢弃截断的工具调用（${res.tool_calls?.length} 个）`);
        res.tool_calls = [];
      }
      const toolCallCount = (res.tool_calls ?? []).length;
      // 记录本轮所有工具调用
      if (res.tool_calls) {
        for (const tc of res.tool_calls) {
          toolCallHistory.push({ name: tc.name });
        }
      }
      diagnostic(`✅ LLM 响应耗时 ${callElapsed}ms——工具调用 ${toolCallCount} 个`);
      if (REACT_DEBUG) {
        console.error(`  🔍 [ReAct-${agentType}#${loops}] tool_calls=${JSON.stringify(res.tool_calls)?.slice(0,200)}`);
      }

      if (toolCallCount === 0) {
        if (REACT_DEBUG) console.error(`[TRACE write_file] react-loop: 零工具调用 (loops=${loops}, agentType=${agentType}, hasWriteFile=${toolCallHistory.some(tc => tc.name === 'write_file')})`);
        // ── 硬检测：代码类任务必须调用 write_file ──
        const hasWriteFile = toolCallHistory.some(tc => tc.name === 'write_file');
        const payload = (node.payload ?? '').toLowerCase();
        const isCodeTask = payload.includes('创建') || payload.includes('生成') ||
          payload.includes('index.html') || payload.includes('.html') ||
          [AgentType.Code, AgentType.Fix, AgentType.Ops].includes(agentType as AgentType);

        const hasWriteTool = toolDefs.some(t => t.name === 'write_file');

        if (isCodeTask && !hasWriteFile && hasWriteTool && loops < maxLoops) {
          if (REACT_DEBUG) console.error(`[TRACE write_file] react-loop: 强制追加 write_file 提醒 (loops=${loops}, agentType=${agentType})`);
          diagnostic('⚠️ 代码任务但未调用 write_file，强制追加提醒');
          messages.push({
            role: 'user',
            content: '你还没有调用 write_file。请立即将代码写入文件，不要只输出在回复里。' +
              '如果你已经写了文件但工具调用记录丢失，请重新调用 write_file。',
          });
          continue; // 回到循环顶部，让 LLM 再执行一轮
        }

        finalOutput = res.content ?? undefined;
        bestEffortOutput = finalOutput; // 保存最后一次成功输出，用于异常恢复
        diagnostic(`🛑 无工具调用，本轮结束——output=${(finalOutput ?? "(空)").slice(0, 100)}`);
        break;
      }

      messages.push({
        role: "assistant",
        content: res.content ?? "",
        tool_calls: res.tool_calls,
        reasoning_content: res.reasoning_content,
      });

      // 分类：L0（只读）并行，L2/L3（写入）串行
      const toolCalls = res.tool_calls ?? [];
      const l0Calls = toolCalls.filter(tc => toolkit.reversibilityOf(tc.name) === RL.L0);
      const writeCalls = toolCalls.filter(tc => toolkit.reversibilityOf(tc.name) !== RL.L0);

      // L0 并行执行
      if (l0Calls.length > 0) {
        diagnostic(`🚀 L0 工具并行执行 ${l0Calls.length} 个`);
        const l0Results = await Promise.allSettled(
          l0Calls.map(async (tc) => {
            if (tc.name === "write_file" && REACT_DEBUG) {
              console.error(`[TRACE write_file] agent=${agentType} calling tool=${tc.name} params=${JSON.stringify(tc.arguments)}`);
            }
            const toolStart = Date.now();
            const result = await resilienceFactory.execute("tool-exec", async () =>
              await toolkit.execute(
                { toolName: tc.name, params: tc.arguments },
                agentType,
              ),
            );
            const toolElapsed = Date.now() - toolStart;
            const outcome = result.success ? `✅ 成功 (${toolElapsed}ms)` : `❌ 失败: ${(result.error ?? "未知").slice(0, 100)}`;
            diagnostic(`🔧 ${tc.name} → ${outcome}`);
            // H10 fix: 遥测走 recordTelemetry 正式通道
            void recordTelemetry("react_loop.tool_called", 1, [
              { key: "agent", value: agentType },
              { key: "tool", value: tc.name },
              { key: "level", value: "L0" },
            ]).catch(() => {});
            return { tc, result, toolElapsed };
          })
        );

        for (const settled of l0Results) {
          if (settled.status === "fulfilled") {
            const { tc, result } = settled.value;
            messages.push({
              role: "tool",
              content: result.success ? (result.output ?? "success") : `ERROR: ${result.error}`,
              tool_call_id: tc.id,
            });
          } else {
            // rejected Promise——仍然推入 tool role 消息，防止 LLM 对话状态缺失
            // R6-H1 fix: 用索引从 l0Calls 取 tc（而非从 reason 读 undefined）
            const idx = l0Results.indexOf(settled);
            const callTc = l0Calls[idx];
            diagnostic(`⚠️ L0 工具被拒绝: ${callTc?.name ?? "unknown"}`);
            messages.push({
              role: "tool",
              content: `ERROR: ${String(settled.reason)}`,
              tool_call_id: callTc?.id ?? "unknown",
            });
          }
        }
      }

      // L2/L3 串行执行
      for (const tc of writeCalls) {
        if (tc.name === "write_file" && REACT_DEBUG) {
          console.error(`[TRACE write_file] agent=${agentType} calling tool=${tc.name} params=${JSON.stringify(tc.arguments)}`);
        }
        diagnostic(`🔧 执行工具 ${tc.name}`);
        const toolStart = Date.now();
        const result = await resilienceFactory.execute("tool-exec", async () =>
          await toolkit.execute(
            { toolName: tc.name, params: tc.arguments },
            agentType,
          ),
        );
        const toolElapsed = Date.now() - toolStart;
        const outcome = result.success ? `✅ 成功 (${toolElapsed}ms)` : `❌ 失败: ${(result.error ?? "未知").slice(0, 100)}`;
        diagnostic(`🔧 ${tc.name} → ${outcome}`);
        // H10 fix: 遥测走 recordTelemetry 正式通道
        void recordTelemetry("react_loop.tool_called", 1, [
          { key: "agent", value: agentType },
          { key: "tool", value: tc.name },
          { key: "level", value: "L2" },
        ]).catch(() => {});

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
        output: bestEffortOutput ?? `[partial output before crash at iteration ${loops}/${maxLoops}]`,
        error: `[ReAct loop crashed at iteration ${loops}/${maxLoops}: ${String(e)}]`,
      };
    }
  }

  // ── 遥测：Token 消耗汇总 ──
  const totalPromptTokens = usageLog.reduce((s,u) => s + (u.prompt_tokens??0), 0);
  const totalCompTokens = usageLog.reduce((s,u) => s + (u.completion_tokens??0), 0);
  // H10 fix: 遥测走 recordTelemetry 正式通道
  void recordTelemetry("react_loop.token_used", totalPromptTokens + totalCompTokens, [
    { key: "agent", value: agentType },
    { key: "promptTokens", value: String(totalPromptTokens) },
    { key: "compTokens", value: String(totalCompTokens) },
  ]).catch(() => {});

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
