// @ci: unit
import { describe, it, expect, vi } from "vitest";
import { SigintHandler } from "../../src/tui/renderer/sigint-handler.js";

describe("SigintHandler", () => {
  it("第一次按返回提示", () => {
    let exited = false;
    const h = new SigintHandler(() => { exited = true; });
    const msg = h.handle();
    expect(msg).toContain("再按一次");
    expect(exited).toBe(false);
  });
  it("1秒内第二次按触发退出", () => {
    let exited = false;
    const h = new SigintHandler(() => { exited = true; });
    h.handle();
    h.handle();
    expect(exited).toBe(true);
  });
});
