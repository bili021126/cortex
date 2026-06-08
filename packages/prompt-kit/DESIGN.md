# @cortex/prompt-kit — 提示词工程工具包

**版本**: v0.1.0 (设计稿)  
**状态**: 设计阶段 — 待圆桌审议与开拓者裁决  
**来源**: 架构分析结论 — 纳西妲 (AnalysisAgent) 独立分析报告  
**宪法依据**: 原则三（安全边界在 Toolkit 调用层）、原则五（可观测事件走统一管道）、原则七·子约束8（硬编码禁令）

---

## 一、背景与动机

### 1.1 现状分析

Cortex 项目中提示词（Prompt）的加载、组装、渲染当前处于**无统一治理的分散状态**：

| 痛点 | 具体表现 | 影响范围 |
|------|---------|---------|
| **加载分散** | `loadAgentSystemPrompt()` 在 CLI `display.ts` 中以 80 行混合代码实现，直接 `fs.readFileSync` + `JSON.parse` | 所有 CLI 对话执行器 |
| **组装硬编码** | system prompt 拼接（身份锚点+persona+上下文+格式指令）分布在 chat/social/talk 三个 executor 中各写一套 | 可维护性差，修改需改三处 |
| **模板引擎错位** | `SimpleTemplateEngine` 在 `@cortex/skill-kit` 中仅为技能步骤服务，不支持 prompt 特有的块级组合、角色切换、条件注入 | 技能与提示词工具耦合 |
| **无校验** | 无法验证 prompt 是否包含必需段（身份声明、行为约束、输出格式），运行时缺失不报错 | 偶发 LLM 输出失控 |
| **无缓存** | 每次对话都重新读取文件、解析 JSON、拼接字符串 | 性能浪费 |
| **版本散落** | `PLANNING_SYSTEM`/`REPLAN_SYSTEM` 在 `@cortex/config` 常量中，persona 在 `prompts/` 目录，内联 prompt 在 `display.ts` | 版本溯源困难 |

### 1.2 设计目标

`@cortex/prompt-kit` 的目标是成为 Cortex 中**所有提示词相关操作的统一入口**，遵循 Cortex 宪法原则三（安全边界在工具调用层）和原则五（可观测事件走统一管道）。

| 目标 | 优先级 | 说明 |
|------|--------|------|
| **统一加载** | P0 | 所有 prompt 来源（文件系统/配置/内联）通过统一 API 加载 |
| **声明式组装** | P0 | 将 system prompt 拆分为语义块（identity/persona/context/instructions），声明式组合 |
| **模板渲染** | P0 | 支持变量插值、条件注入、角色切换、跨段引用 |
| **缓存** | P1 | LRU 缓存已编译的 prompt 模板，减少重复 I/O |
| **校验** | P1 | 校验 prompt 结构的完整性、必需段存在性、变量引用闭合 |
| **版本追踪** | P2 | 记录 prompt 的版本变更历史，支持版本回退 |
| **多角色编排** | P2 | 圆桌会议、群聊、三人对话等多角色场景的 prompt 自动编排 |

### 1.3 与现有包的关系

```
@cortex/config (零依赖根配置)
  ├── 常量: DIR_PROMPTS, FILE_CORTEX_AGENTS_JSON, ...
  ├── 默认值: DEFAULT_ENGINE_CONFIG, ...
  └── 接口: EngineConfig, AgentDefinition, ...
       ↓ 依赖
@cortex/prompt-kit (新增——提示词工程层)
  ├── 加载器: PromptLoader ← 消费 @cortex/config 的路径常量
  ├── 组装器: PromptAssembler
  ├── 模板引擎: PromptTemplateEngine ── 独立于 skill-kit 的模板引擎
  ├── 校验器: PromptValidator
  ├── 缓存: PromptCache
  └── 编排器: PromptOrchestrator
       ↓ 被消费
@cortex/engine ├── Agent 执行循环 (ReAct loop → 注入 system prompt)
@cortex/cli    ├── REPL 对话 (chat/talk/social executor)
```

### 1.4 设计原则

1. **声明式最优** — prompt 的定义应是数据结构，而非拼接逻辑。组装是组合而非编程。
2. **块级组合** — prompt 由语义块组成（IdentityBlock / PersonaBlock / ContextBlock / InstructionBlock），块可独立定义、复用、排序。
3. **安全优先** — 所有 prompt 加载路径必须受原则三（Toolkit 权限校验）管辖，私密 prompt 必须显式标注访问级别。
4. **可观测** — 所有 prompt 加载、组装、渲染事件走 PipelineObserver 管道（原则五）。
5. **无运行时依赖** — 不依赖 Node.js 特定 API 的核心类型可在浏览器端复用。

---

## 二、核心类型定义

### 2.1 PromptBlock — 提示词语义块

```typescript
/**
 * 提示词语义块类型枚举。
 * 每个块代表一段具有独立语义的提示词内容。
 */
export enum PromptBlockType {
  /** 身份声明 — "你是 XX，你的职责是 YY" */
  Identity = "identity",
  /** 角色人格 — persona 定义：语气、风格、背景故事 */
  Persona = "persona",
  /** 上下文注入 — 工程上下文、记忆检索结果、当前任务 */
  Context = "context",
  /** 行为指令 — 约束规则、输出格式、行为边界 */
  Instruction = "instruction",
  /** 示例注入 — few-shot 示例 */
  Example = "example",
  /** 输出格式定义 — 预期输出结构 */
  OutputFormat = "output_format",
  /** 私有内容 — 仅特定场景注入的敏感内容 */
  Private = "private",
}

/**
 * 提示词语义块。
 * 每个块是 prompt 的最小可组合单元。
 */
export interface PromptBlock {
  /** 块唯一标识 */
  id: string;
  /** 块类型 */
  type: PromptBlockType;
  /** 块内容（支持模板语法） */
  content: string;
  /** 优先级（排序用，小值优先） */
  priority: number;
  /** 可选 — 激活条件（表达式） */
  condition?: string;
  /** 可选 — 访问级别标记 */
  accessLevel?: "public" | "restricted" | "private";
  /** 可选 — 标签（用于按标签组引用） */
  tags?: string[];
  /** 可选 — 渲染上下文扩展 */
  metadata?: Record<string, unknown>;
}
```

### 2.2 PromptTemplate — 提示词模板

```typescript
/**
 * 提示词模板——一组有序的语义块组合。
 * 模板是 prompt 的声明式定义：由多个 PromptBlock 按优先级排序组成。
 */
export interface PromptTemplate {
  /** 模板唯一标识 */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板版本（semver） */
  version: string;
  /** 语义块列表（渲染时按 priority 排序） */
  blocks: PromptBlock[];
  /** 适用场景标签 */
  tags: string[];
  /** 可选 — 描述 */
  description?: string;
  /** 可选 — 来源（文件路径/配置标识/内联） */
  source?: string;
  /** 可选 — 扩展元数据 */
  metadata?: Record<string, unknown>;
}
```

### 2.3 PromptContext — 渲染上下文

```typescript
/**
 * 提示词渲染上下文。
 * 提供给模板引擎的变量集和运行时信息。
 */
export interface PromptContext {
  /** 模板变量 */
  variables: Record<string, unknown>;
  /** 当前 Agent 类型 */
  agentType?: string;
  /** 当前任务信息 */
  task?: {
    id: string;
    type: string;
    tags: string[];
    payload: string;
  };
  /** 记忆上下文 */
  memoryContext?: string;
  /** 活跃的块 ID 列表（用于动态启用/禁用块） */
  activeBlockIds?: string[];
  /** 自定义块过滤器 */
  blockFilter?: (block: PromptBlock) => boolean;
  /** 扩展上下文 */
  [key: string]: unknown;
}
```

### 2.4 PromptResult — 渲染结果

```typescript
/**
 * 提示词渲染结果。
 */
export interface PromptResult {
  /** 完整渲染后的文本 */
  text: string;
  /** 模板 ID */
  templateId: string;
  /** 模板版本 */
  version: string;
  /** 实际渲染的块列表（含优先级排序后） */
  renderedBlocks: Array<{
    id: string;
    type: PromptBlockType;
    content: string;
    order: number;
  }>;
  /** 跳过未渲染的块（因 condition 不满足） */
  skippedBlocks: Array<{
    id: string;
    type: PromptBlockType;
    reason: "condition_false" | "filtered" | "access_denied" | "blocked";
  }>;
  /** 渲染耗时 */
  renderTimeMs: number;
  /** 时间戳 */
  timestamp: number;
}
```

### 2.5 PromptLoadOptions — 加载选项

```typescript
/**
 * 提示词加载选项。
 */
export interface PromptLoadOptions {
  /** 加载策略 */
  strategy?: "file_first" | "config_first" | "inline_only" | "merge";
  /** 是否缓存已加载的模板 */
  useCache?: boolean;
  /** 缓存 TTL（毫秒） */
  cacheTtlMs?: number;
  /** 文件系统基础路径 */
  baseDir?: string;
  /** 访问级别校验（拒绝低于该级别的块） */
  minAccessLevel?: "public" | "restricted" | "private";
}
```

### 2.6 PromptAssembly — 组装配置

```typescript
/**
 * 提示词组装配置。
 * 定义如何将多个 PromptBlock 组合为最终 system prompt。
 */
export interface PromptAssembly {
  /** 基础模板 ID（优先加载） */
  baseTemplateId?: string;
  /** 额外块列表（追加到 base 之后） */
  additionalBlocks?: PromptBlock[];
  /** 渲染上下文 */
  context: PromptContext;
  /** 块排序策略 */
  sortStrategy?: "by_priority" | "by_type" | "custom";
  /** 自定义分隔符（默认 \n\n） */
  blockSeparator?: string;
  /** 是否注入共享身份锚点 */
  injectIdentityAnchor?: boolean;
}
```

### 2.7 PromptCacheEntry — 缓存条目

```typescript
/**
 * 提示词缓存条目。
 */
export interface PromptCacheEntry {
  template: PromptTemplate;
  compiledAt: number;
  accessCount: number;
  lastAccessedAt: number;
  ttlMs: number;
}
```

---

## 三、核心模块设计

### 3.1 PromptLoader — 统一加载器

**职责**：从多个来源加载 `PromptTemplate`，抽象文件系统细节。

```
                    ┌─────────────────────┐
                    │    PromptLoader      │
                    │  (统一加载入口)       │
                    └────────┬────────────┘
                             │
             ┌───────────────┼───────────────┐
             │               │               │
             ▼               ▼               ▼
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
    │FileLoader   │  │ConfigLoader │  │InlineLoader │
    │(prompts/*)  │  │(constants)  │  │(内联字符串)  │
    └─────────────┘  └─────────────┘  └─────────────┘
```

```typescript
export interface PromptLoader {
  /** 按模板 ID 加载 */
  load(templateId: string, options?: PromptLoadOptions): Promise<PromptTemplate>;

  /** 从文件路径加载 */
  loadFromFile(filePath: string, options?: PromptLoadOptions): Promise<PromptTemplate>;

  /** 从配置加载（如 PLANNING_SYSTEM 常量） */
  loadFromConfig(configKey: string, options?: PromptLoadOptions): Promise<PromptTemplate>;

  /** 从内联字符串加载 */
  loadFromInline(id: string, content: string, options?: PromptLoadOptions): PromptTemplate;

  /** 注册自定义来源 */
  registerSource(name: string, source: PromptSource): void;
}

/** 自定义 prompt 来源接口 */
export interface PromptSource {
  load(templateId: string): Promise<PromptTemplate | null>;
  list?(): Promise<string[]>;
}
```

**文件加载规则**（按 `FILE_CORTEX_AGENTS_JSON` 配置查找）：

```
prompts/
  ├── <agent-type>/          ← Agent 人格目录
  │   ├── system.md          ← system prompt（基准块）
  │   ├── identity.md        ← 身份声明块（可选）
  │   └── roundtable.md      ← 圆桌人格块（可选）
  ├── coding-standards.md    ← 编码规范
  ├── planning/              ← 规划相关
  │   ├── system.md
  │   └── replan.md
  └── shared/                ← 共享块
      ├── identity-anchor.md
      └── format-instructions.md
```

**文件 → PromptTemplate 映射规则**：

- `prompts/nahida/system.md` → `templateId: "nahida-system"`
- `prompts/nahida/identity.md` → `templateId: "nahida-identity"`
- `prompts/shared/identity-anchor.md` → `templateId: "shared-identity-anchor"`
- 所有块自动合并为 `nahida` 模板，块类型从文件名推导

### 3.2 PromptAssembler — 声明式组装器

**职责**：将 `PromptTemplate` + `PromptAssembly` → 最终的组合 prompt 文本，通过装配管线完成。

```typescript
export interface PromptAssembler {
  /** 组装完整 prompt */
  assemble(template: PromptTemplate, assembly: PromptAssembly): Promise<PromptResult>;

  /** 注册块预处理器 */
  registerPreprocessor(name: string, fn: BlockPreprocessor): void;

  /** 注册块后处理器 */
  registerPostprocessor(name: string, fn: BlockPostprocessor): void;
}

/** 块预处理器：在渲染前修改块 */
export type BlockPreprocessor = (
  blocks: PromptBlock[],
  context: PromptContext,
) => PromptBlock[];

/** 块后处理器：在渲染后修改结果 */
export type BlockPostprocessor = (
  result: PromptResult,
  context: PromptContext,
) => PromptResult;
```

**装配管线（执行顺序）**：

```
1. 加载基础模板（PromptLoader.load）
2. 合并额外块（additionalBlocks）
3. 块过滤（按 condition / accessLevel / blockFilter）
4. 块排序（按 priority）
5. 注入共享身份锚点（如启用）
6. 模板渲染（按块依次渲染）
7. 块间分隔符插入
8. 后处理（自定义后处理器）
9. 返回 PromptResult
```

### 3.3 PromptTemplateEngine — 模板渲染引擎

**职责**：渲染 `PromptBlock.content` 中的模板语法，支持 prompt 特有的功能。

```typescript
export interface PromptTemplateEngine {
  /** 渲染单块内容 */
  renderBlock(block: PromptBlock, context: PromptContext): string;

  /** 批量渲染（依次渲染，拼接分隔符） */
  renderBlocks(blocks: PromptBlock[], context: PromptContext, separator?: string): string;

  /** 注册自定义辅助函数 */
  registerHelper(name: string, fn: (...args: unknown[]) => unknown): void;

  /** 注册自定义指令 */
  registerDirective(name: string, handler: DirectiveHandler): void;
}

/** 自定义指令处理器 */
export type DirectiveHandler = (
  params: string,
  body: string,
  context: PromptContext,
) => string;
```

**支持的模板语法**（继承 skill-kit 的 `SimpleTemplateEngine` 并扩展）：

| 语法 | 说明 | 示例 |
|------|------|------|
| `{{ variable }}` | 变量插值 | `你好，{{ userName }}` |
| `{{ variable \|\| fallback }}` | 默认值 | `当前任务：{{ taskName \|\| 无任务 }}` |
| `{{#if cond}}...{{/if}}` | 条件渲染 | `{{#if hasMemory}}{{memoryContext}}{{/if}}` |
| `{{#each list}}...{{/each}}` | 循环 | `{{#each tools}}{{this}}{{/each}}` |
| `{{#role name}}...{{/role}}` | 角色切换块 | `{{#role nahida}}...{{/role}}` |
| `{{#block id}}...{{/block}}` | 块级引用 | `{{#block identity}}` 引用其他块 |
| `{{#ref templateId}}` | 跨模板引用 | `{{#ref shared-format-instructions}}` |
| `{{#date format}}` | 日期格式化 | `{{#date YYYY-MM-DD}}` |
| `{{#include filepath}}` | 文件包含 | `{{#include prompts/shared/rules.md}}` |

### 3.4 PromptValidator — 校验器

**职责**：校验 `PromptTemplate` 的完整性和渲染产物的质量。

```typescript
export interface PromptValidator {
  /** 校验模板结构 */
  validateTemplate(template: PromptTemplate): ValidationResult;

  /** 校验渲染结果 */
  validateResult(result: PromptResult): ValidationResult;

  /** 检查必需段是否存在 */
  checkRequiredSections(
    result: PromptResult,
    requiredTypes: PromptBlockType[],
  ): SectionCheckResult;

  /** 注册自定义校验规则 */
  registerRule(name: string, rule: ValidationRule): void;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface SectionCheckResult {
  allPresent: boolean;
  present: PromptBlockType[];
  missing: PromptBlockType[];
  warnings: string[];
}

export type ValidationRule = (
  template: PromptTemplate,
  result?: PromptResult,
) => ValidationError | null;
```

**默认校验规则**：

| 规则 | 级别 | 说明 |
|------|------|------|
| **必需块类型检查** | error | 至少包含 Identity 或 Persona 块 |
| **模板变量闭合** | error | 所有变量在 context 中有定义 |
| **块 ID 唯一性** | error | 无重复块 ID |
| **条件表达式语法** | error | `{{#if}}` 语法正确 |
| **循环闭合** | error | `{{#each}}...{{/each}}` 成对出现 |
| **最大 token 数** | warning | 超出预设 token 上限时警告 |
| **身份锚点存在** | warning | 未注入共享身份锚点时警告 |
| **指令完整性** | warning | 包含输出格式指令时检查对应段存在 |

### 3.5 PromptCache — 缓存层

**职责**：缓存已解析的 `PromptTemplate`，减少重复 I/O 和解析开销。

```typescript
export interface PromptCache {
  get(key: string): PromptTemplate | undefined;
  set(key: string, template: PromptTemplate, ttlMs?: number): void;
  has(key: string): boolean;
  evict(key: string): void;
  clear(): void;
  stats(): CacheStats;
  /** 按标签批量失效 */
  evictByTag(tag: string): number;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  /** 按块类型统计命中率 */
  typeStats?: Record<string, { hits: number; misses: number }>;
}
```

**缓存策略**：

- **LRU 淘汰**：超出 `maxSize` 时淘汰最久未访问条目
- **TTL 失效**：文件来源的模板默认 TTL=300s，内联来源 TTL=∞
- **文件变动检测**：可选的 `fs.watchFile` 监听，文件变更时自动失效
- **预加载**：应用启动时可预加载 `prompts/shared/` 下的公共块

### 3.6 PromptVersion — 版本管理

**职责**：记录和管理 prompt 模板的版本变更。

```typescript
export interface PromptVersion {
  /** 获取模板版本历史 */
  getHistory(templateId: string): VersionRecord[];

  /** 获取指定版本的模板 */
  getVersion(templateId: string, version: string): Promise<PromptTemplate | null>;

  /** 记录版本变更 */
  recordChange(record: VersionRecord): void;

  /** 对比两个版本的差异 */
  diff(templateId: string, fromVersion: string, toVersion: string): VersionDiff;
}

export interface VersionRecord {
  templateId: string;
  version: string;
  previousVersion?: string;
  changeDescription: string;
  changedBy: string; // AgentType 或 "user"
  timestamp: number;
  blocksChanged: string[]; // 有变动的块 ID
  source?: string;
}

export interface VersionDiff {
  templateId: string;
  from: string;
  to: string;
  additions: string[];
  removals: string[];
  modifications: Array<{
    blockId: string;
    type: PromptBlockType;
    before: string;
    after: string;
  }>;
}
```

### 3.7 PromptOrchestrator — 编排器（高层门面）

**职责**：组合 Loader + Assembler + TemplateEngine + Validator + Cache 为一体化编排器。

```typescript
/**
 * PromptOrchestrator —— 提示词编排器。
 * 包外统一入口，组合各子模块为完整的 prompt 编排管道。
 */
export class PromptOrchestrator {
  constructor(options?: OrchestratorOptions);

  /** 渲染完整 system prompt */
  async renderSystemPrompt(
    assembly: PromptAssembly,
  ): Promise<PromptResult>;

  /** 快速渲染单块（便捷方法） */
  async renderBlock(
    block: PromptBlock,
    context: PromptContext,
  ): Promise<string>;

  /** 加载并缓存模板 */
  async loadTemplate(
    templateId: string,
    options?: PromptLoadOptions,
  ): Promise<PromptTemplate>;

  /** 验证 assembly 的完整性 */
  validateAssembly(assembly: PromptAssembly): ValidationResult;

  /** 清空缓存 */
  clearCache(): void;

  /** 获取缓存统计 */
  getCacheStats(): CacheStats;

  // ── 子组件访问 ──
  get loader(): PromptLoader;
  get assembler(): PromptAssembler;
  get templateEngine(): PromptTemplateEngine;
  get validator(): PromptValidator;
  get cache(): PromptCache;
  get version(): PromptVersion;
}
```

---

## 四、架构图

### 4.1 模块依赖

```
┌──────────────────────────────────────────────────────────┐
│                    @cortex/prompt-kit                      │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │                  PromptOrchestrator                    │ │
│  │                   （统一门面）                          │ │
│  └────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┘ │
│       │      │      │      │      │      │      │        │
│       ▼      ▼      ▼      ▼      ▼      ▼      ▼        │
│  ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐       │
│  │Loader││Asmb.││Engine││Valid.││Cache ││Vers. │       │
│  └──┬───┘└──────┘└──────┘└──────┘└──────┘└──────┘       │
│     │                                                     │
│     ▼                                                     │
│  ┌──────┐           ┌──────────────────────────┐          │
│  │FsSrc │           │  @cortex/shared (类型)    │          │
│  │CfgSrc│◄──────────┤  @cortex/config (常量/路径)│         │
│  │InlSrc│           │                          │          │
│  └──────┘           └──────────────────────────┘          │
└──────────────────────────────────────────────────────────┘
         │
         ▼ 被消费
┌─────────────────────┐  ┌──────────────────────────┐
│  @cortex/engine      │  │  @cortex/cli              │
│  Agent → ReAct loop  │  │  Executor → chat/social   │
│  → renderSystemPrompt│  │  → renderSystemPrompt     │
└─────────────────────┘  └──────────────────────────┘
```

### 4.2 包结构

```
packages/prompt-kit/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── DESIGN.md                          ← 本文档
├── src/
│   ├── index.ts                       ← 桶导出
│   ├── types.ts                       ← 核心类型（§2）
│   │
│   ├── loader/                        ← 加载器模块
│   │   ├── index.ts
│   │   ├── prompt-loader.ts           ← PromptLoader 实现
│   │   ├── file-source.ts             ← 文件系统来源
│   │   ├── config-source.ts           ← 配置来源
│   │   └── inline-source.ts           ← 内联来源
│   │
│   ├── assembler/                     ← 组装器模块
│   │   ├── index.ts
│   │   ├── prompt-assembler.ts        ← PromptAssembler 实现
│   │   ├── block-filter.ts            ← 块过滤逻辑
│   │   ├── block-sorter.ts            ← 块排序逻辑
│   │   └── default-processors.ts      ← 默认预/后处理器
│   │
│   ├── template-engine/               ← 模板渲染引擎
│   │   ├── index.ts
│   │   ├── prompt-template-engine.ts  ← PromptTemplateEngine 实现
│   │   ├── builtin-helpers.ts         ← 内置辅助函数
│   │   └── builtin-directives.ts      ← 内置指令（role/block/ref/include）
│   │
│   ├── validator/                     ← 校验器
│   │   ├── index.ts
│   │   ├── prompt-validator.ts        ← PromptValidator 实现
│   │   └── default-rules.ts           ← 默认校验规则
│   │
│   ├── cache/                         ← 缓存层
│   │   ├── index.ts
│   │   ├── prompt-cache.ts            ← PromptCache 实现（LRU）
│   │   └── file-watcher.ts            ← 文件变动监听（可选）
│   │
│   ├── version/                       ← 版本管理
│   │   ├── index.ts
│   │   ├── prompt-version.ts          ← PromptVersion 实现
│   │   └── version-storage.ts         ← 版本存储（JSON/MemoryStore）
│   │
│   ├── orchestrator/                  ← 编排器
│   │   ├── index.ts
│   │   └── prompt-orchestrator.ts     ← PromptOrchestrator 实现
│   │
│   └── errors.ts                      ← 自定义错误类型
│
├── tests/
│   ├── unit/
│   │   ├── loader.test.ts
│   │   ├── assembler.test.ts
│   │   ├── template-engine.test.ts
│   │   ├── validator.test.ts
│   │   ├── cache.test.ts
│   │   └── orchestrator.test.ts
│   └── fixtures/                      ← 测试用 prompt 文件
│       ├── nahida/
│       │   ├── system.md
│       │   └── identity.md
│       └── shared/
│           └── identity-anchor.md
```

### 4.3 数据流

```
用户/Agent 请求 prompt
       │
       ▼
PromptOrchestrator.renderSystemPrompt(assembly)
       │
       ├─ 1. PromptLoader.load(templateId)
       │      ├─ 缓存命中 → 返回缓存模板
       │      └─ 缓存未命中 → 文件/配置/内联 → 解析 → 缓存
       │
       ├─ 2. PromptAssembler.assemble(template, assembly)
       │      ├─ 合并额外块
       │      ├─ 块过滤（condition/accessLevel）
       │      ├─ 块排序
       │      ├─ 注入身份锚点
       │      └─ 模板渲染（每块依次渲染）
       │
       ├─ 3. PromptValidator.validateResult(result)
       │      ├─ 必需段检查
       │      ├─ 变量闭合检查
       │      └─ 自定义规则
       │
       └─ 4. 返回 PromptResult ✅ / 抛出 PromptError ❌
              │
              ▼
        Agent ReAct / CLI Executor 使用 result.text
```

---

## 五、与 Cortex 现有体系的集成

### 5.1 替换现有 prompt 加载链

**现状**：CLI `display.ts` 中的 `loadAgentSystemPrompt()` 直读文件 + JSON + 回退。

**改造后**：

```typescript
// Before (display.ts 直读)
export function loadAgentSystemPrompt(agentType: AgentType): string {
  const configPath = path.join(process.cwd(), FILE_CORTEX_AGENTS_JSON);
  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  // ... 80 行手动加载逻辑
}

// After (通过 prompt-kit)
import { PromptOrchestrator } from "@cortex/prompt-kit";

const orchestrator = new PromptOrchestrator({ baseDir: process.cwd() });

async function loadAgentSystemPrompt(agentType: AgentType): Promise<string> {
  const result = await orchestrator.renderSystemPrompt({
    baseTemplateId: `${agentType}-system`,
    context: {
      variables: { agentType },
      agentType,
    },
    injectIdentityAnchor: true,
  });
  return result.text;
}
```

### 5.2 替换现有 Prompt 拼接模式

**现状**：chat-executor.ts / social-executor.ts / talk-executor.ts 各自独立拼接 prompt。

**改造后**：三个 executor 统一调用 `PromptOrchestrator.renderSystemPrompt()`。

### 5.3 类型集成到 @cortex/shared

`@cortex/shared` 中新增以下导出（轻量类型，不依赖实现）：

```typescript
// @cortex/shared/src/prompt-types.ts
export enum PromptBlockType { ... }
export interface PromptBlock { ... }
export interface PromptTemplate { ... }
export interface PromptContext { ... }
export interface PromptResult { ... }
export interface PromptAssembly { ... }
```

### 5.4 PipelineObserver 事件

prompt-kit 的所有关键操作通过 `PipelineObserver` 发出可观测事件：

| 事件 | 触发时机 | 严重性 |
|------|---------|--------|
| `prompt.loaded` | 模板加载成功 | NORMAL |
| `prompt.load_failed` | 模板加载失败 | WARNING |
| `prompt.assembled` | 组装完成 | NORMAL |
| `prompt.rendered` | 渲染完成 | NORMAL |
| `prompt.validation_warning` | 校验警告 | NORMAL |
| `prompt.validation_error` | 校验错误 | WARNING |
| `prompt.cache_miss` | 缓存未命中 | DEBUG |
| `prompt.cache_evict` | 缓存淘汰 | DEBUG |

### 5.5 配置域注册

在 `@cortex/config` 中新增 prompt 配置域：

```typescript
// packages/config/src/interfaces/prompt.ts (新增)
export interface PromptConfig {
  /** 默认模板加载目录 */
  baseDir?: string;
  /** 缓存最大条目数 */
  cacheMaxSize?: number;
  /** 默认缓存 TTL */
  cacheDefaultTtlMs?: number;
  /** 是否启用文件变动监听 */
  enableFileWatching?: boolean;
  /** 是否注入共享身份锚点（默认 true） */
  injectIdentityAnchor?: boolean;
}
```

在 `CONFIG_DOMAINS` 注册表中新增域：

```typescript
{
  name: "prompt",
  fileName: "prompt.json",
  required: false,
  schema: promptSchema,
}
```

---

## 六、API 设计

### 6.1 核心 API

```typescript
// ── 创建编排器 ──
const orch = new PromptOrchestrator({
  baseDir: process.cwd(),
  cacheMaxSize: 100,
  cacheDefaultTtlMs: 300_000,
  injectIdentityAnchor: true,
});

// ── 渲染 Agent system prompt ──
const result = await orch.renderSystemPrompt({
  baseTemplateId: "nahida-system",
  context: {
    variables: {
      userName: "开拓者",
      taskDescription: "分析 packages/engine/src 的模块依赖",
    },
    agentType: "analysis",
  },
  injectIdentityAnchor: true,
});
console.log(result.text);

// ── 加载模板 ──
const template = await orch.loadTemplate("shared-identity-anchor");

// ── 快速渲染单块 ──
const blockText = await orch.renderBlock(
  { id: "greeting", type: PromptBlockType.Identity, content: "你是{{role}}", priority: 1 },
  { variables: { role: "架构分析师" } },
);

// ── 校验 ──
const validation = orch.validateAssembly(assembly);
if (!validation.valid) {
  console.error("Prompt 校验失败:", validation.errors);
}

// ── 版本管理 ──
const history = orch.version.getHistory("nahida-system");
const diff = orch.version.diff("nahida-system", "1.0.0", "1.1.0");

// ── 缓存统计 ──
const stats = orch.getCacheStats();
console.log(`缓存命中率: ${(stats.hitRate * 100).toFixed(1)}%`);
```

### 6.2 便捷工厂方法

```typescript
// 内置工厂函数
export function createAgentSystemPrompt(context: {
  agentType: string;
  task?: { id: string; type: string; tags: string[]; payload: string };
  memoryContext?: string;
  privatePersona?: string;
}): PromptAssembly;

export function createRoundtablePrompt(context: {
  topic: string;
  participants: Array<{ type: string; persona: string }>;
  materials: string[];
}): PromptAssembly;

export function createTalkPrompt(context: {
  companionType: string;
  mode: "solo" | "trio" | "party";
  input: string;
}): PromptAssembly;

export function createPartyPrompt(context: {
  groupName: string;
  members: Array<{ type: string; role: string; muted: boolean }>;
  ownerType: string;
  input: string;
}): PromptAssembly;
```

---

## 七、实现计划

### Phase 1: 核心基础设施（P0 — 2 周）

| 模块 | 交付 | 依赖 |
|------|------|------|
| `types.ts` | 所有核心类型 | 无 |
| `PromptTemplateEngine` | 基础模板渲染（变量插值+条件+循环） | types |
| `PromptCache` | LRU 缓存实现 | types |
| `PromptLoader` | FileSource + InlineSource | types, config |
| `prompt-loader.test.ts` | 加载器单元测试 | vitest |

**验证标准**：
- 能从 `prompts/nahida/system.md` 加载 `PromptTemplate`
- 模板渲染支持 `{{ variable }}` / `{{#if}}` / `{{#each}}`
- LRU 缓存命中/未命中/淘汰逻辑正确
- 全部测试通过

### Phase 2: 组装与校验（P0 — 1 周）

| 模块 | 交付 | 依赖 |
|------|------|------|
| `PromptAssembler` | 块过滤+排序+合并+分隔符 | Phase 1 |
| `PromptValidator` | 完整校验逻辑+默认规则 | types |
| `ConfigSource` | 从 `@cortex/config` 常量加载 | Phase 1 |

**验证标准**：
- 能从 5 个块组装完整 prompt
- 条件过滤正确启用/禁用块
- 校验能检测缺失段和变量未闭合
- 错误信息定位到具体块

### Phase 3: 编排器与集成（P1 — 1 周）

| 模块 | 交付 | 依赖 |
|------|------|------|
| `PromptOrchestrator` | 统一门面 | Phase 1 + 2 |
| `PromptVersion` | 版本记录+diff | types |
| 便捷工厂函数 | `createAgentSystemPrompt` 等 | Orchestrator |
| CLI 集成 | 替换 `display.ts` 的 `loadAgentSystemPrompt` | Phase 1 + 2 |

**验证标准**：
- Orchestrator 完整管线：加载→组装→渲染→校验→返回
- CLI chat/talk 模式使用 prompt-kit 替代直读
- 全部现有测试保持绿色
- PipelineObserver 事件正常 emit

### Phase 4: 高级功能（P2 — 1 周）

| 模块 | 交付 | 依赖 |
|------|------|------|
| 内置指令 | `{{#role}}` / `{{#block}}` / `{{#ref}}` / `{{#include}}` | Phase 1 |
| 圆桌 prompt 编排 | `createRoundtablePrompt` 工厂 | Phase 3 |
| 文件变动监听 | 自动缓存失效 | cache |
| 性能优化 | 模板预编译、批量渲染 | Phase 1 |

**验证标准**：
- 跨模板引用 `{{#ref}}` 正确工作
- 文件变更后缓存自动失效
- 圆桌 prompt 包含所有入席者角色
- 渲染性能相比直读提升 ≥ 50%

---

## 八、错误处理

```typescript
/** Prompt 错误基类 */
export class PromptError extends Error {
  constructor(
    message: string,
    public readonly code: PromptErrorCode,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "PromptError";
  }
}

export enum PromptErrorCode {
  /** 模板未找到 */
  TEMPLATE_NOT_FOUND = "PROMPT_TEMPLATE_NOT_FOUND",
  /** 加载失败 */
  LOAD_FAILED = "PROMPT_LOAD_FAILED",
  /** 校验失败 */
  VALIDATION_FAILED = "PROMPT_VALIDATION_FAILED",
  /** 渲染失败 */
  RENDER_FAILED = "PROMPT_RENDER_FAILED",
  /** 变量未定义 */
  VARIABLE_UNDEFINED = "PROMPT_VARIABLE_UNDEFINED",
  /** 语法错误 */
  SYNTAX_ERROR = "PROMPT_SYNTAX_ERROR",
  /** 循环引用 */
  CIRCULAR_REFERENCE = "PROMPT_CIRCULAR_REFERENCE",
  /** 缓存错误 */
  CACHE_ERROR = "PROMPT_CACHE_ERROR",
  /** 访问拒绝 */
  ACCESS_DENIED = "PROMPT_ACCESS_DENIED",
}
```

---

## 九、安全考量

| 风险 | 缓解措施 |
|------|---------|
| **私密 prompt 泄露** | `accessLevel: "private"` 块仅在显式请求时渲染；私密 persona 文件受 `.gitignore` 保护 |
| **模板注入** | `PromptTemplateEngine` 对输出做转义处理（可配置）；禁止 `eval`/`Function` 构造 |
| **文件遍历** | `PromptLoader` 校验路径在 `DIR_PROMPTS` 白名单内（遵循 §7.5 读取安全边界） |
| **无限递归** | `{{#ref}}` 和 `{{#include}}` 设置最大嵌套深度（默认 5 层） |
| **缓存污染** | 缓存 key 包含模板 ID + 来源路径 + 修改时间戳，防止多版本冲突 |

---

## 十、宪法一致性声明

| 宪法条款 | 遵行方式 |
|---------|---------|
| **原则三** — 安全边界在 Toolkit 调用层 | prompt-kit 不自行调用工具，由上层（Agent/CLI）注入上下文 |
| **原则五** — 可观测事件走统一管道 | 所有关键操作 emit PipelineObserver 事件 |
| **§7.5** — 读取安全边界 | `PromptLoader` 路径限制在 `DIR_PROMPTS` 和 `DIR_CORTEX` 白名单内 |
| **§15·三** — 公开接口最小化 | 核心 API 控制在 6 个接口，内部类不导出 |
| **§15·四** — 内联判定 | 子目录文件数 > 3 时才分解子模块，否则内联至父目录 |

---

## 附录：与 @cortex/skill-kit 的职责边界

| 维度 | `@cortex/skill-kit` | `@cortex/prompt-kit` |
|------|--------------------|---------------------|
| **核心职责** | 技能定义、加载、校验、执行 | 提示词模板、组装、渲染、校验 |
| **模板引擎** | `SimpleTemplateEngine`（轻量，技能步骤） | `PromptTemplateEngine`（增强，prompt 专用） |
| **分离理由** | 技能步骤模板无需 `{{#role}}`/`{{#block}}`/`{{#ref}}` 等 prompt 专用指令 | prompt 组装需要多角色编排、块级组合、跨模板引用 |
| **共享部分** | 基础的变量插值语法（`{{ var }}` / `{{#if}}` / `{{#each}}`）保持一致 | 同上，向后兼容 |
| **依赖关系** | 无依赖 | 可通过 Adapter 复用 `SimpleTemplateEngine` 作为底层渲染器 |
| **合并考量** | 若合并，skill-kit 的包体积膨胀 2x，且引入与技能无关的 API 面 | 分离后两个包各自聚焦，依赖方向清晰 |
