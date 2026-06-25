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

  // ── 新增测试 ─────────────────────────────────

  it("validatePath 正常路径在沙箱内返回 ok", () => {
    const result = validatePath("src/index.ts", "/workspace");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 路径包含 src 和 index 组件（跨平台，Windows 反斜杠不影响）
      expect(result.safePath).toMatch(/src[\\\/]index\.ts/);
    }
  });

  it("validatePath 空路径拒绝", () => {
    const result = validatePath("", "/workspace");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("为空");
    }
  });

  it("validatePath 含 NUL 字节拒绝", () => {
    const result = validatePath("fi\u0000le.txt", "/workspace");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("NUL");
    }
  });

  it("validatePath Windows 绝对路径在非 Windows 的 root 下被拒绝", () => {
    // 当 projectRoot 是 unix 风格路径时，Windows 盘符路径应被拦截
    const result = validatePath("C:\\Windows\\system32", "/workspace");
    expect(result.ok).toBe(false);
  });

  it("validatePath 路径在沙箱子树内返回 ok", () => {
    const result = validatePath("deep/nested/file.ts", "/workspace");
    expect(result.ok).toBe(true);
  });

  it("validatePath 绝对路径正好等于 root 返回 ok", () => {
    const result = validatePath("/workspace", "/workspace");
    expect(result.ok).toBe(true);
  });

  it("validatePath 跨盘符路径拒绝", () => {
    // 模拟 root 在 D: 盘，路径指向 C:
    const result = validatePath("C:/outside/file.txt", "D:/project");
    expect(result.ok).toBe(false);
  });

  it("resolveSafePath 空路径抛出错误", () => {
    expect(() => resolveSafePath("", "/workspace")).toThrow();
  });
});
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
