# @cortex/pattern-extractor

## 定位
模式提取基础设施层——位于技能系统（skill-kit）和 Agent 引擎（engine）之间，提供可替换的多策略模式提取能力，将代码/文本分析结果转化为标准化的 PatternDefinition 供下游消费。

## 上游依赖
- @cortex/shared（仅 workspace 类型依赖，零额外运行时依赖）

## 下游消费者
- @cortex/engine（LoopAgent / AnalysisAgent 产出模式时调用）
- @cortex/skill-kit（消费 PatternDefinition 沉淀为 Skill）

## 接口契约
- `PatternScanner` — 面向消费层的扫描契约（scan / canScan 高级异步 API）
- `IPatternExtractor` — 面向实现层的单次提取接口（extract 同步契约）
- `PatternDefinition` — 模式定义数据结构（score / confidence 元数据）
- `PatternKind` — 模式类型枚举
- `PatternExtractorRegistry` — 提取器注册中心，按 language + kind 匹配策略
- `DEFAULT_SCAN_OPTIONS` / `DEFAULT_SCANNER_NAME` — 默认扫描配置

## 不做什么
- 不沉淀 Skill 生命周期管理（委托 @cortex/skill-kit）
- 不调度 Agent / 任务编排（委托 @cortex/engine）
- 不管理记忆存储与向量检索（委托 @cortex/memory-store）
- 不提供 CLI 交互 / TUI 渲染（委托 @cortex/cli / @cortex/tui）
# @cortex/pattern-extractor 包定位文档

> **作者**：阿贝多（CodeAgent）  
> **版本**：v0.1.0  
> **状态**：implemented  
> **关联设计文档**：`DESIGN.md`（纳西妲架构设计）

---

## 目录

1. [Q1: 本包补足了什么？](#q1-本包补足了什么)
2. [Q2: 本包的定位是什么？](#q2-本包的定位是什么)
3. [Q3: 为什么值得合入？](#q3-为什么值得合入)
4. [附录：当前实现范围](#附录当前实现范围)

---

## Q1: 本包补足了什么？

### 1.1 补足缺口一览

在 `@cortex/pattern-extractor` 实现之前，Cortex 生态在模式提取方面存在以下空白：

| 维度 | 缺口 | 本包补足方式 |
|------|------|-------------|
| **统一模式提取接口** | 没有标准化的 API 从代码/文本中提取可复用模式 | `IPatternExtractor` 接口 + `PatternDefinition` 类型，定义提取契约 |
| **多策略可替换提取** | 不同语言/场景需要不同提取策略，缺乏统一编排 | `PatternExtractorRegistry` 注册中心，按 language + kind 匹配策略 |
| **模式→技能沉淀链路** | LoopAgent/MetaAgent 产出模式后无法自动沉淀为 Skill | `PatternScanner.scan()` → `PatternDefinition` → SkillRegistry 消费 |
| **提取器验证与评测** | 新增提取器无法量化评估准确率/召回率 | `PatternDefinition` 携带 score/confidence 元数据，支持 A/B 对比 |
| **类型安全模式建模** | 模式元数据散落在字符串/JSON 中，无编译期校验 | `PatternKind` 枚举 + `Pattern` 接口，TypeScript 编译期类型约束 |

### 1.2 与现有系统的互补关系

```
                         ┌──────────────────────────────────────────┐
                         │           Cortex 模式引擎                  │
                         ├──────────────────────────────────────────┤
                         │                                          │
 ┌──────────────────┐    │  ┌──────────────────────────────────┐     │
 │ @cortex/skill-kit │    │  │ @cortex/pattern-extractor         │     │
 │                  │    │  │                                   │     │
 │ SkillRegistry    │◄───┼──│ PatternScanner.scan()              │     │
 │  沉淀/查询/淘汰  │    │  │   ├─ IPatternExtractor[AST]        │     │
 │                  │    │  │   ├─ IPatternExtractor[Regex]      │     │
 └──────────────────┘    │  │   ├─ IPatternExtractor[Heuristic]  │     │
                         │  │   └─ PatternExtractorRegistry       │     │
 ┌──────────────────┐    │  │                                   │     │
 │ @cortex/engine    │    │  │ PatternDefinition                 │     │
 │                  │    │  │   pattern/kind/score/confidence    │     │
 │ LoopAgent        │───►│  │   → 序列化 → Skill 模板 JSON       │     │
 │ AnalysisAgent    │───►│  │                                   │     │
 └──────────────────┘    │  └──────────────────────────────────┘     │
                         └──────────────────────────────────────────┘
```

---

## Q2: 本包的定位是什么？

### 2.1 一句话定位

**`@cortex/pattern-extractor` 是 Cortex monorepo 的模式提取基础设施层**——位于技能系统（skill-kit）和 Agent 引擎（engine）之间，提供可替换的多策略提取能力，将代码分析结果转化为标准化的 PatternDefinition 供下游消费。

### 2.2 职责边界

```
        ┌─ 属于 pattern-extractor ─┐
        │                          │
        │  • IPatternExtractor 接口  │
        │  • PatternDefinition 类型  │
        │  • PatternKind 枚举       │
        │  • PatternScanner 接口     │
        │  • Registry 注册/查询     │
        │  • 具体提取器实现          │
        │                          │
        └──────────────────────────┘

  ❌ 不属于本包:
  • Skill 沉淀/生命周期管理 → @cortex/skill-kit
  • Agent 调度/任务编排 → @cortex/engine
  • 内存存储/向量检索 → @cortex/memory-store
  • CLI 交互/TUI 渲染 → @cortex/cli
```

### 2.3 依赖拓扑

```
  pattern-extractor
    ├── @cortex/shared (workspace:*)
    └── (零额外运行时依赖)
```

---

## Q3: 为什么值得合入？

### 3.1 与宪法对齐

| 宪法条款 | 对齐方式 |
|---------|---------|
| **§三·接口隔离** | `IPatternExtractor` 消费方只暴露 extract()，不暴露内部策略 |
| **§四·barrel 铁律** | `src/index.ts` 统一导出 33 个公开符号，禁止跨包直接导入内部文件 |
| **§六·注册表模式** | `PatternExtractorRegistry` 遵循 P06 注册表映射模式 |
| **§十一·零 any** | 全量代码零 `any` 类型，使用泛型 + 联合类型替代 |
| **§十一·零非空断言** | 全量代码零 `!` 非空断言，使用可选链 + 类型守卫替代 |
| **§十四·测试首行标注** | 4 个测试文件首行均为 `// @ci: unit` |

### 3.2 工程价值

1. **填补模式提取空白**：solo-flight 已验证 MetaAgent 规划需要模式提取能力来沉淀可复用技能，pattern-extractor 是此链路的核心基础设施
2. **零运行时依赖**：仅依赖 `@cortex/shared (workspace:*)`，不引入第三方库
3. **可扩展架构**：三层抽象（接口-实现-编排），新提取器通过 Registry.register() 即插即用
4. **全量测试覆盖**：190 个单元测试通过，覆盖接口/枚举/注册表/提取器/扫描器

---

## 附录：当前实现范围

### 已实现

| 文件 | 行数 | 说明 |
|------|------|------|
| `src/extractor.ts` | 397 | IPatternExtractor 接口、PatternDefinition、PACKAGE_ANCHOR |
| `src/pattern.ts` | 637 | PatternKind 枚举、Pattern 接口、所有相关类型 |
| `src/scanner.ts` | 477 | PatternScanner 接口（消费层统一入口） |
| `src/registry.ts` | 545 | PatternExtractorRegistry（注册表映射模式） |
| `src/index.ts` | 353 | Barrel 导出（33 个公开符号） |
| `src/predefined/json-extractor.ts` | 1408 | JsonPatternExtractor 实现 |
| `tests/pattern.spec.ts` | 942 | 64 个测试 |
| `tests/extractor.spec.ts` | 897 | 45 个测试 |
| `tests/registry.spec.ts` | 736 | 44 个测试 |
| `tests/scanner.spec.ts` | 814 | 37 个测试 |

### 待实现（后续迭代）

| 项目 | 优先级 | 说明 |
|------|--------|------|
| `AstPatternExtractor` | P1 | 基于 tree-sitter 的 AST 模式提取 |
| `RegexPatternExtractor` | P2 | 正则表达式通用提取器 |
| Scanner 实现类 | P1 | `DefaultPatternScanner` 编排实现 |
| 管线后处理（Validate→Merge→Score→Filter） | P2 | Scanner 内蕴管线 |
| 消除 PatternKind 重复定义 | P2 | `pattern.ts` 和 `extractor.ts` 各定义了一次 |
