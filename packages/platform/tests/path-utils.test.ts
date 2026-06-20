// @ci: unit

import { describe, it, expect } from "vitest";
import { validatePath, resolveSafePath } from "@cortex/platform";

describe("@cortex/platform — path-utils", () => {
  it("validatePath 接受安全相对路径（无沙箱）", () => {
    const result = validatePath("src/index.ts", null);
    expect(result.ok).toBe(true);
  });

  it("validatePath 有沙箱时拒绝 .. 穿越", () => {
    const result = validatePath("../../../etc/passwd", "/workspace");
    expect(result.ok).toBe(false);
  });

  it("resolveSafePath 解析安全路径", () => {
    const result = resolveSafePath("sub/file.txt", null);
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  });
});
