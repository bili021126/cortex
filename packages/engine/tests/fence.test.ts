// @ci: unit
/**
 * fence.test.ts —— R12-F 组：不可信内容围栏标记格式
 */
import { describe, it, expect } from "vitest";
import { fence } from "../src/execution/fence.js";

describe("fence() 围栏标记", () => {
  it("基础格式——source 属性", () => {
    const result = fence("记忆内容", "rag-memory");
    expect(result).toBe('[UNTRUSTED source="rag-memory"]\n记忆内容\n[/UNTRUSTED]');
  });

  it("带 id 属性", () => {
    const result = fence("工具输出", "tool:web_fetch", "tool-call-1");
    expect(result).toContain('[UNTRUSTED source="tool:web_fetch" id="tool-call-1"]');
    expect(result).toContain("[/UNTRUSTED]");
  });

  it("多行内容保持原样", () => {
    const result = fence("第一行\n第二行", "skill:review");
    expect(result.split("\n")).toHaveLength(4); // 标记行 + 2 内容行 + 闭合行
  });
});
