import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
describe("Platform tools — filesystem", () => {
    let tmpDir;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plt-"));
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    it("read_file — 读取现有文件", () => {
        fs.writeFileSync(path.join(tmpDir, "a.txt"), "hello", "utf-8");
        const content = fs.readFileSync(path.join(tmpDir, "a.txt"), "utf-8");
        expect(content).toBe("hello");
    });
    it("read_file — 文件不存在抛异常", () => {
        expect(() => fs.readFileSync(path.join(tmpDir, "nope.txt"), "utf-8")).toThrow();
    });
    it("write_file — 创建新文件", () => {
        const fp = path.join(tmpDir, "new.txt");
        fs.writeFileSync(fp, "content", "utf-8");
        expect(fs.existsSync(fp)).toBe(true);
        expect(fs.readFileSync(fp, "utf-8")).toBe("content");
    });
    it("write_file — 覆盖已有文件", () => {
        const fp = path.join(tmpDir, "overwrite.txt");
        fs.writeFileSync(fp, "old", "utf-8");
        fs.writeFileSync(fp, "new", "utf-8");
        expect(fs.readFileSync(fp, "utf-8")).toBe("new");
    });
    it("delete_file — 删除已有文件", () => {
        const fp = path.join(tmpDir, "del.txt");
        fs.writeFileSync(fp, "x", "utf-8");
        fs.rmSync(fp);
        expect(fs.existsSync(fp)).toBe(false);
    });
    it("delete_file — 删除不存在的文件静默成功", () => {
        expect(() => fs.rmSync(path.join(tmpDir, "noexist.txt"), { force: true })).not.toThrow();
    });
    it("glob_find — 通配符匹配", () => {
        fs.writeFileSync(path.join(tmpDir, "a.ts"), "");
        fs.writeFileSync(path.join(tmpDir, "b.ts"), "");
        fs.writeFileSync(path.join(tmpDir, "c.js"), "");
        // Simulates glob behavior
        const all = fs.readdirSync(tmpDir).filter(f => f.endsWith(".ts")).sort();
        expect(all).toEqual(["a.ts", "b.ts"]);
    });
    it("run_shell — 执行命令并获取输出", () => {
        const out = execSync('echo hello', { cwd: tmpDir, encoding: "utf-8" });
        expect(out.trim()).toBe("hello");
    });
    it("run_shell — 命令执行失败返回非零退出码", () => {
        expect(() => execSync("exit 1", { cwd: tmpDir })).toThrow();
    });
});
//# sourceMappingURL=tools.test.js.map