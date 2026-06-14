// ============================================================
// @cortex/pattern-extractor — PatternExtractorRegistry 注册表
//
// 中央注册中心，管理所有 PatternExtractor 实例的注册、发现和查询。
// 消费方（Pipeline / Factory / Scanner）面向注册表编程，
// 通过 queryByLanguageAndKind() 动态发现匹配的提取器，
// 无需硬编码提取器名称或 switch 分支。
//
// 设计动机（承袭母项目的注册表模式）：
//   - AgentFactoryRegistry → Agent 工厂注册与发现
//   - SkillRegistry → 技能模板注册与查询
//   - PatternExtractorRegistry → 提取器实例注册与检索
//
// @layer 编排层（Orchestration Layer）
// @dependency extractor.ts（PatternExtractor 接口 + PatternKind 枚举）
// ============================================================

import type { PatternExtractor, PatternKind } from "./extractor.js";

// ============================================================
// §1 注册表类
// ============================================================

/**
 * PatternExtractorRegistry —— 模式提取器注册中心。
 *
 * 管理所有 PatternExtractor 实例的注册、注销和查询。
 * 维护三层索引结构，支持 O(1) 名称查找和高效交集查询：
 *
 * ```
 * 索引结构：
 *   _byName:      Map<name, PatternExtractor>         —— 名称 → 实例
 *   _byLanguage:  Map<language, Set<name>>            —— 语言 → 名称集合
 *   _byKind:      Map<PatternKind, Set<name>>         —— 种类 → 名称集合
 *
 * 查询流程（queryByLanguageAndKind）：
 *   langNames  ← _byLanguage.get(language) ?? _byLanguage.get("*")
 *   kindNames  ← _byKind.get(kind)
 *   取交集      → 解析为 PatternExtractor[] 返回
 * ```
 *
 * **设计动机**：
 * - 新增提取器只需 `register()` 一次，消费方通过 `queryBy*` 动态发现
 * - 消费方无需 `import` 具体提取器实现类，面向注册表编程
 * - 支持精确查询和通配查询（"*" 表示通用语言）
 * - 注册同名提取器时自动覆盖并重建索引
 *
 * **典型使用流程**：
 * ```typescript
 * const registry = new PatternExtractorRegistry();
 *
 * // ① 注册提取器
 * registry.register(new AstPatternExtractor());
 * registry.register(new RegexPatternExtractor());
 *
 * // ② 按语言 + 种类查询
 * const extractors = registry.queryByLanguageAndKind(
 *   "typescript",
 *   PatternKind.Structural,
 * );
 *
 * // ③ 遍历执行提取
 * for (const ext of extractors) {
 *   const result = ext.extract(sourceCode);
 *   // ...
 * }
 * ```
 *
 * @design P06 — 注册表映射模式（继承自母项目 AgentFactoryRegistry / SkillRegistry）
 * @usedBy PatternExtractorPipeline — 管线在 ExtractStage 中查询注册表获取匹配提取器
 * @usedBy ExtractorFactory — 工厂在构造时自动注册注入的提取器列表
 * @usedBy PatternScanner 实现类 — 扫描器按 language + targetKinds 查询注册表
 *
 * @example
 * ```typescript
 * // ── 注册 ──
 * registry.register(astExtractor);
 * registry.registerAll([regexExtractor, heuristicExtractor]);
 *
 * // ── 查询 ──
 * registry.queryByLanguageAndKind("typescript", PatternKind.Structural);
 * // → [astExtractor]（返回匹配的提取器数组）
 *
 * registry.queryByTags(["typescript", "python"]);
 * // → [astExtractor, regexExtractor, heuristicExtractor]
 *
 * // ── 获取 / 列出 ──
 * registry.get("ast-extractor");
 * // → astExtractor 实例
 *
 * registry.list();
 * // → [astExtractor, regexExtractor, heuristicExtractor]
 *
 * // ── 管理 ──
 * registry.has("ast-extractor"); // → true
 * registry.size;                 // → 3
 * registry.unregister("ast-extractor"); // → true
 * registry.clear();
 * ```
 *
 * @since 0.1.0
 */
export class PatternExtractorRegistry {
  /** 名称 → 提取器实例映射（主索引） */
  private readonly _byName: Map<string, PatternExtractor> = new Map();

  /** 语言 → 提取器名称集合映射（"*" 表示通用，支持任意语言） */
  private readonly _byLanguage: Map<string, Set<string>> = new Map();

  /** 模式种类 → 提取器名称集合映射 */
  private readonly _byKind: Map<PatternKind, Set<string>> = new Map();

  // ──────────────────────────────────────────────
  // §1.1 注册
  // ──────────────────────────────────────────────

  /**
   * 注册一个提取器实例。
   *
   * 注册时自动建立三层索引：
   *   1. `_byName`：通过 `extractor.name` 建立名称 → 实例映射
   *   2. `_byLanguage`：遍历 `extractor.supportedLanguages`，为每种语言建立索引
   *   3. `_byKind`：遍历 `extractor.supportedKinds`，为每种种类建立索引
   *
   * 若已存在同名提取器（`_byName.has(extractor.name)` 为 true），
   * 则先调用 {@link unregister} 清理旧实例的全部索引，再注册新实例。
   * 这确保索引不会残留指向已废弃实例的引用。
   *
   * @param extractor - 待注册的 PatternExtractor 实例。
   *   `extractor.name` 必须为唯一标识（字母数字 + 连词符，如 "ast-extractor"）。
   *   若 `supportedLanguages` 包含 "*"，则该提取器匹配所有语言的查询。
   *
   * @example
   * ```typescript
   * registry.register(new AstPatternExtector());
   * // _byName:     { "ast-extractor" → AstPatternExtractor }
   * // _byLanguage: { "typescript" → Set{"ast-extractor"}, "javascript" → Set{"ast-extractor"}, ... }
   * // _byKind:     { "structural" → Set{"ast-extractor"}, "behavioral" → Set{"ast-extractor"}, ... }
   * ```
   */
  register(extractor: PatternExtractor): void {
    const name = extractor.name;

    // 同名提取器已存在 → 先清理旧索引再覆盖
    // 确保不会残留指向已废弃实例的引用
    if (this._byName.has(name)) {
      this.unregister(name);
    }

    // ① 注册名称索引
    this._byName.set(name, extractor);

    // ② 注册语言索引
    //    遍历 supportedLanguages，为每种语言建立倒排索引
    for (const lang of extractor.supportedLanguages) {
      const names = this._byLanguage.get(lang);
      if (names) {
        names.add(name);
      } else {
        this._byLanguage.set(lang, new Set([name]));
      }
    }

    // ③ 注册种类索引
    //    遍历 supportedKinds，为每种模式种类建立倒排索引
    for (const kind of extractor.supportedKinds) {
      const names = this._byKind.get(kind);
      if (names) {
        names.add(name);
      } else {
        this._byKind.set(kind, new Set([name]));
      }
    }
  }

  /**
   * 批量注册多个提取器实例。
   *
   * 遍历输入列表，依次调用 {@link register} 方法。
   * 批量注册的语义等同于逐个注册：
   * - 若列表中存在同名提取器，后注册的覆盖先注册的
   * - 异常不会阻断后续提取器的注册（调用方负责异常处理）
   *
   * @param extractors - 待注册的提取器实例数组。数组为空时无操作。
   *
   * @example
   * ```typescript
   * registry.registerAll([
   *   new AstPatternExtractor(),
   *   new RegexPatternExtractor(),
   *   new HeuristicPatternExtractor(),
   * ]);
   * // 注册表现在包含三个提取器
   * ```
   */
  registerAll(extractors: PatternExtractor[]): void {
    for (const extractor of extractors) {
      this.register(extractor);
    }
  }

  // ──────────────────────────────────────────────
  // §1.2 注销
  // ──────────────────────────────────────────────

  /**
   * 注销指定名称的提取器。
   *
   * 从三层索引中移除该提取器的所有引用：
   *   1. 从 `_byName` 主索引中删除该名称
   *   2. 从 `_byLanguage` 各语言集合中删除该名称
   *   3. 从 `_byKind` 各种类集合中删除该名称
   *
   * 若某语言或种类的集合在删除后为空，则同时清理该键，
   * 避免 `_byLanguage` 或 `_byKind` 中存在值为空集合的条目。
   *
   * 此操作是幂等的——重复调用 `unregister` 同一名称，
   * 第二次调用返回 false。
   *
   * @param name - 提取器名称（大小写敏感，需与注册时的 `extractor.name` 一致）
   * @returns true 表示实际注销了提取器，false 表示未找到同名提取器
   *
   * @example
   * ```typescript
   * registry.unregister("ast-extractor");
   * // → true（已注销，三层索引均清理）
   *
   * registry.unregister("non-existent");
   * // → false（未找到，无操作）
   * ```
   */
  unregister(name: string): boolean {
    const extractor = this._byName.get(name);
    if (!extractor) {
      return false;
    }

    // ① 从名称索引移除
    this._byName.delete(name);

    // ② 从语言索引移除
    //    遍历 supportedLanguages，从对应集合中删除名称
    for (const lang of extractor.supportedLanguages) {
      const names = this._byLanguage.get(lang);
      if (names) {
        names.delete(name);
        // 集合为空时清理键，减少内存占用
        if (names.size === 0) {
          this._byLanguage.delete(lang);
        }
      }
    }

    // ③ 从种类索引移除
    //    遍历 supportedKinds，从对应集合中删除名称
    for (const kind of extractor.supportedKinds) {
      const names = this._byKind.get(kind);
      if (names) {
        names.delete(name);
        // 集合为空时清理键，减少内存占用
        if (names.size === 0) {
          this._byKind.delete(kind);
        }
      }
    }

    return true;
  }

  // ──────────────────────────────────────────────
  // §2 查询
  // ──────────────────────────────────────────────

  /**
   * 按标签列表查询匹配的提取器。
   *
   * 将每个标签作为候选语言名，查询 `_byLanguage` 索引。
   * 同时查询通用语言标记 `"*"`（表示支持所有语言的提取器）。
   *
   **匹配规则**：
   * - 精确匹配：标签字符串与 `_byLanguage` 的键精确匹配
   * - 通配匹配：`_byLanguage` 包含 `"*"` 键（通用提取器）
   * - 去重：同个提取器匹配多个标签只返回一次
   *
   * **适用场景**：
   * - 按项目标签发现适用的提取器（如 "typescript"、"python"）
   * - 不精确到模式种类的宽泛查询
   * - 需要精确到种类时使用 {@link queryByLanguageAndKind}
   *
   * @param tags - 标签列表。每个标签作为语言名进行匹配。
   *   空数组时返回空数组（无意义调用）。
   * @returns 匹配的提取器数组（已去重）。无匹配时返回空数组。
   *
   * @example
   * ```typescript
   * registry.queryByTags(["typescript"]);
   * // → [astExtractor, regexExtractor, heuristicExtractor]
   * // 所有 supportedLanguages 包含 "typescript" 或 "*" 的提取器
   *
   * registry.queryByTags(["typescript", "python"]);
   * // → [astExtractor, regexExtractor, heuristicExtractor, pythonExtractor]
   *
   * registry.queryByTags(["ruby"]);
   * // → []（无支持 Ruby 的提取器）
   * ```
   */
  queryByTags(tags: string[]): PatternExtractor[] {
    const matchedNames = new Set<string>();

    for (const tag of tags) {
      // 按精确语言匹配
      const byLang = this._byLanguage.get(tag);
      if (byLang) {
        for (const name of byLang) {
          matchedNames.add(name);
        }
      }

      // 按通用语言匹配（"*" 表示所有语言）
      const universal = this._byLanguage.get("*");
      if (universal) {
        for (const name of universal) {
          matchedNames.add(name);
        }
      }
    }

    return this._resolveNames(matchedNames);
  }

  /**
   * 按语言和模式种类查询匹配的提取器。
   *
   * **核心查询方法**。取语言匹配集与种类匹配集的交集：
   *
   * ```
   * langNames  = _byLanguage.get(language) ?? _byLanguage.get("*") ?? emptySet
   * kindNames  = _byKind.get(kind) ?? emptySet
   * result     = langNames ∩ kindNames
   * ```
   *
   * 语言匹配策略（按优先级）：
   *   1. 精确语言匹配：`_byLanguage` 中存在 `language` 键
   *   2. 通用语言回退：`_byLanguage` 中存在 `"*"` 键
   *   3. 无匹配：返回空数组
   *
   * **性能**：O(L + K) 其中 L 和 K 分别是语言和种类匹配集的规模。
   * 最坏情况下 O(N) 其中 N 是注册的提取器总数。
   *
   * @param language - 编程语言（如 `"typescript"`、`"python"`、`"*"`）。
   *   若为 `"*"`，匹配所有已注册提取器（不限语言）。
   * @param kind - 模式种类。从 {@link PatternKind} 枚举中选择。
   * @returns 同时匹配指定语言和种类的提取器数组。无匹配时返回空数组。
   *
   * @example
   * ```typescript
   * // 查询支持 TypeScript 结构模式提取的提取器
   * registry.queryByLanguageAndKind("typescript", PatternKind.Structural);
   * // → [astExtractor]（假设只有 astExtractor 支持该组合）
   *
   * // 查询所有提取器中的命名模式提取器
   * registry.queryByLanguageAndKind("*", PatternKind.Naming);
   * // → [regexExtractor, heuristicExtractor]
   *
   * // 无匹配
   * registry.queryByLanguageAndKind("ruby", PatternKind.Structural);
   * // → []
   * ```
   */
  queryByLanguageAndKind(
    language: string,
    kind: PatternKind,
  ): PatternExtractor[] {
    // 语言匹配集：精确语言优先，通用语言回退
    const langNames =
      this._byLanguage.get(language) ??
      this._byLanguage.get("*") ??
      new Set<string>();

    // 种类匹配集
    const kindNames = this._byKind.get(kind) ?? new Set<string>();

    // 取交集：同时匹配语言和种类的提取器
    const matchedNames = new Set<string>();
    for (const name of langNames) {
      if (kindNames.has(name)) {
        matchedNames.add(name);
      }
    }

    return this._resolveNames(matchedNames);
  }

  // ──────────────────────────────────────────────
  // §3 获取 / 列出
  // ──────────────────────────────────────────────

  /**
   * 按名称获取单个提取器实例。
   *
   * 名称查找是 O(1) 操作（基于 Map 的哈希索引）。
   *
   * @param name - 提取器名称（大小写敏感，需与注册时的 `extractor.name` 一致）
   * @returns 提取器实例，或 `undefined`（未找到时）
   *
   * @example
   * ```typescript
   * const ext = registry.get("ast-extractor");
   * if (ext) {
   *   console.log(`发现提取器: ${ext.name}`);
   *   console.log(`描述: ${ext.description}`);
   *   console.log(`支持语言: ${ext.supportedLanguages.join(", ")}`);
   * }
   * ```
   */
  get(name: string): PatternExtractor | undefined {
    return this._byName.get(name);
  }

  /**
   * 列出所有已注册的提取器实例。
   *
   * 返回当前注册表中所有提取器的快照数组。
   * 数组顺序遵循 JavaScript `Map.prototype.values()` 的遍历顺序
   * （即插入顺序，先注册的先出现）。
   *
   * 返回的数组是新建副本，修改数组不影响注册表内部状态。
   *
   * @returns 所有已注册提取器的数组。注册表为空时返回空数组。
   *
   * @example
   * ```typescript
   * for (const ext of registry.list()) {
   *   console.log(`  [${ext.name}] ${ext.description}`);
   *   console.log(`    语言: ${ext.supportedLanguages.join(", ")}`);
   *   console.log(`    种类: ${ext.supportedKinds.join(", ")}`);
   * }
   * ```
   */
  list(): PatternExtractor[] {
    return Array.from(this._byName.values());
  }

  /**
   * 获取已注册提取器的总数量。
   *
   * 与 `registry.list().length` 语义相同，但性能更优
   * （O(1) 的 Map.size 属性访问 vs O(N) 的数组构造）。
   *
   * @returns 当前注册表中提取器的数量
   *
   * @example
   * ```typescript
   * console.log(`已注册 ${registry.size} 个提取器`);
   * // → 已注册 3 个提取器
   * ```
   */
  get size(): number {
    return this._byName.size;
  }

  // ──────────────────────────────────────────────
  // §4 管理
  // ──────────────────────────────────────────────

  /**
   * 清空注册表，移除所有注册的提取器和索引。
   *
   * 调用后所有底层 Map 被清空：
   * - `_byName` → 空
   * - `_byLanguage` → 空
   * - `_byKind` → 空
   *
   * 查询方法全部返回空结果，`size` 为 0。
   * 此操作不可逆——清空后需重新注册提取器。
   *
   * **典型场景**：
   * - 测试环境的注册表重置（每次测试前调用 `clear()` 确保隔离）
   * - 注册表重建（先 `clear()` 再 `registerAll()`）
   *
   * @example
   * ```typescript
   * // 测试用例的 setup/teardown
   * beforeEach(() => {
   *   registry.clear();
   *   registry.register(testExtractor);
   * });
   * ```
   */
  clear(): void {
    this._byName.clear();
    this._byLanguage.clear();
    this._byKind.clear();
  }

  /**
   * 检查指定名称的提取器是否已注册。
   *
   * 名称查找是 O(1) 操作。
   *
   * @param name - 提取器名称（大小写敏感）
   * @returns `true` 表示该名称的提取器已注册
   *
   * @example
   * ```typescript
   * if (registry.has("ast-extractor")) {
   *   // 提取器已注册，可以执行提取
   *   const ext = registry.get("ast-extractor")!;
   *   const result = ext.extract(sourceCode);
   * }
   * ```
   */
  has(name: string): boolean {
    return this._byName.has(name);
  }

  // ──────────────────────────────────────────────
  // §5 内部辅助
  // ──────────────────────────────────────────────

  /**
   * 将名称集合解析为提取器实例数组。
   *
   * 内部辅助方法。对集合中的每个名称，从 `_byName` 主索引中查找对应实例。
   * 跳过 `_byName` 中不存在的名称——这属于防御性编程，防止索引不一致
   * （正常情况下不应发生，但若 `_byLanguage` 或 `_byKind` 的清理逻辑
   * 有 bug，此机制可避免返回 `undefined`）。
   *
   * @param names - 提取器名称集合（来自 `_byLanguage` 或 `_byKind` 查询结果）
   * @returns 提取器实例数组，长度 ≤ 传入集合的大小
   */
  private _resolveNames(names: Set<string>): PatternExtractor[] {
    const result: PatternExtractor[] = [];

    for (const name of names) {
      const extractor = this._byName.get(name);
      if (extractor) {
        result.push(extractor);
      }
    }

    return result;
  }
}
