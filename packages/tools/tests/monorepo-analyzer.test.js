// @ci: unit
// ============================================================
// @cortex/tools — Monorepo Analyzer 单元测试
//
// 覆盖：buildEdges / detectCycles / detectDrifts / computeLayers /
//       generateDot / generateMermaid
//
// 不覆盖需要文件系统的函数（findProjectRoot / collectPackages /
// collectDeps），它们通过 E2E / 冒烟测试覆盖。
// ============================================================
import { describe, it, expect } from "vitest";
import { buildEdges, detectCycles, detectDrifts, computeLayers, generateDot, generateMermaid, } from "../src/monorepo-analyzer.js";
function makePkg(id, name, overrides) {
    return {
        id,
        name: name ?? `@cortex/${id}`,
        version: "0.1.0",
        filePath: `packages/${id}/package.json`,
        relPath: `packages/${id}/package.json`,
        isRoot: false,
        layer: -1,
        ...overrides,
    };
}
function makeDep(depName, pkgId, overrides) {
    return {
        depName,
        pkgId,
        pkgName: `@cortex/${pkgId}`,
        filePath: `packages/${pkgId}/package.json`,
        section: "dependencies",
        version: "workspace:*",
        isWorkspaceStar: true,
        isWorkspaceProtocol: true,
        isOpenVersion: false,
        ...overrides,
    };
}
function makeNonWorkspaceDep(depName, pkgId, version) {
    return makeDep(depName, pkgId, {
        version,
        isWorkspaceStar: false,
        isWorkspaceProtocol: false,
    });
}
// ============================================================
// buildEdges
// ============================================================
describe("buildEdges — 边构建", () => {
    const packages = [
        makePkg("shared"),
        makePkg("engine"),
        makePkg("cli"),
    ];
    it("workspace 依赖生成边", () => {
        const deps = [
            makeDep("@cortex/shared", "engine"),
        ];
        const edges = buildEdges(packages, deps, false);
        expect(edges).toHaveLength(1);
        expect(edges[0]).toEqual({
            from: "engine",
            to: "shared",
            type: "dependencies",
        });
    });
    it("过滤非 @cortex 依赖", () => {
        const deps = [
            makeDep("vitest", "engine"),
            makeDep("typescript", "cli"),
        ];
        const edges = buildEdges(packages, deps, false);
        expect(edges).toHaveLength(0);
    });
    it("默认排除 devDependencies", () => {
        const deps = [
            makeDep("@cortex/shared", "engine", { section: "devDependencies" }),
        ];
        const edges = buildEdges(packages, deps, false);
        expect(edges).toHaveLength(0);
    });
    it("includeDev=true 时包含 devDependencies", () => {
        const deps = [
            makeDep("@cortex/shared", "engine", { section: "devDependencies" }),
        ];
        const edges = buildEdges(packages, deps, true);
        expect(edges).toHaveLength(1);
        expect(edges[0].type).toBe("devDependencies");
    });
    it("目标包不存在时跳过", () => {
        const deps = [
            makeDep("@cortex/nonexistent", "engine"),
        ];
        const edges = buildEdges(packages, deps, false);
        expect(edges).toHaveLength(0);
    });
    it("多条边按源包正确分组", () => {
        const deps = [
            makeDep("@cortex/shared", "engine"),
            makeDep("@cortex/shared", "cli"),
        ];
        const edges = buildEdges(packages, deps, false);
        expect(edges).toHaveLength(2);
        const fromEngine = edges.filter((e) => e.from === "engine");
        const fromCli = edges.filter((e) => e.from === "cli");
        expect(fromEngine).toHaveLength(1);
        expect(fromCli).toHaveLength(1);
    });
});
// ============================================================
// detectCycles
// ============================================================
describe("detectCycles — 循环依赖检测", () => {
    it("无环图返回空数组", () => {
        const edges = [
            { from: "cli", to: "engine", type: "dependencies" },
            { from: "engine", to: "shared", type: "dependencies" },
        ];
        const cycles = detectCycles(edges);
        expect(cycles).toHaveLength(0);
    });
    it("简单 A→B→A 直接循环", () => {
        const edges = [
            { from: "a", to: "b", type: "dependencies" },
            { from: "b", to: "a", type: "dependencies" },
        ];
        const cycles = detectCycles(edges);
        expect(cycles.length).toBeGreaterThanOrEqual(1);
        // 归一化后的路径应包含 a 和 b 各两次（首 tail 重复）
        const path = cycles[0].path;
        expect(path[0]).toBe(path[path.length - 1]); // 首尾相同
        expect(new Set(path)).toEqual(new Set(["a", "b"]));
    });
    it("循环路径被归一化（字典序最小旋转）", () => {
        const edges = [
            { from: "b", to: "c", type: "dependencies" },
            { from: "c", to: "a", type: "dependencies" },
            { from: "a", to: "b", type: "dependencies" },
        ];
        const cycles = detectCycles(edges);
        expect(cycles.length).toBeGreaterThanOrEqual(1);
        // 归一化后应以字典序最小的元素开头
        expect(cycles[0].path[0]).toBe("a");
    });
    it("自环（a→a）被检测", () => {
        const edges = [
            { from: "a", to: "a", type: "dependencies" },
        ];
        const cycles = detectCycles(edges);
        expect(cycles.length).toBeGreaterThanOrEqual(1);
        const path = cycles[0].path;
        expect(path[0]).toBe("a");
        expect(path[path.length - 1]).toBe("a");
    });
    it("空边集返回空", () => {
        expect(detectCycles([])).toHaveLength(0);
    });
    it("多个独立环在 DAG 中都被检测", () => {
        // a→b→a 循环，c→d→c 循环，两个不相通
        const edges = [
            { from: "a", to: "b", type: "dependencies" },
            { from: "b", to: "a", type: "dependencies" },
            { from: "c", to: "d", type: "dependencies" },
            { from: "d", to: "c", type: "dependencies" },
        ];
        const cycles = detectCycles(edges);
        expect(cycles.length).toBeGreaterThanOrEqual(2);
    });
});
// ============================================================
// detectDrifts
// ============================================================
describe("detectDrifts — 版本漂移检测", () => {
    it("无漂移：同一依赖版本一致", () => {
        const deps = [
            makeNonWorkspaceDep("vitest", "engine", "^2.0.0"),
            makeNonWorkspaceDep("vitest", "cli", "^2.0.0"),
        ];
        const { drifts } = detectDrifts(deps, [], false);
        expect(drifts).toHaveLength(0);
    });
    it("检测到版本漂移", () => {
        const deps = [
            makeNonWorkspaceDep("vitest", "engine", "^2.0.0"),
            makeNonWorkspaceDep("vitest", "cli", "^1.0.0"),
        ];
        const { drifts } = detectDrifts(deps, [], false);
        expect(drifts.length).toBeGreaterThanOrEqual(1);
        expect(drifts[0].dependency).toBe("vitest");
        expect(drifts[0].occurrences).toBe(2);
    });
    it("单出现依赖不报漂移（非 verbose）", () => {
        const deps = [
            makeNonWorkspaceDep("typescript", "engine", "^5.0.0"),
        ];
        const { drifts } = detectDrifts(deps, [], false);
        expect(drifts).toHaveLength(0);
    });
    it("workspace:* 内部包不参与漂移检测", () => {
        const deps = [
            makeDep("@cortex/shared", "engine"), // workspace:*
            makeDep("@cortex/shared", "cli"), // workspace:*
        ];
        const { drifts } = detectDrifts(deps, [], false);
        expect(drifts).toHaveLength(0);
    });
    it("ignore 列表排除指定依赖", () => {
        const deps = [
            makeNonWorkspaceDep("vitest", "engine", "^2.0.0"),
            makeNonWorkspaceDep("vitest", "cli", "^1.0.0"),
        ];
        const { drifts } = detectDrifts(deps, ["vitest"], false);
        expect(drifts).toHaveLength(0);
    });
    it("漂移项排序按依赖名字典序", () => {
        const deps = [
            makeNonWorkspaceDep("zod", "engine", "^1.0.0"),
            makeNonWorkspaceDep("zod", "cli", "^2.0.0"),
            makeNonWorkspaceDep("vitest", "engine", "^1.0.0"),
            makeNonWorkspaceDep("vitest", "cli", "^2.0.0"),
        ];
        const { drifts } = detectDrifts(deps, [], false);
        expect(drifts).toHaveLength(2);
        expect(drifts[0].dependency).toBe("vitest");
        expect(drifts[1].dependency).toBe("zod");
    });
});
// ============================================================
// computeLayers
// ============================================================
describe("computeLayers — 分层计算", () => {
    it("线性链：shared L0 → engine L1 → cli L2", () => {
        const packages = [
            makePkg("shared"),
            makePkg("engine"),
            makePkg("cli"),
        ];
        const edges = [
            { from: "engine", to: "shared", type: "dependencies" },
            { from: "cli", to: "engine", type: "dependencies" },
        ];
        const { layers, pkgLayers } = computeLayers(packages, edges);
        expect(pkgLayers.get("shared")).toBe(0);
        expect(pkgLayers.get("engine")).toBe(1);
        expect(pkgLayers.get("cli")).toBe(2);
        expect(layers[0]).toContain("shared");
        expect(layers[1]).toContain("engine");
        expect(layers[2]).toContain("cli");
    });
    it("叶子节点（无依赖）layer=0", () => {
        const packages = [
            makePkg("shared"),
        ];
        const { pkgLayers } = computeLayers(packages, []);
        expect(pkgLayers.get("shared")).toBe(0);
    });
    it("多依赖取最大层+1", () => {
        // engine 依赖 shared(L0) 和 config(L0)，应为 L1
        const packages = [
            makePkg("shared"),
            makePkg("config"),
            makePkg("engine"),
        ];
        const edges = [
            { from: "engine", to: "shared", type: "dependencies" },
            { from: "engine", to: "config", type: "dependencies" },
        ];
        const { pkgLayers } = computeLayers(packages, edges);
        expect(pkgLayers.get("shared")).toBe(0);
        expect(pkgLayers.get("config")).toBe(0);
        expect(pkgLayers.get("engine")).toBe(1);
    });
    it("循环依赖不栈溢出，循环节点同层", () => {
        const packages = [
            makePkg("a"),
            makePkg("b"),
        ];
        const edges = [
            { from: "a", to: "b", type: "dependencies" },
            { from: "b", to: "a", type: "dependencies" },
        ];
        // 之前会栈溢出，现在应正常返回
        expect(() => computeLayers(packages, edges)).not.toThrow();
        const { layers, pkgLayers } = computeLayers(packages, edges);
        // 两个包都应该有有效的层号
        expect(pkgLayers.has("a")).toBe(true);
        expect(pkgLayers.has("b")).toBe(true);
        expect(typeof pkgLayers.get("a")).toBe("number");
        expect(typeof pkgLayers.get("b")).toBe("number");
        // layers 数组不应为空
        expect(layers.length).toBeGreaterThan(0);
    });
    it("root 包被排除在分层外", () => {
        const packages = [
            makePkg("shared"),
            makePkg("root", "(root)", { isRoot: true, id: "root" }),
        ];
        const { pkgLayers } = computeLayers(packages, []);
        expect(pkgLayers.has("root")).toBe(false);
    });
    it("pkgLayers 写回 PkgInfo.layer 属性", () => {
        const packages = [
            makePkg("shared"),
        ];
        computeLayers(packages, []);
        expect(packages[0].layer).toBe(0);
    });
    it("空边集：所有叶子节点均为 L0", () => {
        const packages = [
            makePkg("a"),
            makePkg("b"),
            makePkg("c"),
        ];
        const { layers, pkgLayers } = computeLayers(packages, []);
        expect(pkgLayers.get("a")).toBe(0);
        expect(pkgLayers.get("b")).toBe(0);
        expect(pkgLayers.get("c")).toBe(0);
        expect(layers.length).toBe(1); // 仅一层 L0
    });
});
// ============================================================
// generateDot / generateMermaid
// ============================================================
describe("generateDot — DOT 输出", () => {
    const packages = [
        makePkg("shared"),
        makePkg("engine"),
    ];
    const edges = [
        { from: "engine", to: "shared", type: "dependencies" },
    ];
    it("生成合法的 digraph 头", () => {
        const dot = generateDot(packages, edges, []);
        expect(dot).toContain("digraph monorepo {");
        expect(dot).toContain("rankdir=LR");
        expect(dot.endsWith("}\n") || dot.endsWith("}")).toBe(true);
    });
    it("包含包节点定义", () => {
        const dot = generateDot(packages, edges, []);
        expect(dot).toContain('"shared"');
        expect(dot).toContain('"engine"');
    });
    it("排除 root 包", () => {
        const pkgsWithRoot = [
            ...packages,
            makePkg("root", "(root)", { isRoot: true, id: "root" }),
        ];
        const dot = generateDot(pkgsWithRoot, edges, []);
        expect(dot).not.toContain('"root"');
    });
    it("devDependencies 边用虚线样式", () => {
        const devEdges = [
            { from: "engine", to: "shared", type: "devDependencies" },
        ];
        const dot = generateDot(packages, devEdges, []);
        expect(dot).toContain("dashed");
    });
    it("有循环时节点标红且路径用红色加粗", () => {
        const cycles = [
            { path: ["engine", "shared", "engine"], packages: ["engine", "shared"] },
        ];
        const dot = generateDot(packages, edges, cycles);
        expect(dot).toContain("coral");
        expect(dot).toContain("color=red");
    });
});
describe("generateMermaid — Mermaid 输出", () => {
    const packages = [
        makePkg("shared"),
        makePkg("engine"),
    ];
    const edges = [
        { from: "engine", to: "shared", type: "dependencies" },
    ];
    it("生成合法的 mermaid 代码块", () => {
        const mm = generateMermaid(packages, edges, []);
        expect(mm).toContain("```mermaid");
        expect(mm).toContain("graph TD");
    });
    it("包含包节点和边", () => {
        const mm = generateMermaid(packages, edges, []);
        expect(mm).toContain("shared");
        expect(mm).toContain("engine");
        expect(mm).toContain("-->");
    });
    it("devDependencies 用 -.->|dev| 表示", () => {
        const devEdges = [
            { from: "engine", to: "shared", type: "devDependencies" },
        ];
        const mm = generateMermaid(packages, devEdges, []);
        expect(mm).toContain("-.-");
        expect(mm).toContain("|dev|");
    });
    it("有循环的包标注 ⚠️", () => {
        const cycles = [
            { path: ["shared", "engine", "shared"], packages: ["shared", "engine"] },
        ];
        const mm = generateMermaid(packages, edges, cycles);
        expect(mm).toContain("⚠️");
    });
    it("排除 root 包", () => {
        const pkgsWithRoot = [
            ...packages,
            makePkg("root", "(root)", { isRoot: true, id: "root" }),
        ];
        const mm = generateMermaid(pkgsWithRoot, edges, []);
        expect(mm).not.toContain('"root"');
    });
});
//# sourceMappingURL=monorepo-analyzer.test.js.map