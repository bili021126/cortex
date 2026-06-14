# @cortex/pattern-extractor — 架构设计文档

> **版本**: v1.0 (草案)
> **状态**: 设计中
> **范围**: 从代码与文本中提取可复用模式的三层抽象包，遵循 Cortex 接口层-实现层-编排层宪法

---

## 目录

1. [包定位](#1-包定位)
2. [核心职责与边界](#2-核心职责与边界)
3. [三层抽象总览](#3-三层抽象总览)
4. [接口层（Interface Layer）](#4-接口层interface-layer)
5. [实现层（Implementation Layer）](#5-实现层implementation-layer)
6. [编排层（Orchestration Layer）](#6-编排层orchestration-layer)
7. [Registry 注册机制](#7-registry-注册机制)
8. [依赖注入策略](#8-依赖注入策略)
9. [数据流全景](#9-数据流全景)
10. [文件组织方案](#10-文件组织方案)
11. [从母项目复用的架构模式](#11-从母项目复用的架构模式)
12. [与现有系统的集成](#12-与现有系统的集成)

---

## 1. 包定位

### 1.1 一句话定位

**@cortex/pattern-extractor** 是 Cortex 生态中的**模式提取基础设施**——接收代码文件、文本片段或结构化输入，通过可替换的提取策略（AST / 正则 / 启发式），产出标准化的 `PatternDefinition`，供 SkillRegistry 沉淀为技能或 MetaAgent 规划参考。

### 1.2 包名

```json
{
  "name": "@cortex/pattern-extractor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@cortex/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

### 1.3 解决的问题

| 痛点 | 当前状态 | 本包解决方式 |
|------|---------|-------------|
| **模式提取散落在各 Agent 中** | LoopAgent/InspectorAgent 各写一套文本解析逻辑 | 统一接口 + 可替换策略，提取逻辑与 Agent 解耦 |
| **无标准化的模式定义** | 技能模板（SkillTemplate）承载认知，但缺少代码级模式的结构化描述 | `PatternDefinition` 统一数据结构，可序列化、可评价、可沉淀为技能 |
| **提取策略不可替换** | 硬编码的 JSON 围栏解析（`extractSkillsFromOutput`） | AST / 正则 / 启发式三种策略自由切换，可按场景组合 |
| **无提取管线编排** | 单步提取，无后处理/过滤/归并管道 | `PatternExtractorPipeline` 支持多阶段编排：提取→校验→归并→评分 |
| **无注册发现机制** | Agent 直接 import 提取函数，不可动态发现 | `PatternExtractorRegistry` 按标签/语言/模式种类注册和查询 |

### 1.4 不做的事

- ❌ 不包含 LLM 调用——提取策略是纯代码逻辑，不做 LLM-based 模式推断
- ❌ 不包含技能沉淀逻辑——提取后的模式由 `SkillRegistry` 消费，本包仅产出 `PatternDefinition`
- ❌ 不包含 AST 完整解析——依赖 `parse_ast` 工具或 `tree-sitter` 库，本包仅封装提取策略
- ❌ 不包含持久化——`PatternDefinition` 只做内存流转，持久化由调用方负责
- ❌ 不包含 Agent 实现——本包是基础设施，LoopAgent/AnalysisAgent 通过 DI 消费本包

---

## 2. 核心职责与边界

### 2.1 属于 @cortex/pattern-extractor

```
✅ IPatternExtractor          — 模式提取器统一接口
✅ PatternDefinition          — 标准化模式定义数据结构
✅ PatternKind                — 模式种类枚举（结构/行为/架构/数据流/文档）
✅ AstPatternExtractor        — AST 语义提取变体（基于 parse_ast 工具）
✅ RegexPatternExtractor      — 正则表达式提取变体（快速扫描模式）
✅ HeuristicPatternExtractor  — 启发式规则提取变体（命名约定 + 文件结构）
✅ PatternExtractorRegistry   — 提取器注册表（按标签/语言/种类注册）
✅ PatternExtractorPipeline   — 提取管线编排器（校验/归并/评分等后处理阶段）
✅ ExtractorFactory           — 组合入口，提供默认值与依赖注入
✅ ExtractionContext          — 提取上下文（文件路径、语言、配置选项）
✅ ExtractionResult           — 提取结果（模式列表 + 诊断信息）
✅ PatternValidator           — 模式校验器（字段完整性与语义校验）
✅ PatternMerger              — 模式归并器（去重与相似度合并）
```

### 2.2 留在消费方（@cortex/engine / LoopAgent）

```
❌ SkillRegistry              — 模式→技能的沉淀由 SkillRegistry 完成
❌ SkillTemplate              — 本包产出 PatternDefinition，消费方转换为 SkillTemplate
❌ LLM 调用                    — 本包不做 LLM-based 模式推断
❌ 持久化 / 文件 I/O           — 提取结果由调用方写入 MemoryStore 或磁盘
❌ Agent 调度/生命周期          — 本包是纯基础设施，不感知 Agent
```

### 2.3 边界原则

```
@cortex/engine / LoopAgent
  └── 依赖 → @cortex/pattern-extractor   (模式提取基础设施)
  └── 依赖 → @cortex/shared               (共享类型)

@cortex/pattern-extractor
  └── 依赖 → @cortex/shared               (仅类型: PatternDefinition 中用到的 Tag, SkillKind 等)
  └── devDependencies → @cortex/shared     (编译期类型)
  └── 运行时零 Node.js 原生依赖            (纯 TypeScript/TSX, 可浏览器/Worker 运行)

@cortex/skill-kit
  └── (可选) 依赖 → @cortex/pattern-extractor  (将 PatternDefinition 转换为 SkillTemplate)
```

---

## 3. 三层抽象总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ③ 编排层（Orchestration Layer）                    │
│                                                                     │
│  ┌──────────────────────┐  ┌───────────────────────────────────┐    │
│  │ PatternExtractor     │  │ ExtractorFactory                  │    │
│  │ Registry             │  │ - 组合入口，注入依赖               │    │
│  │ - register/unregister│  │ - 注册表自动发现                   │    │
│  │ - queryByTags/lang   │  │ - 管线编排                        │    │
│  │ - list/get           │  │ - 默认值回退                      │    │
│  └──────────┬───────────┘  └──────────────┬────────────────────┘    │
│             │                              │                         │
│  ┌──────────┴──────────────────────────────────┴──────────────────┐ │
│  │  PatternExtractorPipeline                                    │ │
│  │  [Extract] → [Validate] → [Merge] → [Score] → [Result]      │ │
│  └───────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│                    ② 实现层（Implementation Layer）                  │
│                                                                     │
│  ┌──────────────────┐  ┌────────────────┐  ┌──────────────────┐    │
│  │ AstPattern       │  │ RegexPattern   │  │ HeuristicPattern │    │
│  │ Extractor        │  │ Extractor      │  │ Extractor        │    │
│  │ (AST 语义分析)   │  │ (正则快速扫描)  │  │ (启发式规则)     │    │
│  └──────────────────┘  └────────────────┘  └──────────────────┘    │
│                                                                     │
│  ┌──────────────────┐  ┌────────────────┐                           │
│  │ PatternValidator │  │ PatternMerger  │                           │
│  │ (字段校验)       │  │ (去重归并)     │                           │
│  └──────────────────┘  └────────────────┘                           │
├─────────────────────────────────────────────────────────────────────┤
│                    ① 接口层（Interface Layer）                       │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ types.ts                                                    │   │
│  │ - IPatternExtractor  — 提取器统一接口                        │   │
│  │ - PatternDefinition  — 模式定义数据结构                       │   │
│  │ - PatternKind        — 模式种类枚举（零依赖）                 │   │
│  │ - ExtractionContext  — 提取上下文                             │   │
│  │ - ExtractionResult   — 提取结果（Result 判别联合）            │   │
│  │ - IPatternValidator  — 校验器接口                             │   │
│  │ - IPatternMerger     — 归并器接口                             │   │
│  │ - IPipelineStage     — 管线阶段接口                           │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.1 依赖方向

```
接口层 (types.ts)          — 零依赖，纯类型定义
  ↑ 实现
实现层 (extractors/*)      — 仅依赖接口层 (+ 可选 @cortex/shared 类型)
  ↑ 组合
编排层 (registry/factory)  — 依赖接口层 + 实现层
  ↑ 消费
消费方 (LoopAgent/CLI)     — 面向编排层 API
```

### 3.2 与母项目"分层四件套"模式的关系

本包严格遵循 skill-kit 提炼的 **P01 — 分层四件套架构** 模式：

| 层 | 母项目模式 P01 | 本包映射 |
|----|--------------|---------|
| 类型层 | `types.ts` — 零依赖纯类型 | `types.ts` — `IPatternExtractor`, `PatternDefinition` 等 |
| 实现层 | `loader/validator/cache` | `ast-extractor.ts`, `regex-extractor.ts`, `heuristic-extractor.ts` |
| 工厂层 | `factory.ts` — 组合入口 | `extractor-factory.ts` — 组合注册表+管线+默认值 |
| 导出层 | `index.ts` — 桶导出 | `index.ts` — 聚合全部公开 API |

---

## 4. 接口层（Interface Layer）

### 4.1 PatternKind — 模式种类枚举

```typescript
/**
 * PatternKind —— 模式种类枚举。
 *
 * 每个种类的语义决定了提取策略侧重和后续消费方式：
 * - structural:   代码结构模式（类层次、模块划分、接口组织）
 * - behavioral:   行为模式（算法步骤、状态流转、事件响应）
 * - architectural: 架构模式（分层、微服务、事件驱动架构风格）
 * - dataflow:     数据流模式（管线、变换、聚合、扇入/扇出）
 * - documentation: 文档规范模式（注释风格、API 文档结构、README 约定）
 * - naming:       命名约定模式（文件命名、变量命名、目录组织）
 */
export enum PatternKind {
  Structural     = "structural",
  Behavioral     = "behavioral",
  Architectural  = "architectural",
  Dataflow       = "dataflow",
  Documentation  = "documentation",
  Naming         = "naming",
}
```

### 4.2 PatternDefinition — 标准化模式定义

```typescript
/**
 * PatternDefinition —— 提取出的标准化模式定义。
 *
 * 设计原则（承袭 SkillTemplate 的设计宪法）：
 * - 模式是"可参考"而非"可执行"——消费方（LoopAgent/MetaAgent）
 *   决定如何使用该模式
 * - 可靠性来自评价累加（weight + usageCount），而非二值判断
 * - 每种模式由 sourceSpan 定位到源码位置，可溯源验证
 *
 * @usedBy PatternExtractorPipeline → SkillRegistry.convertToSkill()
 */
export interface PatternDefinition {
  /** 唯一标识 */
  id: string;

  /** 模式种类 */
  kind: PatternKind;

  /** 人类可读名称 */
  name: string;

  /** 详细描述 */
  description: string;

  /** 触发标签——与 @cortex/shared Tag 兼容 */
  tags: string[];

  /** 编程语言（如 "typescript"、"python"、"markdown"） */
  language: string;

  /** 置信度 0–1——提取策略自评的可靠程度 */
  confidence: number;

  /** 模式来源——文件路径或文本片段标识 */
  source: string;

  /** 源码定位（起始行、结束行、列）——可选 */
  sourceSpan?: {
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
  };

  /** 模式体——结构化内容（JSON 可序列化） */
  body: PatternBody;

  /** 模式体中的关键要素列表 */
  elements: PatternElement[];

  /** 关联的外部引用（其他模式 ID 或资源 URL） */
  references?: string[];

  /** 提取器名称——溯源用 */
  extractor: string;

  /** 提取时间戳 */
  extractedAt: number;

  /** 累计引用次数（运行时追踪） */
  usageCount: number;

  /** 评价权重（类似 SkillTemplate.weight） */
  weight: number;
}

/**
 * PatternBody —— 模式体，包含具体规则和示例。
 *
 * 三种形态（由 kind 决定侧重）：
 *   - structural: rules 为结构约束，examples 为正反例
 *   - behavioral: rules 为步骤序列，examples 为调用链
 *   - architectural: rules 为架构决策，examples 为拓扑示意
 */
export interface PatternBody {
  /** 规则/约束列表 */
  rules: string[];

  /** 正反例（可选） */
  examples?: PatternExample[];

  /** 模式模板代码（可选） */
  template?: string;
}

/**
 * PatternExample —— 模式的正反例。
 */
export interface PatternExample {
  /** 示例代码或描述 */
  code: string;
  /** 是否推荐(true=正例/false=反例) */
  isPositive: boolean;
  /** 说明 */
  description?: string;
}

/**
 * PatternElement —— 模式体中的关键要素。
 *
 * 用于快速索引和相似度比较，类似 AST 的轻量节点。
 */
export interface PatternElement {
  /** 要素名（如 "interface", "class", "function", "import"） */
  name: string;
  /** 要素类型 */
  type: string;
  /** 要素的签名或值 */
  signature?: string;
  /** 是否为核心要素 */
  isPrimary: boolean;
}
```

### 4.3 IPatternExtractor — 提取器统一接口

```typescript
/**
 * IPatternExtractor —— 模式提取器统一接口。
 *
 * 所有提取策略（AST / 正则 / 启发式）均实现此接口。
 * 消费方（Registry / Pipeline）面向接口编程，不感知具体策略。
 *
 * @typeParam TInput   - 提取器接受的输入类型（默认 string）
 * @typeParam TOptions - 提取器专有配置类型（默认 Record<string, unknown>）
 */
export interface IPatternExtractor<
  TInput = string,
  TOptions extends Record<string, unknown> = Record<string, unknown>,
> {
  /** 提取器唯一标识 */
  readonly name: string;

  /** 支持的语言列表（"*" 表示通用） */
  readonly supportedLanguages: string[];

  /** 支持的模式种类列表 */
  readonly supportedKinds: PatternKind[];

  /** 提取器的描述 */
  readonly description: string;

  /**
   * 从输入中提取模式。
   *
   * @param input    - 输入（文件内容、代码片段、文本）
   * @param options  - 提取器专有选项
   * @returns ExtractionResult（Result 判别联合）
   */
  extract(input: TInput, options?: TOptions): ExtractionResult;

  /**
   * 判断该提取器能否处理指定语言+种类。
   *
   * @param language - 编程语言
   * @param kind     - 模式种类
   */
  canHandle(language: string, kind: PatternKind): boolean;
}
```

### 4.4 ExtractionContext — 提取上下文

```typescript
/**
 * ExtractionContext —— 提取操作的运行时上下文。
 *
 * 类似 PluginContext / DispatchCtx 设计原则：
 * - 只读字段由调用方在创建时注入
 * - 可变状态在管线推进中逐步填充
 *
 * @usedBy PatternExtractorPipeline.run()
 */
export interface ExtractionContext {
  /** 工作区根目录 */
  workspaceRoot?: string;

  /** 本次提取的源文件路径列表 */
  filePaths: string[];

  /** 目标语言（可选，自动检测） */
  language?: string;

  /** 目标模式种类（可选，提取全部） */
  targetKinds?: PatternKind[];

  /** 最小置信度阈值（0–1，低于此值的模式被过滤） */
  minConfidence?: number;

  /** 是否启用去重归并 */
  enableMerge?: boolean;

  /** 最大返回模式数 */
  maxResults?: number;

  /** 调用方注入的元数据 */
  metadata?: Record<string, unknown>;
}
```

### 4.5 ExtractionResult — 提取结果（Result 判别联合）

```typescript
/**
 * ExtractionResult —— 提取操作的结果。
 *
 * 采用 Result 判别联合（P04 模式），TypeScript 自动收窄类型。
 */
export type ExtractionResult =
  | {
      success: true;
      patterns: PatternDefinition[];
      diagnostics: string[];
      durationMs: number;
    }
  | {
      success: false;
      patterns: [];
      diagnostics: string[];
      durationMs: number;
      error: string;
    };
```

### 4.6 IPatternValidator — 校验器接口

```typescript
/**
 * IPatternValidator —— 模式校验器接口。
 *
 * 负责校验 PatternDefinition 的字段完整性和语义正确性。
 * 类似 SkillJsonValidator / SimpleSkillValidator（P10 多级校验器模式）。
 */
export interface IPatternValidator {
  /** 校验单个模式 */
  validate(pattern: PatternDefinition): ValidationResult;

  /** 批量校验 */
  validateMany(patterns: PatternDefinition[]): ValidationResult[];
}

/**
 * ValidationResult —— 校验结果。
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
}
```

### 4.7 IPatternMerger — 归并器接口

```typescript
/**
 * IPatternMerger —— 模式归并器接口。
 *
 * 负责去重和相似度合并，基于 name/tags/elements 计算 Jaccard 相似度。
 */
export interface IPatternMerger {
  /**
   * 归并多个提取器的输出。
   * 相似度高于 threshold 的模式自动合并（保留高 confidence 的）。
   *
   * @param patterns  - 待归并的模式列表
   * @param threshold - 相似度阈值（0–1, 默认 0.8）
   * @returns 归并后的模式列表
   */
  merge(patterns: PatternDefinition[], threshold?: number): PatternDefinition[];
}
```

### 4.8 IPipelineStage — 管线阶段接口

```typescript
/**
 * IPipelineStage —— 模式提取管线中的一个可插拔阶段。
 *
 * 与 IDispatchStep / IStep 同构设计（P08 管线执行器模式）。
 * 单阶段只做一件事，通过上下文的 patterns 数组传递状态。
 */
export interface IPipelineStage {
  /** 阶段名称——用于调试和日志 */
  readonly name: string;

  /**
   * 执行此阶段。
   *
   * @param ctx - 提取上下文（含 patterns 数组）
   * @returns 更新后的上下文
   */
  run(ctx: PipelineStageContext): Promise<PipelineStageContext>;
}

/**
 * PipelineStageContext —— 管线阶段的上下文。
 * patterns 数组在阶段间逐步传递和变换。
 */
export interface PipelineStageContext {
  patterns: PatternDefinition[];
  diagnostics: string[];
  metadata: Record<string, unknown>;
}
```

---

## 5. 实现层（Implementation Layer）

### 5.1 AstPatternExtractor — AST 语义提取变体

**定位**: 高精度提取器，基于抽象语法树分析代码结构模式。

**策略**:
- 接收源码字符串，调用 `parse_ast` 工具或 `tree-sitter` 解析 AST
- 遍历 AST 节点，识别结构/行为/架构模式
- 产出高置信度（0.8–1.0）的 PatternDefinition

**适用场景**:
- TypeScript/JavaScript 项目的接口设计与类型模式提取
- 函数签名与参数模式分析
- 模块依赖与导入结构分析
- 类层次结构与继承模式识别

```typescript
/**
 * AstPatternExtractor —— 基于 AST 语义分析的模式提取器。
 *
 * 实现策略：
 * - 使用 tree-sitter 或 parse_ast 将源码解析为 AST
 * - 遍历 TypeScript Compiler API 的 SyntaxKind 节点
 * - 识别 InterfaceDeclaration / TypeAliasDeclaration / 
 *   FunctionDeclaration / ClassDeclaration 等结构模式
 * - 提取命名约定、修饰符模式、泛型约束等语义模式
 *
 * @example
 * ```typescript
 * const extractor = new AstPatternExtractor();
 * const result = extractor.extract(`
 *   export interface Agent {
 *     readonly type: AgentType;
 *     readonly status: AgentStatus;
 *     execute(node: TaskNode): Promise<NodeResult>;
 *   }
 * `, { language: "typescript" });
 * // → PatternDefinition { kind: "structural", name: "Agent Interface Pattern", ... }
 * ```
 */
export class AstPatternExtractor implements IPatternExtractor<string, AstExtractorOptions> {
  readonly name = "ast-extractor";
  readonly supportedLanguages = ["typescript", "javascript", "tsx", "jsx"];
  readonly supportedKinds: PatternKind[] = [
    PatternKind.Structural,
    PatternKind.Behavioral,
    PatternKind.Architectural,
    PatternKind.Naming,
  ];
  readonly description = "基于 AST 语义分析的高精度模式提取器";

  constructor(
    private options?: AstExtractorOptions,
  ) {}

  extract(input: string, options?: AstExtractorOptions): ExtractionResult {
    // 1. 解析 AST（调用 parse_ast 或 tree-sitter）
    // 2. 遍历 AST 节点，匹配模式规则
    //    - InterfaceDeclaration → 接口设计模式
    //    - TypeAliasDeclaration → 类型抽象模式
    //    - FunctionDeclaration → 函数签名模式
    //    - ClassDeclaration → 类结构模式
    //    - ImportDeclaration → 依赖管理模式
    // 3. 提取每个节点的 name / signature / span
    // 4. 组装 PatternDefinition，计算置信度
    // 5. 返回 ExtractionResult（判别联合）
    throw new Error("Not implemented — see implementation plan §5.1");
  }

  canHandle(language: string, kind: PatternKind): boolean {
    return (
      this.supportedLanguages.includes(language) &&
      this.supportedKinds.includes(kind)
    );
  }
}

/**
 * AstExtractorOptions —— AST 提取器专有选项。
 */
export interface AstExtractorOptions {
  /** 是否提取类型定义模式（默认 true） */
  extractTypes?: boolean;
  /** 是否提取函数模式（默认 true） */
  extractFunctions?: boolean;
  /** 是否提取类模式（默认 true） */
  extractClasses?: boolean;
  /** 是否提取导入模式（默认 false） */
  extractImports?: boolean;
  /** AST 最大深度（默认 8） */
  maxDepth?: number;
  /** 最小模式体长度（默认 3 行，短于此处不提取） */
  minLines?: number;
}
```

### 5.2 RegexPatternExtractor — 正则表达式提取变体

**定位**: 快速扫描提取器，基于正则表达式匹配常见模式。

**策略**:
- 预定义一组模式规则（`PatternRule[]`），每条包含名称、正则、种类
- 逐行/逐块扫描输入，匹配规则后提取
- 产出中等置信度（0.5–0.8）的 PatternDefinition

**适用场景**:
- 快速扫描代码库中的 TODO/FIXME/HACK 标记分布
- 提取 JSDoc/TSDoc 注释中的 `@param` `@returns` 模式
- 识别 export/import 语句的统计模式
- 大型代码库的初步模式发现（先正则扫 → 再 AST 深挖）

```typescript
/**
 * RegexPatternExtractor —— 基于正则表达式快速扫描的模式提取器。
 *
 * 实现策略：
 * - 内置 PatternRule 规则库（可扩展），每条规则定义：
 *   - name: 模式名
 *   - regex: 匹配正则
 *   - kind: 模式种类
 *   - confidence: 命中置信度
 *   - extract: (match) => PatternElement 提取回调
 * - 逐行扫描输入，收集所有匹配的模式
 * - 按 kind 分组归并同类模式
 * - 计算频率分布作为 pattern 的额外元信息
 *
 * @example
 * ```typescript
 * const extractor = new RegexPatternExtractor()
 *   .addRule({
 *     name: "interface-pattern",
 *     regex: /export\s+(interface|type)\s+(\w+)/g,
 *     kind: PatternKind.Structural,
 *     confidence: 0.6,
 *   });
 * const result = extractor.extract(sourceCode);
 * ```
 */
export class RegexPatternExtractor implements IPatternExtractor<string, RegexExtractorOptions> {
  readonly name = "regex-extractor";
  readonly supportedLanguages = ["*"];  // 通用
  readonly supportedKinds: PatternKind[] = [
    PatternKind.Structural,
    PatternKind.Behavioral,
    PatternKind.Documentation,
    PatternKind.Naming,
  ];
  readonly description = "基于正则表达式快速扫描的模式提取器";

  private rules: PatternRule[] = [];

  constructor(options?: RegexExtractorOptions) {
    if (options?.rules) {
      this.rules = options.rules;
    }
  }

  /** 添加一条模式规则 */
  addRule(rule: PatternRule): this {
    this.rules.push(rule);
    return this;
  }

  /** 批量添加模式规则 */
  addRules(rules: PatternRule[]): this {
    this.rules.push(...rules);
    return this;
  }

  extract(input: string, _options?: RegexExtractorOptions): ExtractionResult {
    // 1. 遍历所有规则
    // 2. 对每条规则执行 regex.exec(input) 收集匹配
    // 3. 对匹配结果按 kind 分组
    // 4. 取频率 top-N 作为模式输出
    // 5. 计算置信度 = confidence * (frequency / totalLines)
    // 6. 返回 ExtractionResult
    throw new Error("Not implemented — see implementation plan §5.2");
  }

  canHandle(_language: string, kind: PatternKind): boolean {
    return this.supportedKinds.includes(kind);
  }
}

/**
 * PatternRule —— 正则模式规则定义。
 */
export interface PatternRule {
  /** 模式名称 */
  name: string;
  /** 匹配正则（应包含全局标志 g） */
  regex: RegExp;
  /** 模式种类 */
  kind: PatternKind;
  /** 命中时的基础置信度 0–1 */
  confidence: number;
  /** 提取要素的回调（可选） */
  extract?: (match: RegExpExecArray) => PatternElement;
  /** 模式描述 */
  description?: string;
}

/**
 * RegexExtractorOptions —— 正则提取器专有选项。
 */
export interface RegexExtractorOptions {
  /** 预置规则列表 */
  rules?: PatternRule[];
  /** 最小命中次数（低于此数不输出） */
  minHits?: number;
  /** 最大输出模式数 */
  maxPatterns?: number;
}
```

### 5.3 HeuristicPatternExtractor — 启发式规则提取变体

**定位**: 灵活度最高的提取器，基于命名约定、文件结构、目录布局等启发式规则。

**策略**:
- 分析文件路径和目录结构推断架构模式
- 分析命名约定（camelCase / PascalCase / kebab-case）统计分布
- 分析 import 路径推断模块组织风格
- 产出中低置信度（0.3–0.7）的 PatternDefinition

**适用场景**:
- 新项目的快速架构摸底
- 目录结构模式（src/ 分层、__tests__ 伴生、docs/ 附件）
- 文件命名约定（`*.service.ts`、`*.controller.ts`、`*.plugin.ts`）
- 模块边界与组织风格推断

```typescript
/**
 * HeuristicPatternExtractor —— 基于启发式规则的模式提取器。
 *
 * 实现策略：
 * - 分析文件路径树 → 推断目录分层模式
 * - 分析文件名后缀分布 → 推断命名约定模式
 * - 分析 import 语句 → 推断模块组织模式
 * - 分析文件首尾注释 → 推断文档规范模式
 * - 每条启发式规则产出带 provenance（溯源说明）的 PatternDefinition
 *
 * @example
 * ```typescript
 * const extractor = new HeuristicPatternExtractor();
 * const result = extractor.extract(fileList.join("\n"), {
 *   language: "typescript",
 *   filePaths: ["src/core/scheduler.ts", "src/core/task-board.ts", ...]
 * });
 * // → PatternDefinition { kind: "architectural", name: "Core Module Grouping", ... }
 * ```
 */
export class HeuristicPatternExtractor
  implements IPatternExtractor<string, HeuristicExtractorOptions>
{
  readonly name = "heuristic-extractor";
  readonly supportedLanguages = ["*"];
  readonly supportedKinds: PatternKind[] = [
    PatternKind.Architectural,
    PatternKind.Documentation,
    PatternKind.Naming,
  ];
  readonly description = "基于启发式规则的模式提取器";

  private heuristics: HeuristicRule[] = [];

  constructor(options?: HeuristicExtractorOptions) {
    if (options?.heuristics) {
      this.heuristics = options.heuristics;
    }
  }

  /** 添加启发式规则 */
  addHeuristic(rule: HeuristicRule): this {
    this.heuristics.push(rule);
    return this;
  }

  extract(
    input: string,
    options?: HeuristicExtractorOptions,
  ): ExtractionResult {
    // 1. 解析文件路径列表
    // 2. 计算目录深度分布 → 推断分层深度
    // 3. 计算命名约定分布（PascalCase / camelCase / snake_case）
    // 4. 计算 import 相对路径 vs 绝对路径比例 → 推断模块耦合度
    // 5. 计算 __tests__ / spec / test 伴生文件比例 → 推断测试组织模式
    // 6. 组装 PatternDefinition，confidence 基于统计显著性
    // 7. 返回 ExtractionResult
    throw new Error("Not implemented — see implementation plan §5.3");
  }

  canHandle(_language: string, kind: PatternKind): boolean {
    return this.supportedKinds.includes(kind);
  }
}

/**
 * HeuristicRule —— 启发式规则定义。
 */
export interface HeuristicRule {
  /** 规则名称 */
  name: string;
  /** 模式种类 */
  kind: PatternKind;
  /** 规则描述和判定逻辑 */
  description: string;
  /** 基础置信度 */
  confidence: number;
}

/**
 * HeuristicExtractorOptions —— 启发式提取器专有选项。
 */
export interface HeuristicExtractorOptions {
  /** 预置规则列表 */
  heuristics?: HeuristicRule[];
  /** 文件路径列表（用于目录结构分析） */
  filePaths?: string[];
  /** 最小样本数（低于此数不输出统计模式） */
  minSampleSize?: number;
}
```

### 5.4 三种提取变体的对比

| 维度 | AstPatternExtractor | RegexPatternExtractor | HeuristicPatternExtractor |
|------|--------------------|----------------------|--------------------------|
| **精度** | 高（0.8–1.0） | 中（0.5–0.8） | 中低（0.3–0.7） |
| **速度** | 慢（AST 遍历） | 快（单次扫描） | 快（统计聚合） |
| **适用规模** | 小到中型文件 | 大型代码库 | 项目级扫描 |
| **依赖** | parse_ast / tree-sitter | 无 | 文件路径列表 |
| **语言支持** | TS/JS/TSX/JSX | 通用（正则） | 通用（启发式） |
| **典型模式** | 接口设计、类型抽象 | TODO 分布、import 统计 | 目录结构、命名约定 |
| **置信度计算** | AST 节点类型 + 深度 | 命中频率 + 规则权重 | 统计显著性 + 样本量 |

### 5.5 PatternValidator — 默认校验器实现

```typescript
/**
 * PatternValidator —— 默认模式校验器。
 *
 * 多级校验策略（P10 多级校验器模式）：
 *   1. 结构校验：必需字段存在、类型正确
 *   2. 语义校验：非空、合理长度、格式规范
 *   3. 引用校验：references 中的 ID 无自引用
 *   4. 置信度校验：[0, 1] 范围检查
 */
export class PatternValidator implements IPatternValidator {
  validate(pattern: PatternDefinition): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // 1. 结构校验
    if (!pattern.id) {
      errors.push({ field: "id", message: "id is required", severity: "error" });
    }
    if (!pattern.name) {
      errors.push({ field: "name", message: "name is required", severity: "error" });
    }
    if (!Object.values(PatternKind).includes(pattern.kind)) {
      errors.push({ field: "kind", message: `Invalid kind: ${pattern.kind}`, severity: "error" });
    }

    // 2. 语义校验
    if (pattern.name.length > 120) {
      warnings.push(`name too long (${pattern.name.length} chars, max 120)`);
    }
    if (pattern.body.rules.length === 0) {
      warnings.push("body.rules is empty — pattern may be incomplete");
    }

    // 3. 置信度校验
    if (pattern.confidence < 0 || pattern.confidence > 1) {
      errors.push({
        field: "confidence",
        message: `confidence must be in [0,1], got ${pattern.confidence}`,
        severity: "error",
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  validateMany(patterns: PatternDefinition[]): ValidationResult[] {
    return patterns.map((p) => this.validate(p));
  }
}
```

### 5.6 PatternMerger — 默认归并器实现

```typescript
/**
 * PatternMerger —— 默认模式归并器。
 *
 * 归并策略：
 * - 基于 name + tags 计算 Jaccard 相似度
 * - 相似度 ≥ threshold 的合并为一条
 * - 保留 confidence 更高的 PatternDefinition
 * - 合并 body.rules 去重（Set）
 * - 合并 elements 去重（按 name+type 判重）
 *
 * Jaccard 相似度 = |A ∩ B| / |A ∪ B|
 * A = new Set(patternA.tags), B = new Set(patternB.tags)
 */
export class PatternMerger implements IPatternMerger {
  merge(patterns: PatternDefinition[], threshold = 0.8): PatternDefinition[] {
    // 1. 遍历 patterns，两两计算 Jaccard 相似度
    // 2. 若相似度 ≥ threshold，合并
    // 3. 合并策略：保留高 confidence 的，body.rules 去重追加
    // 4. 返回归并后的列表
    throw new Error("Not implemented — see implementation plan §5.6");
  }
}
```

---

## 6. 编排层（Orchestration Layer）

### 6.1 PatternExtractorRegistry — 提取器注册表

中央注册中心，管理所有 `IPatternExtractor` 实例的注册、发现和查询。

**设计原则**（承袭母项目的注册表模式）:

| 母项目注册表 | 定位 | 本包对应 |
|------------|------|---------|
| `AgentFactoryRegistry` | Agent 工厂注册与发现 | `PatternExtractorRegistry` — 提取器注册与发现 |
| `SkillRegistry` | 技能模板注册与查询 | 模式→技能转化不在此层，Registry 仅管理提取器 |
| `AGENT_REGISTRY` 声明式数组 | 声明式注册 | `ExtractorFactoryOptions.extractors` 注入式注册 |

```typescript
/**
 * PatternExtractorRegistry —— 模式提取器注册中心。
 *
 * 职责：
 * - register():      注册提取器实例
 * - unregister():    注销提取器
 * - queryByTags():   按标签查询匹配的提取器
 * - queryByLanguageAndKind(): 按语言+种类查询匹配的提取器
 * - get():           按 name 获取单个提取器
 * - list():          列出所有已注册提取器
 *
 * 设计动机（与 AgentFactoryRegistry 同构）：
 * 新增提取器只需 register() 一次，消费方通过 queryBy* 动态发现，
 * 无需修改已有代码或 switch 分支。
 */
export class PatternExtractorRegistry {
  private _byName: Map<string, IPatternExtractor> = new Map();
  private _byLanguage: Map<string, Set<string>> = new Map(); // language → names
  private _byKind: Map<PatternKind, Set<string>> = new Map(); // kind → names

  // ── 注册 / 注销 ──

  /** 注册一个提取器。同 name 覆盖旧实例 */
  register(extractor: IPatternExtractor): void {
    // 先注销同名旧实例（清理索引）
    if (this._byName.has(extractor.name)) {
      this.unregister(extractor.name);
    }

    this._byName.set(extractor.name, extractor);

    // 按语言索引
    for (const lang of extractor.supportedLanguages) {
      const names = this._byLanguage.get(lang) ?? new Set();
      names.add(extractor.name);
      this._byLanguage.set(lang, names);
    }

    // 按种类索引
    for (const kind of extractor.supportedKinds) {
      const names = this._byKind.get(kind) ?? new Set();
      names.add(extractor.name);
      this._byKind.set(kind, names);
    }
  }

  /** 批量注册 */
  registerAll(extractors: IPatternExtractor[]): void {
    for (const ext of extractors) {
      this.register(ext);
    }
  }

  /** 注销提取器。返回是否实际注销 */
  unregister(name: string): boolean {
    const extractor = this._byName.get(name);
    if (!extractor) return false;

    this._byName.delete(name);

    // 从语言索引移除
    for (const [, names] of this._byLanguage) {
      names.delete(name);
    }

    // 从种类索引移除
    for (const [, names] of this._byKind) {
      names.delete(name);
    }

    return true;
  }

  // ── 查询 ──

  /**
   * 按标签查询匹配的提取器。
   * 匹配规则：提取器的 supportedLanguages 含 tag 语言或 "*"
   */
  queryByTags(tags: string[]): IPatternExtractor[] {
    const matched = new Set<IPatternExtractor>();
    for (const tag of tags) {
      // 先按语言匹配
      const byLang = this._byLanguage.get(tag);
      if (byLang) {
        for (const name of byLang) {
          const ext = this._byName.get(name);
          if (ext) matched.add(ext);
        }
      }
      // 通用语言匹配
      const universal = this._byLanguage.get("*");
      if (universal) {
        for (const name of universal) {
          const ext = this._byName.get(name);
          if (ext) matched.add(ext);
        }
      }
    }
    return [...matched];
  }

  /** 按语言+模式种类查询 */
  queryByLanguageAndKind(
    language: string,
    kind: PatternKind,
  ): IPatternExtractor[] {
    const langNames = this._byLanguage.get(language)
      ?? this._byLanguage.get("*")
      ?? new Set();
    const kindNames = this._byKind.get(kind) ?? new Set();

    // 取交集
    const matchedNames = [...langNames].filter((n) => kindNames.has(n));
    return matchedNames
      .map((n) => this._byName.get(n))
      .filter((e): e is IPatternExtractor => e !== undefined);
  }

  // ── 获取 / 列出 ──

  /** 按名称获取提取器 */
  get(name: string): IPatternExtractor | undefined {
    return this._byName.get(name);
  }

  /** 列出所有已注册提取器 */
  list(): IPatternExtractor[] {
    return [...this._byName.values()];
  }

  /** 已注册提取器数量 */
  get size(): number {
    return this._byName.size;
  }

  /** 清空注册表 */
  clear(): void {
    this._byName.clear();
    this._byLanguage.clear();
    this._byKind.clear();
  }
}
```

### 6.2 PatternExtractorPipeline — 提取管线编排器

多阶段执行管线，串联提取→校验→归并→评分。

**设计原则**（与母项目 Dispatch Pipeline / PipelineRunner 同构）:

| 母项目管线 | 本包管线 |
|-----------|---------|
| `IDispatchStep` → `DispatchCtx` | `IPipelineStage` → `PipelineStageContext` |
| Claim → Spawn → Execute → Cleanup | Extract → Validate → Merge → Score |
| `PipelineRunner.run(ctx, steps)` | `PatternExtractorPipeline.run(ctx, stages)` |

```typescript
/**
 * PatternExtractorPipeline —— 模式提取管线编排器。
 *
 * 默认管线阶段：
 *   1. ExtractStage:   从输入文件提取裸模式
 *   2. ValidateStage:  校验模式字段完整性
 *   3. MergeStage:     去重归并相似模式
 *   4. ScoreStage:     按置信度评分排序
 *   5. FilterStage:    按 minConfidence / maxResults 过滤
 *
 * 消费者可注入自定义阶段（如：权重计算、标签补充、SkillTemplate 转换）。
 */
export class PatternExtractorPipeline {
  private stages: IPipelineStage[] = [];
  private registry: PatternExtractorRegistry;

  constructor(
    registry: PatternExtractorRegistry,
    stages?: IPipelineStage[],
  ) {
    this.registry = registry;
    if (stages && stages.length > 0) {
      this.stages = stages;
    } else {
      this.stages = this._defaultStages();
    }
  }

  /**
   * 执行完整提取管线。
   *
   * @param ctx - 提取上下文（含文件路径、语言、配置等）
   * @returns 提取结果
   */
  async run(ctx: ExtractionContext): Promise<ExtractionResult> {
    const startTime = Date.now();
    const diagnostics: string[] = [];

    try {
      // 构建初始管线上下文
      let pipelineCtx: PipelineStageContext = {
        patterns: [],
        diagnostics: [],
        metadata: { context: ctx },
      };

      // 顺序执行每个阶段
      for (const stage of this.stages) {
        pipelineCtx = await stage.run(pipelineCtx);
        diagnostics.push(...pipelineCtx.diagnostics);
      }

      return {
        success: true,
        patterns: pipelineCtx.patterns,
        diagnostics,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        patterns: [],
        diagnostics,
        durationMs: Date.now() - startTime,
        error: `Pipeline failed: ${(error as Error).message}`,
      };
    }
  }

  /** 添加自定义阶段 */
  addStage(stage: IPipelineStage): this {
    this.stages.push(stage);
    return this;
  }

  /** 构建默认阶段 */
  private _defaultStages(): IPipelineStage[] {
    return [
      new ExtractStage(this.registry),
      new ValidateStage(),
      new MergeStage(),
      new ScoreStage(),
      new FilterStage(),
    ];
  }
}
```

### 6.3 默认管线阶段实现

```typescript
/**
 * ExtractStage —— 提取阶段。
 *
 * 按 ExtractionContext 中的 language + targetKinds 从 Registry
 * 查询匹配的提取器，依次调用 extract()，收集所有模式。
 */
export class ExtractStage implements IPipelineStage {
  readonly name = "extract";
  private registry: PatternExtractorRegistry;

  constructor(registry: PatternExtractorRegistry) {
    this.registry = registry;
  }

  async run(ctx: PipelineStageContext): Promise<PipelineStageContext> {
    const extractionCtx = ctx.metadata.context as ExtractionContext;
    const allPatterns: PatternDefinition[] = [];
    const diagnostics: string[] = [];

    // 确定目标语言
    const languages = extractionCtx.language
      ? [extractionCtx.language]
      : ["*"];

    // 确定目标种类
    const kinds = extractionCtx.targetKinds ?? Object.values(PatternKind);

    // 查询匹配的提取器（去重）
    const extractors = new Set<IPatternExtractor>();
    for (const lang of languages) {
      for (const kind of kinds) {
        const matched = this.registry.queryByLanguageAndKind(lang, kind);
        for (const ext of matched) {
          extractors.add(ext);
        }
      }
    }

    if (extractors.size === 0) {
      diagnostics.push("No matching extractors found for language=" +
        `${extractionCtx.language}, kinds=${extractionCtx.targetKinds}`);
      return { ...ctx, diagnostics: [...ctx.diagnostics, ...diagnostics] };
    }

    diagnostics.push(`Found ${extractors.size} matching extractor(s)`);

    // 依次调用每个提取器
    for (const ext of extractors) {
      try {
        const result = ext.extract("", {}); // 输入由外部传递
        if (result.success) {
          allPatterns.push(...result.patterns);
          diagnostics.push(...result.diagnostics);
        } else {
          diagnostics.push(`[${ext.name}] Extract failed: ${result.error}`);
        }
      } catch (error) {
        diagnostics.push(`[${ext.name}] Extract threw: ${(error as Error).message}`);
      }
    }

    return {
      patterns: allPatterns,
      diagnostics: [...ctx.diagnostics, ...diagnostics],
      metadata: ctx.metadata,
    };
  }
}

/**
 * ValidateStage —— 校验阶段。
 */
export class ValidateStage implements IPipelineStage {
  readonly name = "validate";
  private validator: IPatternValidator;

  constructor(validator?: IPatternValidator) {
    this.validator = validator ?? new PatternValidator();
  }

  async run(ctx: PipelineStageContext): Promise<PipelineStageContext> {
    const validPatterns: PatternDefinition[] = [];
    const diagnostics: string[] = [];

    for (const pattern of ctx.patterns) {
      const result = this.validator.validate(pattern);
      if (result.valid) {
        validPatterns.push(pattern);
      } else {
        const errors = result.errors.map(
          (e) => `[${pattern.id}] ${e.field}: ${e.message}`,
        );
        diagnostics.push(...errors);
      }
      diagnostics.push(...result.warnings.map((w) => `[warn][${pattern.id}] ${w}`));
    }

    diagnostics.push(
      `Validation: ${validPatterns.length}/${ctx.patterns.length} patterns passed`,
    );

    return {
      patterns: validPatterns,
      diagnostics: [...ctx.diagnostics, ...diagnostics],
      metadata: ctx.metadata,
    };
  }
}

/**
 * MergeStage —— 归并阶段。
 */
export class MergeStage implements IPipelineStage {
  readonly name = "merge";
  private merger: IPatternMerger;

  constructor(merger?: IPatternMerger) {
    this.merger = merger ?? new PatternMerger();
  }

  async run(ctx: PipelineStageContext): Promise<PipelineStageContext> {
    const before = ctx.patterns.length;
    const merged = this.merger.merge(ctx.patterns);
    const diagnostics = [
      `Merge: ${merged.length}/${before} patterns after dedup`,
    ];

    return {
      patterns: merged,
      diagnostics: [...ctx.diagnostics, ...diagnostics],
      metadata: ctx.metadata,
    };
  }
}

/**
 * ScoreStage —— 评分阶段。
 * 按 confidence 降序排列，附加排名元信息。
 */
export class ScoreStage implements IPipelineStage {
  readonly name = "score";

  async run(ctx: PipelineStageContext): Promise<PipelineStageContext> {
    const sorted = [...ctx.patterns].sort(
      (a, b) => b.confidence - a.confidence,
    );
    // 附加排名
    const ranked = sorted.map((p, i) => ({
      ...p,
      weight: p.weight + (sorted.length - i), // 排名越高权重增量越大
    }));

    return {
      patterns: ranked,
      diagnostics: ctx.diagnostics,
      metadata: ctx.metadata,
    };
  }
}

/**
 * FilterStage —— 过滤阶段。
 * 按 minConfidence 和 maxResults 过滤。
 */
export class FilterStage implements IPipelineStage {
  readonly name = "filter";

  async run(ctx: PipelineStageContext): Promise<PipelineStageContext> {
    const extractionCtx = ctx.metadata.context as ExtractionContext;
    let patterns = ctx.patterns;

    // 按最小置信度过滤
    const minConfidence = extractionCtx.minConfidence ?? 0;
    if (minConfidence > 0) {
      const before = patterns.length;
      patterns = patterns.filter((p) => p.confidence >= minConfidence);
      ctx.diagnostics.push(
        `Filter: ${patterns.length}/${before} patterns passed minConfidence=${minConfidence}`,
      );
    }

    // 按最大数量截断
    const maxResults = extractionCtx.maxResults ?? 100;
    if (patterns.length > maxResults) {
      ctx.diagnostics.push(
        `Filter: truncated to ${maxResults} patterns (from ${patterns.length})`,
      );
      patterns = patterns.slice(0, maxResults);
    }

    return {
      patterns,
      diagnostics: ctx.diagnostics,
      metadata: ctx.metadata,
    };
  }
}
```

### 6.4 ExtractorFactory — 组合入口

```typescript
/**
 * ExtractorFactory —— 模式提取器的组合入口。
 *
 * 遵循 P03 — 工厂统一入口模式：
 * - 接收 ExtractorFactoryOptions 注入依赖
 * - 提供默认值回退（PatternValidator / PatternMerger）
 * - 自动构建注册表 + 管线
 * - 对外暴露简单的 execute() 方法
 *
 * @example
 * ```typescript
 * const factory = new ExtractorFactory({
 *   extractors: [
 *     new AstPatternExtractor(),
 *     new RegexPatternExtractor(),
 *     new HeuristicPatternExtractor(),
 *   ],
 *   validator: new PatternValidator(),
 *   merger: new PatternMerger(),
 * });
 *
 * const result = await factory.execute({
 *   filePaths: ["src/core/scheduler.ts"],
 *   language: "typescript",
 *   targetKinds: [PatternKind.Structural],
 *   minConfidence: 0.6,
 * });
 * ```
 */
export class ExtractorFactory {
  private registry: PatternExtractorRegistry;
  private pipeline: PatternExtractorPipeline;
  private options: Required<ExtractorFactoryOptions>;

  constructor(options: ExtractorFactoryOptions) {
    this.options = {
      extractors: options.extractors ?? [],
      validator: options.validator ?? new PatternValidator(),
      merger: options.merger ?? new PatternMerger(),
      pipelineStages: options.pipelineStages,
    };

    // 1. 构建注册表
    this.registry = new PatternExtractorRegistry();
    this.registry.registerAll(this.options.extractors);

    // 2. 构建管线
    const validateStage = new ValidateStage(this.options.validator);
    const mergeStage = new MergeStage(this.options.merger);
    const customStages = this.options.pipelineStages ?? [
      validateStage,
      mergeStage,
    ];
    this.pipeline = new PatternExtractorPipeline(this.registry, customStages);
  }

  /**
   * 执行完整的模式提取流程。
   * 消费方只需调用此方法，无需手动编排。
   *
   * @param ctx - 提取上下文
   * @returns 提取结果
   */
  async execute(ctx: ExtractionContext): Promise<ExtractionResult> {
    return this.pipeline.run(ctx);
  }

  /** 获取内部注册表引用（用于运行时注册新提取器） */
  getRegistry(): PatternExtractorRegistry {
    return this.registry;
  }

  /** 获取内部管线引用（用于动态添加自定义阶段） */
  getPipeline(): PatternExtractorPipeline {
    return this.pipeline;
  }
}

/**
 * ExtractorFactoryOptions —— 工厂配置选项。
 */
export interface ExtractorFactoryOptions {
  /** 注入的提取器列表（至少一个） */
  extractors?: IPatternExtractor[];
  /** 自定义校验器（默认 PatternValidator） */
  validator?: IPatternValidator;
  /** 自定义归并器（默认 PatternMerger） */
  merger?: IPatternMerger;
  /** 自定义管线阶段（默认 Extract → Validate → Merge → Score → Filter） */
  pipelineStages?: IPipelineStage[];
}
```

---

## 7. Registry 注册机制

### 7.1 注册机制总览

```
register(extractor)
  │
  ├─ _byName Map:       name → extractor          (名称查找)
  ├─ _byLanguage Map:   language → Set<name>      (语言索引)
  └─ _byKind Map:       kind → Set<name>          (种类索引)
        │
        ▼
queryByLanguageAndKind(lang, kind)
  ├─ langNames  = _byLanguage.get(lang) ?? _byLanguage.get("*")
  ├─ kindNames  = _byKind.get(kind)
  └─ 取交集 → 返回匹配的 extractor 列表
```

### 7.2 声明式注册方案

借鉴 `AGENT_REGISTRY` 声明式数组模式，pattern-extractor 提供两种注册方式：

**方式一：编程式注册**（运行时灵活注入）

```typescript
const registry = new PatternExtractorRegistry();
registry.register(new AstPatternExtractor());
registry.register(new RegexPatternExtractor());
registry.register(new HeuristicPatternExtractor());
```

**方式二：声明式注册数组**（编译时定义）

```typescript
// extractor-registry.ts — 单一起源
export const EXTRACTOR_REGISTRY: IPatternExtractor[] = [
  new AstPatternExtractor({
    extractTypes: true,
    extractFunctions: true,
    extractClasses: true,
  }),
  new RegexPatternExtractor({
    rules: DEFAULT_PATTERN_RULES,
    minHits: 3,
  }),
  new HeuristicPatternExtractor({
    minSampleSize: 5,
  }),
];
```

**方式三：自注册副作用导入**（与 Plugin register-all 模式同构）

```typescript
// index.ts — 桶导出
export { PatternExtractorRegistry } from "./registry.js";
export { ExtractorFactory } from "./extractor-factory.js";

// 副作用导入（触发 register-all.ts 中的自注册）
import "./register-all.js";
```

### 7.3 插件化集成

若提取器需要依赖 Engine 的其他组件（如 `IFileSystemAdapter`、`IPipelineObserver`），可通过 PluginContext 注入：

```typescript
// engine-plugin.ts — 引擎插件化集成
export class PatternExtractorPlugin implements EnginePlugin {
  readonly name = "pattern-extractor";
  readonly dependencies: string[] = [];

  async init(ctx: PluginContext): Promise<void> {
    const registry = new PatternExtractorRegistry();

    // 通过 PluginContext 获取文件系统适配器
    const fs = ctx.externals.fs;

    registry.register(new AstPatternExtractor());
    registry.register(new RegexPatternExtractor());
    registry.register(new HeuristicPatternExtractor());

    // 注册到 PluginContainer，供其他插件按名称获取
    // (ctx 的 get/set 机制由 PluginLoader 实现)
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  health(): PluginHealth { return "healthy"; }
}
```

---

## 8. 依赖注入策略

### 8.1 三层 DI 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    ③ 消费者层（Consumer Layer）                   │
│                                                                  │
│  LoopAgent / AnalysisAgent / InspectorAgent / CLI                │
│        │                                                         │
│        │  new ExtractorFactory({ extractors, validator, merger })│
│        ▼                                                         │
├─────────────────────────────────────────────────────────────────┤
│                    ② 工厂层（Factory Layer）                      │
│                                                                  │
│  ExtractorFactory                                                 │
│    ├─ 接收注入的 IPatternExtractor[]                              │
│    ├─ 接收注入的 IPatternValidator                               │
│    ├─ 接收注入的 IPatternMerger                                  │
│    └─ 接收注入的 IPipelineStage[]                                │
│        │                                                         │
│        │  构造函数注入                                            │
│        ▼                                                         │
├─────────────────────────────────────────────────────────────────┤
│                    ① 实现层（Implementation Layer）               │
│                                                                  │
│  AstPatternExtractor   RegexPatternExtractor   HeuristicPattern  │
│  (parse_ast 工具依赖)   (无外部依赖)           Extractor         │
│                                                  (文件路径依赖)   │
│                                                                  │
│  PatternValidator      PatternMerger           [自定义提取器]    │
│  (零依赖)              (零依赖)                (implements       │
│                                                  IPatternExtractor)│
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 注入策略细则

| 层次 | 注入方式 | 注入点 | 默认值 |
|------|---------|--------|--------|
| 提取器 | 构造函数注入 | `ExtractorFactoryOptions.extractors` | 空数组（需至少注入一个） |
| 校验器 | 构造函数注入 | `ExtractorFactoryOptions.validator` | `new PatternValidator()` |
| 归并器 | 构造函数注入 | `ExtractorFactoryOptions.merger` | `new PatternMerger()` |
| 管线阶段 | 构造函数注入 | `ExtractorFactoryOptions.pipelineStages` | 五阶段默认管线 |
| 提取器内部选项 | 构造函数注入 | `AstExtractorOptions` / `RegexExtractorOptions` / `HeuristicExtractorOptions` | 各变体内置默认值 |

### 8.3 与母项目 PluginContext 的集成

当 `@cortex/pattern-extractor` 作为 Engine 插件运行时，通过 PluginContext 获取依赖：

```typescript
// 场景：LoopAgent 在运行时需要动态获取提取器
const pluginCtx = /* PluginContext from PluginLoader */;

// 1. 从 PluginContainer 获取已初始化的 PatternExtractorRegistry
const registry = pluginCtx.get<PatternExtractorRegistry>("pattern-extractor");

// 2. 按语言+种类查询提取器
const extractors = registry.queryByLanguageAndKind("typescript", PatternKind.Structural);

// 3. 执行提取
for (const ext of extractors) {
  const result = ext.extract(sourceCode);
  if (result.success) {
    // 将 PatternDefinition 转换为 SkillTemplate
    for (const pattern of result.patterns) {
      const skill = convertPatternToSkill(pattern);
      skillRegistry.register(skill);
    }
  }
}
```

### 8.4 模块化宪法（昔涟 v2.6 入宪）

本包遵循 @cortex/shared 的 **模块化铁律**：

1. **类型层零依赖** — `types.ts` 不 import 任何运行时模块
2. **实现层在运行时接收依赖** — 提取器不直接 import `parse_ast`/`tree-sitter`，而是通过构造函数注入配置或外部工具引用
3. **工厂层组合但不依赖实现细节** — `ExtractorFactory` 面向 `IPatternExtractor` 接口编程
4. **导出层纯桶聚合** — `index.ts` 只做 `export`，不做 `import` 副作用

---

## 9. 数据流全景

### 9.1 完整提取链路

```
消费者 (LoopAgent / CLI / InspectorAgent)
    │
    │  new ExtractorFactory({ extractors, ... })
    ▼
┌──────────────────────────────────────────────────┐
│              ExtractorFactory                     │
│  execute(ctx: ExtractionContext)                  │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│          PatternExtractorPipeline                 │
│  run(ctx)                                         │
├──────────────────────────────────────────────────┤
│                                                    │
│  ┌─────────────┐                                  │
│  │ ExtractStage │  查询 Registry → 调用提取器     │
│  │              │  AstPatternExtractor.extract()   │
│  │              │  RegexPatternExtractor.extract() │
│  │              │  HeuristicPatternExtractor.extract()│
│  └──────┬──────┘                                  │
│         │ raw PatternDefinition[]                  │
│         ▼                                          │
│  ┌─────────────┐                                  │
│  │ValidateStage│  校验字段完整性 + 语义正确性     │
│  └──────┬──────┘                                  │
│         │ valid PatternDefinition[]                │
│         ▼                                          │
│  ┌─────────────┐                                  │
│  │ MergeStage   │  去重 + 相似度归并              │
│  └──────┬──────┘                                  │
│         │ merged PatternDefinition[]               │
│         ▼                                          │
│  ┌─────────────┐                                  │
│  │ ScoreStage   │  按 confidence 评分排序          │
│  └──────┬──────┘                                  │
│         │ scored PatternDefinition[]               │
│         ▼                                          │
│  ┌─────────────┐                                  │
│  │ FilterStage  │  按阈值过滤 + 截断               │
│  └──────┬──────┘                                  │
│         │ final PatternDefinition[]                │
│         ▼                                          │
└──────────────────────────────────────────────────┘
         │
         │ ExtractionResult { success, patterns, diagnostics }
         ▼
┌──────────────────────────────────────────────────┐
│               消费者处理结果                        │
│                                                    │
│  Option 1: 直接返回给 CLI 展示                      │
│  Option 2: 转换为 SkillTemplate → SkillRegistry    │
│  Option 3: 写入 MemoryStore 作为工程记忆            │
│  Option 4: MetaAgent 规划参考                       │
└──────────────────────────────────────────────────┘
```

### 9.2 错误传播策略

```
extract() 阶段
  ├─ 单个提取器失败 → 不阻断管线，诊断信息记录
  ├─ 所有提取器失败 → success: false, error: 汇总信息
  └─ 异常抛出 → 被管线 catch，转为 ExtractionResult.error

validate() 阶段
  ├─ 校验不通过 → 模式被过滤，诊断信息记录
  └─ 全部被过滤 → success: true, patterns: []

merge() 阶段
  └─ 归并异常 → 跳过归并，使用原始 patterns（降级）

score() + filter() 阶段
  └─ 纯函数运算，不抛出异常
```

### 9.3 事件集成（与 IPipelineObserver 的对接）

当作为 Engine 插件运行时，管线发射可观测事件：

| 事件点 | 事件类型 | Payload |
|--------|---------|---------|
| 提取开始 | `PatternExtractStart`（新增） | `{ filePaths, language, extractorCount }` |
| 提取阶段完成 | `PatternExtractDone`（新增） | `{ patternsFound, durationMs }` |
| 提取阶段失败 | `PatternExtractFailed`（新增） | `{ extractorName, error }` |
| 管线完成 | `PatternExtractPipelineDone`（新增） | `{ totalPatterns, totalDurationMs }` |

---

## 10. 文件组织方案

### 10.1 目录结构

```
packages/pattern-extractor/
├── package.json                    # 包元信息（name, version, deps）
├── tsconfig.json                   # 引用 tsconfig.src.json + tsconfig.test.json
├── tsconfig.src.json               # 编译配置 (extends ../../tsconfig.base.json)
├── tsconfig.test.json              # 测试配置
├── vitest.config.ts                # Vitest 配置
├── vitest.ci.config.ts             # CI 测试配置
│
├── src/
│   ├── index.ts                    # 桶导出（barrel）
│   │
│   ├── types.ts                    # ① 接口层：所有类型/接口/枚举
│   │   # PatternKind, PatternDefinition, PatternBody,
│   │   # PatternElement, PatternExample,
│   │   # IPatternExtractor, ExtractionContext,
│   │   # ExtractionResult, IPatternValidator, IPatternMerger,
│   │   # IPipelineStage, PipelineStageContext,
│   │   # ValidationResult, ValidationError, PatternRule,
│   │   # AstExtractorOptions, RegexExtractorOptions,
│   │   # HeuristicExtractorOptions, ExtractorFactoryOptions
│   │
│   ├── extractors/                 # ② 实现层：提取器变体
│   │   ├── ast-extractor.ts        # AstPatternExtractor
│   │   ├── regex-extractor.ts      # RegexPatternExtractor
│   │   └── heuristic-extractor.ts  # HeuristicPatternExtractor
│   │
│   ├── validators/                 # ② 实现层：校验器
│   │   └── pattern-validator.ts    # PatternValidator
│   │
│   ├── mergers/                    # ② 实现层：归并器
│   │   └── pattern-merger.ts       # PatternMerger
│   │
│   ├── stages/                     # ③ 编排层：管线阶段
│   │   ├── extract-stage.ts        # ExtractStage
│   │   ├── validate-stage.ts       # ValidateStage
│   │   ├── merge-stage.ts          # MergeStage
│   │   ├── score-stage.ts          # ScoreStage
│   │   └── filter-stage.ts         # FilterStage
│   │
│   ├── registry.ts                 # ③ 编排层：提取器注册表
│   │   # PatternExtractorRegistry
│   │
│   ├── pipeline.ts                 # ③ 编排层：管线编排器
│   │   # PatternExtractorPipeline
│   │
│   └── extractor-factory.ts        # ③ 编排层：组合入口
│       # ExtractorFactory
│
├── src/__tests__/                  # 测试目录
│   ├── types.test.ts               # 类型/接口/枚举一致性测试
│   ├── ast-extractor.test.ts       # AST 提取器单元测试
│   ├── regex-extractor.test.ts     # 正则提取器单元测试
│   ├── heuristic-extractor.test.ts # 启发式提取器单元测试
│   ├── pattern-validator.test.ts   # 校验器单元测试
│   ├── pattern-merger.test.ts      # 归并器单元测试
│   ├── registry.test.ts            # 注册表单元测试
│   ├── pipeline.test.ts            # 管线单元测试
│   ├── extractor-factory.test.ts   # 工厂集成测试
│   └── e2e.test.ts                 # 端到端测试
│
└── docs/                           # 设计文档
    ├── DESIGN.md                   # 本文件（设计文档）
    ├── patterns.md                 # 模式提炼（提取后更新）
    ├── govern.md                   # 治理审计
    ├── review.md                   # 代码审查
    ├── ops-check.md                # 运维就绪检查
    └── test-report.md              # 测试报告
```

### 10.2 桶导出（src/index.ts）

```typescript
// ============================================================
// @cortex/pattern-extractor —— 桶导出（Public API Surface）
//
// 遵循模块化铁律（昔涟 v2.6 入宪）：
// 1. 新增公开符号必须在本文件追加 export 语句
// 2. 测试文件禁止 ../src/ 相对导入——只用 @cortex/pattern-extractor 包名
// 3. 桶出口不变，引用方无感知
// ============================================================

// ── ① 接口层（类型 + 接口 + 枚举） ──
export {
  PatternKind,
  type PatternDefinition,
  type PatternBody,
  type PatternElement,
  type PatternExample,
  type IPatternExtractor,
  type ExtractionContext,
  type ExtractionResult,
  type IPatternValidator,
  type IPatternMerger,
  type IPipelineStage,
  type PipelineStageContext,
  type ValidationResult,
  type ValidationError,
  type PatternRule,
  type AstExtractorOptions,
  type RegexExtractorOptions,
  type HeuristicExtractorOptions,
  type ExtractorFactoryOptions,
} from "./types.js";

// ── ② 实现层（提取器变体） ──
export { AstPatternExtractor } from "./extractors/ast-extractor.js";
export { RegexPatternExtractor } from "./extractors/regex-extractor.js";
export { HeuristicPatternExtractor } from "./extractors/heuristic-extractor.js";

// ── ② 实现层（校验器 + 归并器） ──
export { PatternValidator } from "./validators/pattern-validator.js";
export { PatternMerger } from "./mergers/pattern-merger.js";

// ── ③ 编排层（管线阶段） ──
export { ExtractStage } from "./stages/extract-stage.js";
export { ValidateStage } from "./stages/validate-stage.js";
export { MergeStage } from "./stages/merge-stage.js";
export { ScoreStage } from "./stages/score-stage.js";
export { FilterStage } from "./stages/filter-stage.js";

// ── ③ 编排层（注册表 + 管线 + 工厂） ──
export { PatternExtractorRegistry } from "./registry.js";
export { PatternExtractorPipeline } from "./pipeline.js";
export { ExtractorFactory } from "./extractor-factory.js";

// ── 包锚点（用于自检） ──
export const PACKAGE_IDENTITY_ANCHOR =
  `[@cortex/pattern-extractor] 模式提取基础设施，版本 ${"0.1.0"}`;
```

---

## 11. 从母项目复用的架构模式

本包设计系统性地复用了母项目中经过验证的架构模式。下表映射每个模式的来源和本包中的对应。

### 11.1 架构模式复用矩阵

| 母项目模式 | 来源文件 | 本包映射 | 复用方式 |
|-----------|---------|---------|---------|
| **P01 — 分层四件套** | skill-kit docs/patterns.md | 类型层/实现层/工厂层/导出层 | 结构对齐 |
| **P02 — 接口契约优先** | skill-kit 全包 | `IPatternExtractor` → `AstPatternExtractor implements` | 模式复制 |
| **P03 — 工厂统一入口** | skill-kit factory.ts | `ExtractorFactory` | 结构对齐 |
| **P04 — Result 判别联合** | skill-kit types.ts | `ExtractionResult` | 模式复制 |
| **P06 — 注册表映射** | skill-kit loader.ts, engine agent-factory-registry.ts | `PatternExtractorRegistry` | 结构对齐 |
| **P08 — 管线执行器** | skill-kit executor.ts, engine dispatch-steps | `PatternExtractorPipeline` + `IPipelineStage` | 结构对齐 |
| **P10 — 多级校验器** | skill-kit validator.ts | `PatternValidator` (结构/语义/引用/置信度) | 模式复制 |
| **P12 — 设计文档先行** | skill-kit docs/design.md | 本文档 | 模板复用 |
| **AgentFactoryRegistry** | engine plugin/agent-factory-registry.ts | `PatternExtractorRegistry` | 代码风格 |
| **SkillRegistry** | engine registry/skill-registry.ts | `PatternExtractorRegistry` 的 register/unregister/query 三方法 | 代码风格 |
| **PluginContext DI** | engine plugin/types.ts | `ExtractorFactoryOptions` 构造函数注入 | 模式复制 |
| **AGENT_REGISTRY 声明式** | engine agents/registry.ts | `EXTRACTOR_REGISTRY` 声明式数组 | 代码风格 |
| **IFileSystemAdapter** | shared fs-adapter.ts | 提取器通过构造函数接收外部工具引用 | 接口解耦 |
| **模块化铁律（昔涟 v2.6）** | shared index.ts | index.ts 纯桶聚合 | 规则复制 |

### 11.2 关键设计决策

| 决策 ID | 决策 | 可选方案 | 选择理由 |
|:-------:|------|---------|---------|
| ADR-001 | 提取器接口使用泛型 `<TInput, TOptions>` | 固定 `(string, Record)` 签名 | 泛型更灵活，AstExtractor 可接受源码字符串，高级变体可接受 AST 节点 |
| ADR-002 | Pipeline 的 `IPipelineStage` 与 Dispatch Pipeline 的 `IDispatchStep` 同构 | 自创接口 | 降低学习成本，熟悉 engine 的开发者可快速上手 |
| ADR-003 | Registry 建立 `_byLanguage` + `_byKind` 双层索引 | 单层 `Map<tag, IPatternExtractor>` | 支持 queryByLanguageAndKind 交集查询，提高匹配精度 |
| ADR-004 | `ExtractorFactory` 不依赖 Engine 的 `PluginContext` | 强依赖 PluginContext | 保持包独立可测试，非 Engine 环境也可使用 |
| ADR-005 | 三种提取变体各有独立文件 | 全放在一个文件中 | 独立文件便于单元测试和后期扩展变体 |
| ADR-006 | `PatternDefinition` 与 `SkillTemplate` 分开定义 | 直接复用 SkillTemplate | 职责分离：模式提取≠技能沉淀，转换由消费方完成 |
| ADR-007 | 提取器不直接依赖 `tree-sitter` / `parse_ast` | 编译期强依赖 | 保持包轻量，解析工具由消费者注入或通过 CLI adapter 调用 |

---

## 12. 与现有系统的集成

### 12.1 与 @cortex/shared 的类型关系

```
PatternDefinition 中复用了 shared 的 Tag 类型：
  tags: string[]  ← 可与 SkillTemplate.triggerTags 双向映射

PatternExtractor 可通过 shared 的 IToolkit / IFileSystemAdapter
获取文件内容和路径信息（可选依赖，不强制）
```

### 12.2 与 @cortex/engine 的集成路径

```
集成方式一：Engine 插件
  PatternExtractorPlugin implements EnginePlugin
    → init() 时创建 Registry + Factory
    → 注册到 PluginContainer
    → LoopAgent 通过 PluginContext.get() 获取

集成方式二：直接依赖
  LoopAgent import { ExtractorFactory } from "@cortex/pattern-extractor"
    → 构造函数注入
    → 在 react-loop 中调用 execute()

集成方式三：SkillRegistry 前处理
  PatternDefinition → SkillTemplate 转换函数
    → 作为 pipeline 的自定义 stage 注入
    → 产出直接可注册到 SkillRegistry 的 SkillTemplate[]
```

### 12.3 与 @cortex/skill-kit 的集成

将 `PatternDefinition` 转换为 `SkillTemplate` 的转换器可作为 skill-kit 的可选增强：

```typescript
// skill-kit 的扩展（未来可选）
import { type PatternDefinition, PatternKind } from "@cortex/pattern-extractor";
import { type SkillTemplate, type SkillKind } from "@cortex/shared";

/**
 * 将 PatternDefinition 转换为 SkillTemplate。
 * 消费方（LoopAgent）在提取模式后调用此函数，将模式沉淀为技能。
 */
export function patternToSkill(pattern: PatternDefinition): SkillTemplate {
  const kindMap: Record<PatternKind, SkillKind> = {
    [PatternKind.Structural]: "action",
    [PatternKind.Behavioral]: "workflow",
    [PatternKind.Architectural]: "thought",
    [PatternKind.Dataflow]: "workflow",
    [PatternKind.Documentation]: "thought",
    [PatternKind.Naming]: "action",
  };

  return {
    id: `pattern-${pattern.id}`,
    kind: kindMap[pattern.kind] ?? "action",
    name: pattern.name,
    triggerTags: pattern.tags as any,
    trigger: pattern.description,
    steps: pattern.body.rules,
    expectedOutput: pattern.body.examples?.[0]?.code ?? "",
    outputFile: undefined,
    status: "trial",
    weight: Math.round(pattern.confidence * 10),
    feedbackHistory: [],
    discoveredBy: pattern.extractor,
    createdAt: pattern.extractedAt,
  };
}
```

### 12.4 与 PipelineObserver 的事件集成

当注册为 Engine 插件时，管线可向 `IPipelineObserver` 发射事件：

```typescript
// pattern-extractor-plugin.ts（未来实现）
export class PatternExtractorPlugin implements EnginePlugin {
  readonly name = "pattern-extractor";
  readonly dependencies = ["pipeline-observer"];

  private observer!: IPipelineObserver;

  async init(ctx: PluginContext): Promise<void> {
    this.observer = ctx.observer;
    // 注册提取器...
  }

  // 管线中发射事件
  private emitExtractEvent(patterns: PatternDefinition[]): void {
    this.observer.emit({
      type: "analysis" as PipelineEventType,
      priority: PipelinePriority.NORMAL,
      payload: { patterns: patterns.length },
      timestamp: Date.now(),
    });
  }
}
```

---

## 附录 A: 关键设计决策日志

| 决策 ID | 决策 | 选项 | 选择 | 理由 |
|:-------:|------|------|------|------|
| ADR-001 | 提取器泛型参数 | 固定类型 / 泛型 | 泛型 | AstExtractor 可接受 AST 节点，RegexExtractor 接受 string，灵活 |
| ADR-002 | Pipeline 接口设计 | 自创 / 复用 IStep | 自创 IPipelineStage | 上下文类型不同（PipelineCtx vs PipelineStageContext） |
| ADR-003 | Registry 索引策略 | 单层 / 双层 | 双层 (_byLanguage + _byKind) | 支持精确交集查询 |
| ADR-004 | Factory 依赖 PluginContext | 强依赖 / 可选 | 可选 | 保持包独立可测试 |
| ADR-005 | PatternDefinition 与 SkillTemplate | 合并 / 分开 | 分开 | 职责分离，转换由消费方完成 |
| ADR-006 | 提取器初始化方式 | 构造函数 / 工厂方法 | 构造函数 | 与 AgentFactory 同构，一致性 |
| ADR-007 | 置信度计算策略 | 提取器自评 / Pipeline 全局评分 | 提取器自评 + Pipeline 排序 | 各提取器有领域知识，Pipeline 做全局排序 |
| ADR-008 | 默认管线阶段数 | 3 / 5 / 7 | 5 | Extract→Validate→Merge→Score→Filter 覆盖完整流程 |
| ADR-009 | 是否支持自定义 PatternRule 加载 | 静态规则 / 动态 addRule | 静态 + 动态 | RegexExtractor 支持 addRule() 链式调用 |

---

## 附录 B: 提取器扩展指南

### B.1 如何新增一个提取器变体

```typescript
// 1. 实现 IPatternExtractor 接口
import {
  type IPatternExtractor,
  PatternKind,
  type PatternDefinition,
  type ExtractionResult,
} from "@cortex/pattern-extractor";

interface MyExtractorOptions {
  myParam?: string;
}

export class MyCustomExtractor
  implements IPatternExtractor<string, MyExtractorOptions>
{
  readonly name = "my-custom-extractor";
  readonly supportedLanguages = ["typescript"];
  readonly supportedKinds = [PatternKind.Structural];
  readonly description = "我的自定义提取器";

  extract(input: string, options?: MyExtractorOptions): ExtractionResult {
    // 实现提取逻辑...
  }

  canHandle(language: string, kind: PatternKind): boolean {
    return (
      this.supportedLanguages.includes(language) &&
      this.supportedKinds.includes(kind)
    );
  }
}

// 2. 注册到 Registry
registry.register(new MyCustomExtractor());

// 3. 或在 ExtractorFactory 中注入
const factory = new ExtractorFactory({
  extractors: [
    new AstPatternExtractor(),
    new MyCustomExtractor(),
  ],
});
```

### B.2 如何新增一个管线阶段

```typescript
import {
  type IPipelineStage,
  type PipelineStageContext,
} from "@cortex/pattern-extractor";

export class WeightAdjustStage implements IPipelineStage {
  readonly name = "weight-adjust";

  async run(ctx: PipelineStageContext): Promise<PipelineStageContext> {
    const adjusted = ctx.patterns.map((p) => ({
      ...p,
      // 根据模式种类的经验权重调节
      weight: p.weight + (p.kind === PatternKind.Architectural ? 2 : 0),
    }));

    return {
      patterns: adjusted,
      diagnostics: [
        ...ctx.diagnostics,
        `WeightAdjust: adjusted ${adjusted.length} patterns`,
      ],
      metadata: ctx.metadata,
    };
  }
}

// 注入到工厂
const factory = new ExtractorFactory({
  extractors: [new AstPatternExtractor()],
  pipelineStages: [
    new ExtractStage(registry),
    new ValidateStage(),
    new WeightAdjustStage(),  // 自定义阶段
    new ScoreStage(),
    new FilterStage(),
  ],
});
```

---

> **文档约定**:
> - 所有接口名以 `I` 开头（`IPatternExtractor`、`IPipelineStage`）
> - 上下文类型命名使用 `XxxContext` 后缀（`ExtractionContext`、`PipelineStageContext`）
> - 配置类型命名使用 `XxxOptions` 后缀（`AstExtractorOptions`、`ExtractorFactoryOptions`）
> - 步骤接口使用 `IXxx` 命名（`IPipelineStage`）与 engine 的 `IStep` / `IDispatchStep` 同族
> - 所有 Mermaid 图遵循纯字母+数字节点 ID 规范
> - 设计文档中的类型定义应与 `src/types.ts` 保持同步（可执行设计文档原则 P14）
