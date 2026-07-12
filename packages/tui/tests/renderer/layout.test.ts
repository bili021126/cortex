// @ci: unit
import { describe, it, expect } from "vitest";
import { Layout } from "../../src/renderer/layout.js";
import type { TuiComponent } from "../../src/renderer/diff-renderer.js";

class MockComp implements TuiComponent {
  private _rows: string[] = [];
  constructor(rows: string[]) { this._rows = rows; }
  render(_w: number): string[] { return this._rows; }
  invalidate(): void {}
}

describe("Layout (skeleton — v4 退役)", () => {
  it("方法不抛异常", () => {
    const layout = new Layout();
    expect(() => layout.setTerminalSize(80, 24)).not.toThrow();
    expect(() => layout.add(new MockComp(["footer"]), "bottom", 1)).not.toThrow();
    expect(() => layout.remove(new MockComp([]))).not.toThrow();
  });
  it("render 返回空数组", () => {
    const layout = new Layout();
    const rows = layout.render(80);
    expect(rows.length).toBe(0);
  });
});
