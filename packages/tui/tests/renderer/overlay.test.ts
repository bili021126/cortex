// @ci: unit
import { describe, it, expect } from "vitest";
import { OverlayManager } from "../../src/renderer/overlay.js";

describe("OverlayManager (skeleton — v4 退役)", () => {
  it("无overlay时render为空", () => {
    const om = new OverlayManager();
    expect(om.render(80).length).toBe(0);
  });
  it("有overlay时render仍为空（骨架）", () => {
    const om = new OverlayManager();
    om.setWidth(80);
    om.show({ title: "test", content: ["line1"], anchor: "center", width: 50 }, () => {});
    expect(om.render(80).length).toBe(0);
    expect(om.active).toBe(false);
    om.dismiss();
  });
  it("dismiss 不抛异常", () => {
    const om = new OverlayManager();
    expect(() => om.dismiss()).not.toThrow();
  });
});
