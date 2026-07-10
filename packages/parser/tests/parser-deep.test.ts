import { describe, it, expect } from "vitest";

describe("parser deep", () => {
  it("AST解析: convert 将markdown转HTML", async () => {
    const { convert } = await import("@cortex/parser");
    const html = convert("# Hello\n\nThis is **bold** text.");
    expect(html).toContain("<h1>");
    expect(html).toContain("Hello");
    expect(html).toContain("<strong>");
  });

  it("AST解析: convertToDocument 生成完整文档", async () => {
    const { convertToDocument } = await import("@cortex/parser");
    const doc = convertToDocument("# Title\nContent", "Test Doc");
    expect(doc).toContain("<h1>");
    expect(doc).toContain("Title");
  });

  it("AST解析: 空输入返回空字符串", async () => {
    const { convert } = await import("@cortex/parser");
    expect(convert("")).toBe("");
  });
});
