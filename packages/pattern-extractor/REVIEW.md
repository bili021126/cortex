# @cortex/pattern-extractor 代码审查报告

> **审查日期**: 2025-07-17  
> **审查范围**: `packages/pattern-extractor/src/` 全部 6 个源文件  
> **审查维度**: 接口设计、职责拆分、依赖注入、命名规范、JSDoc 完整性、禁止模式、导入走 barrel、单向依赖拓扑  
> **审查结论**: ⚠️ **有条件通过** — 存在 1 个阻断性问题、5 个严重问题、3 个一般问题

---

## 目录

1. [严重性分级说明](#1-严重性分级说明)
2. [阻断性问题（BLOCKER）](#2-阻断性问题blocker)
3. [严重问题（CRITICAL）](#3-严重问题critical)
4. [一般问题（MINOR）](#4-一般问题minor)
5. [检查通过项](#5-检查通过项)
6. [整改建议汇总](#6-整改建议汇总)

---

## 1. 严重性分级说明

| 级别 | 标记 | 含义 | 要求 |
|------|------|------|------|
| 🔴 BLOCKER | 阻断 | 编译/运行直接失败 | 必须立即修复 |
| 🟠 CRITICAL | 严重 | 违反架构原则或编码规范 | 必须在本迭代修复 |
| 🟡 MINOR | 一般 | 可维护性/一致性瑕疵 | 建议修复 |
| ✅ PASS | 通过 | 符合规范 | 保持 |

---

## 2. 阻断性问题（BLOCKER）

### B1. scanner.ts 导入不存在的文件 `./types.js`

**文件**: `packages/pattern-extractor/src/scanner.ts` 第 21–24 行

```typescript
import type {
  PatternKind,
  PatternDefinition,
} from "./types.js";
```

**问题**: 包内不存在 `src/types.ts` 或 `src/types.js` 文件。`./types.js` 既不在文件系统中，也不在 tsconfig 的 include 范围内。此导入将导致 **tsc 编译失败**（TS2307: Cannot find module）。

**影响范围**:
- `scanner.ts` 本身无法编译
- `index.ts` 通过 `export type { PatternScanner } from "./scanner.js"` 间接依赖，**barrel 入口也失效**
- 整个包的 `build` / `typecheck` 命令无法通过

**根因追溯**: DESIGN.md §3 描述了 `types.ts` 作为"接口层"核心文件，但实际实现时将类型分散到了 `extractor.ts` 和 `pattern.ts` 两个文件中，未创建 `types.ts`。scanner.ts 的文件头注释也引用了不存在的 `types.ts`。

**修复方案**: 将导入源改为现有文件之一：
- 若 `PatternKind` 和 `PatternDefinition` 以 `extractor.ts` 为规范来源 → `from "./extractor.js"`
- 若以 `pattern.ts` 为规范来源 → `from "./pattern.js"`（但 `PatternDefinition` 仅在 `extractor.ts` 中定义，pattern.ts 中对应的是 `Pattern`）

---

## 3. 严重问题（CRITICAL）

### C1. `extractor.ts` 与 `pattern.ts` 重复定义类型（DRY 违反）

**文件**: `extractor.ts` + `pattern.ts`

**重复定义的类型清单**:

| 类型 | extractor.ts | pattern.ts | 差异 |
|------|-------------|-----------|------|
| `PatternKind` 枚举 | ✅ 定义 | ✅ 定义 | 值相同，注释风格不同 |
| `PatternBody` 接口 | ✅ 定义 | ✅ 定义 | 结构相同 |
| `PatternExample` 接口 | ✅ 定义 | ✅ 定义 | 结构相同 |
| `PatternElement` 接口 | ✅ 定义 | ✅ 定义 | 结构相同 |
| `ExtractionContext` 接口 | ✅ 定义 | ✅ 定义 | `metadata` 类型不同（`Record<string, unknown>` vs `Record<string, string \| number \| boolean>`） |
| `ExtractionResult` 联合 | ✅ 定义 | ✅ 定义 | patterns 类型不同（`PatternDefinition[]` vs `Pattern[]`) |
| `PatternExtractorOptions` | ✅ 定义 | ❌ 无 | — |

**影响**:
- 同一概念有两份定义，消费者困惑该用哪个
- 未来修改必须同步两处，极易遗漏
- `index.ts` 被迫用"规范来源"策略区分，增加认知负担
- `ExtractionContext.metadata` 的类型不一致会导致隐蔽的兼容性问题

### C2. 两套提取器接口体系：`PatternExtractor` vs `IPatternExtractor`

**提取器接口 A** — `extractor.ts`:
```typescript
export interface PatternExtractor<TInput = string, TOptions extends Record<string, unknown> = Record<string, unknown>> {
  extract(input: TInput, options?: TOptions): ExtractionResult;  // ExtractionResult 内 patterns: PatternDefinition[]
  canHandle(language: string, kind: PatternKind): boolean;
}
```

**提取器接口 B** — `pattern.ts`:
```typescript
export interface IPatternExtractor<TInput = string, TOptions extends Record<string, string | number | boolean | object> = Record<string, string | number | boolean | object>> {
  extract(input: TInput, options?: TOptions): ExtractionResult;  // ExtractionResult 内 patterns: Pattern[]
  canHandle(language: string, kind: PatternKind): boolean;
}
```

**差异对比**:

| 维度 | `PatternExtractor` (extractor.ts) | `IPatternExtractor` (pattern.ts) |
|------|----------------------------------|----------------------------------|
| 命名风格 | 无 `I` 前缀 | 有 `I` 前缀 |
| TOptions 约束 | `Record<string, unknown>` | `Record<string, string \| number \| boolean \| object>` |
| Result patterns 类型 | `PatternDefinition[]` | `Pattern[]` |
| 实际实现 | `JsonPatternExtractor` 实现此接口 | 无实现类 |
| Registry 使用 | `PatternExtractorRegistry` 使用此接口 | 未使用 |

**影响**:
- 严重违反"接口契约优先"（P02）原则——一个契约不应该有两份定义
- 两个接口的 TOptions 约束不同：`unknown` vs `string | number | boolean | object`，前者更宽松，后者排除了 `symbol` 和 `bigint` 但增加了 `object`。这种微小差异会引发泛型推导冲突
- `IPatternExtractor` 无任何实现类，属于死代码（dead code）

### C3. `pattern.ts` 违反单一职责（God File）

**文件**: `pattern.ts`（646 行）

**文件中包含的类型归属**:

| 职责域 | 包含的类型 | 行数占比 |
|--------|-----------|---------|
| 模式核心类型 | `Pattern`, `PatternKind`, `SourceSpan`, `PatternBody`, `PatternExample`, `PatternElement` | ~30% |
| 提取器接口 | `IPatternExtractor`, `ExtractionContext`, `ExtractionResult` | ~15% |
| 校验器接口 | `IPatternValidator`, `ValidationResult`, `ValidationError` | ~15% |
| 归并器接口 | `IPatternMerger` | ~8% |
| 管线阶段接口 | `IPipelineStage`, `PipelineStageContext` | ~12% |
| 提取器选项 | `AstExtractorOptions`, `RegexExtractorOptions`, `PatternRule`, `HeuristicExtractorOptions`, `HeuristicRule` | ~12% |
| 工厂选项 | `ExtractorFactoryOptions` | ~8% |

**问题**: 一个文件承载了 7 种不同职责的类型定义。按 DESIGN.md 的三层抽象（接口层/实现层/编排层），本文件属于"接口层"，但混入了本应属于"实现层"的 `AstExtractorOptions`、`RegexExtractorOptions`、`HeuristicRule` 等选项类型。

**建议**: 按 DESIGN.md §10.1 的目录结构拆分：
- `src/types/pattern-types.ts` — `Pattern`, `PatternKind`, `PatternBody`, `PatternExample`, `PatternElement`, `SourceSpan`
- `src/types/extractor-types.ts` — `IPatternExtractor`, `ExtractionContext`, `ExtractionResult`
- `src/types/validator-types.ts` — `IPatternValidator`, `ValidationResult`, `ValidationError`
- `src/types/merger-types.ts` — `IPatternMerger`
- `src/types/pipeline-types.ts` — `IPipelineStage`, `PipelineStageContext`
- `src/types/option-types.ts` — `AstExtractorOptions`, `RegexExtractorOptions`, `HeuristicExtractorOptions`, `ExtractorFactoryOptions`, `PatternRule`, `HeuristicRule`

或至少拆分为 3 个文件：`pattern.ts`（核心类型）、`extractor-interface.ts`（提取器/校验器/归并器接口）、`pipeline-interface.ts`（管线阶段接口+选项类型）。

### C4. 设计文档与实现严重不一致

**文件**: `DESIGN.md` vs 实际源码

**不一致清单**:

| 设计文档描述 | 实际实现 | 不一致级别 |
|-------------|---------|-----------|
| 接口层为 `types.ts` | 无 `types.ts`，类型分散在 `extractor.ts` + `pattern.ts` | 🔴 架构级 |
| 接口名均为 `I` 前缀（`IPatternExtractor`） | 既有 `PatternExtractor`（无 I）又有 `IPatternExtractor`（有 I） | 🟠 命名级 |
| 目录结构为 `src/extractors/ast-extractor.ts` 等子目录 | 所有文件在 `src/` 根目录（除 `predefined/`） | 🟠 结构级 |
| `IPatternValidator` / `IPatternMerger` 在设计文档中为接口 | 在 `pattern.ts` 中已定义为接口 | ✅ 一致 |
| `PatternExtractorRegistry` 操作 `IPatternExtractor` | 实际操作 `PatternExtractor`（从 extractor.ts） | 🟠 类型级 |
| 提取器变体3个（AST/Regex/Heuristic） | 仅实现了 `JsonPatternExtractor` | 🟡 实现级 |

**影响**: 开发者参照 DESIGN.md 编码会导致链接错误。DESIGN.md 不再是"可执行设计文档"（P14），降低了文档的信噪比。

### C5. `DEFAULT_SCAN_OPTIONS` 使用类型断言 `as Readonly<ScanOptions>` 绕过类型检查

**文件**: `packages/pattern-extractor/src/scanner.ts` 第 452–459 行

```typescript
export const DEFAULT_SCAN_OPTIONS: Readonly<ScanOptions> = Object.freeze({
  minConfidence: 0,
  enableMerge: true,
  mergeThreshold: 0.8,
  maxResults: 100,
  includeSummary: true,
  verbose: false,
}) as Readonly<ScanOptions>;
```

**问题**:
- 使用 `as Readonly<ScanOptions>` 类型断言，绕过了 TypeScript 的结构兼容性检查
- `Object.freeze(...)` 的返回值类型为 `Readonly<{ minConfidence: number; ... }>`，本身就兼容 `Readonly<ScanOptions>`（因为 ScanOptions 所有字段均为可选），不需要类型断言
- 多余的 `as` 断言会掩盖未来 ScanOptions 接口变更时可能产生的类型错误

---

## 4. 一般问题（MINOR）

### M1. 魔法数字散落在置信度计算中

**文件**: `packages/pattern-extractor/src/predefined/json-extractor.ts`

**问题位置与建议**:

| 位置 | 魔法数字 | 语义 | 建议命名常量 |
|------|---------|------|-------------|
| `buildNamingPattern` | `0.6` (占比阈值) | 命名风格主导占比 ≥ 60% 才产出 | `DOMINANT_STYLE_RATIO_THRESHOLD = 0.6` |
| `buildNamingPattern` | `0.3` (基础置信度) | 命名模式基础置信度 | `NAMING_BASE_CONFIDENCE = 0.3` |
| `buildNamingPattern` | `0.6` (乘数) | 置信度 = 0.3 + ratio × 0.6 | `NAMING_CONFIDENCE_MULTIPLIER = 0.6` |
| `buildNamingPattern` | `0.95` (上限) | 命名模式最大置信度 | `NAMING_MAX_CONFIDENCE = 0.95` |
| `buildStructurePattern` | `0.3`, `0.5`, `0.9` | 结构模式置信度计算 | 建议提取为 `STRUCTURE_*` 系列常量 |
| `buildTypeDistributionPattern` | `0.3`, `0.5`, `0.85` | 类型分布置信度计算 | 建议提取为 `TYPE_DIST_*` 系列常量 |
| `buildArrayHomogeneityPattern` | `0.3`, `0.3`, `0.3`, `0.9` | 数组同质性置信度计算 | 建议提取为 `ARRAY_*` 系列常量 |

**建议**: 在文件顶部定义常量组，按提取维度分组（命名/结构/类型/数组），提升可维护性和可调参性。

### M2. `PACKAGE_ANCHOR` 与 `JSON_EXTRACTOR_ANCHOR` 命名不一致

**文件**: `extractor.ts` 第 397 行 + `json-extractor.ts` 最后

```
extractor.ts:      export const PACKAGE_ANCHOR = "[@cortex/pattern-extractor] 模式提取基础设施";
json-extractor.ts: export const JSON_EXTRACTOR_ANCHOR = "[@cortex/pattern-extractor] JsonPatternExtractor v0.1.0 — JSON 结构模式提取器";
```

**问题**:
- `PACKAGE_ANCHOR` 在 `extractor.ts` 中定义，但作为"包锚点"放在一个接口定义文件中不合适——应放在 `index.ts` 或独立的 `constants.ts` 中
- `JSON_EXTRACTOR_ANCHOR` 包含 `v0.1.0` 版本号，需要随版本发布同步更新，容易遗漏
- 两个锚点的格式不一致（一个包含版本号一个不包含）

### M3. `metadata` 字段类型在三处定义中不一致

| 文件 | 类型 | 
|------|------|
| `extractor.ts` — `ExtractionContext.metadata` | `Record<string, unknown>` |
| `pattern.ts` — `ExtractionContext.metadata` | `Record<string, string \| number \| boolean>` |
| `scanner.ts` — `ScanOptions.metadata` | `Record<string, unknown>` |

**影响**: 消费者在不同层面看到不同的类型约束。`pattern.ts` 版本排除了 `null`、`object[]` 和嵌套 `Record`，比 `extractor.ts` 版本更严格。若消费者从 `pattern.ts` 导入 `ExtractionContext` 然后传给接收 `extractor.ts` 版本的函数，TypeScript 可能报类型不兼容。

### M4. `Pattern` 与 `PatternDefinition` 几乎完全相同

**文件**: `pattern.ts` 的 `Pattern` vs `extractor.ts` 的 `PatternDefinition`

两个接口的字段完全一致（id, kind, name, description, tags, language, confidence, source, sourceSpan, body, elements, references, extractor, extractedAt, usageCount, weight），仅接口名不同。

**问题**: 这不是两个不同概念，而是同一个概念的两个名字。这种重复会让消费者困惑"到底该用哪一个"。

### M5. `JsonArray` 使用空接口继承

**文件**: `json-extractor.ts`

```typescript
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface JsonArray extends Array<JsonValue> {}
```

**问题**: 虽然加了 eslint 豁免注释，但空接口继承 `Array<T>` 在 TypeScript 5.x 中不产生任何实际类型差异——`JsonArray` 与 `JsonValue[]`（或 `Array<JsonValue>`）完全等价。直接使用 `JsonValue[]` 即可，无需额外的接口声明。

---

## 5. 检查通过项（PASS）

### ✅ `any` 类型禁止

所有源文件零 `any` 类型。`json-extractor.ts` 使用 `JsonValue` 联合正确描述 JSON 值类型。

### ✅ 非空断言禁止

所有源文件零 `!` 非空断言。

### ✅ 空 catch 禁止

所有 catch 块均正确处理异常：
- `catch (parseError: unknown)` + `instanceof Error` 守卫
- `catch (analyzeError: unknown)` + `instanceof Error` 守卫

### ✅ JSDoc 完整性

| 文件 | 公开符号数 | 有 JSDoc | 覆盖率 |
|------|-----------|---------|--------|
| `extractor.ts` | 8 | 8 | 100% |
| `pattern.ts` | 27 | 27 | 100% |
| `scanner.ts` | 10 | 10 | 100% |
| `registry.ts` | 14 | 14 | 100% |
| `json-extractor.ts` | 5 (公开类+类型) | 5 | 100% |
| `index.ts` | 32 (每个 re-export) | 32 | 100% |

所有公开 API、接口、类型别名、枚举均有完整 JSDoc，含 `@example`、`@param`、`@returns`、`@since` 等标签。

### ✅ 单向依赖拓扑

```
extractor.ts  ──→ (zero internal deps)
pattern.ts    ──→ (zero internal deps)
scanner.ts    ──→ [./types.js] (BROKEN — 应为 ./extractor.ts)
registry.ts   ──→ ./extractor.ts ✓
json-extractor.ts  ──→ ../extractor.ts ✓
index.ts      ──→ ./scanner.js, ./pattern.js, ./extractor.js ✓
```

除 B1 外，依赖方向正确：实现层 (`json-extractor.ts`) → 接口层 (`extractor.ts`)，编排层 (`registry.ts`) → 接口层。

### ✅ `satisfies` 运算符正确使用

`json-extractor.ts` 使用 `satisfies InternalOptions` 进行构造选项校验，获得精确类型推断同时保留类型安全。

### ✅ Registry 三层索引设计

`PatternExtractorRegistry` 的 `_byName` + `_byLanguage` + `_byKind` 三层索引设计正确，`queryByLanguageAndKind` 交集查询逻辑严谨，支持精确匹配和通配回退。

### ✅ 容错设计

`json-extractor.ts` 的 `extract()` 方法：
- 输入校验 → 返回 `success: false` 而非抛异常
- JSON 解析失败 → 返回 `success: false` + 错误详情
- 循环引用检测 → `Set<object>` 追踪，避免 Stack Overflow
- 单个模式构建失败 → 不影响其他模式
- 总体符合"所有错误通过 ExtractionResult 返回"的契约

### ✅ 导入走 barrel

所有外部消费者应通过 `@cortex/pattern-extractor`（即 `index.ts`）导入。内部文件间使用相对路径导入具体文件，符合"内部导入走相对路径，外部导入走 barrel"的惯例。

---

## 6. 整改建议汇总

### 6.1 按优先级排序

| 优先级 | 问题 ID | 整改动作 | 预计工作量 |
|--------|---------|---------|-----------|
| P0 | **B1** | 修复 `scanner.ts` 的导入路径 `"./types.js"` → `"./extractor.js"` | 5 分钟 |
| P1 | **C1 + C2** | 合并 `extractor.ts` 和 `pattern.ts` 的重复类型，消除 `IPatternExtractor` vs `PatternExtractor` 两套接口 | 2–3 小时 |
| P1 | **C4** | 同步更新 DESIGN.md 与实际实现（或重构实现对齐设计） | 1–2 小时 |
| P2 | **C3** | 拆分 `pattern.ts` god file 为多个职责单一的文件 | 2–3 小时 |
| P2 | **C5** | 移除 `DEFAULT_SCAN_OPTIONS` 多余的 `as Readonly<ScanOptions>` 断言 | 5 分钟 |
| P3 | **M1** | 为 json-extractor.ts 中的置信度计算提取命名常量 | 30 分钟 |
| P3 | **M2** | 将 `PACKAGE_ANCHOR` 移至 `index.ts` 或独立的 `constants.ts` | 15 分钟 |
| P3 | **M3** | 统一三处的 `metadata` 类型为 `Record<string, unknown>` | 15 分钟 |
| P3 | **M4** | 评估 `Pattern` vs `PatternDefinition` 是否真的需要同时存在，或移除其中一个 | 1 小时 |
| P4 | **M5** | 移除 `JsonArray` 空接口，直接使用 `JsonValue[]` | 5 分钟 |

### 6.2 推荐的合并策略（C1 + C2 详细方案）

建议将类型体系统一为**单一规范来源**，方案如下：

```
extractor.ts  ─ 保留，作为"提取器接口"规范来源
  ├── PatternKind 枚举
  ├── PatternBody / PatternExample / PatternElement 接口
  ├── PatternDefinition 接口（统一命名，移除 Pattern）
  ├── PatternExtractor 接口（统一命名，移除 IPatternExtractor）
  ├── ExtractionContext 接口（metadata: Record<string, unknown>）
  ├── ExtractionResult 判别联合（patterns: PatternDefinition[]）
  ├── PatternExtractorOptions
  └── PACKAGE_ANCHOR

pattern.ts ─ 删除，职责迁移到 extractor.ts 或拆分为独立类型文件
  ├── Pattern → 合并为 PatternDefinition（统一命名）
  ├── SourceSpan → 迁入 extractor.ts
  ├── IPatternExtractor → 删除，统一使用 PatternExtractor
  ├── IPatternValidator / IPatternMerger → 迁入独立 validator-types.ts / merger-types.ts
  ├── IPipelineStage / PipelineStageContext → 迁入独立 pipeline-types.ts
  └── 各 Options 类型 → 迁入独立 option-types.ts
```

### 6.3 编译修复步骤（最低工作量，先让包可编译）

1. **修复 B1**: 修改 `scanner.ts` 第 21–24 行的导入为 `from "./extractor.js"`
2. **修复 B1 连带**: 确认 `index.ts` 中从 `scanner.ts` 的 re-export 链路正常
3. 运行 `tsc --noEmit` 验证编译通过
4. 再根据优先级修复 C1–C5

---

## 附录: 源码度量摘要

| 指标 | extractor.ts | pattern.ts | scanner.ts | registry.ts | json-extractor.ts | index.ts |
|------|-------------|-----------|-----------|------------|------------------|---------|
| 行数 | 398 | 646 | 477 | 348 | 611 | 364 |
| 接口数 | 5 | 14 | 4 | 0 | 0 | 0 |
| 类型别名 | 1 | 1 | 1 | 0 | 3 | 0 |
| 类 | 0 | 0 | 0 | 1 | 1 | 0 |
| 枚举 | 1 | 1 | 0 | 0 | 0 | 0 |
| 函数 | 1 | 0 | 0 | 0 | 9 | 0 |
| 导入语句 | 0 | 0 | 1 | 2 | 1 | 12 |
| JSDoc 覆盖率 | 100% | 100% | 100% | 100% | 100% | 100% |
| `any` 出现次数 | 0 | 0 | 0 | 0 | 0 | 0 |
| 非空断言 `!` | 0 | 0 | 0 | 0 | 0 | 0 |
| 空 catch | 0 | 0 | 0 | 0 | 0 | 0 |

---

*审查结束。总体代码质量高（JSDoc 完整、无 any、错误处理规范），但存在严重的类型重复和组织问题，根源在于 DESIGN.md 规划的 `types.ts` 未创建，导致类型定义散落且重复。建议优先解决 B1（阻断编译）和 C1+C2（类型体系统一），再逐步拆分 god file 和对齐设计文档。*
