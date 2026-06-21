/**
 * @ci 路径越界防护单元测试
 *
 * 验证 validatePath / resolveSafePath 能阻断以下攻击向量：
 *   - ../ 向上穿越
 *   - 绝对路径绕过
 *   - NUL 字节注入
 *   - 空路径
 *   - 多级 ../ 穿越
 *
 * 正常路径通过验证，确保不会误杀合法操作。
 */
// @ci: unit
import { describe, it, expect } from "vitest";
import { validatePath, resolveSafePath } from "@cortex/platform";
import * as path from "node:path";
const PROJECT_ROOT = path.resolve("/home/project/cortex");
describe("validatePath — 路径越界防护", () => {
    // ── 正常路径（应通过） ───────────────────────────
    it("允许 projectRoot 自身", () => {
        const result = validatePath(PROJECT_ROOT, PROJECT_ROOT);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.safePath).toBe(path.resolve(PROJECT_ROOT));
        }
    });
    it("允许 projectRoot 子目录下的相对路径", () => {
        const result = validatePath("src/index.ts", PROJECT_ROOT);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.safePath).toBe(path.resolve(PROJECT_ROOT, "src/index.ts"));
        }
    });
    it("允许 projectRoot 子目录下的绝对路径", () => {
        const abs = path.resolve(PROJECT_ROOT, "packages/engine/src/main.ts");
        const result = validatePath(abs, PROJECT_ROOT);
        expect(result.ok).toBe(true);
    });
    it("允许深层嵌套路径", () => {
        const result = validatePath("a/b/c/d/e/f/g.txt", PROJECT_ROOT);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.safePath.startsWith(PROJECT_ROOT)).toBe(true);
        }
    });
    // ── 未设沙箱（向后兼容） ─────────────────────────
    it("未设 projectRoot 时允许任意路径", () => {
        const result = validatePath("/etc/passwd", null);
        expect(result.ok).toBe(true);
    });
    // ── ../ 穿越攻击（应阻断） ────────────────────────
    it("阻断单级 ../ 穿越", () => {
        const result = validatePath("../etc/passwd", PROJECT_ROOT);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("越界");
        }
    });
    it("阻断多级 ../ 穿越", () => {
        const result = validatePath("../../../etc/passwd", PROJECT_ROOT);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("越界");
        }
    });
    it("阻断混在路径中间的 ../ 穿越", () => {
        const result = validatePath("src/../../etc/passwd", PROJECT_ROOT);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("越界");
        }
    });
    it("阻断以 ../ 开头的路径", () => {
        const result = validatePath("../root/.bashrc", PROJECT_ROOT);
        expect(result.ok).toBe(false);
    });
    // ── 绝对路径绕过（应阻断） ────────────────────────
    it("阻断指向 /etc 的绝对路径绕过", () => {
        const result = validatePath("/etc/passwd", PROJECT_ROOT);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("越界");
        }
    });
    it("阻断指向 /tmp 的绝对路径绕过", () => {
        const result = validatePath("/tmp/evil.sh", PROJECT_ROOT);
        expect(result.ok).toBe(false);
    });
    it("阻断 Windows 绝对路径绕过 (C:\\)", () => {
        const result = validatePath("C:\\Windows\\System32\\config\\SAM", PROJECT_ROOT);
        expect(result.ok).toBe(false);
    });
    // ── NUL 字节注入（应阻断） ────────────────────────
    it("阻断 NUL 字节注入", () => {
        const result = validatePath("src/index.ts\0.jpg", PROJECT_ROOT);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("NUL");
        }
    });
    it("阻断多个 NUL 字节", () => {
        const result = validatePath("\0\0\0", PROJECT_ROOT);
        expect(result.ok).toBe(false);
    });
    // ── 空路径（应阻断） ──────────────────────────────
    it("阻断空字符串路径", () => {
        const result = validatePath("", PROJECT_ROOT);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("为空");
        }
    });
    it("阻断纯空格路径", () => {
        const result = validatePath("   ", PROJECT_ROOT);
        expect(result.ok).toBe(false);
    });
    // ── resolveSafePath（快速失败） ────────────────────
    it("resolveSafePath 在合法时返回绝对路径", () => {
        const safe = resolveSafePath("src/index.ts", PROJECT_ROOT);
        expect(safe).toBe(path.resolve(PROJECT_ROOT, "src/index.ts"));
    });
    it("resolveSafePath 在越界时抛出错误", () => {
        expect(() => resolveSafePath("../etc/passwd", PROJECT_ROOT)).toThrow("越界");
    });
    // ── 边界情况 ─────────────────────────────────────
    it("项目根恰好为文件系统根 / 时不误杀", () => {
        const result = validatePath("/tmp/test.txt", "/");
        expect(result.ok).toBe(true);
    });
    it("路径包含特殊字符（空格、中文）通过", () => {
        const result = validatePath("src/我的文档/read me.txt", PROJECT_ROOT);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.safePath).toBe(path.resolve(PROJECT_ROOT, "src/我的文档/read me.txt"));
        }
    });
});
//# sourceMappingURL=path-safety.test.js.map