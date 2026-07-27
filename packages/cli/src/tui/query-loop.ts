/**
 * tui/query-loop.ts — 统一 Agent 查询循环
 *
 * 吸收 Claude Code 的 queryLoop() 统一架构——所有模式
 * (chat/talk/plan/party/command) 共用同一个执行循环。
 * 各模式差异体现在 system prompt 组装和 hooks 配置，
 * 而非不同的执行路径。
 *
 * 循环逻辑：
 * 1. 根据 mode 组装 system prompt (persona + agent role + format instructions)
 * 2. 调用 LLM (streaming)，逐 chunk yield llm_chunk
 * 3. 模型返回 tool_calls → yield tool_start → 权限门 → 执行 → yield tool_result
 * 4. 工具结果回传 LLM → 继续循环直到模型输出文本
 * 5. yield node_complete 含最终输出
 *
 * @module tui/query-loop
 * @since v3 — CLI TUI 全栈重构
 */

import {
  AGENT_CHINESE_ROLE,
  AGENT_DISPLAY_BY_TYPE,
  AGENT_DISPLAY_FALLBACK,
  CHINESE_NAME_TO_TYPE,
  AGENT_TYPE_TO_DIR,
  type AgentType,
  type LlmMessage,
  type ITuiEngineBridge,
} from "@cortex/shared";
import type { TuiEvent, TuiHooks, ReplMode } from "./types.js";
import { compactMessages } from "./context-compactor.js";
import { streamExecuteTools } from "./streaming-tool-executor.js";
import { DEFAULT_MAX_TOOL_ROUNDS, ENV_MAX_TOOL_ROUNDS } from "@cortex/config";
import { PLANNING_SYSTEM } from "@cortex/config";
import fs from "fs";
import path from "path";

// ═══════════════════════════════════════════════════════════
// §1 System Prompt 组装
// ═══════════════════════════════════════════════════════════

const BASE_SYSTEM_PROMPT = `[系统指令] 你是 Cortex 工程助手。`;

/** AgentType 枚举值 → prompts/<agentDir>/system.md 目录名 */
// 已迁至 @cortex/shared （AGENT_TYPE_TO_DIR）

/** agent id（如 nahida/beidou）→ 自身——用于用户直接输入 id 时自解析 */
const AGENT_ID_SELF: Set<string> = new Set(Object.values(AGENT_TYPE_TO_DIR));

/** 懒加载昔涟 persona——从 .cortex/lore/cyrene/persona-talk.txt 读取（仅 butler talk 使用） */
let _cyrenePersona: string | null = null;
function cyrenePersona(): string {
  if (_cyrenePersona !== null) return _cyrenePersona;
  try {
    const personaPath = path.join(process.cwd(), ".cortex", "lore", "cyrene", "persona-talk.txt");
    _cyrenePersona = fs.readFileSync(personaPath, "utf-8");
  } catch (err) { console.warn('[DEGRADED:tui-query-loop]', String(err));
    _cyrenePersona = "你是昔涟，用轻松自然的语气和用户聊天。";
  }
  return _cyrenePersona;
}

/** 缓存所有 agent persona 文件，避免每次对话都读磁盘 */
const _personaCache = new Map<string, string>();
function cachedPersona(filePath: string): string | undefined {
  if (_personaCache.has(filePath)) return _personaCache.get(filePath);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      _personaCache.set(filePath, content);
      return content;
    }
  } catch { /* fall through */ }
  return undefined;
}

/**
 * 多策略解析 agent 输入 → 加载 talk persona 文件。
 *
 * 解析优先级：
 * 1. AgentType 枚举值（"analysis"/"code"）→ AGENT_TYPE_TO_DIR
 * 2. 中文名（"纳西妲"/"阿贝多"）→ CHINESE_NAME_TO_TYPE → AGENT_TYPE_TO_DIR
 * 3. agent id（"nahida"/"albedo"）→ 自解析（id 即目录名）
 * 4. 以上都失败 → 直接试用 agent 字符串作为目录名
 * 5. 仍失败 → 回退到昔涟 persona
 */
export function agentTalkPersona(agent: string): string {
  let dir: string | undefined;

  // 1. AgentType 枚举值直接映射
  dir = AGENT_TYPE_TO_DIR[agent];

  // 2. 中文名 → AgentType → 目录
  if (!dir) {
    const agentType = CHINESE_NAME_TO_TYPE[agent];
    if (agentType) dir = AGENT_TYPE_TO_DIR[agentType as string];
  }

  // 3. agent id 自识别（nahida / beidou / keqing ...）
  if (!dir && AGENT_ID_SELF.has(agent)) {
    dir = agent;
  }

  // 4. 盲试——agent 字符串可能就是目录名
  if (!dir) {
    try {
      const testPath = path.join(process.cwd(), "prompts", agent, "system.md");
      if (fs.existsSync(testPath)) dir = agent;
    } catch (err) { console.warn('[DEGRADED:tui-query-loop]', String(err)) }
  }

  // 5. 加载 persona 本体——从 .cortex/lore/{agent}/persona-talk.txt 加载
  if (dir) {
    // 昔涟：lore/cyrene/persona-talk.txt
    if (dir === "cyrene") return cyrenePersona();

    try {
      const personaPath = path.join(process.cwd(), ".cortex", "lore", dir, "persona-talk.txt");
      const cached = cachedPersona(personaPath);
      if (cached) return cached;
    } catch { /* fall through */ }
    try {
      const promptPath = path.join(process.cwd(), "prompts", dir, "system.md");
      const cached = cachedPersona(promptPath);
      if (cached) return cached;
    } catch { /* fall through */ }
  }

  return cyrenePersona();
}

/** Agent 角色 system prompt——chat模式也加载对应的系统文件 */
function agentSystemPrompt(agent: AgentType): string {
  // chat 模式下也尝试加载 agent 的 persona/system.md
  const personaText = agentTalkPersona(agent);
  // 如果加载到了 persona 文件, 用它（但ler+analysis 直接使用完整 persona）
  if (personaText && (agent === "butler" || agent === "analysis" || personaText !== cyrenePersona())) {
    return personaText;
  }
  const chinese = AGENT_CHINESE_ROLE[agent] ?? agent;
  const display = AGENT_DISPLAY_BY_TYPE[agent] ?? AGENT_DISPLAY_FALLBACK;
  return `你的身份是 ${chinese}（${agent}）。${display.signature}\n\n` +
    `[关键] 你的名字叫${chinese}，不叫"用户"。你是Cortex的${agent}类型智能体。`;
}

/** 模式 system prompt */
function modeSystemPrompt(mode: ReplMode, agent: AgentType): string {
  switch (mode) {
    case "chat":
      return `[智能模式] 分析用户输入，自行判断应该:
- 生成执行计划(task) → 输出 TaskNode JSON
- 直接对话回答(chat) → 自然语言回复
- 执行命令(command) → 调用工具

你是 Cortex 工程助手，直接回答用户的问题。如果用户有编程任务，可以调用工具完成。`;
    case "plan":
      // 加载甘雨完整战术中枢 prompt（含时序依赖、标签匹配规则、输出格式等）
      return PLANNING_SYSTEM;
    case "talk":
      return agentTalkPersona(agent);
    case "party":
      return "这是群聊模式。多个角色在同一个对话中发言。你可以用角色特有的风格说话。";
    default:
      return "";
  }
}

/** 组装完整 system prompt——结果按 (mode, agent) 缓存，避免每轮重建 */
const _promptCache = new Map<string, string>();
function assembleSystemPrompt(mode: ReplMode, agent: AgentType): string {
  const key = `${mode}:${agent}`;
  const cached = _promptCache.get(key);
  if (cached) return cached;

  const parts: string[] = [];

  // butler/analysis: persona 文件自包含身份+格式——不叠加通用前缀
  if (agent === "butler" || agent === "analysis") {
    parts.push(agentSystemPrompt(agent));
  } else if (mode === "talk") {
    parts.push(modeSystemPrompt(mode, agent));
  } else {
    parts.push(BASE_SYSTEM_PROMPT);
    parts.push(agentSystemPrompt(agent));
    parts.push(modeSystemPrompt(mode, agent));
    parts.push("[格式] 直接说话/做事，不要用（）写旁白或动作描述。");
  }

  const result = parts.join("\n");
  _promptCache.set(key, result);
  return result;
}

// ═══════════════════════════════════════════════════════════
// §2 QueryLoop 异步生成器
// ═══════════════════════════════════════════════════════════

/** queryLoop 参数聚合 */
interface QueryLoopParams {
  input: string;
  bridge: ITuiEngineBridge;
  mode: ReplMode;
  agent: AgentType;
  hooks: TuiHooks;
  history?: LlmMessage[];
  /** 中断信号——Esc 触发，端到端停流（回合边界 + fetch 两层） */
  signal?: AbortSignal;
}

/**
 * 统一查询循环——所有模式共用。
 */
export async function* queryLoop(p: QueryLoopParams): AsyncGenerator<TuiEvent, string, void> {
  const { mode, agent, history, input, hooks, bridge, signal } = p;
  const systemPrompt = assembleSystemPrompt(mode, agent);
  const messages: LlmMessage[] = [];

  // 注入 system prompt
  messages.push({ role: "system", content: systemPrompt });

  // 注入历史（多轮对话）
  if (history && history.length > 0) {
    messages.push(...history);
  }

  // 注入用户输入
  messages.push({ role: "user", content: input });

  // 模型路由：plan（推理密集）优先走 reasoner/pro——thinking + reasoning_effort 才能生效；
  // 其余模式用 chat（flash）。未配置 reasoner 时回退 chat。
  const reasonerModel = bridge.getReasonerModelName();
  const chatModel = (mode === "plan" && reasonerModel)
    ? reasonerModel
    : (bridge.getChatModelName() || "deepseek-v4-flash");

  // 获取工具定义——plan/talk/party 模式零工具
  const rawTools = bridge.getToolDefs(agent);
  const tools = mode === "plan" || mode === "talk" || mode === "party"
    ? []
    : rawTools;

  // 最大工具调用轮次（从 config 读取，支持环境变量 CORTEX_MAX_TOOL_ROUNDS 覆盖）
  const envLimit = process.env[ENV_MAX_TOOL_ROUNDS];
  const configMax = envLimit ? Number(envLimit) : DEFAULT_MAX_TOOL_ROUNDS;
  // plan/talk/party 模式：零工具 + 极低轮次上限——纯文本对话，不调用工具
  const MAX_TOOL_ROUNDS = mode === "plan" ? Math.min(configMax, 5) : configMax;
  const CONTEXT_LIMIT = parseInt(process.env.CORTEX_CONTEXT_LIMIT || "500000", 10);
  let toolRound = 0;
  let finalOutput = "";
  let sessionTokens = 0;

  while (toolRound < MAX_TOOL_ROUNDS) {
    // 回合边界中断检查——Esc 后不再发起新一轮
    if (signal?.aborted) { yield { type: "interrupted", agent } as TuiEvent; return finalOutput; }
    // ═══ 真流式：Promise.race 即时 yield 每个 chunk ═══
    let resolveNextChunk: ((v: void) => void) | null = null;
    const chunkQueue: TuiEvent[] = [];
    let streamDone = false;
    let streamResult: Awaited<ReturnType<typeof bridge.streamChat>> | null = null;
    let streamError: Error | null = null;
    
    const wake = () => {
      if (resolveNextChunk) { const r = resolveNextChunk; resolveNextChunk = null; r(); }
    };
    // 中断信号到达时立即唤醒发射循环（不必等下一个 chunk）
    const onAbortWake = (): void => wake();
    if (signal && !signal.aborted) signal.addEventListener("abort", onAbortWake, { once: true });
    
    // Hook: onPreModelRequest（可在发送前修改 messages）
    const boundMessages = await (hooks.onPreModelRequest?.(messages) ?? Promise.resolve(messages));
    // 若 hook 返回新数组，同步回原始引用，确保后续压缩/工具执行看到最新内容
    if (boundMessages !== messages) {
      messages.length = 0;
      messages.push(...boundMessages);
    }
    // Hook: onStreamStart
    hooks.onStreamStart?.();
    
    bridge.streamChat(
      chatModel,
      boundMessages,
      tools.length > 0 ? tools : undefined,
      (content, reasoning) => {
        chunkQueue.push({ type: "llm_chunk", agent, content, reasoning } as TuiEvent);
        wake();
      },
      // DeepSeek V4: chat不启用thinking, plan用high；signal 端到端透传以中断 fetch
      (mode === "plan") ? { reasoningEffort: "high" as const, signal } : { signal },
    ).then(r => { streamResult = r; streamDone = true; wake(); return r; })
     .catch(e => { streamError = e as Error; streamDone = true; wake(); });

    // 流式发射——每个 chunk 到达即时 yield
    while (!streamDone) {
      if (signal?.aborted) break;
      while (chunkQueue.length > 0) {
        const ev = chunkQueue.shift();
        if (!ev) break;
        yield ev;
        hooks.onChunk?.(ev as TuiEvent & { type: "llm_chunk" });
      }
      if (streamDone) break;
      await new Promise<void>(resolve => { resolveNextChunk = resolve; });
    }
    // 排空残余 chunk
    while (chunkQueue.length > 0) {
      const ev = chunkQueue.shift();
      if (!ev) break;
      yield ev;
      hooks.onChunk?.(ev as TuiEvent & { type: "llm_chunk" });
    }
    if (signal) signal.removeEventListener("abort", onAbortWake);
    // 中断优先于错误——fetch abort 会以 AbortError 形式落入 streamError，视为中断而非报错
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- streamError 在 .catch 闭包内赋值，TS 同步流误判类型，?. 形式会报 never
    if (signal?.aborted || (streamError && streamError.name === "AbortError")) {
      yield { type: "interrupted", agent } as TuiEvent;
      return finalOutput;
    }
    if (streamError) {
      // H3 fix: 统一本地/远程语义——调 hooks.onError + yield 错误事件，再 throw
      const err = streamError as Error;
      hooks.onError?.(err, "llm-stream");
      yield { type: "turn_error", error: err.message, context: "llm-stream" } as TuiEvent;
      throw err;
    }

    if (streamResult === null) throw new Error("stream 未产生有效结果");
    const resp = streamResult as NonNullable<typeof streamResult>;
    // Hook: onStreamEnd
    hooks.onStreamEnd?.();
    // Hook: onPostModelRequest
    hooks.onPostModelRequest?.({ content: resp.content, tool_calls: resp.tool_calls, usage: resp.usage });

    // Token 用量 + 上下文窗口感知
    // H3 fix: prompt_tokens 包含全部历史，改为直接使用 API 返回的 usage 作为 session 总量
    // （每次 LLM 调用返回的 prompt_tokens 即当前上下文的 token 总数）
    if (resp.usage) {
      sessionTokens = resp.usage.prompt_tokens + resp.usage.completion_tokens;
      const usagePercent = Math.round((sessionTokens / CONTEXT_LIMIT) * 100);
      yield {
        type: "token_usage",
        promptTokens: resp.usage.prompt_tokens,
        completionTokens: resp.usage.completion_tokens,
        sessionTotalTokens: sessionTokens,
        contextWindowSize: CONTEXT_LIMIT,
        cacheHitTokens: resp.usage.prompt_cache_hit_tokens,
        cacheMissTokens: resp.usage.prompt_cache_miss_tokens,
      };
      // 超 50% 警告——仅通过 hook 通知，不注入 llm_chunk（避免污染 assistant 消息）
      if (usagePercent > 50) {
        hooks.onCompactionWarning?.(usagePercent);
      }
    }

    // ── 上下文压缩（95% 阈值自动触发）──
    if (resp.usage) {
      const promptPercent = Math.round((sessionTokens / CONTEXT_LIMIT) * 100);
      if (promptPercent >= 95) {
        // Hook: onPreCompact
        await hooks.onPreCompact?.(messages);
        const compactResult = await compactMessages(messages, {
          contextLimit: CONTEXT_LIMIT,
          currentTokens: sessionTokens,
          triggerThreshold: 0.75,
          toolOutputMaxChars: 1000,
          keepRecentTurns: 3,
          summarize: bridge.chat
            ? async (msgs: LlmMessage[]) => {
                const compactPrompt = "以下是一段对话历史。请用一段中文（不超过200字）简要摘要：用户问了什么、你做了什么、关键结论。只输出摘要。";
                return await bridge.chat(compactPrompt, msgs);
              }
            : undefined,
        });

        if (compactResult.compactedCount > 0) {
          // 替换消息列表（保持 system prompt 在新数组头部）
          messages.length = 0;
          messages.push(...compactResult.messages);

          // Bug 10 fix: 更新 sessionTokens 以反映压缩后的实际 token 数
          sessionTokens = compactResult.estimatedTokens;

          // Hook: onPostCompact
          hooks.onPostCompact?.(compactResult);
          // 不再 yield llm_chunk — compaction 事件本身会在 reducer 中创建 system 消息
          yield {
            type: "compaction",
            compactedCount: compactResult.compactedCount,
            summary: compactResult.summary,
            appliedLayers: compactResult.appliedLayers,
            estimatedTokens: compactResult.estimatedTokens,
          } as TuiEvent;
        }
      }
    }

    // 检查 tool_calls
    if (resp.tool_calls && resp.tool_calls.length > 0) {
      toolRound++;

      // 流式并发执行——L1 读操作并行，L2/L3 写操作串行
      for await (const ev of streamExecuteTools(
        resp.tool_calls.map(tc => ({ name: tc.name, arguments: tc.arguments, id: tc.id })),
        agent,
        bridge,
        messages,
        hooks,
        resp.reasoning_content,
        signal,
      )) {
        yield ev;
      }

      // 继续循环——LLM 处理工具结果
      continue;
    }

    // 无 tool_calls → 最终输出
    finalOutput = resp.content ?? "";
    break;
  }

  if (toolRound >= MAX_TOOL_ROUNDS) {
    // Hook: onMaxToolRounds
    hooks.onMaxToolRounds?.();
    finalOutput = "[已达到最大工具调用轮次，停止]";
  }

  // Hook: onPostProcessOutput
  if (finalOutput) {
    finalOutput = await (hooks.onPostProcessOutput?.(finalOutput) ?? Promise.resolve(finalOutput));
  }

  // 将助手回复加入历史
  if (finalOutput) {
    messages.push({ role: "assistant", content: finalOutput });
  }

  return finalOutput;
}

// ═══════════════════════════════════════════════════════════
// §3 辅助函数
// ═══════════════════════════════════════════════════════════

/**
 * 从 queryLoop 的 messages 中提取对话历史（不含 system prompt）。
 * 用于多轮对话上下文的保留。
 */
export function extractHistory(messages: LlmMessage[]): LlmMessage[] {
  return messages.filter((m) => m.role !== "system");
}
