// @ci: unit
/**
 * TUI 核心测试：streaming-tool-executor（工具流式执行——空批次/执行/事件/容错）
 */
import { describe, it, expect } from "vitest";
import { streamExecuteTools } from "../src/tui/streaming-tool-executor.js";

/** 收集 generator 的事件与结果（next() 驱动——拿到 return 值） */
async function collect(calls: Parameters<typeof streamExecuteTools>[0], bridge?: unknown) {
  const yielded: Array<{ type: string }> = [];
  const hooks = {
    onPostToolUse: () => {},
  };
  const gen = streamExecuteTools(
    calls,
    "cyrene",
    (bridge ?? {
      executeToolCall: async (name: string) => {
        await new Promise((r) => setTimeout(r, 5));
        return { success: true, output: `out-${name}` };
      },
    }) as never,
    [],
    hooks as never,
  );
  let results: unknown[] = [];
  for (;;) {
    const n = await gen.next();
    if (n.done) { results = n.value as unknown[]; break; }
    yielded.push(n.value as { type: string });
  }
  return { yielded, results };
}

const READ_CALL = { id: "t1", name: "read_file", arguments: {} };
const WRITE_CALL = { id: "t2", name: "write_file", arguments: {} };

describe("streamExecuteTools", () => {
  it("空 toolCalls → 立即返回空结果", async () => {
    const { yielded, results } = await collect([]);
    expect(yielded).toEqual([]);
    expect(results).toEqual([]);
  });

  it("读操作执行成功——返回 ToolCallResult（id/name/success）", async () => {
    const { results, yielded } = await collect([READ_CALL]);
    expect(results.length).toBe(1);
    expect(results[0]).toMatchObject({ id: "t1", name: "read_file", success: true });
    // 执行期间有 tool_start/tool_result 事件
    expect(yielded.some((e) => e.type === "tool_start")).toBe(true);
    expect(yielded.some((e) => e.type === "tool_result")).toBe(true);
  });

  it("读写混合按序执行——全部返回", async () => {
    const { results } = await collect([READ_CALL, WRITE_CALL]);
    expect(results.length).toBe(2);
    expect(results[0]?.id).toBe("t1");
    expect(results[1]?.id).toBe("t2");
  });

  it("失败调用不阻塞后续（容错）", async () => {
    const failingBridge = {
      executeToolCall: async (name: string) => {
        if (name === "read_file") throw new Error("boom");
        return { success: true, output: "ok" };
      },
    };
    const { results } = await collect([READ_CALL, WRITE_CALL], failingBridge);
    expect(results.length).toBe(2);
    expect(results[0]).toMatchObject({ id: "t1", success: false });
    expect(results[1]).toMatchObject({ id: "t2", success: true });
  });
});
