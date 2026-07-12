// @ci: unit
import { describe, it, expect } from "vitest";
import { Footer } from "../../src/renderer/footer.js";

describe("Footer", () => {
  it("空segments无输出", () => {
    const f = new Footer();
    expect(f.render(80).length).toBe(0);
  });
  it("有segments有输出", () => {
    const f = new Footer();
    f.setSegments([{ label: "mode", value: "chat" }]);
    const rows = f.render(80);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toContain("chat");
  });
});
