// @ci: unit
/**
 * streaming-tool-executor.test.ts — 流式工具并发执行器单元测试
 *
 * 覆盖：
 *   - classifyCalls: 读写分类（L1 读 / L2-L3 写）
 *   - _pushToolMessages: assistant+tool 消息注入
 *   - streamExecuteTools: 空调用、deny/skip 权限分支、并行读、串行写
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { streamExecuteTools } from "@cortex/cli";
import type { TuiHooks, TuiEvent } from "@cortex/cli";
import type { AgentType, LlmMessage, ITuiEngineBridge } from "@cortex/shared";

// ── 类型辅助 ──────────────────────────────────────────────

interface ToolCallInput {
  name: string;
  arguments: Record<string, unknown>;
  id: string;
}

// ── Mock 工厂 ──────────────────────────────────────────────

function mockBridge(overrides?: Partial<ITuiEngineBridge>): ITuiEngineBridge {
  return {
    streamChat: vi.fn() as ITuiEngineBridge["streamChat"],
    executeToolCall: vi.fn().mockResolvedValue({ success: true, output: "ok" } as never),
    getToolDefs: vi.fn().mockReturnValue([]),
    getChatModelName: vi.fn().mockReturnValue("test-model"),
    getReasonerModelName: vi.fn().mockReturnValue("test-reasoner"),
    chat: vi.fn().mockResolvedValue("ok"),
    ensureTalkMemory: vi.fn().mockResolvedValue(undefined),
    readTalkMemory: vi.fn().mockResolvedValue([]),
    writeTalkMemory: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ITuiEngineBridge;
}

function mockHooks(overrides?: Partial<TuiHooks>): TuiHooks {
  return {
    onPreToolUse: vi.fn().mockResolvedValue("allow" as const),
    onPostToolUse: vi.fn(),
    ...overrides,
  };
}

function readCall(name = "read_file", id = "r1"): ToolCallInput {
  return { name, arguments: { path: "/tmp/x" }, id };
}
function writeCall(name = "write", id = "w1"): ToolCallInput {
  return { name, arguments: { path: "/tmp/x", content: "hello" }, id };
}
function bashCall(name = "bash", id = "b1"): ToolCallInput {
  return { name, arguments: { command: "ls" }, id };
}

// ── 工具函数：收集 AsyncGenerator 全部 yield ──────────────────

async function collectEvents(
  gen: AsyncGenerator<TuiEvent, unknown, void>,
): Promise<{ events: TuiEvent[]; result: unknown }> {
  const events: TuiEvent[] = [];
  let result: unknown;
  while (true) {
    const { value, done } = await gen.next();
    if (done) {
      result = value;
      break;
    }
    events.push(value);
  }
  return { events, result };
}

// ═══════════════════════════════════════════════════════════
// 测试
// ═══════════════════════════════════════════════════════════

const AGENT = "code" as AgentType;

describe("streamExecuteTools", () => {
  describe("空调用", () => {
    it("空 toolCalls 返回空数组", async () => {
      const gen = streamExecuteTools([], AGENT, mockBridge(), [], mockHooks());
      const { result } = await collectEvents(gen as AsyncGenerator<TuiEvent, unknown, void>);
      expect(result).toEqual([]);
    });
  });

  describe("权限 deny", () => {
    it("L1 读操作被 deny 时，写入 denied 消息不执行", async () => {
      const messages: LlmMessage[] = [];
      const hooks = mockHooks({
        onPreToolUse: vi.fn().mockResolvedValue("deny" as const),
      });

      const gen = streamExecuteTools(
        [readCall("read_file", "r1")],
        AGENT,
        mockBridge(),
        messages,
        hooks,
      );
      const { events, result } = await collectEvents(
        gen as AsyncGenerator<TuiEvent, unknown, void>,
      );

      // 无 tool_start 事件
      expect(events.filter((e) => e.type === "tool_start")).toHaveLength(0);
      // 结果含 deny
      const results = result as { id: string; success: boolean; output: string }[];
      expect(results[0].success).toBe(false);
      expect(results[0].output).toBe("denied by hook");
      // 消息注入
      expect(messages).toHaveLength(2); // assistant + tool
      expect(messages[1].content).toBe("denied by hook");
    });

    it("L3 写操作被 deny 时，写入 denied 消息不执行", async () => {
      const messages: LlmMessage[] = [];
      const hooks = mockHooks({
        onPreToolUse: vi.fn().mockResolvedValue("deny" as const),
      });

      const gen = streamExecuteTools(
        [writeCall("write", "w1")],
        AGENT,
        mockBridge(),
        messages,
        hooks,
      );
      const { result } = await collectEvents(
        gen as AsyncGenerator<TuiEvent, unknown, void>,
      );

      const results = result as { id: string; level: number; output: string }[];
      expect(results[0].output).toBe("denied by hook");
      expect(results[0].level).toBe(3); // "write" 在 L3 不可逆集合中
    });
  });

  describe("权限 skip", () => {
    it("skip 时注入 [skipped by user] 消息并标记 success=true", async () => {
      const messages: LlmMessage[] = [];
      const hooks = mockHooks({
        onPreToolUse: vi.fn().mockResolvedValue("skip" as const),
      });

      const gen = streamExecuteTools(
        [readCall("glob", "r1")],
        AGENT,
        mockBridge(),
        messages,
        hooks,
      );
      const { result } = await collectEvents(
        gen as AsyncGenerator<TuiEvent, unknown, void>,
      );

      const results = result as { success: boolean; output: string }[];
      expect(results[0].success).toBe(true);
      expect(results[0].output).toBe("[skipped by user]");
      expect(messages[1].content).toBe("[skipped by user]");
    });
  });

  describe("读操作执行", () => {
    it("allow 时 yield tool_start 事件", async () => {
      const bridge = mockBridge({
        executeToolCall: vi.fn().mockResolvedValue({ success: true, output: "result" }),
      });

      const gen = streamExecuteTools(
        [readCall("read_file", "r1")],
        AGENT,
        bridge,
        [],
        mockHooks(),
      );
      const { events } = await collectEvents(
        gen as AsyncGenerator<TuiEvent, unknown, void>,
      );

      expect(events.some((e) => e.type === "tool_start" && e.tool === "read_file")).toBe(true);
    });

    it("执行后 yield tool_result 事件", async () => {
      const bridge = mockBridge({
        executeToolCall: vi.fn().mockResolvedValue({ success: true, output: "hello world" }),
      });

      const gen = streamExecuteTools(
        [readCall("grep", "r1")],
        AGENT,
        bridge,
        [],
        mockHooks(),
      );
      const { events } = await collectEvents(
        gen as AsyncGenerator<TuiEvent, unknown, void>,
      );

      const resultEv = events.find((e) => e.type === "tool_result");
      expect(resultEv).toBeDefined();
      expect((resultEv as { output: string }).output).toBe("hello world");
    });

    it("多个 L1 读操作并行执行，所有 tool_start 先 yield", async () => {
      const calls: ToolCallInput[] = [
        readCall("read_file", "r1"),
        readCall("glob", "r2"),
        readCall("grep", "r3"),
      ];
      const gen = streamExecuteTools(calls, AGENT, mockBridge(), [], mockHooks());
      const { events } = await collectEvents(
        gen as AsyncGenerator<TuiEvent, unknown, void>,
      );

      const starts = events.filter((e) => e.type === "tool_start");
      const results_ = events.filter((e) => e.type === "tool_result");
      expect(starts).toHaveLength(3);
      expect(results_).toHaveLength(3);
      // tool_start 先于 tool_result（所有 start yield 后才 await Promise.all）
      const firstResult = events.findIndex((e) => e.type === "tool_result");
      const lastStart = events.map((e) => e.type).lastIndexOf("tool_start");
      expect(lastStart).toBeLessThan(firstResult);
    });

    it("读操作结果注入 messages", async () => {
      const messages: LlmMessage[] = [];
      const bridge = mockBridge({
        executeToolCall: vi.fn().mockResolvedValue({ success: true, output: "file content" }),
      });

      const gen = streamExecuteTools(
        [readCall("read_file", "r1")],
        AGENT,
        bridge,
        messages,
        mockHooks(),
      );
      await collectEvents(gen as AsyncGenerator<TuiEvent, unknown, void>);

      expect(messages[0].role).toBe("assistant");
      expect(messages[1].role).toBe("tool");
      expect(messages[1].content).toBe("file content");
    });
  });

  describe("写操作执行", () => {
    it("L2 写操作串行执行", async () => {
      let executions = 0;
      const bridge = mockBridge({
        executeToolCall: vi.fn().mockImplementation(async () => {
          executions++;
          return { success: true, output: `exec_${executions}` };
        }),
      });

      const gen = streamExecuteTools(
        [writeCall("write", "w1"), writeCall("update_memory", "w2")],
        AGENT,
        bridge,
        [],
        mockHooks(),
      );
      const { events, result } = await collectEvents(
        gen as AsyncGenerator<TuiEvent, unknown, void>,
      );

      const results = result as { output: string }[];
      expect(results).toHaveLength(2);
      expect(results[0].output).toBe("exec_1");
      expect(results[1].output).toBe("exec_2");
    });

    it("L3 不可逆操作正确标记 level=3", async () => {
      const gen = streamExecuteTools(
        [bashCall("bash", "b1")],
        AGENT,
        mockBridge(),
        [],
        mockHooks(),
      );
      const { result } = await collectEvents(
        gen as AsyncGenerator<TuiEvent, unknown, void>,
      );

      const results = result as { level: number }[];
      expect(results[0].level).toBe(3);
    });
  });

  describe("混合批次", () => {
    it("读写混合：先完成所有读，再写", async () => {
      const executionOrder: string[] = [];
      const bridge = mockBridge({
        executeToolCall: vi.fn().mockImplementation(async (name: string) => {
          executionOrder.push(name);
          // 读快，写慢 —— 但串行保证写在读之后
          if (name === "write") await new Promise((r) => setTimeout(r, 10));
          return { success: true, output: name };
        }),
      });

      const calls: ToolCallInput[] = [
        readCall("read_file", "r1"),
        writeCall("write", "w1"),
        readCall("glob", "r2"),
      ];

      const gen = streamExecuteTools(calls, AGENT, bridge, [], mockHooks());
      await collectEvents(gen as AsyncGenerator<TuiEvent, unknown, void>);

      // 两个读先于写
      const writeIdx = executionOrder.indexOf("write");
      expect(writeIdx).toBeGreaterThan(0); // 写不可能是第一个
      // reads 在 writes 之前
      expect(executionOrder.slice(0, 2).sort()).toEqual(["glob", "read_file"].sort());
    });

    it("L1+L3 混合：正确分级", async () => {
      const calls: ToolCallInput[] = [
        readCall("read_file", "r1"),
        bashCall("bash", "b1"),
      ];

      const gen = streamExecuteTools(calls, AGENT, mockBridge(), [], mockHooks());
      const { result } = await collectEvents(
        gen as AsyncGenerator<TuiEvent, unknown, void>,
      );

      const results = result as { name: string; level: number }[];
      const read = results.find((r) => r.name === "read_file");
      const bash = results.find((r) => r.name === "bash");
      expect(read!.level).toBe(1);
      expect(bash!.level).toBe(3);
    });
  });

  describe("推理内容传递", () => {
    it("reasoningContent 注入到 assistant 消息", async () => {
      const messages: LlmMessage[] = [];
      const gen = streamExecuteTools(
        [readCall("read_file", "r1")],
        AGENT,
        mockBridge(),
        messages,
        mockHooks(),
        "I should read this file",
      );
      await collectEvents(gen as AsyncGenerator<TuiEvent, unknown, void>);

      const asstMsg = messages.find((m) => m.role === "assistant");
      expect(asstMsg).toBeDefined();
      expect(
        (asstMsg as unknown as Record<string, unknown>).reasoning_content,
      ).toBe("I should read this file");
    });
  });

  describe("错误处理", () => {
    it("executeToolCall 抛异常时调用 onToolError 并返回失败结果", async () => {
      const onToolError = vi.fn();
      const bridge = mockBridge({
        executeToolCall: vi.fn().mockRejectedValue(new Error("boom")),
      });
      const hooks = mockHooks({ onToolError });

      const gen = streamExecuteTools(
        [readCall("read_file", "r1")],
        AGENT,
        bridge,
        [],
        hooks,
      );
      const { result } = await collectEvents(
        gen as AsyncGenerator<TuiEvent, unknown, void>,
      );

      const results = result as { success: boolean; output: string }[];
      expect(results[0].success).toBe(false);
      expect(results[0].output).toContain("boom");
      expect(onToolError).toHaveBeenCalled();
    });
  });
});
