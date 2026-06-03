# @cortex/skill-kit — 设计文档

> **状态**: 初稿 · v0.1  
> **日期**: 2025-07-18  
> **作者**: Cortex Architecture Team  
> **对应**: Core-2 可执行技能系统 · 独立包设计

---

## 目录

1. [设计目标](#1-设计目标)
2. [包边界与依赖](#2-包边界与依赖)
3. [核心接口](#3-核心接口)
   - 3.1 [SkillDefinition](#31-skilldefinition)
   - 3.2 [PromptTemplate](#32-prompttemplate)
   - 3.3 [SkillExecutor](#33-skillexecutor)
4. [核心类设计](#4-核心类设计)
   - 4.1 [Loader](#41-loader)
   - 4.2 [Validator](#42-validator)
   - 4.3 [Cache](#43-cache)
   - 4.4 [Executor](#44-executor)
5. [数据流与生命周期](#5-数据流与生命周期)
6. [集成策略](#6-集成策略)
7. [可扩展性](#7-可扩展性)
8. [附录：与现有系统的关系](#8-附录与现有系统的关系)

---

## 1. 设计目标

### 1.1 解决的问题

当前 Cortex 引擎拥有两套技能系统：

| 系统 | 路径 | 现状 |
|------|------|------|
| JSON 技能模板 | `skills/*.json` → SkillRegistry | 只读模板，无执行能力 |
| 可执行技能 | `engine/src/registry/executable-skill/` | 内置于引擎，仅含 3 个 demo 技能，未接入主循环 |

**核心缺口**：缺乏一个**独立、可测试、可扩展**的技能包，让开发者可以：

1. 以代码（而非 JSON）定义可执行的技能
2. 在引擎外部独立开发、测试技能
3. 通过标准化接口将技能注入引擎
4. 享受缓存、校验、生命周期管理等基础设施

### 1.2 设计原则

- **单一职责**：每个类只做一件事，通过组合构建复杂行为
- **接口优先**：先定义契约，再实现细节
- **可测试**：核心逻辑不依赖引擎运行时，纯函数 + 依赖注入
- **渐进复杂**：20% 的接口覆盖 80% 的场景，高级功能通过扩展点暴露
- **与现有系统兼容**：不破坏已有的 JSON 技能模板体系，而是作为其补充

### 1.3 非目标

- ❌ 不取代 `SkillRegistry` / `SkillExecutor`（引擎内部实现）
- ❌ 不定义 Agent 运行时或 LLM 调用
- ❌ 不处理 MemoryStore 持久化（由上层 `skill-persister.ts` 负责）
- ✅ 提供**标准技能包**，可被引擎的 `SkillRegistry` 消费

---

## 2. 包边界与依赖

### 2.1 包信息

```jsonc
// package.json
{
  "name": "@cortex/skill-kit",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./loader": "./src/loader/index.ts",
    "./validator": "./src/validator/index.ts",
    "./cache": "./src/cache/index.ts",
    "./executor": "./src/executor/index.ts",
    "./interfaces": "./src/interfaces/index.ts"
  },
  "dependencies": {
    "@cortex/shared": "workspace:*"    // 仅依赖 SkillTemplate 等基础类型
  },
  "peerDependencies": {
    "zod": "^3.23"                     // 运行时校验（可选）
  }
}
```

### 2.2 依赖关系

```
┌─────────────────────────────────────────────┐
│                @cortex/skill-kit              │
│                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Loader   │  │Validator │  │  Cache   │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │              │              │         │
│  ┌────▼──────────────▼──────────────▼─────┐  │
│  │              Executor                   │  │
│  │  (编排 Loader → Validator → Cache →    │  │
│  │           SkillExecutor 执行)           │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │            Interfaces                    │  │
│  │  SkillDefinition  PromptTemplate        │  │
│  │  SkillExecutor    ExecutionContext       │  │
│  └─────────────────────────────────────────┘  │
└──────────────┬────────────────────────────────┘
               │ 依赖
               ▼
       ┌───────────────┐
       │ @cortex/shared │  (SkillTemplate, AgentType, 等基础类型)
       └───────────────┘
```

### 2.3 零外部依赖原则

核心接口和类**零外部运行时依赖**（除 `@cortex/shared` 外）。`zod` 作为可选 peer dependency，仅在需要运行时 schema 校验时引入。

---

## 3. 核心接口

### 3.1 SkillDefinition

技能定义的**核心契约**。一个 `SkillDefinition` 描述了一个技能的全部元数据、输入输出规范和执行入口。

```typescript
// src/interfaces/skill-definition.ts

import type { SkillTemplate } from '@cortex/shared';

/**
 * 技能执行上下文。
 * 包含技能执行时所需的全部环境信息。
 */
export interface ExecutionContext {
  /** 触发本次执行的 Agent 类型 */
  agentType: string;

  /** 触发标签列表 */
  triggerTags: string[];

  /** Agent 的 system prompt（可注入） */
  systemPrompt: string;

  /** 任务描述（由 MetaAgent 规划生成） */
  taskDescription: string;

  /** 工作目录 */
  cwd: string;

  /** 已收集的上下文文件列表 */
  contextFiles: string[];

  /** 可选的额外参数（由调用方传递） */
  params?: Record<string, unknown>;
}

/**
 * 技能执行结果。
 */
export interface ExecutionResult {
  /** 是否成功 */
  success: boolean;

  /** 执行后的输出数据 */
  output: unknown;

  /** 注入到 Agent system prompt 的文本（如有） */
  injectedContext?: string;

  /** 执行耗时（ms） */
  durationMs: number;

  /** 错误信息（失败时） */
  error?: string;

  /** 执行日志（调试用） */
  logs: string[];
}

/**
 * 技能定义 —— 一个可执行技能的所有元数据和行为。
 *
 * 这是 @cortex/skill-kit 的核心接口，替代 JSON-only 的 SkillTemplate，
 * 支持以代码形式定义可执行技能。
 */
export interface SkillDefinition {
  // ─── 元数据 ─────────────────────────────────────

  /** 唯一标识，格式: `skill-{namespace}-{name}` */
  readonly id: string;

  /** 人类可读名称 */
  readonly name: string;

  /** 详细描述 */
  readonly description: string;

  /** Agent 类型匹配列表 */
  readonly agentTypes: string[];

  /** 触发标签 */
  readonly triggerTags: string[];

  /** 技能版本（语义化版本） */
  readonly version: string;

  /** 作者 */
  readonly author?: string;

  // ─── 输入规范 ───────────────────────────────────

  /** 期望的输入参数 schema（JSON Schema 或 Zod Schema 描述） */
  readonly inputSchema?: Record<string, unknown>;

  /** 期望的上下文文件 glob 模式 */
  readonly requiredContextFiles?: string[];

  // ─── 生命周期钩子 ───────────────────────────────

  /** 技能初始化（在注册时调用，仅一次） */
  onInit?(): Promise<void>;

  /** 技能销毁（在移除时调用） */
  onDestroy?(): Promise<void>;

  // ─── 核心行为 ───────────────────────────────────

  /**
   * 校验输入是否合法。
   * 默认基于 inputSchema 校验，可重写。
   */
  validateInput?(input: unknown): Promise<boolean>;

  /**
   * 在匹配后被调用，生成要注入到 Agent system prompt 的上下文。
   * 返回 null 表示无需注入。
   */
  buildContext?(ctx: ExecutionContext): Promise<string | null>;

  /**
   * 执行技能主体逻辑。
   * 这是技能的核心行为。
   */
  execute(ctx: ExecutionContext): Promise<ExecutionResult>;
}
```

#### SkillDefinition 设计考量

| 决定 | 理由 |
|------|------|
| `onInit` / `onDestroy` 为可选钩子 | 简单技能无需生命周期管理 |
| `validateInput` 独立于 `execute` | 允许在 execute 前做快速失败校验 |
| `buildContext` 与 `execute` 分离 | 注入上下文和实际执行是两个独立阶段，MetaAgent 规划时只需前者 |
| `ExecutionContext` 包含完整环境 | 技能可在不依赖全局状态的情况下自包含运行 |
| `readonly id` | 技能 ID 一旦创建不可变更，保证注册表稳定性 |

### 3.2 PromptTemplate

提示模板 —— 将技能描述格式化为可注入到 Agent prompt 的文本。

```typescript
// src/interfaces/prompt-template.ts

/**
 * 模板变量。
 * 键为变量名，值为要替换的值。
 */
export interface TemplateVariables {
  [key: string]: string | number | boolean | string[];
}

/**
 * 提示模板 —— 将结构化数据渲染为自然语言提示文本。
 *
 * 用于将 SkillDefinition 格式化为可注入到 Agent system prompt
 * 的文本块，或生成 LLM 调用的 prompt 片段。
 */
export interface PromptTemplate {
  /** 模板唯一标识 */
  readonly id: string;

  /** 模板描述 */
  readonly description: string;

  /**
   * 模板内容。
   *
   * 支持 {{variable}} 语法进行变量插值。
   * 支持 {{#each list}}...{{/each}} 块级迭代。
   *
   * @example
   * ```
   * 你拥有以下技能：
   * {{#each skills}}
   * - {{name}}: {{description}}
   * {{/each}}
   * ```
   */
  readonly template: string;

  /**
   * 使用给定变量渲染模板。
   *
   * @param variables - 要注入的变量
   * @returns 渲染后的文本
   * @throws {TemplateRenderError} 当缺少必需变量或语法错误时
   */
  render(variables: TemplateVariables): string;

  /**
   * 列出模板中声明的所有变量名（不含块级标签）。
   */
  listVariables(): string[];

  /**
   * 校验给定变量集是否满足模板要求。
   */
  validateVariables(variables: TemplateVariables): boolean;
}

/**
 * 模板渲染错误。
 */
export class TemplateRenderError extends Error {
  constructor(
    message: string,
    public readonly templateId: string,
    public readonly missingVariables?: string[],
  ) {
    super(message);
    this.name = 'TemplateRenderError';
  }
}
```

#### PromptTemplate 设计考量

| 决定 | 理由 |
|------|------|
| 双方法 `render` + `validateVariables` | 先校验后渲染，避免运行时异常 |
| `listVariables` 自省能力 | 工具和编辑器可自动提示变量补全 |
| 自定义错误类型 | 上层可精确捕获模板错误，提供友好提示 |
| 模板语法参考 Mustache | 降低学习成本，与现有 prompt 模板风格一致 |

### 3.3 SkillExecutor

技能执行器的接口 —— 定义如何运行一个技能。

```typescript
// src/interfaces/skill-executor.ts

import type { SkillDefinition, ExecutionContext, ExecutionResult } from './skill-definition';

/**
 * 技能执行器 —— 负责执行单个 SkillDefinition 实例。
 *
 * 与 Executor 类的区别：
 * - SkillExecutor 是**单个技能**的执行接口
 * - Executor 类是**编排层**，管理多个技能的执行生命周期
 */
export interface SkillExecutor {
  /** 此执行器关联的技能 ID */
  readonly skillId: string;

  /**
   * 执行技能。
   *
   * 实现应处理以下生命周期：
   * 1. 校验输入（调用 skill.validateInput 或默认校验）
   * 2. 调用 skill.execute
   * 3. 捕获异常并格式化为 ExecutionResult
   * 4. 记录执行日志和耗时
   *
   * @param ctx - 执行上下文
   * @returns 执行结果
   */
  execute(ctx: ExecutionContext): Promise<ExecutionResult>;

  /**
   * 构建注入上下文（用于 MetaAgent 规划阶段）。
   * 这是 execute 的轻量版本，仅生成注入文本，不执行技能主体。
   *
   * @param ctx - 执行上下文
   * @returns 注入文本，或 null 表示无需注入
   */
  buildInjection(ctx: ExecutionContext): Promise<string | null>;

  /**
   * 校验输入是否合法。
   *
   * @param input - 要校验的输入
   * @returns true 如果输入合法
   */
  validate(input: unknown): Promise<boolean>;
}
```

#### 三个接口的关系

```
SkillDefinition          ← 技能"是什么"（数据 + 行为契约）
    │
    ▼ 由 SkillExecutor 包装
SkillExecutor            ← 技能"如何执行"（单个技能的执行接口）
    │
    ▼ 由 Executor 编排
Executor (class)         ← 技能"如何管理"（多个技能的加载/缓存/调度）
```

---

## 4. 核心类设计

### 4.1 Loader

负责从各种来源**加载**技能定义。

```typescript
// src/loader/loader.ts

import type { SkillDefinition } from '../interfaces/skill-definition';

/**
 * 技能加载器配置。
 */
export interface LoaderOptions {
  /** 是否递归搜索子目录 */
  recursive?: boolean;

  /** 要包含的文件 glob 模式（默认: ['**\/*.skill.ts', '**\/*.skill.js']） */
  includePatterns?: string[];

  /** 要排除的 glob 模式 */
  excludePatterns?: string[];

  /** 自定义文件扩展名映射到加载策略 */
  extensions?: Record<string, 'module' | 'json'>;
}

/**
 * 加载结果。
 */
export interface LoadResult {
  /** 成功加载的技能 */
  skills: SkillDefinition[];

  /** 加载失败的文件及其错误 */
  errors: { file: string; error: string }[];

  /** 加载耗时（ms） */
  durationMs: number;
}

/**
 * Loader —— 从文件系统、内存、远程等来源加载技能定义。
 *
 * 设计为可组合的加载管线：
 * ```
 * SourceReader(s) → SkillParser → SkillAdapter → SkillDefinition[]
 * ```
 */
export class Loader {
  private readonly readers: Map<string, SourceReader>;
  private readonly parsers: Map<string, SkillParser>;

  constructor(private options: LoaderOptions = {}) {
    this.readers = new Map();
    this.parsers = new Map();
    this.registerDefaultReaders();
    this.registerDefaultParsers();
  }

  // ─── 公开 API ───────────────────────────────────

  /**
   * 从文件系统加载技能。
   *
   * @param baseDir - 搜索的根目录
   * @returns 加载结果
   */
  async fromDirectory(baseDir: string): Promise<LoadResult> {
    // 1. 扫描文件（按 include/exclude 模式）
    // 2. 按扩展名分派到对应 SourceReader
    // 3. 每个文件通过 SkillParser 解析
    // 4. 将解析结果适配为 SkillDefinition
    // 5. 收集错误继续处理（不中断整体流程）
    throw new Error('Not implemented');
  }

  /**
   * 从单个文件加载技能。
   */
  async fromFile(filePath: string): Promise<SkillDefinition | null> {
    throw new Error('Not implemented');
  }

  /**
   * 从内存中的 skill 对象加载（用于测试或内存恢复）。
   */
  fromObject(skill: Record<string, unknown>): SkillDefinition {
    // 将普通对象适配为 SkillDefinition
    // 如果对象包含 execute 函数则保留，否则抛出
    throw new Error('Not implemented');
  }

  /**
   * 从 JSON 模板（SkillTemplate 格式）加载。
   * 提供与现有 skills/*.json 系统的向后兼容。
   */
  fromJsonTemplate(template: Record<string, unknown>): SkillDefinition {
    // 将 JSON SkillTemplate 适配为 SkillDefinition
    // 由于 JSON 模板无 execute 方法，生成一个默认执行器
    throw new Error('Not implemented');
  }

  // ─── 扩展点 ─────────────────────────────────────

  /**
   * 注册自定义源读取器。
   * 用于支持非文件系统来源（HTTP、数据库等）。
   */
  registerReader(extension: string, reader: SourceReader): void {
    this.readers.set(extension, reader);
  }

  /**
   * 注册自定义解析器。
   * 用于支持新的技能定义格式。
   */
  registerParser(format: string, parser: SkillParser): void {
    this.parsers.set(format, parser);
  }

  // ─── 内部方法 ───────────────────────────────────

  private registerDefaultReaders(): void {
    // .ts / .js → ModuleReader（动态 import）
    // .json → JsonReader（JSON.parse）
  }

  private registerDefaultParsers(): void {
    // 'module' → ModuleSkillParser（提取 exports）
    // 'json' → JsonSkillParser（适配为 SkillDefinition）
  }
}

/**
 * 源读取器 —— 读取原始技能数据。
 */
export interface SourceReader {
  read(path: string): Promise<string | Record<string, unknown>>;
}

/**
 * 技能解析器 —— 将原始数据解析为 SkillDefinition。
 */
export interface SkillParser {
  parse(data: string | Record<string, unknown>): SkillDefinition | SkillDefinition[];
}
```

#### Loader 设计考量

| 决定 | 理由 |
|------|------|
| `LoadResult` 含 `errors` 而非抛出 | 批量加载时部分失败不应中断整体流程 |
| Reader / Parser 分离 | 支持灵活组合：文件系统读 + JSON 解析、HTTP 读 + YAML 解析等 |
| `fromJsonTemplate` 桥接方法 | 确保与现有 `skills/*.json` 向后兼容 |
| 默认注册 `.ts/.js/.json` | 开箱即用，零配置加载常见格式 |

### 4.2 Validator

校验技能定义的正确性和完整性。

```typescript
// src/validator/validator.ts

import type { SkillDefinition } from '../interfaces/skill-definition';

/**
 * 校验级别。
 */
export type ValidationLevel = 'error' | 'warn' | 'info';

/**
 * 校验结果条目。
 */
export interface ValidationEntry {
  /** 级别 */
  level: ValidationLevel;

  /** 校验码（用于去重和文档） */
  code: string;

  /** 人类可读消息 */
  message: string;

  /** 关联的技能 ID */
  skillId: string;

  /** 关联的字段路径（如 'triggerTags'） */
  path?: string;

  /** 建议修复方案 */
  suggestion?: string;
}

/**
 * 校验结果。
 */
export interface ValidationResult {
  /** 是否通过（无 error 级别条目） */
  valid: boolean;

  /** 所有校验条目 */
  entries: ValidationEntry[];

  /** 错误数量 */
  errorCount: number;

  /** 警告数量 */
  warnCount: number;
}

/**
 * 校验规则 —— 单个可组合的校验逻辑。
 */
export interface ValidationRule {
  /** 规则唯一标识 */
  id: string;

  /** 规则描述 */
  description: string;

  /** 执行校验 */
  validate(skill: SkillDefinition): ValidationEntry[];
}

/**
 * Validator —— 技能定义校验器。
 *
 * 支持：
 * - 内置规则（必填字段、ID 格式、标签格式等）
 * - 自定义规则（通过 registerRule）
 * - 忽略特定规则（通过 options）
 */
export class Validator {
  private readonly rules: Map<string, ValidationRule> = new Map();

  constructor(private options: ValidatorOptions = {}) {
    this.registerBuiltinRules();
  }

  // ─── 公开 API ───────────────────────────────────

  /**
   * 校验单个技能定义。
   */
  validate(skill: SkillDefinition): ValidationResult {
    const entries: ValidationEntry[] = [];
    for (const [id, rule] of this.rules) {
      if (this.options.ignoredRules?.includes(id)) continue;
      entries.push(...rule.validate(skill));
    }
    return this.toResult(entries);
  }

  /**
   * 批量校验多个技能。
   */
  validateAll(skills: SkillDefinition[]): Map<string, ValidationResult> {
    const results = new Map<string, ValidationResult>();
    for (const skill of skills) {
      results.set(skill.id, this.validate(skill));
    }
    return results;
  }

  /**
   * 注册自定义校验规则。
   */
  registerRule(rule: ValidationRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * 移除校验规则。
   */
  unregisterRule(id: string): void {
    this.rules.delete(id);
  }

  // ─── 内置规则 ───────────────────────────────────

  private registerBuiltinRules(): void {
    this.rules.set('required-fields', new RequiredFieldsRule());
    this.rules.set('id-format', new IdFormatRule());
    this.rules.set('trigger-tags', new TriggerTagsRule());
    this.rules.set('agent-types', new AgentTypesRule());
    this.rules.set('version-format', new VersionFormatRule());
    this.rules.set('execute-exists', new ExecuteExistsRule());
    this.rules.set('no-side-effects-export', new NoSideEffectsExportRule());
    this.rules.set('context-file-exists', new ContextFileExistsRule());
  }

  private toResult(entries: ValidationEntry[]): ValidationResult {
    const errorCount = entries.filter(e => e.level === 'error').length;
    return {
      valid: errorCount === 0,
      entries,
      errorCount,
      warnCount: entries.filter(e => e.level === 'warn').length,
    };
  }
}

/**
 * Validator 配置选项。
 */
export interface ValidatorOptions {
  /** 要忽略的规则 ID 列表 */
  ignoredRules?: string[];

  /** 严格模式：warn 级别也视为不通过 */
  strictMode?: boolean;
}
```

#### 内置校验规则清单

| 规则 ID | 级别 | 校验内容 |
|---------|------|----------|
| `required-fields` | error | id, name, description, agentTypes, triggerTags, version, execute 必须存在 |
| `id-format` | error | id 格式必须匹配 `skill-[a-z0-9]+(-[a-z0-9]+)*` |
| `trigger-tags` | warn | triggerTags 长度 ≥ 1 |
| `agent-types` | warn | agentTypes 引用的类型应在已知 Agent 类型列表中 |
| `version-format` | error | version 必须符合 semver 格式 |
| `execute-exists` | error | execute 方法必须是函数 |
| `no-side-effects-export` | warn | 模块不应在顶层有副作用（如 `console.log`） |
| `context-file-exists` | warn | requiredContextFiles 引用的 glob 在项目中是否匹配到文件 |

### 4.3 Cache

技能编译/解析结果的缓存层。

```typescript
// src/cache/cache.ts

import type { SkillDefinition } from '../interfaces/skill-definition';

/**
 * 缓存条目元数据。
 */
interface CacheEntryMeta {
  /** 缓存时间戳 */
  cachedAt: number;

  /** 文件修改时间（用于文件来源的缓存失效） */
  mtimeMs?: number;

  /** 访问次数 */
  hitCount: number;

  /** 最后访问时间 */
  lastAccessed: number;
}

/**
 * 缓存条目。
 */
interface CacheEntry<T> {
  value: T;
  meta: CacheEntryMeta;
}

/**
 * 缓存策略。
 */
export type CacheStrategy = 'lru' | 'fifo' | 'ttl';

/**
 * 缓存配置。
 */
export interface CacheOptions {
  /** 最大条目数（默认 100） */
  maxSize?: number;

  /** 缓存策略（默认 'lru'） */
  strategy?: CacheStrategy;

  /** TTL 毫秒（仅 strategy='ttl' 时生效，默认 5 分钟） */
  ttlMs?: number;

  /** 是否在启动时预加载所有已注册技能 */
  preload?: boolean;
}

/**
 * Cache —— 技能编译/解析结果缓存。
 *
 * 职责：
 * 1. 缓存已加载的 SkillDefinition（避免重复加载）
 * 2. 缓存校验结果（避免重复校验）
 * 3. 缓存模板渲染结果（避免重复渲染）
 * 4. LRU 淘汰 + TTL 过期
 */
export class Cache {
  private readonly defs: Map<string, CacheEntry<SkillDefinition>> = new Map();
  private readonly validations: Map<string, CacheEntry<ValidationResult>> = new Map();
  private readonly renders: Map<string, CacheEntry<string>> = new Map();

  constructor(private options: CacheOptions = {}) {
    this.options = {
      maxSize: 100,
      strategy: 'lru',
      ttlMs: 5 * 60 * 1000,
      ...options,
    };
  }

  // ─── SkillDefinition 缓存 ──────────────────────

  /** 根据技能 ID 获取缓存的 SkillDefinition */
  getDefinition(skillId: string): SkillDefinition | undefined {
    return this.get(this.defs, skillId)?.value;
  }

  /** 缓存 SkillDefinition */
  setDefinition(skill: SkillDefinition): void {
    this.set(this.defs, skill.id, skill);
  }

  /** 从缓存中移除技能 */
  evictDefinition(skillId: string): void {
    this.defs.delete(skillId);
  }

  // ─── Validation 缓存 ───────────────────────────

  /** 获取缓存的校验结果 */
  getValidation(skillId: string): ValidationResult | undefined {
    return this.get(this.validations, skillId)?.value;
  }

  /** 缓存校验结果 */
  setValidation(skillId: string, result: ValidationResult): void {
    this.set(this.validations, skillId, result);
  }

  // ─── Template Render 缓存 ──────────────────────

  /** 获取缓存的渲染结果 */
  getRender(cacheKey: string): string | undefined {
    return this.get(this.renders, cacheKey)?.value;
  }

  /** 缓存渲染结果 */
  setRender(cacheKey: string, rendered: string): void {
    this.set(this.renders, cacheKey, rendered);
  }

  // ─── 缓存管理 ───────────────────────────────────

  /** 清空所有缓存 */
  clear(): void {
    this.defs.clear();
    this.validations.clear();
    this.renders.clear();
  }

  /** 当前缓存统计 */
  stats(): CacheStats {
    return {
      definitions: this.defs.size,
      validations: this.validations.size,
      renders: this.renders.size,
      maxSize: this.options.maxSize!,
    };
  }

  // ─── 内部方法 ───────────────────────────────────

  private get<T>(map: Map<string, CacheEntry<T>>, key: string): CacheEntry<T> | undefined {
    const entry = map.get(key);
    if (!entry) return undefined;

    // TTL 检查
    if (this.options.strategy === 'ttl') {
      const age = Date.now() - entry.meta.cachedAt;
      if (age > this.options.ttlMs!) {
        map.delete(key);
        return undefined;
      }
    }

    entry.meta.hitCount++;
    entry.meta.lastAccessed = Date.now();
    return entry;
  }

  private set<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
    // 淘汰检查
    if (map.size >= this.options.maxSize!) {
      this.evictOne(map);
    }

    map.set(key, {
      value,
      meta: {
        cachedAt: Date.now(),
        hitCount: 0,
        lastAccessed: Date.now(),
      },
    });
  }

  private evictOne<T>(map: Map<string, CacheEntry<T>>): void {
    // LRU 策略：淘汰最久未访问的条目
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of map) {
      if (entry.meta.lastAccessed < oldestTime) {
        oldestTime = entry.meta.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) map.delete(oldestKey);
  }
}

/**
 * 缓存统计。
 */
export interface CacheStats {
  definitions: number;
  validations: number;
  renders: number;
  maxSize: number;
}
```

#### Cache 设计考量

| 决定 | 理由 |
|------|------|
| 三层独立缓存 | 定义/校验/渲染的缓存生命周期不同，混在一起管理混乱 |
| TTL + LRU 双策略 | 适应不同场景：长时间运行选 LRU，资源敏感选 TTL |
| `evictDefinition` 公开 | 当技能文件变更时，外部可主动通知缓存失效 |
| `CacheStats` 可观测 | 运维时可查询缓存命中率（需额外扩展） |

### 4.4 Executor

技能编排器 —— 协调 Loader、Validator、Cache 和 SkillExecutor 完成技能完整生命周期。

```typescript
// src/executor/executor.ts

import type { SkillDefinition, ExecutionContext, ExecutionResult } from '../interfaces/skill-definition';
import type { SkillExecutor } from '../interfaces/skill-executor';
import type { LoadResult } from '../loader/loader';
import type { ValidationResult } from '../validator/validator';
import { Loader } from '../loader/loader';
import { Validator } from '../validator/validator';
import { Cache } from '../cache/cache';

/**
 * Executor 事件。
 */
export type ExecutorEvent =
  | 'skill:loaded'
  | 'skill:validated'
  | 'skill:executing'
  | 'skill:executed'
  | 'skill:failed'
  | 'cache:hit'
  | 'cache:miss';

/**
 * 事件监听器。
 */
export type ExecutorEventListener = (event: ExecutorEvent, data: unknown) => void;

/**
 * Executor 配置。
 */
export interface ExecutorOptions {
  /** Loader 配置 */
  loader?: LoaderOptions;

  /** Validator 配置 */
  validator?: ValidatorOptions;

  /** Cache 配置 */
  cache?: CacheOptions;

  /** 是否在技能执行前自动校验 */
  autoValidate?: boolean;

  /** 是否启用缓存 */
  enableCache?: boolean;
}

/**
 * Executor —— 技能编排器。
 *
 * 职责：
 * 1. 加载技能（委托 Loader）
 * 2. 校验技能（委托 Validator）
 * 3. 缓存技能（委托 Cache）
 * 4. 执行技能（委托 SkillExecutor）
 * 5. 事件发布（供上层监听执行生命周期）
 *
 * 使用示例：
 * ```typescript
 * const executor = new Executor({ autoValidate: true, enableCache: true });
 *
 * // 加载技能
 * const result = await executor.loadFromDirectory('./skills');
 *
 * // 执行匹配的技能
 * const ctx = createContext({ agentType: 'code', triggerTags: ['refactor'] });
 * const output = await executor.executeMatching(ctx);
 * ```
 */
export class Executor {
  private readonly loader: Loader;
  private readonly validator: Validator;
  private readonly cache: Cache;
  private readonly skills: Map<string, SkillDefinition> = new Map();
  private readonly executors: Map<string, SkillExecutor> = new Map();
  private readonly listeners: Set<ExecutorEventListener> = new Set();

  constructor(private options: ExecutorOptions = {}) {
    this.loader = new Loader(options.loader);
    this.validator = new Validator(options.validator);
    this.cache = new Cache(options.cache);
  }

  // ─── 加载 ──────────────────────────────────────

  /**
   * 从目录加载所有技能。
   * 加载后自动执行 validate（如果 autoValidate 开启）。
   */
  async loadFromDirectory(baseDir: string): Promise<LoadResult> {
    const result = await this.loader.fromDirectory(baseDir);

    for (const skill of result.skills) {
      await this.registerSkill(skill);
      this.emit('skill:loaded', { skillId: skill.id });
    }

    if (this.options.autoValidate) {
      for (const skill of result.skills) {
        const validation = this.validateSkill(skill.id);
        if (validation && !validation.valid) {
          // 仅发出事件，不阻止注册
          this.emit('skill:validated', { skillId: skill.id, result: validation });
        }
      }
    }

    return result;
  }

  /**
   * 从单个文件加载技能。
   */
  async loadFromFile(filePath: string): Promise<SkillDefinition | null> {
    const skill = await this.loader.fromFile(filePath);
    if (skill) {
      await this.registerSkill(skill);
      this.emit('skill:loaded', { skillId: skill.id });
    }
    return skill;
  }

  // ─── 执行 ──────────────────────────────────────

  /**
   * 执行指定技能。
   *
   * @param skillId - 技能 ID
   * @param ctx - 执行上下文
   * @returns 执行结果
   */
  async execute(skillId: string, ctx: ExecutionContext): Promise<ExecutionResult> {
    const executor = this.executors.get(skillId);
    if (!executor) {
      return {
        success: false,
        output: null,
        durationMs: 0,
        error: `技能 "${skillId}" 未注册`,
        logs: [],
      };
    }

    this.emit('skill:executing', { skillId, ctx });

    const start = performance.now();
    try {
      // 缓存检查
      if (this.options.enableCache) {
        const cached = this.cache.getDefinition(skillId);
        if (cached) {
          this.emit('cache:hit', { skillId });
        } else {
          this.emit('cache:miss', { skillId });
        }
      }

      const result = await executor.execute(ctx);
      const elapsed = performance.now() - start;

      const finalResult: ExecutionResult = {
        ...result,
        durationMs: Math.round(elapsed),
      };

      this.emit(result.success ? 'skill:executed' : 'skill:failed', {
        skillId,
        result: finalResult,
      });

      return finalResult;
    } catch (err) {
      const elapsed = performance.now() - start;
      const errorResult: ExecutionResult = {
        success: false,
        output: null,
        durationMs: Math.round(elapsed),
        error: err instanceof Error ? err.message : String(err),
        logs: [],
      };

      this.emit('skill:failed', { skillId, result: errorResult, error: err });
      return errorResult;
    }
  }

  /**
   * 根据标签匹配并执行技能。
   * 返回所有匹配技能的执行结果。
   *
   * @param ctx - 执行上下文
   * @returns 执行结果数组
   */
  async executeMatching(ctx: ExecutionContext): Promise<ExecutionResult[]> {
    const matched = this.matchByTags(ctx.triggerTags);
    const results: ExecutionResult[] = [];

    for (const skill of matched) {
      const result = await this.execute(skill.id, ctx);
      results.push(result);
    }

    return results;
  }

  // ─── 查询 ──────────────────────────────────────

  /**
   * 根据标签匹配技能。
   * 交集匹配：技能的 triggerTags 与查询标签至少有一个交集。
   */
  matchByTags(tags: string[]): SkillDefinition[] {
    const matched: SkillDefinition[] = [];
    for (const skill of this.skills.values()) {
      if (skill.triggerTags.some(t => tags.includes(t))) {
        matched.push(skill);
      }
    }
    return matched;
  }

  /**
   * 根据 Agent 类型匹配技能。
   */
  matchByAgentType(agentType: string): SkillDefinition[] {
    return Array.from(this.skills.values()).filter(s =>
      s.agentTypes.includes(agentType),
    );
  }

  /**
   * 获取已注册的全部技能。
   */
  listSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  // ─── 校验 ──────────────────────────────────────

  /**
   * 校验指定技能。
   */
  validateSkill(skillId: string): ValidationResult | null {
    const skill = this.skills.get(skillId);
    if (!skill) return null;

    // 缓存检查
    if (this.options.enableCache) {
      const cached = this.cache.getValidation(skillId);
      if (cached) return cached;
    }

    const result = this.validator.validate(skill);

    if (this.options.enableCache) {
      this.cache.setValidation(skillId, result);
    }

    return result;
  }

  /**
   * 校验所有已注册技能。
   */
  validateAll(): Map<string, ValidationResult> {
    return this.validator.validateAll(Array.from(this.skills.values()));
  }

  // ─── 生命周期管理 ──────────────────────────────

  /**
   * 移除技能并调用 onDestroy。
   */
  async unregister(skillId: string): Promise<boolean> {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    if (skill.onDestroy) {
      await skill.onDestroy();
    }

    this.skills.delete(skillId);
    this.executors.delete(skillId);
    this.cache.evictDefinition(skillId);
    return true;
  }

  /**
   * 清空所有技能。
   */
  async clear(): Promise<void> {
    for (const [id] of this.skills) {
      await this.unregister(id);
    }
    this.cache.clear();
  }

  // ─── 事件系统 ──────────────────────────────────

  /**
   * 注册事件监听器。
   */
  on(listener: ExecutorEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 移除事件监听器。
   */
  off(listener: ExecutorEventListener): void {
    this.listeners.delete(listener);
  }

  // ─── 内部方法 ──────────────────────────────────

  private async registerSkill(skill: SkillDefinition): Promise<void> {
    this.skills.set(skill.id, skill);

    // 调用 onInit 钩子
    if (skill.onInit) {
      await skill.onInit();
    }

    // 创建并注册默认 SkillExecutor
    this.executors.set(skill.id, new DefaultSkillExecutor(skill));

    // 写入缓存
    if (this.options.enableCache) {
      this.cache.setDefinition(skill);
    }
  }

  private emit(event: ExecutorEvent, data: unknown): void {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch {
        // 监听器异常不应影响主流程
      }
    }
  }
}

/**
 * 默认 SkillExecutor 实现。
 * 包装 SkillDefinition 为 SkillExecutor 接口。
 */
class DefaultSkillExecutor implements SkillExecutor {
  readonly skillId: string;

  constructor(private skill: SkillDefinition) {
    this.skillId = skill.id;
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    return this.skill.execute(ctx);
  }

  async buildInjection(ctx: ExecutionContext): Promise<string | null> {
    if (this.skill.buildContext) {
      return this.skill.buildContext(ctx);
    }
    return null;
  }

  async validate(input: unknown): Promise<boolean> {
    if (this.skill.validateInput) {
      return this.skill.validateInput(input);
    }
    return true;
  }
}
```

#### Executor 设计考量

| 决定 | 理由 |
|------|------|
| 事件系统（`on` / `off`） | 上层可监听执行生命周期，无需继承 Executor |
| `executeMatching` 批量执行 | 一次匹配多个技能并执行，适合 MetaAgent 规划阶段 |
| 异常隔离 | 单个技能执行失败不影响其他技能 |
| `DefaultSkillExecutor` 内部类 | 外部无需关心 SkillExecutor 实现细节 |

---

## 5. 数据流与生命周期

### 5.1 完整执行流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        Executor 编排层                           │
│                                                                 │
│  loadFromDirectory()                                            │
│      │                                                          │
│      ▼                                                          │
│  ┌─────────┐      ┌──────────┐      ┌──────────────┐          │
│  │ Loader   │─────▶│ Validator│─────▶│    Cache     │          │
│  │          │ 加载  │          │ 校验  │              │ 缓存     │
│  └─────────┘      └──────────┘      └──────────────┘          │
│      │                                                          │
│      ▼                                                          │
│  skills Map ← SkillDefinition[] (已注册)                        │
│      │                                                          │
│  executeMatching(ctx)                                           │
│      │                                                          │
│      ▼                                                          │
│  matchByTags(tags) ──→ 匹配的技能列表                           │
│      │                                                          │
│      ▼                                                          │
│  foreach matched skill:                                         │
│      │                                                          │
│      ├─ 1. Cache.getDefinition()  (缓存命中则跳过加载)          │
│      ├─ 2. Cache.getValidation()  (缓存命中则跳过校验)          │
│      ├─ 3. executor.buildInjection()  (生成注入上下文)          │
│      ├─ 4. executor.execute()          (执行技能主体)           │
│      └─ 5. emit('skill:executed')      (发布事件)              │
│                                                                 │
│  return ExecutionResult[]                                        │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 生命周期状态图

```
                ┌──────┐
                │ 注册  │  (onInit 调用)
                └──┬───┘
                   │
                   ▼
             ┌──────────┐
        ┌───▶│  就绪     │◀────────────┐
        │    │ (READY)   │              │
        │    └────┬─────┘              │
        │         │                    │
        │    execute()                 │
        │         │              re-register
        │         ▼                    │
        │    ┌──────────┐              │
        │    │ 执行中    │              │
        │    │ (RUNNING) │             │
        │    └────┬─────┘              │
        │         │                    │
        │    ┌────┴────┐               │
        │    ▼         ▼               │
        │ ┌──────┐ ┌──────┐            │
        │ │ 成功  │ │ 失败  │           │
        │ │ (OK)  │ │(FAIL) │           │
        │ └──────┘ └──────┘            │
        │                              │
        │    unregister()              │
        │         │                    │
        │         ▼                    │
        │    ┌──────────┐              │
        └────┤  已销毁   │ (onDestroy)  │
             │ (DESTROY)│             │
             └──────────┘              │
                  ▲                    │
                  └────────────────────┘
```

---

## 6. 集成策略

### 6.1 与引擎现有系统的集成

```
┌─────────────────────────────────────────────────────────┐
│                     Engine (packages/engine)              │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │            initSkillSystem()                      │   │
│  │                                                   │   │
│  │  1. 创建 SkillRegistry (三重索引)                  │   │
│  │  2. 创建 SkillExecutor (匹配/注入/反馈)            │   │
│  │  3. 从 MemoryStore 恢复技能                        │   │
│  │  4. ── 新增 ──────────────────────────           │   │
│  │     @cortex/skill-kit 作为技能来源之一              │   │
│  │     skillKit = new Executor()                     │   │
│  │     await skillKit.loadFromDirectory('./skills')  │   │
│  │     将 skillKit.listSkills() 注册到 SkillRegistry  │   │
│  │  5. 注册技能持久化管线                             │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │            SkillPipeline (持久化闭环)              │   │
│  │                                                   │   │
│  │  NodeComplete 事件                                 │   │
│  │      → 技能提取                                   │   │
│  │      → SkillRegistry.registerAll()                │   │
│  │      → persistSkillsToMemory()                    │   │
│  │      → (可选) crystallizeSkillToKnowledge()       │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 6.2 双轨策略

| 维度 | JSON 模板（已有） | @cortex/skill-kit（新增） |
|------|-------------------|--------------------------|
| 定义方式 | JSON 文件 | TypeScript 类/对象 |
| 可执行性 | ❌ 纯模板 | ✅ 可执行代码 |
| 适用场景 | 非开发者定义简单技能 | 开发者定义复杂技能 |
| 生命周期 | 无 | onInit / onDestroy |
| 输入校验 | JSON Schema 可选 | Zod / 自定义校验 |
| 缓存 | 无 | LRU + TTL |
| 测试 | 外部集成测试 | 单元测试 + 模拟执行 |

**共存策略**：`@cortex/skill-kit` 的 `Loader.fromJsonTemplate()` 方法可以将 JSON 模板适配为 `SkillDefinition`（使用默认执行器），因此现有 JSON 技能可以无缝迁移。引擎的 `initSkillSystem` 将同时支持两种来源。

---

## 7. 可扩展性

### 7.1 扩展点总览

| 扩展点 | 接口/基类 | 用途 |
|--------|----------|------|
| 自定义源读取器 | `SourceReader` | 从数据库、HTTP API、云存储加载技能 |
| 自定义解析器 | `SkillParser` | 支持 YAML、TOML、Markdown 等格式 |
| 自定义校验规则 | `ValidationRule` | 添加项目特定的校验逻辑 |
| 自定义缓存策略 | `CacheStrategy` | 替换默认 LRU 策略 |
| 自定义 SkillExecutor | `SkillExecutor` | 为特定技能定制执行行为 |
| 事件监听 | `ExecutorEventListener` | 监控、日志、指标收集 |

### 7.2 中间件支持（未来规划）

```typescript
// 预留中间件接口（v0.2 或 v1.0）

export interface ExecutorMiddleware {
  /** 中间件名称 */
  name: string;

  /**
   * 在技能执行前后执行。
   * 调用 next() 继续执行链。
   */
  execute(ctx: ExecutionContext, next: () => Promise<ExecutionResult>): Promise<ExecutionResult>;
}

// 使用示例：
// executor.use(new LoggingMiddleware());
// executor.use(new MetricsMiddleware());
// executor.use(new TimeoutMiddleware({ timeoutMs: 30000 }));
```

### 7.3 与 Zod 的集成

```typescript
// 可选集成（需安装 zod）

import { z } from 'zod';
import type { SkillDefinition } from '@cortex/skill-kit';

/**
 * 使用 Zod schema 定义技能输入的辅助函数。
 */
export function createSkillWithSchema<
  TInput extends z.ZodTypeAny,
>(
  skill: Omit<SkillDefinition, 'validateInput'>,
  schema: TInput,
): SkillDefinition {
  return {
    ...skill,
    validateInput: async (input: unknown): Promise<boolean> => {
      const result = schema.safeParse(input);
      return result.success;
    },
  };
}

// 使用示例：
// const mySkill = createSkillWithSchema({
//   id: 'skill-analyze-package',
//   name: '包分析器',
//   // ...
//   execute: async (ctx) => { /* ... */ },
// }, z.object({
//   packageName: z.string(),
//   includeDev: z.boolean().default(false),
// }));
```

---

## 8. 附录：与现有系统的关系

### 8.1 类型对应关系

| @cortex/shared (现有) | @cortex/skill-kit (新增) | 说明 |
|----------------------|-------------------------|------|
| `SkillTemplate` | `SkillDefinition` | 前者是纯 JSON 类型，后者是可执行接口 |
| `AgentType` | `ExecutionContext.agentType` | Agent 类型复用 |
| `SkillRegistry` | `Executor` 内部 `skills` Map | 前者是引擎内部实现，后者是独立包 |
| `SkillExecutor` (engine) | `SkillExecutor` (skill-kit) | 概念对齐，接口不同 |

### 8.2 迁移路径

```
阶段 1 (v0.1)  ──  @cortex/skill-kit 独立发布，含核心接口和类
                   引擎通过 npm 依赖引入

阶段 2 (v0.2)  ──  Loader.fromJsonTemplate() 桥接现有 JSON 技能
                   引擎 initSkillSystem 新增 @cortex/skill-kit 来源

阶段 3 (v1.0)  ──  引擎内部 SkillRegistry 可选替换为 @cortex/skill-kit
                   完整中间件支持
```

### 8.3 文件结构建议

```
packages/skill-kit/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                      # 公开 API 聚合导出
│   ├── interfaces/
│   │   ├── index.ts
│   │   ├── skill-definition.ts       # SkillDefinition, ExecutionContext, ExecutionResult
│   │   ├── prompt-template.ts        # PromptTemplate, TemplateVariables
│   │   └── skill-executor.ts         # SkillExecutor 接口
│   ├── loader/
│   │   ├── index.ts
│   │   ├── loader.ts                 # Loader 类
│   │   ├── readers/
│   │   │   ├── module-reader.ts      # .ts / .js 文件读取
│   │   │   └── json-reader.ts        # .json 文件读取
│   │   └── parsers/
│   │       ├── module-skill-parser.ts # 模块导出解析
│   │       └── json-skill-parser.ts   # JSON → SkillDefinition 适配
│   ├── validator/
│   │   ├── index.ts
│   │   ├── validator.ts              # Validator 类
│   │   └── rules/
│   │       ├── required-fields.ts
│   │       ├── id-format.ts
│   │       ├── trigger-tags.ts
│   │       ├── agent-types.ts
│   │       ├── version-format.ts
│   │       ├── execute-exists.ts
│   │       ├── no-side-effects-export.ts
│   │       └── context-file-exists.ts
│   ├── cache/
│   │   ├── index.ts
│   │   └── cache.ts                  # Cache 类
│   ├── executor/
│   │   ├── index.ts
│   │   ├── executor.ts               # Executor 类
│   │   └── default-executor.ts       # DefaultSkillExecutor
│   └── helpers/
│       ├── index.ts
│       ├── template-engine.ts        # {{variable}} 模板渲染引擎
│       └── schema-utils.ts           # Schema 校验工具函数
├── tests/
│   ├── loader.test.ts
│   ├── validator.test.ts
│   ├── cache.test.ts
│   ├── executor.test.ts
│   └── fixtures/
│       ├── valid-skill.ts
│       ├── invalid-skill.ts
│       └── json-template.json
└── docs/
    ├── design.md                     # ← 本文档
    ├── api.md
    └── migration-guide.md
```

---

> **文档版本**: v0.1  
> **更新日期**: 2025-07-18  
> **后续步骤**: 1) 评审设计 2) 实现核心接口 3) 实现 Loader 4) 实现 Validator 5) 实现 Cache 6) 实现 Executor 7) 编写单元测试 8) 集成到引擎
