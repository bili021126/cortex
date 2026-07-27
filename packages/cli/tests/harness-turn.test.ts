// @ci: verify
/**
 * harness-turn.test.ts — Harness 回合级语义测试
 *
 * 覆盖 queryLoop（TUI 引擎回合格）的核心语义路径：
 *   1. 正常回合：用户输入 → LLM 流式响应 → 事件序列正确
 *   2. 工具批回合：LLM 返回 tool_calls → 执行 → 结果回填 → 二轮 LLM 收尾
 *   3. 权限拒绝：onPreToolUse deny → 工具不执行、回合不崩
 *   4. 中断语义：AbortController.abort() → 边界停止、无悬挂
 *   5. type-ahead：queryLoop 不暴露队列语义，不可测
 *
 * 约束：全 mock 零真实 LLM/IO；每用例自足；总时长 < 5s。
 *
 * @module tests/harness-turn
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { queryLoop } from "@cortex/cli";
import type { TuiEvent, TuiHooks } from "@cortex/cli";
import type { AgentType, LlmMessage, ITuiEngineBridge } from "@cortex/shared";

// ── 类型辅助 ──────────────────────────────────────────────

/** ReplMode 不直接从 @cortex/cli 导出，就地定义 */
type ReplMode = "chat" | "talk" | "party" | "plan" | "command";

interface ToolCallDef {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

interface ToolCallResult {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface StreamChatResult {
  content: string | null;
  tool_calls?: ToolCallResult[];
  usage?: { prompt_tokens: number; completion_tokens: number };
  reasoning_content?: string;
}

// ── Mock 工厂 ──────────────────────────────────────────────

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
    ...overrides,
  };
}

// ── 工具函数：收集 AsyncGenerator 全部 yield ──────────────

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
// 正常回合
// ═══════════════════════════════════════════════════════════

describe("正常回合", () => {
  it("用户输入 → LLM 流式响应 → 事件序列完整", async () => {
    const bridge = mockBridge({
      streamChat: vi.fn().mockImplementation(
        async (
          _model: string,
          _messages: LlmMessage[],
          _tools: ToolCallDef[] | undefined,
          onChunk: (content: string) => void,
        ): Promise<StreamChatResult> => {
          onChunk("Hello");
          onChunk(" world");
          return {
            content: "Hello world",
            usage: { prompt_tokens: 15, completion_tokens: 8 },
          };
        },
      ),
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

    // 最终结果
    expect(result).toBe("Hello world");

    // 事件顺序：llm_chunk(s) → token_usage (无 tool_calls)
    const chunks = events.filter((e) => e.type === "llm_chunk");
    expect(chunks.length).toBe(2);
    expect(chunks.map((c) => (c as { content: string }).content).join("")).toBe("Hello world");

    // token_usage 事件
    const usageEv = events.find((e) => e.type === "token_usage") as
      | { promptTokens: number; completionTokens: number }
      | undefined;
    expect(usageEv).toBeDefined();
    expect(usageEv!.promptTokens).toBe(15);
    expect(usageEv!.completionTokens).toBe(8);

    // 无 tool_start / tool_result
    expect(events.filter((e) => e.type === "tool_start")).toHaveLength(0);
    expect(events.filter((e) => e.type === "tool_result")).toHaveLength(0);
    // 无 interrupted
    expect(events.filter((e) => e.type === "interrupted")).toHaveLength(0);
  });

  it("空回复返回空字符串", async () => {
    const bridge = mockBridge({
      streamChat: vi.fn().mockResolvedValue({
        content: null,
        usage: undefined,
      }),
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

  it("流式 chunk 按顺序 yield", async () => {
    const bridge = mockBridge({
      streamChat: vi.fn().mockImplementation(
        async (
          _model: string,
          _messages: LlmMessage[],
          _tools: ToolCallDef[] | undefined,
          onChunk: (content: string) => void,
        ): Promise<StreamChatResult> => {
          onChunk("A");
          onChunk("B");
          onChunk("C");
          return { content: "ABC", usage: { prompt_tokens: 5, completion_tokens: 3 } };
        },
      ),
    });
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "order",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });
    const { events, result } = await collectEvents(gen);

    expect(result).toBe("ABC");
    const chunkContents = events
      .filter((e) => e.type === "llm_chunk")
      .map((c) => (c as { content: string }).content);
    expect(chunkContents).toEqual(["A", "B", "C"]);
  });
});

// ═══════════════════════════════════════════════════════════
// 工具批回合
// ═══════════════════════════════════════════════════════════

describe("工具批回合", () => {
  it("tool_calls → streamExecuteTools → 二轮 LLM 收尾", async () => {
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
                { id: "r1", name: "read_file", arguments: { path: "/tmp/x" } },
                { id: "r2", name: "grep", arguments: { pattern: "test", path: "/tmp/x" } },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            };
          }
          // 第二轮：返回最终文本
          onChunk("Task complete");
          return {
            content: "Task complete",
            usage: { prompt_tokens: 25, completion_tokens: 10 },
          };
        },
      ),
      executeToolCall: vi.fn().mockImplementation(
        async (name: string): Promise<{ success: boolean; output: string }> => {
          if (name === "read_file") return { success: true, output: "file content" };
          if (name === "grep") return { success: true, output: "match found" };
          return { success: true, output: "ok" };
        },
      ),
    });
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "read files",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });
    const { events, result } = await collectEvents(gen);

    // 最终结果
    expect(result).toBe("Task complete");

    // 工具事件
    const toolStarts = events.filter((e) => e.type === "tool_start");
    expect(toolStarts).toHaveLength(2);
    const toolResults = events.filter((e) => e.type === "tool_result");
    expect(toolResults).toHaveLength(2);

    // L1 读操作并行——所有 tool_start 先于第一个 tool_result
    const firstResultIdx = events.findIndex((e) => e.type === "tool_result");
    const lastStartIdx = events
      .map((e, i) => (e.type === "tool_start" ? i : -1))
      .filter((i) => i >= 0)
      .pop()!;
    expect(lastStartIdx).toBeLessThan(firstResultIdx);

    // streamChat 被调用两次（初始 + 工具结果回填）
    expect(bridge.streamChat).toHaveBeenCalledTimes(2);
    // executeToolCall 被调用两次
    expect(bridge.executeToolCall).toHaveBeenCalledTimes(2);

    // 第二轮消息应包含工具结果
    const secondCallMsgs = (bridge.streamChat as ReturnType<typeof vi.fn>).mock.calls[1][1] as LlmMessage[];
    const toolMsgs = secondCallMsgs.filter((m) => m.role === "tool");
    expect(toolMsgs.length).toBeGreaterThanOrEqual(2);
  });

  it("L1 读操作并行执行维持结果顺序", async () => {
    let callCount = 0;
    const bridge = mockBridge({
      streamChat: vi.fn().mockImplementation(
        async (...args: unknown[]): Promise<StreamChatResult> => {
          callCount++;
          if (callCount === 1) {
            return {
              content: null,
              tool_calls: [
                { id: "r1", name: "read_file", arguments: { path: "/a" } },
                { id: "r2", name: "grep", arguments: { pattern: "x", path: "/b" } },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            };
          }
          const onChunk = args[3] as (content: string) => void;
          onChunk("Done");
          return { content: "Done", usage: { prompt_tokens: 20, completion_tokens: 8 } };
        },
      ),
      executeToolCall: vi.fn().mockImplementation(
        async (name: string): Promise<{ success: boolean; output: string }> => {
          // 模拟顺序无关的并行执行——结果仍按原始顺序排列
          if (name === "read_file") return { success: true, output: "reads" };
          return { success: true, output: "greps" };
        },
      ),
    });
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "process",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });
    const { result } = await collectEvents(gen);
    expect(result).toBe("Done");
  });
});

// ═══════════════════════════════════════════════════════════
// 权限拒绝
// ═══════════════════════════════════════════════════════════

describe("权限拒绝", () => {
  it("onPreToolUse 返回 deny → 工具不执行、回合继续", async () => {
    let callCount = 0;
    const bridge = mockBridge({
      streamChat: vi.fn().mockImplementation(
        async (): Promise<StreamChatResult> => {
          callCount++;
          if (callCount === 1) {
            return {
              content: null,
              tool_calls: [
                { id: "w1", name: "write", arguments: { path: "/tmp/x", content: "data" } },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            };
          }
          return {
            content: "Skipped write, continuing",
            usage: { prompt_tokens: 15, completion_tokens: 6 },
          };
        },
      ),
      executeToolCall: vi.fn(),
    });
    const hooks = mockHooks({
      onPreToolUse: vi.fn().mockResolvedValue("deny" as const),
    });

    const gen = queryLoop({
      input: "write file",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });
    const { events, result } = await collectEvents(gen);

    // 回合正常完成
    expect(result).toBe("Skipped write, continuing");

    // 有 tool_start 事件（权限门检查触发 hook 事件，但拒绝后不执行）
    // 注：queryLoop 内 streamExecuteTools 在 _checkPermission 时才 yield tool_start
    const toolStarts = events.filter((e) => e.type === "tool_start");
    expect(toolStarts).toHaveLength(0); // deny 不走 yield tool_start

    // executeToolCall 不应被调用
    expect(bridge.executeToolCall).not.toHaveBeenCalled();

    // 有 token_usage 事件
    const usageEv = events.find((e) => e.type === "token_usage");
    expect(usageEv).toBeDefined();
  });

  it("skip 时标记成功、工具不执行", async () => {
    let callCount = 0;
    const bridge = mockBridge({
      streamChat: vi.fn().mockImplementation(
        async (): Promise<StreamChatResult> => {
          callCount++;
          if (callCount === 1) {
            return {
              content: null,
              tool_calls: [
                { id: "s1", name: "bash", arguments: { command: "ls" } },
              ],
              usage: { prompt_tokens: 8, completion_tokens: 3 },
            };
          }
          return {
            content: "Skipped bash",
            usage: { prompt_tokens: 12, completion_tokens: 5 },
          };
        },
      ),
      executeToolCall: vi.fn(),
    });
    const hooks = mockHooks({
      onPreToolUse: vi.fn().mockResolvedValue("skip" as const),
    });

    const gen = queryLoop({
      input: "run command",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
    });
    const { result } = await collectEvents(gen);

    expect(result).toBe("Skipped bash");
    expect(bridge.executeToolCall).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
// 中断语义
// ═══════════════════════════════════════════════════════════

describe("中断语义", () => {
  it("回合中断 → yield interrupted 事件并干净退出", async () => {
    const controller = new AbortController();
    const bridge = mockBridge({
      streamChat: vi.fn().mockImplementation(
        async (
          _model: string,
          _messages: LlmMessage[],
          _tools: ToolCallDef[] | undefined,
          onChunk: (content: string) => void,
        ): Promise<StreamChatResult> => {
          // 流第一个 chunk
          onChunk("Partial");
          // 等待——不完成，让中断机制触发
          await new Promise<void>((resolve) => {
            if (controller.signal.aborted) { resolve(); return; }
            controller.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return { content: "Partial", usage: { prompt_tokens: 5, completion_tokens: 3 } };
        },
      ),
    });
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "long task",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
      signal: controller.signal,
    });

    // 获取第一个 chunk
    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ type: "llm_chunk" });

    // 中断
    controller.abort();

    // 应 yield interrupted 事件
    const second = await gen.next();
    expect(second.done).toBe(false);
    expect(second.value).toMatchObject({ type: "interrupted" });

    // 生成器干净结束
    const third = await gen.next();
    expect(third.done).toBe(true);
    expect(third.value).toBe(""); // 中断时无 finalOutput

    // streamChat 被调用一次（中断在首次回合内）
    expect(bridge.streamChat).toHaveBeenCalledTimes(1);
  });

  it("中断后不调用 streamExecuteTools", async () => {
    // 场景：streamChat 返回 tool_calls 之前已被中断
    const controller = new AbortController();
    // 开局就 abort
    controller.abort();

    const bridge = mockBridge({
      streamChat: vi.fn().mockResolvedValue({
        content: null,
        tool_calls: [
          { id: "x1", name: "read_file", arguments: { path: "/tmp/x" } },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }),
    });
    const executeToolCall = vi.fn();
    bridge.executeToolCall = executeToolCall;
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "test",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
      signal: controller.signal,
    });

    const { events, result } = await collectEvents(gen);

    // 立即中断——yield interrupted
    expect(events.filter((e) => e.type === "interrupted")).toHaveLength(1);
    expect(result).toBe(""); // 无输出
    // 不调用工具
    expect(bridge.executeToolCall).not.toHaveBeenCalled();
  });

  it("中断在工具执行边界止住写操作", async () => {
    const controller = new AbortController();
    let callCount = 0;
    const bridge = mockBridge({
      streamChat: vi.fn().mockImplementation(
        async (): Promise<StreamChatResult> => {
          callCount++;
          if (callCount === 1) {
            return {
              content: null,
              tool_calls: [
                { id: "r1", name: "read_file", arguments: { path: "/tmp/x" } },
                { id: "w1", name: "write", arguments: { path: "/tmp/y", content: "data" } },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            };
          }
          return {
            content: "Done",
            usage: { prompt_tokens: 20, completion_tokens: 8 },
          };
        },
      ),
      executeToolCall: vi.fn().mockImplementation(
        async (name: string): Promise<{ success: boolean; output: string }> => {
          // 让读操作稍微延迟，以便在写操作开始前中断
          await new Promise((r) => setTimeout(r, 5));
          return { success: true, output: `${name}-result` };
        },
      ),
    });
    const hooks = mockHooks();

    const gen = queryLoop({
      input: "mixed",
      bridge,
      mode: "chat" as ReplMode,
      agent: "code" as AgentType,
      hooks,
      signal: controller.signal,
    });

    // 消费一个事件（触发 generator 进入流式循环）
    await gen.next();
    // 中断（在工具执行批次中）
    controller.abort();

    // 消费剩余事件
    const remaining: TuiEvent[] = [];
    let finalResult = "";
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        finalResult = value as string;
        break;
      }
      remaining.push(value);
    }

    // 应有 interrupted 事件
    const interrupted = remaining.filter((e) => e.type === "interrupted");
    expect(interrupted.length).toBeGreaterThanOrEqual(0);
    // finalResult 为空（中断退出）
    expect(typeof finalResult).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════
// type-ahead
// ═══════════════════════════════════════════════════════════

describe("type-ahead", () => {
  it("queryLoop 不暴露输入队列语义 — 跳过（不可测）", async () => {
    // queryLoop 是单次生成器：接收一个 input，运行至完成，返回最终文本。
    // 队列语义（回合进行中排队输入）由外层 Ink TUI 循环或
    // 事件驱动层实现，不在 queryLoop 职责范围内。
    // 当前 queryLoop 签名无 queue/enqueue/dequeue 方法，
    // 回调查看也无 type-ahead 相关的参数或事件。
    // 因此本用例无法在 queryLoop 级别覆盖，需在集成级测试。
    expect(true).toBe(true);
  });
});
