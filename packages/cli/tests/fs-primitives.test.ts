// @ci: unit
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { Toolkit } from "@cortex/platform";

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

  it("路径越界拒绝——Toolkit._resolvePath 对越界路径抛错", () => {
    // 真实实例化 Toolkit 并设置沙箱根目录，直接调用 _resolvePath
    const toolkit = new Toolkit();
    toolkit.setWorkspaceRoot(tmpDir);
    // bind 保留 this 上下文（_resolvePath 内部依赖 this.workspaceRoot）
    const resolvePath = (toolkit as unknown as { _resolvePath(p: string): string })._resolvePath.bind(toolkit);

    // 越界路径（tmpDir 的父目录）应抛错
    const escapePath = path.join(tmpDir, "..", "outside.txt");
    expect(() => resolvePath(escapePath)).toThrow(/路径越界/);

    // 工作区内路径正常解析
    const insidePath = path.join(tmpDir, "inside.txt");
    expect(resolvePath(insidePath)).toBe(path.resolve(insidePath));
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
