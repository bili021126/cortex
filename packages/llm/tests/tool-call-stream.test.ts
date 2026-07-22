/**
 * @ci: unit
 * tool-call-stream.test.ts — accumulateToolCalls / finalizeToolCalls 单元测试
 *
 * 重点验证：后续 delta 不带 id 只有 index 时，arguments 正确追加到同一槽位。
 */

import { describe, it, expect } from "vitest";
import {
  accumulateToolCalls,
  finalizeToolCalls,
  type StreamToolCallDelta,
} from "../src/tool-call-stream.js";

describe("accumulateToolCalls", () => {
  // ── 基础累积 ──

  it("首个 delta 创建槽位（index=0, 带 id + name）", () => {
    const deltas: StreamToolCallDelta[] = [
      { index: 0, id: "call_1", function: { name: "read_file", arguments: "" } },
    ];
    const acc = accumulateToolCalls([], deltas);
    expect(acc).toHaveLength(1);
    expect(acc[0]).toEqual({
      id: "call_1",
      function: { name: "read_file", arguments: "" },
    });
  });

  it("后续 delta 不带 id、只带 index，arguments 追加到同一槽位", () => {
    // 模拟 3 个连续 chunk：首 chunk 带 id+name，后两个只带 arguments 片段
    let acc = accumulateToolCalls([], [
      { index: 0, id: "call_1", function: { name: "read", arguments: "" } },
    ]);
    acc = accumulateToolCalls(acc, [
      { index: 0, function: { arguments: '{"file' } },
    ]);
    acc = accumulateToolCalls(acc, [
      { index: 0, function: { arguments: '_path":"/foo"}' } },
    ]);

    expect(acc).toHaveLength(1);
    expect(acc[0]).toEqual({
      id: "call_1",
      function: { name: "read", arguments: '{"file_path":"/foo"}' },
    });
  });

  it("多 tool_call 按 index 正确分槽", () => {
    let acc = accumulateToolCalls([], [
      { index: 1, id: "call_B", function: { name: "grep", arguments: "" } },
    ]);
    acc = accumulateToolCalls(acc, [
      { index: 0, id: "call_A", function: { name: "read", arguments: "" } },
    ]);
    acc = accumulateToolCalls(acc, [
      { index: 0, function: { arguments: "{}" } },
    ]);
    acc = accumulateToolCalls(acc, [
      { index: 1, function: { arguments: '{"pattern":"foo"}' } },
    ]);

    expect(acc).toHaveLength(2);
    expect(acc[0]!.id).toBe("call_A");
    expect(acc[0]!.function.arguments).toBe("{}");
    expect(acc[1]!.id).toBe("call_B");
    expect(acc[1]!.function.arguments).toBe('{"pattern":"foo"}');
  });

  // ── 边界情况 ──

  it("空 deltas 返回原数组浅拷贝", () => {
    const acc = accumulateToolCalls(
      [{ id: "x", function: { name: "t", arguments: "{}" } }],
      [],
    );
    expect(acc).toHaveLength(1);
    expect(acc[0]!.id).toBe("x");
  });

  it("无 index 默认槽位 0", () => {
    let acc = accumulateToolCalls([], [
      { id: "call_x", function: { name: "ls", arguments: "" } } as StreamToolCallDelta,
    ]);
    acc = accumulateToolCalls(acc, [
      { function: { arguments: "{}" } } as StreamToolCallDelta,
    ]);
    expect(acc[0]!.function.arguments).toBe("{}");
  });

  it("首次 delta 无 id，后续补 id", () => {
    let acc = accumulateToolCalls([], [
      { index: 0, function: { name: "read", arguments: "" } },
    ]);
    acc = accumulateToolCalls(acc, [
      { index: 0, id: "call_late", function: { arguments: "{}" } },
    ]);
    expect(acc[0]!.id).toBe("call_late");
  });

  it("id 已存在时不覆盖", () => {
    let acc = accumulateToolCalls([], [
      { index: 0, id: "call_first", function: { name: "read", arguments: "" } },
    ]);
    // 后续 chunk 尝试提供不同 id——应保持首次的 id
    acc = accumulateToolCalls(acc, [
      { index: 0, id: "call_second", function: { arguments: "{}" } },
    ]);
    expect(acc[0]!.id).toBe("call_first");
  });
});

describe("finalizeToolCalls", () => {
  it("正常 JSON arguments → 解析为对象", () => {
    const acc = [
      { id: "c1", function: { name: "read", arguments: '{"file_path":"/x.ts"}' } },
    ];
    const result = finalizeToolCalls(acc);
    expect(result).toEqual([
      { id: "c1", name: "read", arguments: { file_path: "/x.ts" } },
    ]);
  });

  it("空字符串 arguments → {}", () => {
    const acc = [
      { id: "c2", function: { name: "grep", arguments: "" } },
    ];
    const result = finalizeToolCalls(acc);
    expect(result).toEqual([
      { id: "c2", name: "grep", arguments: {} },
    ]);
  });

  it("不完整 JSON arguments → __parse_error__ 标记（R6-C1 fix）", () => {
    const acc = [
      { id: "c2b", function: { name: "read", arguments: '{"file_path":"/foo' } },
    ];
    const result = finalizeToolCalls(acc);
    expect(result).toHaveLength(1);
    // R6-C1: 不再静默返回 {}，而是标记为 parse_error 防止引擎执行错误参数
    expect(result[0]!.name).toBe("__parse_error__");
    expect(result[0]!.arguments).toHaveProperty("_error");
  });

  it("空名称的槽位被过滤", () => {
    const acc = [
      { id: "", function: { name: "", arguments: "{}" } },
      { id: "c3", function: { name: "read", arguments: "{}" } },
    ];
    const result = finalizeToolCalls(acc);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("read");
  });

  it("空数组 → []", () => {
    expect(finalizeToolCalls([])).toEqual([]);
  });
});
