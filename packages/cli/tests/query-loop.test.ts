// @ci: unit
/**
 * query-loop.test.ts — 统一 Agent 查询循环单元测试
 *
 * 覆盖：
 *   - extractHistory: 过滤 system 消息，保留 user/assistant
 *   - agentTalkPersona: 解析 agent → persona 文本
 *   - queryLoop 基本流程: 无 tool_calls → yield llm_chunk → 返回最终文本
 *   - queryLoop 历史注入: history 参数注入到消息列表
 *   - queryLoop hooks: onStreamStart/onStreamEnd/onChunk 调用顺序
 *   - queryLoop 最大工具轮次: 达到 MAX_TOOL_ROUNDS(10) 后停止
 *   - queryLoop 模式: 各 mode 产生正确的 system prompt
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  queryLoop,
  extractHistory,
  agentTalkPersona,
} from "../src/tui/query-loop.js";
import type { TuiEvent, TuiHooks, ReplMode, LlmStreamBridge } from "../src/tui/types.js";
import type { AgentType, LlmMessage, ICortexApi } from "@cortex/shared";

// ── 类型辅助 ──────────────────────────────────────────────

type BridgeFull = LlmStreamBridge & Pick<ICortexApi, "chat" | "submitTask" | "executeAll">;

interface StreamResult {
  content: string | null;
  tool_calls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
  reasoning_content?: string;
}

// ── Mock 工厂 ──────────────────────────────────────────────

function mockBridge(streamResult?: StreamResult): BridgeFull {
  const defaultResult: StreamResult = {
    content: "Hello from LLM",
    tool_calls: undefined,
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
  const result = streamResult ?? defaultResult;

  return {
    // LlmStreamBridge
    streamChat: vi.fn().mockImplementation(
      async (
        _model: string,
        _messages: LlmMessage[],
        _tools: unknown[] | undefined,
        onChunk: (content: string, reasoning?: string) => void,
      ): Promise<StreamResult> => {
        // 模拟流式 chunk
        const text = result.content ?? "";
        if (text.length > 0) {
          const mid = Math.ceil(text.length / 2);
          onChunk(text.slice(0, mid));
          onChunk(text.slice(mid));
        }
        return result;
      },
    ),
    executeToolCall: vi.fn().mockResolvedValue({ success: true, output: "tool-output" }),
    getToolDefs: vi.fn().mockReturnValue([]),
    getChatModelName: vi.fn().mockReturnValue("test-model"),
    getReasonerModelName: vi.fn().mockReturnValue("test-reasoner"),

    // Pick<ICortexApi, "chat" | "submitTask" | "executeAll">
    chat: vi.fn().mockResolvedValue("chat-response"),
    submitTask: vi.fn().mockResolvedValue(undefined),
    executeAll: vi.fn().mockResolvedValue({ executed: 0, failed: 0 } as never),
  };
}

/**
 * mockBridge 变体：每次调用 streamChat 都返回 tool_calls，
 * 用于测试 MAX_TOOL_ROUNDS 停止逻辑。
 */
function mockBridgeWithTools(rounds: number): BridgeFull {
  let callCount = 0;
  const bridge = mockBridge();

  (bridge.streamChat as ReturnType<typeof vi.fn>).mockImplementation(
    async (
      _model: string,
      _messages: LlmMessage[],
      _tools: unknown[] | undefined,
      onChunk: (content: string, reasoning?: string) => void,
    ): Promise<StreamResult> => {
      callCount++;
      if (callCount <= rounds) {
        // 返回 tool_calls 让循环继续
        return {
          content: "",
          tool_calls: [
            {
              id: `call_${callCount}`,
              name: "read_file",
              arguments: { path: `/tmp/${callCount}` },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
      }
      // 最终轮：返回纯文本
      onChunk("final answer");
      return {
        content: "final answer",
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      };
    },
  );

  return bridge;
}

function mockHooks(overrides?: Partial<TuiHooks>): TuiHooks {
  return {
    onPreToolUse: vi.fn().mockResolvedValue("allow" as const),
    onPostToolUse: vi.fn(),
    ...overrides,
  };
}

// ── 工具函数：收集 AsyncGenerator 全部 yield ──────────────────

async function collectEvents(
  gen: AsyncGenerator<TuiEvent, string, void>,
): Promise<{ events: TuiEvent[]; result: string }> {
  const events: TuiEvent[] = [];
  let result = "";
  while (true) {
    const { value, done } = await gen.next();
    if (done) {
      result = value as string;
      break;
    }
    events.push(value);
  }
  return { events, result };
}

// ═══════════════════════════════════════════════════════════
// extractHistory
// ═══════════════════════════════════════════════════════════

describe("extractHistory", () => {
  it("过滤 system 消息，保留 user 和 assistant", () => {
    const msgs: LlmMessage[] = [
      { role: "system", content: "you are helpful" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    const result = extractHistory(msgs);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
  });

  it("多个 system 消息全部过滤", () => {
    const msgs: LlmMessage[] = [
      { role: "system", content: "sys1" },
      { role: "system", content: "sys2" },
      { role: "user", content: "q" },
    ];
    const result = extractHistory(msgs);
    expect(result).toHaveLength(1);
    expect(result.every((m) => m.role !== "system")).toBe(true);
  });

  it("空输入返回空数组", () => {
    expect(extractHistory([])).toEqual([]);
  });

  it("仅 system 消息返回空数组", () => {
    const msgs: LlmMessage[] = [
      { role: "system", content: "only system" },
    ];
    expect(extractHistory(msgs)).toEqual([]);
  });

  it("保留 tool 消息", () => {
    const msgs: LlmMessage[] = [
      { role: "system", content: "sys" },
      { role: "assistant", content: "calling tool", tool_calls: [{ id: "c1", name: "read", arguments: {} }] },
      { role: "tool", content: "result", tool_call_id: "c1" },
    ];
    const result = extractHistory(msgs);
    expect(result).toHaveLength(2);
    expect(result[1].role).toBe("tool");
  });
});

// ═══════════════════════════════════════════════════════════
// agentTalkPersona
// ═══════════════════════════════════════════════════════════

describe("agentTalkPersona", () => {
  it("未知 agent 回退到昔涟 persona", () => {
    const persona = agentTalkPersona("unknown-agent-xyz");
    // 回退到 cyrenePersona()，要么是文件内容要么是默认字符串
    expect(typeof persona).toBe("string");
    expect(persona.length).toBeGreaterThan(0);
  });

  it("butler 类型解析昔涟 persona（cyrene 目录）", () => {
    const persona = agentTalkPersona("butler");
    expect(typeof persona).toBe("string");
    expect(persona.length).toBeGreaterThan(0);
  });

  it("已知 AgentType 值可以解析", () => {
    // "code" → albedo 目录 → 尝试加载 persona 文件或 system.md
    // 在测试环境可能回退（文件不存在），但不应崩溃
    const persona = agentTalkPersona("code");
    expect(typeof persona).toBe("string");
  });

  it("agent id（如 nahida）可以解析", () => {
    const persona = agentTalkPersona("nahida");
    expect(typeof persona).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════
// queryLoop — 基本流程
// ═══════════════════════════════════════════════════════════

describe("queryLoop — 基本流程", () => {
  it("无 tool_calls → yield llm_chunk 事件并返回最终文本", async () => {
    const bridge = mockBridge({
      content: "Hello world",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "Hi",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });
    const { events, result } = await collectEvents(gen);

    // 结果
    expect(result).toBe("Hello world");

    // 应有 llm_chunk 事件
    const chunks = events.filter((e) => e.type === "llm_chunk");
    expect(chunks.length).toBeGreaterThan(0);

    // 应有 token_usage 事件
    const usageEv = events.find((e) => e.type === "token_usage");
    expect(usageEv).toBeDefined();
  });

  it("streamChat 被调用且传入正确的 model", async () => {
    const bridge = mockBridge();
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "test",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });
    await collectEvents(gen);

    expect(bridge.streamChat).toHaveBeenCalledTimes(1);
    const [model] = (bridge.streamChat as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(model).toBe("test-model");
  });

  it("空 content 返回空字符串", async () => {
    const bridge = mockBridge({
      content: null,
      usage: undefined,
    });
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "test",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });
    const { result } = await collectEvents(gen);

    expect(result).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════
// queryLoop — 历史注入
// ═══════════════════════════════════════════════════════════

describe("queryLoop — 历史注入", () => {
  it("history 参数注入到 streamChat 的 messages 中", async () => {
    const bridge = mockBridge();
    const hooks = mockHooks();
    const history: LlmMessage[] = [
      { role: "user", content: "previous question" },
      { role: "assistant", content: "previous answer" },
    ];

    const gen = queryLoop({
      input: "follow-up",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
      history,
    });
    await collectEvents(gen);

    // 检查 streamChat 收到的 messages
    const callArgs = (bridge.streamChat as ReturnType<typeof vi.fn>).mock.calls[0];
    const messages: LlmMessage[] = callArgs[1];

    // messages 结构: [system, ...history, user]
    expect(messages[0].role).toBe("system");
    expect(messages[1]).toEqual(history[0]);
    expect(messages[2]).toEqual(history[1]);
    expect(messages[3].role).toBe("user");
    expect(messages[3].content).toBe("follow-up");
  });

  it("无 history 时消息列表为 [system, user, assistant]", async () => {
    const bridge = mockBridge();
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "fresh question",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });
    await collectEvents(gen);

    const callArgs = (bridge.streamChat as ReturnType<typeof vi.fn>).mock.calls[0];
    const messages: LlmMessage[] = callArgs[1];

    // queryLoop 在流结束后会 push assistant 回复到同一个数组
    // 所以检查时 messages = [system, user, assistant]
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("fresh question");
    // 末尾是 assistant 回复（被 queryLoop 追加）
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.role).toBe("assistant");
  });

  it("空 history 数组不注入", async () => {
    const bridge = mockBridge();
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "test",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
      history: [],
    });
    await collectEvents(gen);

    const callArgs = (bridge.streamChat as ReturnType<typeof vi.fn>).mock.calls[0];
    const messages: LlmMessage[] = callArgs[1];

    // [system, user, assistant(追加)] — 无历史消息插入
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("test");
  });
});

// ═══════════════════════════════════════════════════════════
// queryLoop — hooks 调用顺序
// ═══════════════════════════════════════════════════════════

describe("queryLoop — hooks", () => {
  it("onStreamStart 和 onStreamEnd 按正确顺序调用", async () => {
    const callOrder: string[] = [];
    const bridge = mockBridge();
    const hooks = mockHooks({
      onStreamStart: vi.fn(() => callOrder.push("start")),
      onStreamEnd: vi.fn(() => callOrder.push("end")),
      onChunk: vi.fn(() => callOrder.push("chunk")),
    });

    const gen = queryLoop({
      input: "test",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });
    await collectEvents(gen);

    // onStreamStart 必须在 onChunk 之前
    const startIdx = callOrder.indexOf("start");
    const firstChunkIdx = callOrder.indexOf("chunk");
    const endIdx = callOrder.indexOf("end");

    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(startIdx);
    if (firstChunkIdx >= 0) {
      expect(startIdx).toBeLessThan(firstChunkIdx);
      expect(endIdx).toBeGreaterThan(firstChunkIdx);
    }
  });

  it("onChunk 被调用时收到 llm_chunk 事件", async () => {
    const chunkContents: string[] = [];
    const bridge = mockBridge({
      content: "test output",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const hooks = mockHooks({
      onChunk: vi.fn((ev: { content: string }) => {
        chunkContents.push(ev.content);
      }),
    });

    const gen = queryLoop({
      input: "test",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });
    await collectEvents(gen);

    expect(chunkContents.length).toBeGreaterThan(0);
    expect(chunkContents.join("")).toBe("test output");
  });

  it("onPostModelRequest 在 streamChat 返回后被调用", async () => {
    const bridge = mockBridge({
      content: "response",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const onPostModelRequest = vi.fn();
    const hooks = mockHooks({ onPostModelRequest });

    const gen = queryLoop({
      input: "test",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });
    await collectEvents(gen);

    expect(onPostModelRequest).toHaveBeenCalledTimes(1);
    const callArg = onPostModelRequest.mock.calls[0][0];
    expect(callArg.content).toBe("response");
    expect(callArg.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
  });

  it("onPostProcessOutput 可以修改最终输出", async () => {
    const bridge = mockBridge({
      content: "original",
      usage: undefined,
    });
    const hooks = mockHooks({
      onPostProcessOutput: vi.fn(async (output: string) => output + " [modified]"),
    });

    const gen = queryLoop({
      input: "test",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });
    const { result } = await collectEvents(gen);

    expect(result).toBe("original [modified]");
  });

  it("onPreModelRequest 可以修改 messages", async () => {
    const bridge = mockBridge();
    const hooks = mockHooks({
      onPreModelRequest: vi.fn(async (msgs: LlmMessage[]) => {
        // 追加一条自定义消息
        return [...msgs, { role: "user" as const, content: "injected" }];
      }),
    });

    const gen = queryLoop({
      input: "test",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });
    await collectEvents(gen);

    // streamChat 收到的 messages 应包含 injected
    const callArgs = (bridge.streamChat as ReturnType<typeof vi.fn>).mock.calls[0];
    const messages: LlmMessage[] = callArgs[1];
    expect(messages.some((m) => m.content === "injected")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// queryLoop — 最大工具轮次
// ═══════════════════════════════════════════════════════════

describe("queryLoop — 最大工具轮次", () => {
  it("达到 MAX_TOOL_ROUNDS(10) 后停止并调用 onMaxToolRounds", async () => {
    // 每次 streamChat 都返回 tool_calls，永远不返回纯文本
    let callCount = 0;
    const bridge = mockBridge();
    (bridge.streamChat as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _model: string,
        _messages: LlmMessage[],
        _tools: unknown[] | undefined,
        _onChunk: (content: string, reasoning?: string) => void,
      ): Promise<StreamResult> => {
        callCount++;
        return {
          content: "",
          tool_calls: [
            {
              id: `call_${callCount}`,
              name: "read_file",
              arguments: { path: `/tmp/${callCount}` },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
      },
    );

    const onMaxToolRounds = vi.fn();
    const hooks = mockHooks({ onMaxToolRounds });

    const gen = queryLoop({
      input: "infinite loop test",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });
    const { result } = await collectEvents(gen);

    // 应该停止
    expect(result).toContain("最大工具调用轮次");
    expect(onMaxToolRounds).toHaveBeenCalledTimes(1);
    // streamChat 被调用 10 次（MAX_TOOL_ROUNDS）
    expect(callCount).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════
// queryLoop — 模式 system prompt
// ═══════════════════════════════════════════════════════════

describe("queryLoop — 模式 system prompt", () => {
  async function getSystemPrompt(mode: ReplMode, agent: AgentType): Promise<string> {
    const bridge = mockBridge();
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "test",
      bridge,
      mode,
      agent,
      hooks,
    });
    await collectEvents(gen);

    const callArgs = (bridge.streamChat as ReturnType<typeof vi.fn>).mock.calls[0];
    const messages: LlmMessage[] = callArgs[1];
    return messages[0].content;
  }

  it("chat 模式包含 BASE_SYSTEM_PROMPT 和对话说明", async () => {
    const sysPrompt = await getSystemPrompt("chat", "code" as AgentType);
    expect(sysPrompt).toContain("Cortex 工程助手");
    expect(sysPrompt).toContain("对话模式");
    expect(sysPrompt).toContain("[格式]");
  });

  it("plan 模式包含规划说明", async () => {
    const sysPrompt = await getSystemPrompt("plan", "code" as AgentType);
    expect(sysPrompt).toContain("规划模式");
    expect(sysPrompt).toContain("任务计划");
    expect(sysPrompt).toContain("[格式]");
  });

  it("talk 模式使用 agent persona 且不包含 BASE_SYSTEM_PROMPT", async () => {
    const sysPrompt = await getSystemPrompt("talk", "butler" as AgentType);
    // talk 模式不使用通用前缀
    expect(sysPrompt).not.toContain("[系统指令] 你是 Cortex 工程助手。");
    // talk 模式不包含 [格式] 后缀
    expect(sysPrompt).not.toContain("[格式]");
    // 应该有 persona 内容（非空）
    expect(sysPrompt.length).toBeGreaterThan(0);
  });

  it("party 模式包含群聊说明", async () => {
    const sysPrompt = await getSystemPrompt("party", "code" as AgentType);
    expect(sysPrompt).toContain("群聊模式");
    expect(sysPrompt).toContain("[格式]");
  });

  it("command 模式包含命令说明且不包含 agent 角色", async () => {
    const sysPrompt = await getSystemPrompt("command", "code" as AgentType);
    expect(sysPrompt).toContain("命令模式");
    // command 模式不注入 agent 角色描述
    expect(sysPrompt).not.toContain("你现在是");
    expect(sysPrompt).toContain("[格式]");
  });

  it("非 talk/command 模式包含 agent 角色描述", async () => {
    const sysPrompt = await getSystemPrompt("chat", "code" as AgentType);
    // 应包含 agent 角色信息（阿贝多 / code）
    expect(sysPrompt).toContain("code");
  });
});
