// @ci: unit
// ============================================================
// @cortex/pattern-extractor — registry.ts 单元测试
//
// 覆盖范围：
// - register() / unregister() / registerAll()
// - queryByTags() / queryByLanguageAndKind()
// - get() / list() / size / has() / clear()
// - 同名提取器覆盖注册
// - 边界情况：空注册表、未找到、重复注册
// - 索引一致性：_byLanguage / _byKind 在 unregister 后自动清理空集合
// ============================================================
import { describe, it, expect, beforeEach } from "vitest";
import { PatternExtractorRegistry } from "../src/registry.js";
import { PatternKind } from "../src/extractor.js";
// ============================================================
// §0 Mock 提取器工厂
// ============================================================
/**
 * 创建一个 Mock 提取器，用于注册表测试。
 * 每个 Mock 有独立名称、语言和种类支持列表。
 */
function createMockExtractor(name, options = {}) {
    const { languages = ["*"], kinds = [PatternKind.Structural], description = `Mock 提取器: ${name}`, } = options;
    return {
        name,
        supportedLanguages: languages,
        supportedKinds: kinds,
        description,
        extract: () => ({
            success: true,
            patterns: [],
            diagnostics: [],
            durationMs: 0,
        }),
        canHandle: (language, kind) => languages.includes(language) && kinds.includes(kind),
    };
}
// ============================================================
// §1 基本注册 / 注销
// ============================================================
describe("PatternExtractorRegistry - register / unregister", () => {
    let registry;
    beforeEach(() => {
        registry = new PatternExtractorRegistry();
    });
    it("新注册表应为空", () => {
        expect(registry.size).toBe(0);
        expect(registry.list()).toEqual([]);
    });
    it("注册单个提取器后 size 应为 1", () => {
        registry.register(createMockExtractor("ext-1"));
        expect(registry.size).toBe(1);
    });
    it("注册多个提取器后 size 应递增", () => {
        registry.register(createMockExtractor("ext-1"));
        registry.register(createMockExtractor("ext-2"));
        registry.register(createMockExtractor("ext-3"));
        expect(registry.size).toBe(3);
    });
    it("注册同名提取器应覆盖旧实例", () => {
        const oldExt = createMockExtractor("same-name", {
            languages: ["typescript"],
            kinds: [PatternKind.Structural],
            description: "旧版本",
        });
        const newExt = createMockExtractor("same-name", {
            languages: ["python"],
            kinds: [PatternKind.Naming],
            description: "新版本",
        });
        registry.register(oldExt);
        expect(registry.size).toBe(1);
        registry.register(newExt);
        // 同名覆盖后 size 仍为 1
        expect(registry.size).toBe(1);
        // 获取的应为新实例
        const retrieved = registry.get("same-name");
        expect(retrieved).toBeDefined();
        expect(retrieved.description).toBe("新版本");
        // 旧的语言索引应被清理
        const tsExtractors = registry.queryByLanguageAndKind("typescript", PatternKind.Structural);
        expect(tsExtractors).toHaveLength(0);
        // 新的语言索引应就绪
        const pyExtractors = registry.queryByLanguageAndKind("python", PatternKind.Naming);
        expect(pyExtractors).toHaveLength(1);
    });
    it("unregister 已存在的提取器应返回 true", () => {
        registry.register(createMockExtractor("ext-1"));
        const result = registry.unregister("ext-1");
        expect(result).toBe(true);
        expect(registry.size).toBe(0);
    });
    it("unregister 不存在的提取器应返回 false", () => {
        const result = registry.unregister("non-existent");
        expect(result).toBe(false);
    });
    it("unregister 后注册表应完全清理该提取器的所有索引", () => {
        registry.register(createMockExtractor("multi-lang", {
            languages: ["typescript", "javascript", "python"],
            kinds: [PatternKind.Structural, PatternKind.Naming],
        }));
        expect(registry.size).toBe(1);
        expect(registry.queryByLanguageAndKind("typescript", PatternKind.Structural)).toHaveLength(1);
        registry.unregister("multi-lang");
        // 所有查询应返回空
        expect(registry.get("multi-lang")).toBeUndefined();
        expect(registry.has("multi-lang")).toBe(false);
        expect(registry.queryByLanguageAndKind("typescript", PatternKind.Structural)).toHaveLength(0);
        expect(registry.queryByLanguageAndKind("javascript", PatternKind.Naming)).toHaveLength(0);
        expect(registry.queryByLanguageAndKind("python", PatternKind.Structural)).toHaveLength(0);
    });
    it("重复 unregister 同一名称应幂等", () => {
        registry.register(createMockExtractor("ext-1"));
        expect(registry.unregister("ext-1")).toBe(true);
        expect(registry.unregister("ext-1")).toBe(false);
        expect(registry.unregister("ext-1")).toBe(false);
    });
});
// ============================================================
// §2 registerAll 批量注册
// ============================================================
describe("PatternExtractorRegistry - registerAll", () => {
    let registry;
    beforeEach(() => {
        registry = new PatternExtractorRegistry();
    });
    it("批量注册空数组应无操作", () => {
        registry.registerAll([]);
        expect(registry.size).toBe(0);
    });
    it("批量注册多个提取器", () => {
        const extractors = [
            createMockExtractor("ext-1", { languages: ["ts"] }),
            createMockExtractor("ext-2", { languages: ["py"] }),
            createMockExtractor("ext-3", { languages: ["js"] }),
        ];
        registry.registerAll(extractors);
        expect(registry.size).toBe(3);
    });
    it("批量注册中的同名提取器后注册的应覆盖先注册的", () => {
        const oldExt = createMockExtractor("conflict", {
            languages: ["typescript"],
            kinds: [PatternKind.Structural],
            description: "旧版本",
        });
        const newExt = createMockExtractor("conflict", {
            languages: ["python"],
            kinds: [PatternKind.Naming],
            description: "新版本",
        });
        registry.registerAll([oldExt, newExt]);
        // 同名，最终 size 为 1
        expect(registry.size).toBe(1);
        expect(registry.get("conflict").description).toBe("新版本");
        // 旧的语言索引已清理
        expect(registry.queryByLanguageAndKind("typescript", PatternKind.Structural)).toHaveLength(0);
    });
});
// ============================================================
// §3 查询：queryByTags
// ============================================================
describe("PatternExtractorRegistry - queryByTags", () => {
    let registry;
    beforeEach(() => {
        registry = new PatternExtractorRegistry();
        registry.registerAll([
            createMockExtractor("ts-ext", {
                languages: ["typescript"],
                kinds: [PatternKind.Structural, PatternKind.Naming],
            }),
            createMockExtractor("universal-ext", {
                languages: ["*"],
                kinds: [PatternKind.Structural],
            }),
            createMockExtractor("py-ext", {
                languages: ["python"],
                kinds: [PatternKind.Behavioral],
            }),
            createMockExtractor("multi-ext", {
                languages: ["typescript", "javascript"],
                kinds: [PatternKind.Structural, PatternKind.Naming],
            }),
        ]);
    });
    it("按标签查询应匹配精确语言和通用语言", () => {
        const result = registry.queryByTags(["typescript"]);
        // ts-ext (typescript), universal-ext (*), multi-ext (typescript)
        expect(result.length).toBe(3);
        const names = result.map((e) => e.name).sort();
        expect(names).toEqual(["multi-ext", "ts-ext", "universal-ext"]);
    });
    it("按标签查询应去重（同一提取器匹配多个标签只返回一次）", () => {
        const result = registry.queryByTags(["typescript", "javascript"]);
        // ts-ext (ts), universal-ext (*), multi-ext (ts+js)
        expect(result.length).toBe(3);
    });
    it("按标签查询空数组应返回空数组", () => {
        const result = registry.queryByTags([]);
        expect(result).toEqual([]);
    });
    it("按不存在的标签查询应返回通用提取器", () => {
        // 由于有 universal-ext（语言="*"），即使标签"ruby"不精确匹配，
        // queryByTags 会回退到通用语言匹配，返回所有支持 "*" 的提取器
        const result = registry.queryByTags(["ruby"]);
        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result.map((e) => e.name)).toContain("universal-ext");
    });
    it("通用语言 '*' 应在所有标签查询中返回", () => {
        // unversal-ext 支持 "*"
        const result = registry.queryByTags(["ruby", "swift", "go"]);
        // 只有 universal-ext 匹配
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("universal-ext");
    });
});
// ============================================================
// §4 查询：queryByLanguageAndKind
// ============================================================
describe("PatternExtractorRegistry - queryByLanguageAndKind", () => {
    let registry;
    beforeEach(() => {
        registry = new PatternExtractorRegistry();
        registry.registerAll([
            createMockExtractor("ast-ext", {
                languages: ["typescript", "javascript"],
                kinds: [PatternKind.Structural, PatternKind.Behavioral],
            }),
            createMockExtractor("regex-ext", {
                languages: ["*"],
                kinds: [PatternKind.Structural, PatternKind.Naming],
            }),
            createMockExtractor("heuristic-ext", {
                languages: ["*"],
                kinds: [PatternKind.Architectural, PatternKind.Naming],
            }),
            createMockExtractor("py-struct-ext", {
                languages: ["python"],
                kinds: [PatternKind.Structural],
            }),
        ]);
    });
    it("应精确匹配语言和种类的交集", () => {
        // typescript + Structural → 
        //   langNames = _byLanguage.get("typescript") = {"ast-ext"} (精确匹配，不触发"*"回退)
        //   kindNames = _byKind.get(PatternKind.Structural) = {"ast-ext", "regex-ext", "py-struct-ext"}
        //   交集 = {"ast-ext"}
        const result = registry.queryByLanguageAndKind("typescript", PatternKind.Structural);
        expect(result.length).toBe(1);
        expect(result[0].name).toBe("ast-ext");
    });
    it("语言回退：语言不匹配时使用通用语言 '*'", () => {
        // ruby + Structural → regex-ext (*, Structural+Naming)
        const result = registry.queryByLanguageAndKind("ruby", PatternKind.Structural);
        expect(result.length).toBe(1);
        expect(result[0].name).toBe("regex-ext");
    });
    it("语言为 '*' 时匹配通用提取器中种类匹配的", () => {
        // * + Structural →
        //   langNames = _byLanguage.get("*") = {"regex-ext", "heuristic-ext"}
        //   kindNames = _byKind.get(PatternKind.Structural) = {"ast-ext", "regex-ext", "py-struct-ext"}
        //   交集 = {"regex-ext"}（只有 regex-ext 同时支持"*"语言和 Structural 种类）
        const result = registry.queryByLanguageAndKind("*", PatternKind.Structural);
        expect(result.length).toBe(1);
        expect(result[0].name).toBe("regex-ext");
    });
    it("无匹配时应返回空数组", () => {
        const result = registry.queryByLanguageAndKind("ruby", PatternKind.Dataflow);
        expect(result).toEqual([]);
    });
    it("种类不匹配时即使语言匹配也应返回空数组", () => {
        // python + Naming → py-struct-ext 仅支持 Structural
        const result = registry.queryByLanguageAndKind("python", PatternKind.Naming);
        expect(result).toEqual([]);
    });
    it("应支持 PatternKind 所有枚举值的查询", () => {
        // 注册仅支持 Architectural 的提取器
        registry.register(createMockExtractor("arch-ext", {
            languages: ["*"],
            kinds: [PatternKind.Architectural],
        }));
        for (const kind of Object.values(PatternKind)) {
            const result = registry.queryByLanguageAndKind("typescript", kind);
            // 至少应有通配提取器匹配 Structural 和 Naming
            expect(Array.isArray(result)).toBe(true);
        }
    });
    it("注册相同名称的提取器后索引应更新而不是累积", () => {
        // 先注册一个通用提取器
        registry.register(createMockExtractor("dynamic-ext", {
            languages: ["*"],
            kinds: [PatternKind.Structural],
        }));
        expect(registry.queryByLanguageAndKind("typescript", PatternKind.Structural)).toHaveLength(1); // ast-ext (精确匹配 typescript) — regex-ext 不匹配因精确匹配存在时无"*"回退
        // 重新注册为仅支持 python
        registry.register(createMockExtractor("dynamic-ext", {
            languages: ["python"],
            kinds: [PatternKind.Naming],
        }));
        // typescript+Structural 应不再包含 dynamic-ext（且 dynamic-ext 从未在此组合中出现）
        expect(registry.queryByLanguageAndKind("typescript", PatternKind.Structural)).toHaveLength(1); // 仍是 ast-ext
        // python+Naming 应包含 dynamic-ext
        expect(registry.queryByLanguageAndKind("python", PatternKind.Naming)).toHaveLength(1);
        expect(registry.queryByLanguageAndKind("python", PatternKind.Naming)[0].name).toBe("dynamic-ext");
    });
});
// ============================================================
// §5 获取 / 列出
// ============================================================
describe("PatternExtractorRegistry - get / list / size / has", () => {
    let registry;
    beforeEach(() => {
        registry = new PatternExtractorRegistry();
    });
    it("get 存在时应返回提取器实例", () => {
        const ext = createMockExtractor("my-ext");
        registry.register(ext);
        const retrieved = registry.get("my-ext");
        expect(retrieved).toBe(ext);
    });
    it("get 不存在时应返回 undefined", () => {
        expect(registry.get("non-existent")).toBeUndefined();
    });
    it("has 存在时应返回 true", () => {
        registry.register(createMockExtractor("ext-1"));
        expect(registry.has("ext-1")).toBe(true);
    });
    it("has 不存在时应返回 false", () => {
        expect(registry.has("ext-1")).toBe(false);
    });
    it("size 应反映注册数量", () => {
        expect(registry.size).toBe(0);
        registry.register(createMockExtractor("a"));
        expect(registry.size).toBe(1);
        registry.register(createMockExtractor("b"));
        expect(registry.size).toBe(2);
        registry.unregister("a");
        expect(registry.size).toBe(1);
    });
    it("list 应返回所有已注册提取器的快照", () => {
        const extA = createMockExtractor("a");
        const extB = createMockExtractor("b");
        registry.register(extA);
        registry.register(extB);
        const list = registry.list();
        expect(list).toHaveLength(2);
        expect(list).toContain(extA);
        expect(list).toContain(extB);
    });
    it("list 返回的数组是副本，修改不影响注册表", () => {
        registry.register(createMockExtractor("a"));
        const list = registry.list();
        list.length = 0; // 清空副本
        expect(registry.size).toBe(1); // 注册表不受影响
    });
    it("空注册表时 list 应返回空数组", () => {
        expect(registry.list()).toEqual([]);
    });
});
// ============================================================
// §6 清空注册表
// ============================================================
describe("PatternExtractorRegistry - clear", () => {
    let registry;
    beforeEach(() => {
        registry = new PatternExtractorRegistry();
        registry.registerAll([
            createMockExtractor("a", { languages: ["ts"] }),
            createMockExtractor("b", { languages: ["py"] }),
            createMockExtractor("c", { languages: ["*"] }),
        ]);
    });
    it("clear 后 size 应为 0", () => {
        expect(registry.size).toBe(3);
        registry.clear();
        expect(registry.size).toBe(0);
    });
    it("clear 后 list 应返回空数组", () => {
        registry.clear();
        expect(registry.list()).toEqual([]);
    });
    it("clear 后所有查询应返回空结果", () => {
        registry.clear();
        expect(registry.get("a")).toBeUndefined();
        expect(registry.has("a")).toBe(false);
        expect(registry.queryByTags(["ts"])).toEqual([]);
        expect(registry.queryByLanguageAndKind("ts", PatternKind.Structural)).toEqual([]);
    });
    it("clear 后重新注册应正常工作", () => {
        registry.clear();
        const ext = createMockExtractor("new-ext", { languages: ["go"] });
        registry.register(ext);
        expect(registry.size).toBe(1);
        expect(registry.get("new-ext")).toBe(ext);
    });
});
// ============================================================
// §7 边界情况与压力测试
// ============================================================
describe("PatternExtractorRegistry - 边界情况", () => {
    let registry;
    beforeEach(() => {
        registry = new PatternExtractorRegistry();
    });
    it("注册空语言的提取器应无语言索引", () => {
        const ext = createMockExtractor("no-lang", { languages: [] });
        registry.register(ext);
        // 注册了，但不匹配任何语言查询
        expect(registry.size).toBe(1);
        expect(registry.queryByTags(["anything"])).toHaveLength(0);
    });
    it("注册空种类的提取器应无种类索引", () => {
        const ext = createMockExtractor("no-kind", {
            languages: ["*"],
            kinds: [],
        });
        registry.register(ext);
        expect(registry.size).toBe(1);
        expect(registry.queryByLanguageAndKind("anything", PatternKind.Structural)).toHaveLength(0);
    });
    it("支持多种语言和多种种类的提取器应在多维度查询中返回", () => {
        const ext = createMockExtractor("swiss-army", {
            languages: ["a", "b", "c", "d", "e"],
            kinds: [
                PatternKind.Structural,
                PatternKind.Behavioral,
                PatternKind.Naming,
            ],
        });
        registry.register(ext);
        // 每种语言 + 每种种类组合均能查到
        for (const lang of ["a", "b", "c", "d", "e"]) {
            for (const kind of [
                PatternKind.Structural,
                PatternKind.Behavioral,
                PatternKind.Naming,
            ]) {
                const result = registry.queryByLanguageAndKind(lang, kind);
                expect(result).toHaveLength(1);
                expect(result[0].name).toBe("swiss-army");
            }
        }
        // 不支持的种类查不到
        expect(registry.queryByLanguageAndKind("a", PatternKind.Dataflow)).toHaveLength(0);
    });
    it("大量提取器注册性能正常", () => {
        const count = 100;
        for (let i = 0; i < count; i++) {
            registry.register(createMockExtractor(`ext-${i}`, {
                languages: ["typescript"],
                kinds: [PatternKind.Structural],
            }));
        }
        expect(registry.size).toBe(count);
        const result = registry.queryByLanguageAndKind("typescript", PatternKind.Structural);
        expect(result).toHaveLength(count);
    });
    it("支持多种查询后 unregister 再查询", () => {
        registry.registerAll([
            createMockExtractor("keep", { languages: ["ts"], kinds: [PatternKind.Structural] }),
            createMockExtractor("remove", { languages: ["ts"], kinds: [PatternKind.Structural] }),
        ]);
        expect(registry.queryByLanguageAndKind("ts", PatternKind.Structural)).toHaveLength(2);
        registry.unregister("remove");
        const result = registry.queryByLanguageAndKind("ts", PatternKind.Structural);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("keep");
    });
    it("同时注册两个支持不同语言的同名提取器，最终只有后注册生效", () => {
        registry.register(createMockExtractor("conflict", {
            languages: ["typescript"],
            kinds: [PatternKind.Structural],
        }));
        registry.register(createMockExtractor("conflict", {
            languages: ["python"],
            kinds: [PatternKind.Naming],
        }));
        // typescript+Structural → 0（被覆盖了）
        expect(registry.queryByLanguageAndKind("typescript", PatternKind.Structural)).toHaveLength(0);
        // python+Naming → 1
        expect(registry.queryByLanguageAndKind("python", PatternKind.Naming)).toHaveLength(1);
    });
});
// ============================================================
// §8 索引一致性
// ============================================================
describe("PatternExtractorRegistry - 索引一致性", () => {
    let registry;
    beforeEach(() => {
        registry = new PatternExtractorRegistry();
    });
    it("_byLanguage 不应包含空集合（验证内部实现正确清理）", () => {
        const ext = createMockExtractor("temp", {
            languages: ["unique-lang"],
            kinds: [PatternKind.Structural],
        });
        registry.register(ext);
        registry.unregister("temp");
        // 使用 queryByTags 验证索引已清理
        // unique-lang 应不再有匹配
        expect(registry.queryByTags(["unique-lang"])).toEqual([]);
    });
    it("_byKind 不应包含空集合（验证内部实现正确清理）", () => {
        const ext = createMockExtractor("temp", {
            languages: ["*"],
            kinds: [PatternKind.Architectural],
        });
        registry.register(ext);
        registry.unregister("temp");
        // Architectural 应不再有匹配（如果只有这一个提取器支持它）
        expect(registry.queryByLanguageAndKind("*", PatternKind.Architectural)).toEqual([]);
    });
    it("多次注册-注销周期后索引应保持正确", () => {
        for (let cycle = 0; cycle < 5; cycle++) {
            registry.register(createMockExtractor(`cycle-${cycle}`, {
                languages: [`lang-${cycle}`],
                kinds: [PatternKind.Structural],
            }));
        }
        expect(registry.size).toBe(5);
        for (let cycle = 0; cycle < 5; cycle++) {
            expect(registry.queryByLanguageAndKind(`lang-${cycle}`, PatternKind.Structural)).toHaveLength(1);
        }
        // 注销奇数周期的
        for (let cycle = 1; cycle < 5; cycle += 2) {
            registry.unregister(`cycle-${cycle}`);
        }
        expect(registry.size).toBe(3);
        // 偶数周期的仍可查询
        expect(registry.queryByLanguageAndKind("lang-0", PatternKind.Structural)).toHaveLength(1);
        expect(registry.queryByLanguageAndKind("lang-2", PatternKind.Structural)).toHaveLength(1);
        expect(registry.queryByLanguageAndKind("lang-4", PatternKind.Structural)).toHaveLength(1);
        // 奇数周期的已不可查询
        expect(registry.queryByLanguageAndKind("lang-1", PatternKind.Structural)).toHaveLength(0);
        expect(registry.queryByLanguageAndKind("lang-3", PatternKind.Structural)).toHaveLength(0);
    });
});
//# sourceMappingURL=registry.spec.js.map