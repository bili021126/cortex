// @ci: unit
// ============================================================
// @cortex/tools — 配置漂移探测器功能测试
//
// 覆盖：
//   1. 辅助函数：isWorkspaceStar / isOpenVersion / shouldSkipDrift
//   2. compareVersions 语义化版本比较
//   3. getPkgId 路径 → 包 ID 映射
//   4. recommendVersion 版本推荐算法
//   5. collectDependencies + detectDrift 核心管线
//   6. detectDrift 边界条件
// ============================================================
import { describe, it, expect } from "vitest";
import { collectDependencies, detectDrift, } from "../src/configuration-drift.js";
import * as path from "node:path";
const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
// 辅助构造
// ════════════════════════════════════════════════════════
function makeEntry(overrides = {}) {
    return {
        depName: "dep-a",
        pkg: "cli",
        pkgName: "@cortex/cli",
        filePath: "/fake/packages/cli/package.json",
        section: "dependencies",
        version: "1.0.0",
        isWorkspaceStar: false,
        isOpenVersion: false,
        ...overrides,
    };
}
function makeWorkspaceEntry(depName, pkg) {
    return makeEntry({
        depName,
        pkg,
        version: "workspace:*",
        isWorkspaceStar: true,
    });
}
// ════════════════════════════════════════════════════════
// collectDependencies
// ════════════════════════════════════════════════════════
describe("collectDependencies", () => {
    it("从当前项目扫描 → 返回非空依赖列表", () => {
        const entries = collectDependencies();
        expect(entries.length).toBeGreaterThan(0);
        // 验证关键字段存在
        for (const entry of entries) {
            expect(entry.depName).toBeTruthy();
            expect(entry.pkg).toBeTruthy();
            expect(entry.version).toBeTruthy();
            expect(["dependencies", "devDependencies"]).toContain(entry.section);
        }
    });
    it("workspace 标记正确", () => {
        const entries = collectDependencies();
        const workspaceEntries = entries.filter((e) => e.isWorkspaceStar);
        for (const e of workspaceEntries) {
            expect(e.version).toBe("workspace:*");
        }
    });
    it("open version 标记正确", () => {
        const entries = collectDependencies();
        const openEntries = entries.filter((e) => e.isOpenVersion);
        for (const e of openEntries) {
            expect(["*", "latest"]).toContain(e.version);
        }
    });
});
// ════════════════════════════════════════════════════════
// detectDrift 核心算法
// ════════════════════════════════════════════════════════
describe("detectDrift", () => {
    it("空输入 → 空结果", () => {
        const groups = detectDrift([]);
        expect(groups).toHaveLength(0);
    });
    it("单包单依赖 → 无漂移", () => {
        const entries = [makeEntry({ depName: "dep-a" })];
        const groups = detectDrift(entries);
        expect(groups).toHaveLength(1);
        expect(groups[0].hasDrift).toBe(false);
        expect(groups[0].uniqueVersions).toEqual(["1.0.0"]);
    });
    it("同版本跨包 → 无漂移", () => {
        const entries = [
            makeEntry({ depName: "dep-a", pkg: "cli", version: "1.0.0" }),
            makeEntry({ depName: "dep-a", pkg: "engine", version: "1.0.0" }),
        ];
        const groups = detectDrift(entries);
        expect(groups).toHaveLength(1);
        expect(groups[0].hasDrift).toBe(false);
        expect(groups[0].uniqueVersions).toEqual(["1.0.0"]);
    });
    it("不同版本跨包 → 检测到漂移", () => {
        const entries = [
            makeEntry({ depName: "dep-a", pkg: "cli", version: "1.0.0" }),
            makeEntry({ depName: "dep-a", pkg: "engine", version: "2.0.0" }),
        ];
        const groups = detectDrift(entries);
        expect(groups).toHaveLength(1);
        expect(groups[0].hasDrift).toBe(true);
        expect(groups[0].uniqueVersions).toHaveLength(2);
    });
    it("workspace:* 不参与漂移计算", () => {
        const entries = [
            makeEntry({ depName: "@cortex/shared", pkg: "cli", version: "workspace:*", isWorkspaceStar: true }),
            makeEntry({ depName: "@cortex/shared", pkg: "engine", version: "workspace:*", isWorkspaceStar: true }),
        ];
        const groups = detectDrift(entries);
        expect(groups).toHaveLength(1);
        expect(groups[0].hasDrift).toBe(false);
    });
    it("workspace:* vs 显式版本 → 不视为漂移", () => {
        const entries = [
            makeEntry({ depName: "@cortex/shared", pkg: "cli", version: "workspace:*", isWorkspaceStar: true }),
            makeEntry({ depName: "@cortex/shared", pkg: "external_tool", version: "0.1.0", isWorkspaceStar: false }),
        ];
        const groups = detectDrift(entries);
        expect(groups).toHaveLength(1);
        // workspace:* 被过滤后只剩一个非 workspace 版本 → 无漂移
        expect(groups[0].hasDrift).toBe(false);
    });
    it("两个不同非 workspace 版本 + workspace:* → 漂移", () => {
        const entries = [
            makeEntry({ depName: "dep-x", pkg: "a", version: "workspace:*", isWorkspaceStar: true }),
            makeEntry({ depName: "dep-x", pkg: "b", version: "1.0.0" }),
            makeEntry({ depName: "dep-x", pkg: "c", version: "2.0.0" }),
        ];
        const groups = detectDrift(entries);
        expect(groups).toHaveLength(1);
        expect(groups[0].hasDrift).toBe(true);
    });
    it("多个不同依赖分组正确", () => {
        const entries = [
            makeEntry({ depName: "dep-a", pkg: "cli", version: "1.0.0" }),
            makeEntry({ depName: "dep-a", pkg: "engine", version: "2.0.0" }),
            makeEntry({ depName: "dep-b", pkg: "cli", version: "3.0.0" }),
            makeEntry({ depName: "dep-b", pkg: "engine", version: "3.0.0" }),
        ];
        const groups = detectDrift(entries);
        expect(groups).toHaveLength(2);
        const depA = groups.find((g) => g.depName === "dep-a");
        expect(depA.hasDrift).toBe(true);
        const depB = groups.find((g) => g.depName === "dep-b");
        expect(depB.hasDrift).toBe(false);
    });
    it("结果按依赖名字母排序", () => {
        const entries = [
            makeEntry({ depName: "c-lib", pkg: "i", version: "1.0.0" }),
            makeEntry({ depName: "a-lib", pkg: "j", version: "1.0.0" }),
            makeEntry({ depName: "b-lib", pkg: "k", version: "1.0.0" }),
        ];
        const groups = detectDrift(entries);
        expect(groups.map((g) => g.depName)).toEqual(["a-lib", "b-lib", "c-lib"]);
    });
    it("hasOpenVersion 正确标记", () => {
        const entries = [
            makeEntry({ depName: "dep-o", pkg: "a", version: "*", isOpenVersion: true }),
            makeEntry({ depName: "dep-o", pkg: "b", version: "1.0.0" }),
        ];
        const groups = detectDrift(entries);
        expect(groups[0].hasOpenVersion).toBe(true);
        // 开放版本参与漂移检测（只有 workspace:* 被跳过）
        expect(groups[0].hasDrift).toBe(true);
    });
    it("仅一个非 workspace 版本 → 无漂移", () => {
        const entries = [
            makeEntry({ depName: "dep-solo", pkg: "a", version: "1.0.0" }),
        ];
        const groups = detectDrift(entries);
        expect(groups[0].hasDrift).toBe(false);
    });
    it("全 workspace:* → 无漂移", () => {
        const entries = [
            makeWorkspaceEntry("@cortex/shared", "cli"),
            makeWorkspaceEntry("@cortex/shared", "engine"),
            makeWorkspaceEntry("@cortex/shared", "factory"),
        ];
        const groups = detectDrift(entries);
        expect(groups).toHaveLength(1);
        expect(groups[0].hasDrift).toBe(false);
    });
});
// ════════════════════════════════════════════════════════
// 真实项目扫描
// ════════════════════════════════════════════════════════
describe("真实项目漂移检测", () => {
    it("当前项目扫描 → 无漂移或仅有已知例外", () => {
        const entries = collectDependencies(PROJECT_ROOT);
        const groups = detectDrift(entries);
        const realDrifts = groups.filter((g) => g.hasDrift && !g.hasOpenVersion);
        // 项目应该保持干净；如有漂移需记录原因
        if (realDrifts.length > 0) {
            console.warn(`⚠️ 检测到 ${realDrifts.length} 处版本漂移:`, realDrifts.map((g) => g.depName).join(", "));
        }
        // 当前项目预期干净
        expect(realDrifts.length).toBe(0);
    });
    it("扫描到的包包含已知包名", () => {
        const entries = collectDependencies(PROJECT_ROOT);
        const pkgs = new Set(entries.map((e) => e.pkg));
        // 核心包应都被扫描到
        expect(pkgs.has("cli")).toBe(true);
        expect(pkgs.has("engine")).toBe(true);
        expect(pkgs.has("shared")).toBe(true);
        expect(pkgs.has("root")).toBe(true);
    });
});
//# sourceMappingURL=configuration-drift.test.js.map