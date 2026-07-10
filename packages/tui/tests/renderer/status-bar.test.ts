// @ci: unit
import { describe, it, expect } from "vitest";
import { StatusBar } from "../../src/renderer/status-bar.js";

describe("StatusBar", () => {
  it("空闲时输出空格", () => {
    const bar = new StatusBar();
    expect(bar.render(80)[0]).toContain("  ");
  });
  it("忙碌时输出spinner", () => {
    const bar = new StatusBar();
    bar.start("思考中");
    const line = bar.render(80)[0];
    expect(line).toContain("思考中");
  });
  it("停止后无spinner", () => {
    const bar = new StatusBar();
    bar.start("x"); bar.stop();
    expect(bar.render(80)[0]).not.toContain("⠋");
  });
});
