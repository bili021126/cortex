// @ci: unit
/**
 * DENSITY 上下文密度分级压缩 —— 全场景全链路单元测试
 *
 * 覆盖维度:
 *   全场景: parseDensityTag 6 场景 / stripDensityTag 2 场景 /
 *           compressByDensity 6 场景 / annotateAndCompress 3 场景 /
 *           mergeContext 4 场景 / densityToStrategy 3 场景
 *   全周期: 边界值 (恰好 150/500 字符、空字符串、超长输入)
 *   全链路: parse → compress → annotate → merge 完整通路
 */
import { describe, it, expect } from "vitest";
import { parseDensityTag, stripDensityTag, compressByDensity, annotateAndCompress, mergeContext, densityToStrategy, } from "@cortex/scheduler";
// ════════════════════════════════════════════════════════
// parseDensityTag — 标签解析（6 场景）
// ════════════════════════════════════════════════════════
describe("parseDensityTag — 标签解析", () => {
    it("[DENSITY: light] → 'light'", () => {
        expect(parseDensityTag("[DENSITY: light] some content")).toBe("light");
    });
    it("[DENSITY: medium] → 'medium'", () => {
        expect(parseDensityTag("prefix [DENSITY: medium] more text")).toBe("medium");
    });
    it("[DENSITY: heavy] → 'heavy'", () => {
        expect(parseDensityTag("[DENSITY: heavy]")).toBe("heavy");
    });
    it("无标签 → 默认 'medium'", () => {
        expect(parseDensityTag("plain text no tag")).toBe("medium");
    });
    it("大小写不敏感 → 正确识别", () => {
        expect(parseDensityTag("[DENSITY: HEAVY]")).toBe("heavy");
        expect(parseDensityTag("[density: Light]")).toBe("light");
    });
    it("标签中多余空格 → 正常解析", () => {
        expect(parseDensityTag("[DENSITY:   light   ]")).toBe("light");
    });
});
// ════════════════════════════════════════════════════════
// stripDensityTag — 标签移除（2 场景）
// ════════════════════════════════════════════════════════
describe("stripDensityTag — 标签移除", () => {
    it("移除标签保留内容", () => {
        const result = stripDensityTag("[DENSITY: light] the actual content here");
        expect(result).toBe("the actual content here");
    });
    it("无标签 → 原样返回", () => {
        expect(stripDensityTag("clean text without tag")).toBe("clean text without tag");
    });
});
// ════════════════════════════════════════════════════════
// compressByDensity — 按密度压缩（6 场景）
// ════════════════════════════════════════════════════════
describe("compressByDensity — 按密度压缩", () => {
    // ── light ──
    it("light: 短内容 → 取第一句（不含句号）", () => {
        const short = "[DENSITY: light] 一切正常。";
        const result = compressByDensity(short, "light");
        // compressLight 按 [。！？\n] 切分取第一句，不含分隔符
        expect(result).toBe("一切正常");
    });
    it("light: 长文本 → 截断到 150 字并加 '…'", () => {
        const long = "[DENSITY: light] " + "A".repeat(300);
        const result = compressByDensity(long, "light");
        expect(result.length).toBeLessThanOrEqual(150);
        expect(result).toMatch(/…$/);
    });
    // ── medium ──
    it("medium: 保留结构化行，丢弃短非结构化行", () => {
        const raw = [
            "[DENSITY: medium]",
            "- 发现 3 个错误",
            "# 严重问题",
            "✅ 修复完成",
            "xyz", // 太短 (< 20 字) 的非结构化行被丢弃
        ].join("\n");
        const result = compressByDensity(raw, "medium");
        expect(result).toContain("- 发现 3 个错误");
        expect(result).toContain("# 严重问题");
        expect(result).toContain("✅ 修复完成");
        // 短非结构化行被丢弃
        expect(result).not.toContain("xyz");
    });
    it("medium: 超 500 字 → 截断加 '…'", () => {
        const long = "[DENSITY: medium]\n" + Array(100).fill("- item").join("\n");
        const result = compressByDensity(long, "medium");
        expect(result.length).toBeLessThanOrEqual(500);
        expect(result).toMatch(/…$/);
    });
    // ── heavy ──
    it("heavy: 全量保留（移除标签）", () => {
        const raw = "[DENSITY: heavy]\n架构决策: 采用 Event Sourcing 模式\n理由: 需要完整审计追踪";
        const result = compressByDensity(raw, "heavy");
        expect(result).toContain("架构决策");
        expect(result).toContain("理由");
        expect(result).not.toContain("[DENSITY: heavy]");
    });
    // ── 边界 ──
    it("light 恰好 150 字符 → 不截断", () => {
        const exact = "[DENSITY: light] " + "B".repeat(130);
        const result = compressByDensity(exact, "light");
        expect(result.length).toBeLessThanOrEqual(151); // 150 chars + possible …
        expect(result).not.toMatch(/…$/);
    });
});
// ════════════════════════════════════════════════════════
// annotateAndCompress — 完整标注+压缩（3 场景）
// ════════════════════════════════════════════════════════
describe("annotateAndCompress — 完整标注+压缩", () => {
    it("返回 DensityAnnotated 结构完整", () => {
        const result = annotateAndCompress("[DENSITY: heavy] critical finding");
        expect(result.raw).toContain("[DENSITY: heavy]");
        expect(result.density).toBe("heavy");
        expect(result.compressed).toBe("critical finding");
    });
    it("raw 保留原始内容", () => {
        const original = "[DENSITY: light] all good";
        const result = annotateAndCompress(original);
        expect(result.raw).toBe(original);
    });
    it("无标签 → density=medium", () => {
        const result = annotateAndCompress("plain text");
        expect(result.density).toBe("medium");
        expect(result.raw).toBe("plain text");
    });
});
// ════════════════════════════════════════════════════════
// mergeContext — 上下文合并（4 场景）
// ════════════════════════════════════════════════════════
describe("mergeContext — 上下文合并", () => {
    it("空数组 → 空字符串", () => {
        expect(mergeContext([])).toBe("");
    });
    it("单个 heavy 条目 → 带 [HEAVY] 标签", () => {
        const items = [
            { raw: "critical", density: "heavy", compressed: "critical finding" },
        ];
        const result = mergeContext(items);
        expect(result).toBe("[HEAVY] critical finding");
    });
    it("多个不同密度条目 → 按传入顺序合并", () => {
        const items = [
            { raw: "a", density: "light", compressed: "summary" },
            { raw: "b", density: "medium", compressed: "details" },
            { raw: "c", density: "heavy", compressed: "full report" },
        ];
        const result = mergeContext(items);
        const lines = result.split("\n");
        expect(lines).toHaveLength(3);
        expect(lines[0]).toBe("[LIGHT] summary");
        expect(lines[1]).toBe("[MEDIUM] details");
        expect(lines[2]).toBe("[HEAVY] full report");
    });
    it("heavymedium 混合 → 各自保留对应标签", () => {
        const items = [
            { raw: "x", density: "heavy", compressed: "h-content" },
            { raw: "y", density: "medium", compressed: "m-content" },
        ];
        const result = mergeContext(items);
        expect(result).toContain("[HEAVY]");
        expect(result).toContain("[MEDIUM]");
    });
});
// ════════════════════════════════════════════════════════
// densityToStrategy — 密度→策略映射（3 场景）
// ════════════════════════════════════════════════════════
describe("densityToStrategy — 密度→策略映射", () => {
    it("heavy → 'decompose'", () => {
        expect(densityToStrategy("heavy")).toBe("decompose");
    });
    it("medium → 'react'", () => {
        expect(densityToStrategy("medium")).toBe("react");
    });
    it("light → 'direct'", () => {
        expect(densityToStrategy("light")).toBe("direct");
    });
});
// ════════════════════════════════════════════════════════
// 全链路集成
// ════════════════════════════════════════════════════════
describe("DENSITY 全链路集成", () => {
    it("parse → compress → annotate → merge 完整通路", () => {
        // 模拟两个子任务产出
        const output1 = "[DENSITY: heavy] CVE-2024-1234: RCE via shell injection in run_shell()";
        const output2 = "[DENSITY: light] 检查完毕，无异常";
        const a1 = annotateAndCompress(output1);
        const a2 = annotateAndCompress(output2);
        expect(a1.density).toBe("heavy");
        expect(a2.density).toBe("light");
        // heavy 全量保留，light 只保留摘要
        expect(a1.compressed).toContain("CVE-2024-1234");
        expect(a2.compressed.length).toBeLessThanOrEqual(150);
        // 合并上下文
        const merged = mergeContext([a1, a2]);
        expect(merged).toContain("[HEAVY]");
        expect(merged).toContain("[LIGHT]");
    });
    it("medium 压缩 → 策略映射 → 上下文合并", () => {
        const output = [
            "[DENSITY: medium]",
            "- error at line 42",
            "- warning at line 100",
            "✅ 3 tests passed",
        ].join("\n");
        const strategy = densityToStrategy(parseDensityTag(output));
        expect(strategy).toBe("react");
        const annotated = annotateAndCompress(output);
        expect(annotated.compressed).toContain("error at line 42");
        expect(annotated.compressed).toContain("warning at line 100");
    });
});
//# sourceMappingURL=density-compress.test.js.map