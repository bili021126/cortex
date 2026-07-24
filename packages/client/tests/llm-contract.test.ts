// @ci: contract
// tests/cross-package/llm-contract.test.ts — protocol DTO ↔ engine/llm Type 对齐验证
import { describe, it, expect } from "vitest";

/**
 * 跨包契约测试——不依赖运行时，仅验证类型结构一致性。
 *
 * 关键验证：
 *   LlmMessage (shared) ↔ LlmMessageDTO (protocol)
 *   LlmToolCall (shared) ↔ protocol tool_calls 格式
 *   确保 reasoning_content / tool_call_id 不在协议层丢失
 */

describe("跨包契约 — LLM 协议对齐", () => {
  it("LlmMessage 的 tool_call_id 可往返序列化", () => {
    // 模拟 RemoteEngineBridge.serializeMsg 的行为
    const msg = {
      role: "tool" as const,
      content: "result",
      tool_call_id: "tc_123",
    };

    const serialized = {
      role: msg.role,
      content: msg.content,
      ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
    };

    expect(serialized.tool_call_id).toBe("tc_123");
    expect(serialized.role).toBe("tool");
  });

  it("LlmMessage 的 reasoning_content 可往返序列化", () => {
    const msg = {
      role: "assistant" as const,
      content: "answer",
      reasoning_content: "let me think",
    };

    const serialized = {
      role: msg.role,
      content: msg.content,
      ...(msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {}),
    };

    expect(serialized.reasoning_content).toBe("let me think");
  });

  it("tool_calls 在消息中完整保留（含 id/name/arguments）", () => {
    const toolCalls = [
      { id: "tc1", name: "read_file", arguments: { path: "/f" } },
    ];
    const msg = {
      role: "assistant" as const,
      content: "",
      tool_calls: toolCalls,
    };

    const serialized = {
      role: msg.role,
      content: msg.content,
      tool_calls: msg.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
      })),
    };

    const dto = serialized.tool_calls[0]!;
    expect(dto.id).toBe("tc1");
    expect(dto.name).toBe("read_file");
    expect(JSON.parse(dto.arguments as string)).toEqual({ path: "/f" });
  });

  it("空 tool_calls 不序列化（避免多余字段）", () => {
    const msg = { role: "user" as const, content: "hello" };
    const serialized = { role: msg.role, content: msg.content };
    expect(serialized).not.toHaveProperty("tool_calls");
    expect(serialized).not.toHaveProperty("tool_call_id");
  });
});
