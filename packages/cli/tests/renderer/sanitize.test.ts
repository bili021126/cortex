// @ci: unit
import { describe, it, expect } from "vitest";
import { sanitizeRenderableText } from "../../src/renderer/sanitize.js";

describe("sanitizeRenderableText", () => {
  it("正常文本不变", () => { expect(sanitizeRenderableText("hello")).toBe("hello"); });
  it("二进制检测", () => { expect(sanitizeRenderableText("�".repeat(12))).toBe("[binary data omitted]"); });
  it("ANSI 剥离", () => { expect(sanitizeRenderableText("\x1b[31mred\x1b[0m")).toBe("red"); });
  it("保留换行", () => { expect(sanitizeRenderableText("a\nb")).toBe("a\nb"); });
  it("控制字符过滤", () => { expect(sanitizeRenderableText("hel\x00lo")).toBe("hello"); });
});
