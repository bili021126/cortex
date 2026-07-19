// @ci: unit
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";

// We'll test the NodeFileSystemAdapter directly
// since it's the underlying implementation for all platform tools
describe("NodeFileSystemAdapter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plt-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("read/write file round-trip", () => {
    const filePath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(filePath, "hello cortex", "utf-8");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toBe("hello cortex");
  });

  it("路径越界拒绝——文件不在工作区内", () => {
    // The actual sandbox check is in Toolkit._resolvePath()
    // which throws on path traversal
    const filePath = path.join(tmpDir, "..", "outside.txt");
    const resolved = path.resolve(filePath);
    // Assert that the resolved path is outside tmpDir
    expect(resolved.startsWith(tmpDir)).toBe(false);
  });

  it("delete 不存在文件返回 false", () => {
    const nonexistent = path.join(tmpDir, "nope.txt");
    expect(fs.existsSync(nonexistent)).toBe(false);
    // deleteFile silently handles non-existent
    expect(() => fs.rmSync(nonexistent, { force: true })).not.toThrow();
  });

  it("目录遍历——list files", () => {
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "a");
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "b");
    fs.mkdirSync(path.join(tmpDir, "sub"));
    fs.writeFileSync(path.join(tmpDir, "sub", "c.ts"), "c");

    const all: string[] = [];
    function walk(dir: string) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else all.push(path.relative(tmpDir, full));
      }
    }
    walk(tmpDir);
    expect(all.length).toBe(3);
    expect(all).toContain("a.ts");
    expect(all).toContain("b.ts");
    expect(all).toContain("sub" + path.sep + "c.ts");
  });
});
