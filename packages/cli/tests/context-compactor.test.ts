// @ci: unit
/**
 * context-compactor.test.ts — 五层渐进式上下文压缩管线单元测试
 *
 * 覆盖所有导出函数 + 各压缩层边界条件：
 *   - estimateTokens
 *   - compactMessages 主入口（空消息、无 system prompt、各层触发与提前停止）
 *   - L1 孤立 tool 结果裁剪
 *   - L2 超长 tool 输出截断
 *   - L3 旧 tool 调用对合并
 *   - L4 LLM 摘要（含回调失败降级）
 *   - L5 最旧消息丢弃（含 keepRecentTurns 边界保护）
 */

import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  compactMessages,
  type CompactionOptions,
} from "@cortex/tui";
import type { LlmMessage } from "@cortex/shared";

// ── 工厂函数 ──────────────────────────────────────────────

function sys(content: string): LlmMessage {
  return { role: "system", content };
}
function user(content: string): LlmMessage {
  return { role: "user", content };
}
function asst(content: string): LlmMessage {
  return { role: "assistant", content };
}
function asstWithTools(
  content: string,
  toolCalls: { id: string; name: string; arguments?: Record<string, unknown> }[],
): LlmMessage {
  return {
    role: "assistant",
    content,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments ?? {},
    })),
  };
}
function tool(id: string, content: string): LlmMessage {
  return { role: "tool", content, tool_call_id: id };
}
function userTurn(question: string, answer: string): LlmMessage[] {
  return [user(question), asst(answer)];
}

// ═══════════════════════════════════════════════════════════
// estimateTokens
// ═══════════════════════════════════════════════════════════

describe("estimateTokens", () => {
  it("空消息列表返回 0", () => {
    expect(estimateTokens([])).toBe(0);
  });

  it("纯文本消息按 chars/4 估算", () => {
    // "hello" = 5 chars → ceil(5/4) = 2
    expect(estimateTokens([user("hello")])).toBe(2);
  });

  it("多个消息累加", () => {
    const msgs: LlmMessage[] = [
      sys("You are helpful"),
      user("hi"),           // 2 chars
      asst("hello there"),  // 11 chars
    ];
    // total chars: 15 + 2 + 11 = 28 → ceil(28/4) = 7
    expect(estimateTokens(msgs)).toBe(7);
  });

  it("包含 reasoning_content 计入 token 估算", () => {
    const msg: LlmMessage = {
      role: "assistant",
      content: "ok",
      reasoning_content: "let me think about this carefully", // 32 chars
    };
    // 2 + 32 = 34 → ceil(34/4) = 9
    expect(estimateTokens([msg])).toBe(9);
  });

  it("包含 tool_calls 计入序列化长度", () => {
    const msg = asstWithTools("using tools", [
      { id: "call_1", name: "read_file", arguments: { path: "/tmp/x" } },
    ]);
    // content: 11 + tool_calls JSON
    // tool_calls 序列化为 JSON 约 50 chars → total ≈ 61 → ceil(61/4) = 16
    const tokens = estimateTokens([msg]);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(50); // sanity
  });

  it("tool 消息含 tool_call_id 计入估算", () => {
    const msgs: LlmMessage[] = [
      tool("call_abc123", "result"),
    ];
    // "result"(6) + "call_abc123"(11) = 17 → ceil(17/4) = 5
    expect(estimateTokens(msgs)).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════
// compactMessages — 边界
// ═══════════════════════════════════════════════════════════

describe("compactMessages — 边界条件", () => {
  const baseOpts: CompactionOptions = {
    contextLimit: 128000,
    currentTokens: 128000,
    triggerThreshold: 0.95,
    targetRatio: 0.6,
  };

  it("消息不足 2 条时跳过压缩", async () => {
    const result = await compactMessages([], baseOpts);
    expect(result.compactedCount).toBe(0);
    expect(result.summary).toContain("跳过压缩");
  });

  it("无 system prompt 时跳过压缩", async () => {
    const msgs: LlmMessage[] = [user("hello"), asst("hi")];
    const result = await compactMessages(msgs, baseOpts);
    expect(result.compactedCount).toBe(0);
  });

  it("消息数不足触发压缩时不做任何层", async () => {
    // 当前 token 远低于阈值
    const opts: CompactionOptions = {
      contextLimit: 128000,
      currentTokens: 100, // 远低于 95%
      triggerThreshold: 0.95,
    };
    const msgs: LlmMessage[] = [
      sys("system"),
      ...userTurn("q", "a"),
    ];
    const result = await compactMessages(msgs, opts);
    // 注意：compactMessages 即使不触发也会运行 L1 判断
    // L1 无孤儿 tool 结果 → 不推入 appliedLayers
    expect(result.appliedLayers).toEqual([]);
    expect(result.compactedCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// L1 — 裁剪孤立工具结果
// ═══════════════════════════════════════════════════════════

describe("L1 — 裁剪孤立工具结果", () => {
  const triggerOpts: CompactionOptions = {
    contextLimit: 128000,
    currentTokens: 128000,
    targetRatio: 0.2, // 设定极低目标确保 L1 之后继续
  };

  it("移除无对应 assistant tool_calls 的 tool 消息", async () => {
    const msgs: LlmMessage[] = [
      sys("system"),
      tool("orphan_1", "orphan result"),
      user("hello"),
      asst("hi"),
    ];
    const result = await compactMessages(msgs, triggerOpts);
    expect(result.compactedCount).toBe(1);
    expect(result.appliedLayers).toContain(1);
    // 孤儿 tool 被移除
    expect(result.messages.find((m) => m.tool_call_id === "orphan_1")).toBeUndefined();
    // system 和正常对话保留
    expect(result.messages.length).toBe(3);
  });

  it("保留有对应 assistant tool_calls 的 tool 消息", async () => {
    const msgs: LlmMessage[] = [
      sys("system"),
      asstWithTools("calling", [{ id: "call_1", name: "read" }]),
      tool("call_1", "file content"),
    ];
    const result = await compactMessages(msgs, triggerOpts);
    // call_1 被引用 → tool 消息保留
    expect(result.messages.some((m) => m.tool_call_id === "call_1")).toBe(true);
  });

  it("多个孤儿 tool 结果全部移除", async () => {
    const msgs: LlmMessage[] = [
      sys("system"),
      tool("o1", "a"),
      tool("o2", "b"),
      tool("o3", "c"),
      user("hi"),
    ];
    const result = await compactMessages(msgs, triggerOpts);
    // 3 孤儿 + 1 system + 1 user = len 2 (移除了 3)
    expect(result.compactedCount).toBe(3);
    expect(result.messages.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════
// L2 — 截断超长工具输出
// ═══════════════════════════════════════════════════════════

describe("L2 — 截断超长工具输出", () => {
  const triggerOpts: CompactionOptions = {
    contextLimit: 128000,
    currentTokens: 128000,
    targetRatio: 0.001, // 极小目标，确保 L1 后不提前停止
    toolOutputMaxChars: 100,
  };

  it("超长 tool 内容被截断并标记", async () => {
    const longContent = "x".repeat(500);
    const msgs: LlmMessage[] = [
      sys("system"),
      user("run test"),
      asstWithTools("ok", [{ id: "c1", name: "bash" }]),
      tool("c1", longContent),
    ];
    const result = await compactMessages(msgs, triggerOpts);
    expect(result.appliedLayers).toContain(2);
    const toolMsg = result.messages.find((m) => m.tool_call_id === "c1");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toContain("[截断，原始 500 字符]");
    expect(toolMsg!.content.length).toBeLessThan(longContent.length + 50);
  });

  it("短 tool 内容不被截断", async () => {
    const msgs: LlmMessage[] = [
      sys("system"),
      user("q"),
      asstWithTools("a", [{ id: "c1", name: "read" }]),
      tool("c1", "short"),
    ];
    const result = await compactMessages(msgs, triggerOpts);
    // L2 可能不触发（内容已短，也可能触发但 truncated=0）
    const toolMsg = result.messages.find((m) => m.tool_call_id === "c1");
    expect(toolMsg!.content).toBe("short");
  });

  it("非 tool 消息不受影响", async () => {
    const msgs: LlmMessage[] = [
      sys("system"),
      user("x".repeat(500)),
    ];
    const result = await compactMessages(msgs, triggerOpts);
    // user 消息不被截断
    expect(result.messages[1].content).toBe("x".repeat(500));
  });
});

// ═══════════════════════════════════════════════════════════
// L3 — 压缩旧工具调用对
// ═══════════════════════════════════════════════════════════

describe("L3 — 压缩旧工具调用对", () => {
  const triggerOpts: CompactionOptions = {
    contextLimit: 1, // 极小 contextLimit 确保各层不被 isBelowTarget 提前截停
    currentTokens: 128000,
    targetRatio: 0,
    keepRecentTurns: 0, // 不保留最近轮次，让 L3 处理全量
  };

  it("将旧 assistant(tool_calls)+tool 对压缩为摘要", async () => {
    const msgs: LlmMessage[] = [
      sys("system"),
      asstWithTools("calling", [{ id: "call_1", name: "read_file" }]),
      tool("call_1", "file contents here"),
    ];
    const result = await compactMessages(msgs, triggerOpts);
    // L3 将 1 个 assistant + 1 个 tool 压缩为 1 个 assistant 摘要
    // compressed = 1 (tool 消息)
    expect(result.appliedLayers).toContain(3);
    expect(result.compactedCount).toBeGreaterThanOrEqual(1);
    // 摘要消息存在
    const summaryMsg = result.messages.find(
      (m) => m.role === "assistant" && m.content.includes("[已执行工具"),
    );
    expect(summaryMsg).toBeDefined();
  });

  it("保留区内的 tool 对不被压缩", async () => {
    const triggerOptsKeep: CompactionOptions = {
      ...triggerOpts,
      contextLimit: 128000,
      targetRatio: 0.001,
      keepRecentTurns: 1,
    };
    const msgs: LlmMessage[] = [
      sys("system"),
      asstWithTools("old call", [{ id: "old", name: "read" }]),
      tool("old", "old result"),
      user("new question"), // ← keepRecentTurns=1 从这里开始保留
      asstWithTools("new call", [{ id: "new", name: "read" }]),
      tool("new", "new result"),
    ];
    const result = await compactMessages(msgs, triggerOptsKeep);
    // 保留区内的 new tool 对不应该被压缩
    const newTool = result.messages.find((m) => m.tool_call_id === "new");
    expect(newTool).toBeDefined();
  });

  it("多个工具调用对压缩为摘要含所有工具名", async () => {
    const msgs: LlmMessage[] = [
      sys("system"),
      asstWithTools("multi", [
        { id: "a", name: "read_file" },
        { id: "b", name: "grep" },
      ]),
      tool("a", "content A"),
      tool("b", "content B"),
    ];
    const result = await compactMessages(msgs, triggerOpts);
    const summary = result.messages.find((m) => m.content.includes("read_file"));
    expect(summary).toBeDefined();
    expect(summary!.content).toContain("grep");
  });
});

// ═══════════════════════════════════════════════════════════
// L4 — LLM 摘要（回调）
// ═══════════════════════════════════════════════════════════

describe("L4 — LLM 摘要", () => {
  it("无 summarize 回调时 L4 跳过", async () => {
    const opts: CompactionOptions = {
      contextLimit: 1, // 极小 contextLimit 确保走到 L4
      currentTokens: 128000,
      targetRatio: 0,
      keepRecentTurns: 0,
    };
    const msgs: LlmMessage[] = [
      sys("system"),
      ...userTurn("q1", "a1"),
      ...userTurn("q2", "a2"),
      ...userTurn("q3", "a3"),
      ...userTurn("q4", "a4"),
      user("current"),
    ];
    const result = await compactMessages(msgs, opts);
    // 没有 summarize → L4 跳过
    expect(result.appliedLayers).not.toContain(4);
  });

  it("summarize 回调被调用，旧轮次被摘要替换", async () => {
    let called = false;
    const summarize = async (msgs: LlmMessage[]) => {
      called = true;
      return "用户询问了多个技术问题，助手逐一解答。";
    };
    // target=50: 压缩前 11 条消息 ~82 tokens > 50，L4 压缩后 4 条 ~18 tokens < 50
    // → L1/L2/L3 不提前停，L4 后 isBelowTarget 触发，L5 不运行
    const opts: CompactionOptions = {
      contextLimit: 100,
      currentTokens: 100,
      targetRatio: 0.5,
      keepRecentTurns: 1,
      summarize,
    };
    // 填充消息使初始 tokens > 50
    const pad = "M".repeat(20); // 每个 user/assistant 约 20 字符 → 10 tokens/pair
    const msgs: LlmMessage[] = [
      sys("system"),
      ...userTurn(`q1 ${pad}`, `a1 ${pad}`),
      ...userTurn(`q2 ${pad}`, `a2 ${pad}`),
      ...userTurn(`q3 ${pad}`, `a3 ${pad}`),
      ...userTurn(`q4 ${pad}`, `a4 ${pad}`),
      user("current question"),
      asst("current answer"),
    ];
    const result = await compactMessages(msgs, opts);
    expect(called).toBe(true);
    expect(result.appliedLayers).toContain(4);
    // 压缩后应有摘要消息
    const summaryMsg = result.messages.find((m) => m.content.includes("[对话摘要]"));
    expect(summaryMsg).toBeDefined();
    // 保留区消息仍存在
    expect(result.messages.some((m) => m.content === "current question")).toBe(true);
    expect(result.messages.some((m) => m.content === "current answer")).toBe(true);
  });

  it("summarize 抛出异常时降级返回原消息", async () => {
    const summarize = async () => {
      throw new Error("LLM failed");
    };
    const opts: CompactionOptions = {
      contextLimit: 1,
      currentTokens: 128000,
      targetRatio: 0,
      keepRecentTurns: 0,
      summarize,
    };
    const msgs: LlmMessage[] = [
      sys("system"),
      ...userTurn("q1", "a1"),
      ...userTurn("q2", "a2"),
      ...userTurn("q3", "a3"),
      ...userTurn("q4", "a4"),
    ];
    const result = await compactMessages(msgs, opts);
    // 不崩溃，消息保留
    expect(result.messages.length).toBeGreaterThan(1);
    expect(result.appliedLayers).not.toContain(4);
  });

  it("summarize 返回过短内容时跳过", async () => {
    const summarize = async () => "ok";
    const opts: CompactionOptions = {
      contextLimit: 1,
      currentTokens: 128000,
      targetRatio: 0,
      keepRecentTurns: 0,
      summarize,
    };
    const msgs: LlmMessage[] = [
      sys("system"),
      ...userTurn("q1", "a1"),
      ...userTurn("q2", "a2"),
      ...userTurn("q3", "a3"),
      ...userTurn("q4", "a4"),
    ];
    const result = await compactMessages(msgs, opts);
    expect(result.appliedLayers).not.toContain(4);
  });
});

// ═══════════════════════════════════════════════════════════
// L5 — 丢弃最旧消息
// ═══════════════════════════════════════════════════════════

describe("L5 — 丢弃最旧消息", () => {
  it("无其他层可压缩时，逐条丢弃旧消息直到目标以下", async () => {
    const opts: CompactionOptions = {
      contextLimit: 100,
      currentTokens: 100,
      targetRatio: 0.01, // 极小目标，确保 L1-L4 后不提前停止
      keepRecentTurns: 1, // 保留最后 1 轮
    };
    const msgs: LlmMessage[] = [
      sys("system"),
      ...userTurn("q1", "a1"),
      ...userTurn("q2", "a2"),
      ...userTurn("q3", "a3"),
      user("current"),
    ];
    const result = await compactMessages(msgs, opts);
    // L5 应触发（前几层不够）
    expect(result.appliedLayers).toContain(5);
    // system prompt 始终保留
    expect(result.messages[0].role).toBe("system");
    // 保留区消息存在
    expect(result.messages.some((m) => m.content === "current")).toBe(true);
  });

  it("system prompt 永不丢弃", async () => {
    const opts: CompactionOptions = {
      contextLimit: 50,
      currentTokens: 100,
      targetRatio: 0.1,
      keepRecentTurns: 0,
    };
    const msgs: LlmMessage[] = [
      sys("I am a system prompt that must stay"),
      user("q"),
      asst("a"),
    ];
    const result = await compactMessages(msgs, opts);
    expect(result.messages[0]).toEqual(msgs[0]);
  });
});

// ═══════════════════════════════════════════════════════════
// 多层级联动
// ═══════════════════════════════════════════════════════════

describe("多层级联动", () => {
  it("L1→L3 级联压缩后提前停止", async () => {
    const opts: CompactionOptions = {
      contextLimit: 5000,
      currentTokens: 5000,
      targetRatio: 0.99, // 接近不压缩，提前停止
      keepRecentTurns: 0,
    };
    // 构造大量孤儿 tool + 少数正常消息
    const msgs: LlmMessage[] = [
      sys("system"),
      tool("o1", "a"),
      tool("o2", "b"),
      asstWithTools("call", [{ id: "c1", name: "read" }]),
      tool("c1", "result"),
    ];
    const result = await compactMessages(msgs, opts);
    // L1 移除 2 孤儿 → 达标 → 提前停止
    expect(result.appliedLayers).toEqual([1]);
    expect(result.compactedCount).toBe(2);
  });

  it("返回正确的 estimatedTokens 和 summary", async () => {
    const opts: CompactionOptions = {
      contextLimit: 128000,
      currentTokens: 128000,
      targetRatio: 0.2,
      keepRecentTurns: 0,
    };
    const msgs: LlmMessage[] = [
      sys("system"),
      tool("o1", "orphan"),
      user("hello"),
      asst("hi"),
    ];
    const result = await compactMessages(msgs, opts);
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.summary).toBeTruthy();
    expect(result.appliedLayers.length).toBeGreaterThan(0);
  });

  it("compactedCount 准确反映被修改/移除的消息数", async () => {
    const opts: CompactionOptions = {
      contextLimit: 128000,
      currentTokens: 128000,
      targetRatio: 0.2,
      keepRecentTurns: 0,
    };
    const msgs: LlmMessage[] = [
      sys("system"),
      tool("o1", "a"),
      tool("o2", "b"),
      user("hi"),
    ];
    const result = await compactMessages(msgs, opts);
    // L1 移除 2 孤儿
    expect(result.compactedCount).toBe(2);
  });
});
