// @ci: unit
import { describe, it, expect } from "vitest";
import { ToolCard } from "../../src/renderer/tool-card.js";

describe("ToolCard", () => {
  it("add创建pending卡片", () => {
    const tc = new ToolCard(); tc.add("t1", "read_file");
    expect(tc.render(80)[0]).toContain("⏳");
  });
  it("complete更新卡片", () => {
    const tc = new ToolCard(); tc.add("t1", "read_file");
    tc.complete("t1", "file content here", 123, true);
    expect(tc.render(80)[0]).toContain("✅");
  });
});
