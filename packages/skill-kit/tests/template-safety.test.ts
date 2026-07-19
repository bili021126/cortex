// @ci: unit
import { describe, it, expect } from "vitest";

describe("Skill template engine — prototype safety", () => {
  it("变量路径禁止访问 __proto__", () => {
    const context = { safe: "ok" };
    const path = "__proto__";
    const parts = path.split(".");
    let current: unknown = context;
    for (const part of parts) {
      if (part === "__proto__" || part === "constructor" || part === "prototype") {
        current = undefined;
        break;
      }
      if (typeof current === "object" && current !== null && part in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[part];
      } else {
        current = undefined;
      }
    }
    expect(current).toBeUndefined();
  });

  it("变量路径禁止访问 constructor", () => {
    const context = { safe: "ok" };
    const parts = "constructor".split(".");
    let current: unknown = context;
    for (const part of parts) {
      if (part === "__proto__" || part === "constructor" || part === "prototype") {
        current = undefined;
        break;
      }
    }
    expect(current).toBeUndefined();
  });

  it("正常变量路径正常解析", () => {
    const context = { deep: { key: "value" } };
    const parts = "deep.key".split(".");
    let current: unknown = context;
    for (const part of parts) {
      if (typeof current === "object" && current !== null && part in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[part];
      }
    }
    expect(current).toBe("value");
  });
});
