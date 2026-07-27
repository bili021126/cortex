// @ci: verify
/**
 * harness-fault.test.ts — Harness 故障注入测试
 *
 * 在 H1（harness-turn.test.ts）mock 惯例基础上，验证 harness 在故障下的恢复语义。
 * 全 mock 零真实 IO；每用例自足；总时长 < 5s。
 *
 * 覆盖：
 *   1. LLM 抛错 → 错误从 generator 抛出、无未处理 rejection
 *   2. 流中途断 → 已发 chunk 不丢、错误被捕获、干净终止
 *   3. 工具执行抛错 → 错误回填 tool 消息、回合继续
 *   4. 工具批部分失败 → 1 成功 1 失败、批次完成不悬挂
 *   5. 连续故障后可恢复 → 第一回合抛错后，第二回合正常成功
 *
 * @module tests/harness-fault
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { queryLoop } from "@cortex/cli";
import type { TuiEvent, TuiHooks } from "@cortex/cli";
import type { AgentType, LlmMessage, ITuiEngineBridge } from "@cortex/shared";

// ── 类型辅助 ──────────────────────────────────────────────

type ReplMode = "chat" | "talk" | "party" | "plan" | "command";

interface ToolCallDef {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

interface StreamChatResult {
  content: string | null;
  tool_calls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
  reasoning_content?: string;
}

// ── Mock 工厂（与 H1 惯例一致） ──────────────────────────

function mockBridge(overrides?: Partial<ITuiEngineBridge>): ITuiEngineBridge {
  return {
    getChatModelName: vi.fn().mockReturnValue("test-chat-model"),
    getReasonerModelName: vi.fn().mockReturnValue("test-reasoner-model"),
    getToolDefs: vi.fn().mockReturnValue([
      { name: "read_file", description: "Read file content" },
      { name: "grep", description: "Search with grep" },
      { name: "write", description: "Write to file" },
      { name: "bash", description: "Run shell command" },
    ] as ToolCallDef[]),
    streamChat: vi.fn().mockImplementation(
      async (
        _model: string,
        _messages: LlmMessage[],
        _tools: ToolCallDef[] | undefined,
        onChunk: (content: string, reasoning?: string) => void,
      ): Promise<StreamChatResult> => {
        const text = "Hello from LLM";
        const mid = Math.ceil(text.length / 2);
        onChunk(text.slice(0, mid));
        onChunk(text.slice(mid));
        return {
          content: text,
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
      },
    ),
    executeToolCall: vi.fn().mockResolvedValue({ success: true, output: "tool-result" }),
    chat: vi.fn().mockResolvedValue("chat-response"),
    ensureTalkMemory: vi.fn().mockResolvedValue(undefined),
    readTalkMemory: vi.fn().mockResolvedValue([]),
    writeTalkMemory: vi.fn().mockResolvedValue(undefined),
    executeWithStream: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function mockHooks(overrides?: Partial<TuiHooks>): TuiHooks {
  return {
    onPreToolUse: vi.fn().mockResolvedValue("allow" as const),
    onPostToolUse: vi.fn(),
    onToolError: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

// ── 工具函数：收集 AsyncGenerator 全部 yield（安全版：捕获 generator 抛错） ──

async function collectEventsSafe(
  gen: AsyncGenerator<TuiEvent, string, void>,
): Promise<{ events: TuiEvent[]; result: string; error: Error | null }> {
  const events: TuiEvent[] = [];
  let result = "";
  let error: Error | null = null;
  try {
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value as string;
        break;
      }
      events.push(value);
    }
  } catch (e) {
    error = e as Error;
  }
  return { events, result, error };
}

// ═══════════════════════════════════════════════════════════
// §1 LLM 抛错
// ═══════════════════════════════════════════════════════════

describe("LLM 抛错", () => {
  it("streamChat reject → 错误从 generator 抛出、无未处理 rejection、generator 干净 done", async () => {
    // 验证：查询循环的 streamChat 在被 mock reject 后，错误以 throw 形式从 generator 传播
    // 而非 yield 错误类型事件。.catch() 闭包已处理 promise rejection，无未处理 rejection。
    const bridge = mockBridge({
      streamChat: vi.fn().mockRejectedValue(new Error("LLM timeout")),
    });
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "hi",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });

    // TODO: 缺陷——query-loop.ts L320 将 streamError throw 出 generator，
    //       调用方需 try/catch。hooks.onError 也未在此路径被调用。
    //       应改为 yield error 事件或至少调用 hooks.onError。
    const { events, error } = await collectEventsSafe(gen);

    // 无事件被 yield（streamChat 立即 reject，无 chunk）
    expect(events).toHaveLength(0);

    // generator 抛出 LLM timeout 错误
    expect(error).toBeDefined();
    expect(error!.message).toBe("LLM timeout");

    // streamChat 被调用一次
    expect(bridge.streamChat).toHaveBeenCalledTimes(1);

    // hooks.onError 未被调用（缺陷：query-loop.ts 未在 streamChat 错误路径调用 hooks.onError）
    expect(hooks.onError).not.toHaveBeenCalled();
  });

  it("generator 干净终止——无残留打开状态", async () => {
    // 验证 generator 抛出后，再调用 gen.next() 返回 { done: true }
    const bridge = mockBridge({
      streamChat: vi.fn().mockRejectedValue(new Error("LLM timeout")),
    });
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "hi",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });

    // 第一次 next 抛出
    await expect(gen.next()).rejects.toThrow("LLM timeout");

    // 第二次 next 返回 done:true（generator 已终止）
    const final = await gen.next();
    expect(final.done).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// §2 流中途断
// ═══════════════════════════════════════════════════════════

describe("流中途断", () => {
  it("chatStream 发 2 个 chunk 后 reject → 已发 chunk 不丢、错误被捕获、终止干净", async () => {
    // 场景：streamChat 先同步产生 2 个 chunk 再抛出
    // 预期：2 个 chunk 被 yield，然后 generator 抛出错误
    const bridge = mockBridge({
      streamChat: vi.fn().mockImplementation(
        async (
          _model: string,
          _messages: LlmMessage[],
          _tools: ToolCallDef[] | undefined,
          onChunk: (content: string) => void,
        ): Promise<StreamChatResult> => {
          onChunk("Partial");
          onChunk(" result");
          throw new Error("stream interrupted");
        },
      ),
    });
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "test",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });

    // 消费第一个 chunk
    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ type: "llm_chunk", content: "Partial" });

    // 消费第二个 chunk
    const second = await gen.next();
    expect(second.done).toBe(false);
    expect(second.value).toMatchObject({ type: "llm_chunk", content: " result" });

    // 第三次 next → generator 抛出错误
    await expect(gen.next()).rejects.toThrow("stream interrupted");

    // 后续 next 干净 done
    const final = await gen.next();
    expect(final.done).toBe(true);

    // streamChat 被调用一次
    expect(bridge.streamChat).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════
// §3 工具执行抛错
// ═══════════════════════════════════════════════════════════

describe("工具执行抛错", () => {
  it("executeToolCall reject → 错误回填 tool 消息、回合继续、不崩", async () => {
    // 场景：LLM 第一轮返回 tool_calls，executeToolCall 抛出异常
    // 预期：streaming-tool-executor._executeOneCall try/catch 捕获异常，
    //       返回 success:false + "工具执行异常:" 前缀，tool 消息回填 messages，
    //       LLM 第二轮收到错误结果，输出最终文本。
    let callCount = 0;
    const bridge = mockBridge({
      streamChat: vi.fn().mockImplementation(
        async (
          _model: string,
          _messages: LlmMessage[],
          _tools: ToolCallDef[] | undefined,
          onChunk: (content: string) => void,
        ): Promise<StreamChatResult> => {
          callCount++;
          if (callCount === 1) {
            // 第一轮：返回 tool_calls
            return {
              content: null,
              tool_calls: [
                { id: "e1", name: "read_file", arguments: { path: "/tmp/x" } },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            };
          }
          // 第二轮：输出最终文本（工具错误已回填 messages）
          onChunk("Recovered from tool error");
          return {
            content: "Recovered from tool error",
            usage: { prompt_tokens: 25, completion_tokens: 10 },
          };
        },
      ),
      // executeToolCall 抛出异常
      executeToolCall: vi.fn().mockRejectedValue(new Error("permission denied")),
    });
    const hooks = mockHooks({
      onToolError: vi.fn(),
    });

    const gen = queryLoop({
      input: "execute tool",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });

    const { events, result, error } = await collectEventsSafe(gen);

    // 无未捕获错误
    expect(error).toBeNull();

    // 最终结果正常返回
    expect(result).toBe("Recovered from tool error");

    // 工具事件：1 次 start + 1 次 result
    const toolStarts = events.filter((e) => e.type === "tool_start");
    expect(toolStarts).toHaveLength(1);

    const toolResults = events.filter((e) => e.type === "tool_result");
    expect(toolResults).toHaveLength(1);

    // tool_result 标记为失败
    const toolResult = toolResults[0] as { success: boolean; output?: string };
    expect(toolResult.success).toBe(false);
    expect(toolResult.output).toContain("工具执行异常");

    // onToolError hook 被调用
    expect(hooks.onToolError).toHaveBeenCalledTimes(1);
    expect(hooks.onToolError).toHaveBeenCalledWith("read_file", expect.any(Error));

    // streamChat 被调用两次（第一轮 + 工具结果回填后第二轮）
    expect(bridge.streamChat).toHaveBeenCalledTimes(2);
    // executeToolCall 被调用一次
    expect(bridge.executeToolCall).toHaveBeenCalledTimes(1);

    // 第二轮调用包含 tool 消息（回填的错误结果）
    const secondCallMsgs = (bridge.streamChat as ReturnType<typeof vi.fn>).mock.calls[1][1] as LlmMessage[];
    const toolMsgs = secondCallMsgs.filter((m) => m.role === "tool");
    expect(toolMsgs.length).toBeGreaterThanOrEqual(1);
    expect(toolMsgs[0].content).toContain("工具执行异常");
  });

  it("executeToolCall 返回 success:false → 错误回填、回合继续", async () => {
    // 场景：executeToolCall 不抛异常，但返回 { success: false, output: "ERROR: ..." }
    // 预期：结果按正常路径回填（success=false），回合继续
    let callCount = 0;
    const bridge = mockBridge({
      streamChat: vi.fn().mockImplementation(
        async (
          _model: string,
          _messages: LlmMessage[],
          _tools: ToolCallDef[] | undefined,
          onChunk: (content: string) => void,
        ): Promise<StreamChatResult> => {
          callCount++;
          if (callCount === 1) {
            return {
              content: null,
              tool_calls: [
                { id: "f1", name: "bash", arguments: { command: "ls" } },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            };
          }
          onChunk("Error handled");
          return {
            content: "Error handled",
            usage: { prompt_tokens: 20, completion_tokens: 8 },
          };
        },
      ),
      executeToolCall: vi.fn().mockResolvedValue({ success: false, output: "ERROR: command not found" }),
    });
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "run failing tool",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });

    const { events, result, error } = await collectEventsSafe(gen);

    expect(error).toBeNull();
    expect(result).toBe("Error handled");

    const toolResults = events.filter((e) => e.type === "tool_result");
    expect(toolResults).toHaveLength(1);
    const toolResult = toolResults[0] as { success: boolean; output?: string };
    expect(toolResult.success).toBe(false);
    expect(toolResult.output).toBe("ERROR: command not found");

    expect(bridge.streamChat).toHaveBeenCalledTimes(2);
    expect(bridge.executeToolCall).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════
// §4 工具批部分失败
// ═══════════════════════════════════════════════════════════

describe("工具批部分失败", () => {
  it("L1 并行批 1 成功 1 抛错 → 成功正常回填、失败错误回填、批次完成不悬挂", async () => {
    // 场景：LLM 返回两个 tool_calls（均为 L1 读操作），第一个成功，第二个抛出异常
    // 预期：Promise.all 完成 → 成功的 tool_result yield + 失败错误信息 yield
    //       → 两段消息均回填 messages → 批次完成
    let callCount = 0;
    const bridge = mockBridge({
      streamChat: vi.fn().mockImplementation(
        async (
          _model: string,
          _messages: LlmMessage[],
          _tools: ToolCallDef[] | undefined,
          onChunk: (content: string) => void,
        ): Promise<StreamChatResult> => {
          callCount++;
          if (callCount === 1) {
            return {
              content: null,
              tool_calls: [
                { id: "s1", name: "read_file", arguments: { path: "/a" } },
                { id: "s2", name: "grep", arguments: { pattern: "x", path: "/b" } },
              ],
              usage: { prompt_tokens: 15, completion_tokens: 8 },
            };
          }
          onChunk("Batch completed");
          return {
            content: "Batch completed",
            usage: { prompt_tokens: 30, completion_tokens: 12 },
          };
        },
      ),
      executeToolCall: vi.fn().mockImplementation(
        async (name: string): Promise<{ success: boolean; output: string }> => {
          if (name === "read_file") return { success: true, output: "file content" };
          // grep 抛出异常
          throw new Error("grep failed: permission error");
        },
      ),
    });
    const hooks = mockHooks({
      onToolError: vi.fn(),
    });

    const gen = queryLoop({
      input: "partial failure",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });

    const { events, result, error } = await collectEventsSafe(gen);

    // 无未捕获错误
    expect(error).toBeNull();
    expect(result).toBe("Batch completed");

    // 两个 tool_start + 两个 tool_result
    const toolStarts = events.filter((e) => e.type === "tool_start");
    expect(toolStarts).toHaveLength(2);

    const toolResults = events.filter((e) => e.type === "tool_result");
    expect(toolResults).toHaveLength(2);

    // 成功的工具
    const successResult = toolResults.find(
      (r) => (r as { tool: string }).tool === "read_file",
    ) as { success: boolean; output?: string };
    expect(successResult.success).toBe(true);
    expect(successResult.output).toBe("file content");

    // 失败的工具
    const failResult = toolResults.find(
      (r) => (r as { tool: string }).tool === "grep",
    ) as { success: boolean; output?: string };
    expect(failResult.success).toBe(false);
    expect(failResult.output).toContain("工具执行异常");
    expect(failResult.output).toContain("grep failed");

    // onToolError 只对失败的工具调用一次
    expect(hooks.onToolError).toHaveBeenCalledTimes(1);
    expect(hooks.onToolError).toHaveBeenCalledWith("grep", expect.any(Error));

    // streamChat 被调用两次（初始 + 工具结果回填）
    expect(bridge.streamChat).toHaveBeenCalledTimes(2);
    // executeToolCall 被调用两次
    expect(bridge.executeToolCall).toHaveBeenCalledTimes(2);

    // 第二轮 messages 包含两条 tool 消息
    const secondCallMsgs = (bridge.streamChat as ReturnType<typeof vi.fn>).mock.calls[1][1] as LlmMessage[];
    const toolMsgs = secondCallMsgs.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════
// §5 连续故障后可恢复
// ═══════════════════════════════════════════════════════════

describe("连续故障后可恢复", () => {
  it("第一回合 LLM 抛错后，同一 bridge 再跑第二回合正常成功", async () => {
    // 场景：同一个 bridge 实例，第一回合 streamChat reject，
    //       第二回合 streamChat 正常返回
    // 预期：第一回合抛出错误，第二回合成功（无残留毒化状态）
    let streamChatCallCount = 0;
    const bridge = mockBridge({
      streamChat: vi.fn().mockImplementation(
        async (
          _model: string,
          _messages: LlmMessage[],
          _tools: ToolCallDef[] | undefined,
          onChunk: (content: string) => void,
        ): Promise<StreamChatResult> => {
          streamChatCallCount++;
          if (streamChatCallCount === 1) {
            // 第一回合：抛错
            throw new Error("LLM unavailable");
          }
          // 第二回合：正常
          onChunk("Recovered response");
          return {
            content: "Recovered response",
            usage: { prompt_tokens: 20, completion_tokens: 10 },
          };
        },
      ),
    });
    const hooks = mockHooks();
    const params = {
      input: "test",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    };

    // 第一回合：失败
    const gen1 = queryLoop(params);

    // TODO: 缺陷——query-loop.ts L320 将 streamError throw 出 generator，
    //       调用方必须 try/catch 每个回合。hooks.onError 也未在 streamChat
    //       错误路径被调用。
    const { events: events1, error: error1 } = await collectEventsSafe(gen1);
    expect(events1).toHaveLength(0);
    expect(error1).toBeDefined();
    expect(error1!.message).toBe("LLM unavailable");

    // 第二回合：正常成功
    const gen2 = queryLoop(params);
    const { events: events2, result: result2, error: error2 } = await collectEventsSafe(gen2);

    expect(error2).toBeNull();
    expect(result2).toBe("Recovered response");

    // 有 llm_chunk 事件
    const chunks2 = events2.filter((e) => e.type === "llm_chunk");
    expect(chunks2.length).toBeGreaterThan(0);
    expect(chunks2.map((c) => (c as { content: string }).content).join("")).toBe("Recovered response");

    // 有 token_usage
    const usageEv2 = events2.find((e) => e.type === "token_usage");
    expect(usageEv2).toBeDefined();

    // streamChat 被调用两次（一次失败 + 一次成功）
    expect(bridge.streamChat).toHaveBeenCalledTimes(2);
  });
});
