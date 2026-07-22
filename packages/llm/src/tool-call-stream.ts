/**
 * tool-call-stream.ts — SSE 流式 tool_calls 累积器
 *
 * 问题：OpenAI/DeepSeek 兼容 API 的流式 tool_calls 分片规则：
 *   - 首个 delta 携带 id + function.name + index
 *   - 后续 delta 的 arguments 追加，可能只带 index 不带 id
 *   - 因此不能用 id 做 key，必须用 index
 *
 * 这是一个纯函数模块——不依赖 LlmAdapter 内部状态，可独立测试。
 */

/**
 * 单个 tool_call 在流式累积中的中间形态。
 * 与最终 LlmToolCall 不同：function.arguments 是字符串（片段拼接），不是已解析的 JSON。
 */
export interface StreamToolCallAccumulator {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * 流式 SSE delta 中 tool_calls 数组的单项。
 * 字段都是可选的——不同 chunk 提供不同字段。
 */
export interface StreamToolCallDelta {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

/**
 * 将一批 SSE delta tool_calls 累积到现有数组中。
 *
 * 纯函数：不修改传入的 accumulator 数组，返回新数组（浅拷贝）。
 *
 * @param accumulator - 当前的累积状态。首次调用传 `[]`。
 * @param deltas      - 本次 chunk 中的 `delta.tool_calls` 数组
 * @returns 新的累积状态数组（按 index 排序）
 *
 * @example
 * // 首 chunk——建立索引槽位
 * let acc = accumulateToolCalls([], [{ index: 0, id: "call_1", function: { name: "read", arguments: "" } }]);
 *
 * // 后续 chunk——追加 arguments
 * acc = accumulateToolCalls(acc, [{ index: 0, function: { arguments: '{"path":' } }]);
 * acc = accumulateToolCalls(acc, [{ index: 0, function: { arguments: '"/foo"}' } }]);
 *
 * // acc[0] → { id: "call_1", function: { name: "read", arguments: '{"path":"/foo"}' } }
 */
export function accumulateToolCalls(
  accumulator: ReadonlyArray<StreamToolCallAccumulator>,
  deltas: ReadonlyArray<StreamToolCallDelta>,
): StreamToolCallAccumulator[] {
  if (deltas.length === 0) return accumulator.slice();

  // 找到本次最大 index，确保数组长度足够
  let maxIdx = accumulator.length - 1;
  for (const tc of deltas) {
    const idx = typeof tc.index === "number" ? tc.index : 0;
    if (idx > maxIdx) maxIdx = idx;
  }

  // 扩容——用浅拷贝
  const next: StreamToolCallAccumulator[] = accumulator.slice();
  for (let i = next.length; i <= maxIdx; i++) {
    next[i] = { id: "", function: { name: "", arguments: "" } };
  }

  for (const tc of deltas) {
    const idx = typeof tc.index === "number" ? tc.index : 0;
    const item: StreamToolCallAccumulator = next[idx] ?? { id: "", function: { name: "", arguments: "" } };

    // id 只在首个 delta 出现，补上
    if (tc.id && !item.id) {
      next[idx] = { ...item, id: tc.id };
    }

    // function.name —— 只在首个 delta 出现时设置，后续 chunk 不追加（防止跨 chunk 拼接错误）
    if (tc.function?.name) {
      const current = next[idx] || item;
      if (!current.function.name) {
        next[idx] = {
          ...current,
          function: {
            ...current.function,
            name: tc.function.name,
          },
        };
      }
    }

    // function.arguments —— 分片追加
    if (tc.function?.arguments) {
      next[idx] = {
        ...(next[idx] || item),
        function: {
          ...(next[idx] || item).function,
          arguments: (next[idx] || item).function.arguments + tc.function.arguments,
        },
      };
    }
  }

  return next;
}

/**
 * 将累积完成的 tool_call 数组转换为最终格式。
 * 过滤掉空名称的幽灵 tool_call，并尝试解析 arguments JSON。
 *
 * @param accumulator - accumulateToolCalls 的最终输出
 * @returns 已解析的 tool_calls 列表
 */
export function finalizeToolCalls(
  accumulator: ReadonlyArray<StreamToolCallAccumulator>,
): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
  return accumulator
    .filter((tc) => tc.function.name.length > 0)
    .map((tc) => {
      let args: Record<string, unknown> = {};
      if (tc.function.arguments) {
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          // R6-C1 fix: 流中断导致 JSON 不完整——标记为 parse_error 而非静默执行 {}
          return { id: tc.id, name: "__parse_error__", arguments: { _error: `tool_call arguments JSON 解析失败 (${tc.function.name})`, _raw: tc.function.arguments.slice(0, 200) } };
        }
      }
      return { id: tc.id, name: tc.function.name, arguments: args };
    });
}
