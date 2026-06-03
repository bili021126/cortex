# 莫娜模式提炼：@cortex/skill-kit 技能开发工具包

> **提炼者**：莫娜（Mona）— Pattern Analysis Agent  
> **提炼版本**：v0.1.0  
> **覆盖流程**：设计 → 实现 → 测试 → 验证  
> **模式分类**：架构模式 · 代码结构范式 · 开发流程模式 · 文档规范

---

## 目录

1. [模式总览](#1-模式总览)
2. [架构模式](#2-架构模式)
3. [代码结构范式](#3-代码结构范式)
4. [开发流程模式](#4-开发流程模式)
5. [文档规范模式](#5-文档规范模式)
6. [测试模式](#6-测试模式)
7. [可复用片段](#7-可复用片段)
8. [技能定义模板](#8-技能定义模板)
9. [检查清单](#9-检查清单)

---

## 1. 模式总览

### 1.1 核心发现

从 `@cortex/skill-kit` 的完整构建过程中，提炼出以下可复用的模式体系：

| 模式编号 | 模式名称 | 分类 | 复用价值 |
|---------|---------|------|---------|
| P01 | **分层四件套架构** | 架构模式 | 🔴 高 |
| P02 | **接口契约优先** | 架构模式 | 🔴 高 |
| P03 | **工厂统一入口** | 架构模式 | 🔴 高 |
| P04 | **Result 判别联合** | 代码范式 | 🔴 高 |
| P05 | **泛型三件套** | 代码范式 | 🟡 中 |
| P06 | **注册表映射** | 代码范式 | 🔴 高 |
| P07 | **适配器包装** | 代码范式 | 🔴 高 |
| P08 | **管线执行器** | 代码范式 | 🔴 高 |
| P09 | **LRU + TTL 缓存** | 代码范式 | 🟡 中 |
| P10 | **多级校验器** | 代码范式 | 🔴 高 |
| P11 | **技能结晶循环** | 开发流程 | 🔴 高 |
| P12 | **设计文档先行** | 开发流程 | 🟡 中 |
| P13 | **治理-审查-测试三角** | 文档规范 | 🟡 中 |
| P14 | **可执行设计文档** | 文档规范 | 🟡 中 |

---

## 2. 架构模式

### P01 —— 分层四件套架构

**描述**：将一个子系统拆分为四个正交的职责层：**类型层**、**实现层**、**工厂层**、**导出层**。每层只关注一件事，依赖方向单一。

```
┌─────────────────────────────────────────────────────────┐
│  ④ 导出层 (index.ts)         ← 桶导出，聚合所有公开 API  │
├─────────────────────────────────────────────────────────┤
│  ③ 工厂层 (factory.ts)       ← 组合四件套，统一入口      │
├─────────────────────────────────────────────────────────┤
│  ② 实现层 (loader/cache/     ← 接口的具体实现            │
│            validator/executor)                           │
├─────────────────────────────────────────────────────────┤
│  ① 类型层 (types.ts)         ← 所有类型、接口、枚举定义   │
└─────────────────────────────────────────────────────────┘
```

**适用场景**：
- 任何需要提供"一站式" API 给消费者的子系统
- 具有多个可替换实现的模块（如缓存策略、校验器）

**关键决策**：
- 类型层零依赖（不依赖任何实现模块）
- 实现层只依赖类型层
- 工厂层依赖所有实现层，但消费者只面向工厂层
- 导出层聚合所有模块的公开 API

**代码骨架**：

```typescript
// types.ts — 零依赖，纯类型定义
export interface SkillLoader { /* ... */ }
export interface SkillCache { /* ... */ }

// loader.ts — 实现层，只依赖 types
import { SkillLoader } from "./types.js";
export class DynamicImportLoader implements SkillLoader { /* ... */ }

// factory.ts — 组合层，依赖所有实现
import { SkillLoader, SkillCache } from "./types.js";
import { DynamicImportLoader } from "./loader.js";
export class SkillFactory {
  constructor(options: { loader: SkillLoader; cache?: SkillCache }) { /* ... */ }
}

// index.ts — 桶导出
export { SkillLoader, SkillCache } from "./types.js";
export { DynamicImportLoader } from "./loader.js";
export { SkillFactory } from "./factory.js";
```

---

### P02 —— 接口契约优先

**描述**：在编写任何实现代码之前，先在 `types.ts` 中定义完整的接口契约。实现类通过 `implements` 保证与契约一致。

**关键实践**：

```typescript
// 1. 先在 types.ts 中定义接口
export interface SkillValidator {
  validate(skill: SkillDefinition): ValidationResult;
  validateMeta(meta: SkillMeta): ValidationResult;
  validateManifest(manifest: SkillManifest): ValidationResult;
}

// 2. 实现类明确 implements
export class SimpleSkillValidator implements SkillValidator {
  validate(skill: SkillDefinition): ValidationResult { /* ... */ }
  validateMeta(meta: SkillMeta): ValidationResult { /* ... */ }
  validateManifest(manifest: SkillManifest): ValidationResult { /* ... */ }
}
```

**收益**：
- 实现与契约解耦：可替换任意实现
- 编译时校验：确保实现覆盖所有接口方法
- 文档即代码：接口本身就是使用文档

---

### P03 —— 工厂统一入口

**描述**：通过一个 `Factory` 类组合多个子系统组件，对外提供简单一致的 API，屏蔽内部组合细节。

```typescript
export class SkillFactory {
  private loader: SkillLoader;
  private validator: SkillValidator;
  private executor: SkillExecutor;
  private cache: SkillCache;

  constructor(options: SkillFactoryOptions) {
    this.loader = options.loader;
    this.validator = options.validator ?? new SimpleSkillValidator();
    this.executor = options.executor ?? new PipelineExecutor();
    this.cache = options.cache ?? new DefaultSkillCache();
  }

  // 对外只暴露高层 API
  async execute<TInput, TOutput>(
    skillId: string,
    input: TInput,
    options?: ExecuteOptions,
  ): Promise<SkillOutput<TOutput>> {
    // 内部编排：1. 查缓存 → 2. 加载 → 3. 写缓存 → 4. 校验 → 5. 执行
    const skill = await this.load(skillId);
    const validationResult = this.validator.validate(skill);
    // ...
    return this.executor.execute(skill, input, mergedOptions);
  }
}
```

**适用场景**：
- 消费者需要"一键执行"而非手动编排多个组件
- 有默认实现但允许消费者注入自定义组件

**模式变体**：依赖注入 + 默认值回退。

---

## 3. 代码结构范式

### P04 —— Result 判别联合

**描述**：使用 TypeScript 的判别联合类型（Discriminated Union）表示操作结果，避免抛出异常作为流程控制。

```typescript
export type SkillOutput<TOutput = unknown> =
  | { success: true; data: TOutput; meta?: ExecutionMeta }
  | { success: false; error: SkillError; meta?: ExecutionMeta };

// 消费者使用时，通过 success 字段区分
const result = await executor.execute(skill, input);
if (result.success) {
  console.log(result.data);  // TypeScript 自动收窄类型
} else {
  console.error(result.error.code, result.error.message);
}
```

**收益**：
- 类型安全的错误处理
- 强制消费者处理错误路径（不处理会得到类型错误）
- 执行元信息（duration, version, timestamp）统一附加

**可复用片段**：

```typescript
// 通用 Result 类型（可提取到 @cortex/shared）
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// 工具函数
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function fail<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
```

---

### P05 —— 泛型三件套

**描述**：为核心接口定义三个泛型参数：`TInput`（输入类型）、`TOutput`（输出类型）、`TEnv`（环境依赖类型），使技能定义在不同使用场景下保持类型安全。

```typescript
export interface SkillDefinition<
  TInput = unknown,
  TOutput = unknown,
  TEnv = Record<string, unknown>,
> {
  meta: SkillMeta;
  execute(ctx: SkillContext<TInput, TEnv>): Promise<SkillOutput<TOutput>>;
  validateInput?(input: unknown): input is TInput;
  onInit?(ctx: SkillInitContext<TEnv>): Promise<void>;
  onDestroy?(): Promise<void>;
}
```

**使用示例**：

```typescript
interface CodeReviewInput {
  prNumber: number;
  files: string[];
}

interface CodeReviewOutput {
  approved: boolean;
  comments: string[];
}

const reviewSkill: SkillDefinition<CodeReviewInput, CodeReviewOutput> = {
  meta: { /* ... */ },
  validateInput(input): input is CodeReviewInput {
    return typeof input === 'object' && input !== null && 'prNumber' in input;
  },
  async execute(ctx) {
    const { prNumber, files } = ctx.input;
    // ctx.input 类型为 CodeReviewInput ✓
    return { success: true, data: { approved: true, comments: [] } };
  },
};
```

---

### P06 —— 注册表映射

**描述**：通过内部 `Map` 维护 `skillId → filePath` 的映射关系，实现按 ID 查找技能入口的解耦。

```typescript
export class DynamicImportLoader implements SkillLoader {
  private registry: Map<string, string> = new Map();

  register(skillId: string, filePath: string): void {
    this.registry.set(skillId, filePath);
  }

  registerMany(entries: Array<{ id: string; path: string }>): void {
    for (const entry of entries) {
      this.registry.set(entry.id, entry.path);
    }
  }

  async load(skillId: string): Promise<SkillDefinition> {
    const filePath = this.registry.get(skillId);
    if (!filePath) {
      throw new Error(`技能 "${skillId}" 未注册`);
    }
    return this.loadFromFile(filePath);
  }
}
```

**收益**：
- 技能 ID 与文件路径解耦：可迁移文件而不影响消费者
- 支持批量注册（`registerMany`）
- 可序列化快照（`getRegistrySnapshot`）

---

### P07 —— 适配器包装

**描述**：将一种数据格式（如 JSON 清单）适配为系统核心类型（`SkillDefinition`），使非原生格式也能参与统一执行管线。

```typescript
private adaptManifest(manifest: SkillManifest): SkillDefinition {
  const meta = this.manifestToMeta(manifest);

  return {
    meta,
    async execute(ctx) {
      // JSON 技能的执行：将 steps 格式化为 prompt 文本
      const prompt = [
        `## 技能：${meta.name}`,
        `**描述**：${meta.description}`,
        ``,
        `### 执行步骤`,
        ...meta.steps.map((step, i) => `${i + 1}. ${step}`),
      ].join("\n");

      return { success: true, data: { prompt } as never };
    },
  };
}
```

**适用场景**：
- 需要将外部格式（JSON / YAML / XML）统一为内部类型
- 需要为旧格式提供兼容层

---

### P08 —— 管线执行器

**描述**：将"执行"分解为一系列有序的阶段（Stage），每个阶段只负责一件事，通过明确的输入/输出连接。

```
execute(skill, input, options)
  │
  ├─ Stage 1: 超时控制     — 创建 AbortController + setTimeout
  ├─ Stage 2: 参数校验     — validateInput 或 inputSchema
  ├─ Stage 3: 初始化钩子   — onInit（仅首次）
  ├─ Stage 4: 构建上下文   — SkillContext、AbortSignal、Store
  ├─ Stage 5: 执行主逻辑   — skill.execute(ctx)
  ├─ Stage 6: 超时检测     — 信号已中止则返回 TIMEOUT
  └─ Stage 7: 收集元信息   — duration, version, timestamp
```

```typescript
export class PipelineExecutor implements SkillExecutor {
  async execute<TInput, TOutput>(
    skill: SkillDefinition<TInput, TOutput>,
    input: TInput,
    options?: ExecuteOptions,
  ): Promise<SkillOutput<TOutput>> {
    // Stage 1: 超时控制
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeout);

    try {
      // Stage 2: 参数校验
      // Stage 3: 初始化钩子
      // Stage 4: 构建上下文
      // Stage 5: 执行主逻辑
      // Stage 6: 超时检测
      // Stage 7: 收集元信息
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
```

**收益**：
- 每个阶段独立可测
- 可插拔：在 future 可以增加新的 stage（如重试、审计日志）
- 错误隔离：每个 stage 的异常都被捕获并包装为对应错误码

---

### P09 —— LRU + TTL 缓存

**描述**：使用 `Map` 的插入顺序特性实现 LRU 淘汰策略，结合 TTL 过期，提供高效的缓存管理。

```typescript
export class DefaultSkillCache implements SkillCache {
  private storage: Map<string, CacheEntry> = new Map();

  get(skillId: string): SkillDefinition | undefined {
    const entry = this.storage.get(skillId);
    if (!entry) { this.misses++; return undefined; }
    if (this.isExpired(entry)) {
      this.storage.delete(skillId);
      this.misses++;
      return undefined;
    }
    // LRU 更新：删除再插入（移动到 Map 末尾）
    this.storage.delete(skillId);
    this.storage.set(skillId, entry);
    this.hits++;
    return entry.skill;
  }

  set(skillId: string, skill: SkillDefinition, ttlMs?: number): void {
    if (this.storage.has(skillId)) this.storage.delete(skillId);
    // 容量检查：超出时删除第一个键（最久未使用）
    if (this.storage.size >= this.maxSize) {
      const oldestKey = this.storage.keys().next().value;
      // 可选：调用 onDestroy
      this.storage.delete(oldestKey);
    }
    this.storage.set(skillId, { skill, loadedAt: Date.now(), ttlMs: ttlMs ?? this.defaultTtlMs });
  }
}
```

**关键点**：
- `Map` 的迭代顺序 = 插入顺序，天然支持 LRU
- get() 时删除再插入 = 移到末尾 = 最近使用
- 超出容量时删除第一个键 = 最久未使用
- TTL 在 get() 时惰性检查

---

### P10 —— 多级校验器

**描述**：将校验分解为多个维度，每个维度独立可配置，错误信息包含字段路径。

```typescript
export class SimpleSkillValidator implements SkillValidator {
  validate(skill: SkillDefinition): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // 1. 结构校验：必填字段是否存在、类型是否正确
    if (!skill || typeof skill !== 'object') { /* error */ }
    if (typeof skill.execute !== 'function') { /* error */ }

    // 2. 语义校验：非空、格式
    this.checkRequiredMetaString(meta, 'name', errors);
    if (meta.steps.length === 0) { /* error */ }

    // 3. Schema 校验（委托给专门的 schema 方法）

    // 4. 版本校验（semver）
    if (!SEMVER_REGEX.test(meta.version)) { /* error */ }

    // 5. 依赖校验（无自引用）
    if (meta.dependencies?.includes(meta.id)) { /* error */ }

    return { valid: errors.length === 0, errors, warnings };
  }
}
```

**校验维度矩阵**：

| 维度 | 检查项 | 严重级别 |
|------|--------|---------|
| 结构 | 字段存在、类型正确 | error |
| 语义 | 非空、长度、格式 | error / warning |
| Schema | JSON Schema 约束 | error |
| 版本 | semver 格式 | error（可配置） |
| 依赖 | 自引用、循环引用 | error |

---

## 4. 开发流程模式

### P11 —— 技能结晶循环（Skill Crystallization Loop）

**描述**：将技能从"松散步骤集合"固化为"可复用技能模块"的完整循环。这是 `@cortex/skill-kit` 中最核心的开发流程模式。

```
┌─────────────────────────────────────────────────────────────────┐
│                    技能结晶循环 (Skill Crystallization Loop)       │
│                                                                   │
│  ① 设计阶段                                                       │
│     ├─ 定义技能元信息 (id/name/version/category/triggerTags)       │
│     ├─ 设计类型契约 (TInput/TOutput/TEnv)                         │
│     └─ 编写设计文档 (docs/design.md)                              │
│         └─ 设计文档需包含：目标、架构图、核心类型、接口、示例       │
│                                                                   │
│  ② 实现阶段                                                       │
│     ├─ 类型层 (types.ts)    → 定义所有类型/接口/枚举               │
│     ├─ 实现层 (各模块)      → 按接口实现具体功能                    │
│     ├─ 工厂层 (factory.ts)  → 组合入口                            │
│     └─ 导出层 (index.ts)    → 桶导出                              │
│         └─ 遵循 "接口契约优先" 原则：先接口，后实现                │
│                                                                   │
│  ③ 测试阶段                                                       │
│     ├─ 单元测试 (tests/*.test.ts) → 每个模块独立测试              │
│     ├─ 端到端测试 (tests/e2e.test.ts) → 完整闭环验证              │
│     └─ 测试技能夹具 (tests/skills/*.ts) → 可复用的测试技能定义    │
│         └─ 覆盖：正常路径、错误路径、边界条件、并发场景            │
│                                                                   │
│  ④ 验证阶段                                                       │
│     ├─ 类型检查 (tsc --noEmit) → 静态类型安全                     │
│     ├─ 构建验证 (tsc) → 产物完整性                                │
│     ├─ 测试运行 (vitest run) → 全部通过                           │
│     └─ 文档审计 → 设计 vs 实现一致性检查                          │
│         └─ 治理审计 (govern.md)、代码审查 (review.md)、           │
│            运维检查 (ops-check.md)、测试报告 (test-report.md)      │
│                                                                   │
│  ← ← ← ← ← ← ← ← ← 循环迭代 ← ← ← ← ← ← ← ← ← ← ←           │
│                                                                   │
│  ⑤ 固化阶段（可选，进入下一轮循环）                               │
│     ├─ 模式提炼 → 更新 docs/patterns.md                          │
│     ├─ 技能 JSON 更新 → 更新对应技能定义文件                      │
│     └─ 检查清单确认 → 标记技能为 active                          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**每个阶段的产出物**：

| 阶段 | 产出物 | 质量门禁 |
|------|--------|---------|
| ① 设计 | `docs/design.md` | 设计文档评审通过 |
| ② 实现 | `src/` 下所有源文件 | `tsc --noEmit` 通过 |
| ③ 测试 | `tests/` 下所有测试文件 | `vitest run` 100% 通过 |
| ④ 验证 | `docs/govern.md`, `docs/review.md`, `docs/ops-check.md`, `docs/test-report.md` | 所有审计报告通过 |
| ⑤ 固化 | `docs/patterns.md`, 技能 JSON 文件 | 模式评审通过 |

---

### P12 —— 设计文档先行

**描述**：在编写任何代码之前，先编写 `docs/design.md` 设计文档，包含目标、架构图、核心类型、接口定义、使用示例。

**设计文档模板**：

```markdown
# @cortex/<package> 设计文档

> 设计者：<name>  
> 版本：v0.1.0  
> 状态：draft  
> 更新：<date>

---

## 1. 设计目标

<!-- 用 3–5 句话说明本包解决什么问题、不解决什么问题 -->

## 2. 架构总览

<!-- ASCII 架构图 + 分层职责表 -->

## 3. 核心类型定义

<!-- 关键类型、接口、枚举的完整定义 -->

## 4. 接口设计

<!-- 所有接口方法的签名和行为描述 -->

## 5. 实现策略

<!-- 关键实现决策（如为什么不使用某个库、为什么选择某种模式） -->

## 6. 使用示例

<!-- 至少 2 个完整示例：基本用法 + 进阶用法 -->

## 7. 与现有系统的关系

<!-- 与其他包的依赖关系、类型映射 -->

## 8. 开放问题

<!-- 未决策的设计问题、待办事项 -->
```

---

## 5. 文档规范模式

### P13 —— 治理-审查-测试三角

**描述**：每个包完成实现后，应产出三份配套文档，从不同视角验证包的质量。

```
                ┌──────────────────┐
                │  设计文档 design.md │
                └────────┬─────────┘
                         │ 驱动实现
                         ▼
                ┌──────────────────┐
                │   源代码 src/     │
                └───┬───┬───┬─────┘
                    │   │   │
         ┌─────────┘   │   └──────────┐
         ▼             ▼              ▼
   ┌──────────┐  ┌──────────┐  ┌────────────┐
   │ govern.md │  │ review.md│  │ test-report │
   │ 治理审计  │  │ 代码审查 │  │ 测试报告    │
   │ (凝光)    │  │ (刻晴)   │  │ (安柏)      │
   └──────────┘  └──────────┘  └────────────┘
         │             │              │
         └─────────────┴──────────────┘
                       ▼
              ┌──────────────────┐
              │  ops-check.md    │
              │  运维就绪检查    │
              │  (北斗)          │
              └──────────────────┘
```

**各文档职责**：

| 文档 | 检查视角 | 关键问题 |
|------|---------|---------|
| `govern.md` | 包治理 | package.json 合规？exports 完整？API vs 设计一致？ |
| `review.md` | 代码质量 | 类型安全？错误处理？模块边界？可测试性？代码风格？ |
| `test-report.md` | 测试覆盖 | 测试用例数？覆盖率？边界场景覆盖？ |
| `ops-check.md` | 运维就绪 | 构建通过？类型检查通过？测试通过？依赖完整？ |

---

### P14 —— 可执行设计文档

**描述**：设计文档中的类型定义、接口签名、使用示例应可直接复制为代码骨架。设计文档 = 代码蓝本。

**实践**：

1. 设计文档中的类型定义直接来自 `types.ts`（保持同步）
2. 接口签名与实现完全一致
3. 使用示例可通过 `tsc --noEmit` 验证

```markdown
<!-- 设计文档中的内容与代码保持一致 -->
### SkillDefinition
```typescript
export interface SkillDefinition<TInput = unknown, TOutput = unknown> {
  meta: SkillMeta;
  execute(ctx: SkillContext<TInput>): Promise<SkillOutput<TOutput>>;
  validateInput?(input: unknown): input is TInput;
}
```
```

---

## 6. 测试模式

### T01 —— 测试技能夹具

**描述**：创建可复用的测试技能工厂函数，避免在每个测试中重复编写完整的 SkillDefinition。

```typescript
// tests/helpers.ts
export function makeSkill(id: string, overrides?: Partial<SkillDefinition>): SkillDefinition {
  return {
    meta: {
      id,
      name: `技能 ${id}`,
      version: "1.0.0",
      description: "测试技能",
      category: SkillCategory.TOOL,
      triggerTags: ["test"],
      trigger: "测试触发",
      steps: ["步骤1"],
      expectedOutput: "测试输出",
    },
    async execute(ctx) {
      return { success: true, data: { id, input: ctx.input } };
    },
    ...overrides,
  };
}
```

### T02 —— 三层测试金字塔

| 层 | 文件模式 | 职责 | 数量原则 |
|---|---------|------|---------|
| 单元测试 | `tests/*.test.ts` | 每个模块独立测试 | 多（每个模块一个文件） |
| 集成测试 | `tests/e2e.test.ts` | 组件间协作验证 | 中（一个完整文件） |
| E2E 测试 | `tests/e2e.test.ts` | 完整闭环 | 少（覆盖核心场景） |

### T03 —— 场景命名规范

```typescript
describe("E2E: 完整闭环 —— 加载 → 校验 → 缓存 → 执行", () => {
  it("场景 1: 加载 .ts 技能 → 校验 → 缓存 → 执行 → 断言", async () => { /* ... */ });
  it("场景 2: 第二次加载走缓存命中路径", async () => { /* ... */ });
  it("场景 3: 缓存未命中 → 加载技能 → 写入缓存", async () => { /* ... */ });
  it("场景 4: JSON 技能完整闭环", async () => { /* ... */ });
  it("场景 5: 无效技能定义校验失败", async () => { /* ... */ });
  it("场景 6: validateInput 拒绝非法输入", async () => { /* ... */ });
  it("场景 7: 执行抛出异常返回 EXECUTION_FAILED", async () => { /* ... */ });
  it("场景 8: evict 主动失效缓存", async () => { /* ... */ });
  it("场景 9: clear 清空全部缓存", async () => { /* ... */ });
  it("场景 10: 超出 maxSize 触发 LRU 淘汰", async () => { /* ... */ });
});
```

### T04 —— 临时文件管理模式

```typescript
// 创建临时 JSON 技能文件
function createTempJsonSkill(overrides?: Partial<SkillManifest>): string {
  const id = `e2e-${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const filePath = join(TMP_DIR, `${id}.json`);
  writeFileSync(filePath, JSON.stringify({ /* ... */ }));
  return filePath;
}

// 清理（在 afterEach 或 finally 中调用）
function cleanupTempFile(filePath: string): void {
  try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* ignore */ }
}
```

---

## 7. 可复用片段

### 7.1 基础技能模板

```typescript
import { type SkillDefinition, type SkillContext, type SkillOutput, SkillCategory } from "@cortex/skill-kit";

// === 类型定义 ===
export interface MySkillInput {
  /** 主参数 */
  target: string;
  /** 可选：详细模式 */
  verbose?: boolean;
}

export interface MySkillOutput {
  message: string;
  details: Record<string, unknown>;
}

// === 技能定义 ===
const mySkill: SkillDefinition<MySkillInput, MySkillOutput> = {
  meta: {
    id: "my-skill",
    name: "我的技能",
    version: "1.0.0",
    description: "用于处理特定任务的技能",
    category: SkillCategory.TOOL,
    triggerTags: ["my-tag"],
    trigger: "当需要执行特定任务时触发",
    steps: [
      "接收输入参数",
      "处理主逻辑",
      "返回处理结果",
    ],
    expectedOutput: "处理完成并返回结果",
    author: "开发者",
    createdAt: Date.now(),
  },

  validateInput(input: unknown): input is MySkillInput {
    return (
      typeof input === "object" &&
      input !== null &&
      "target" in input &&
      typeof (input as Record<string, unknown>).target === "string"
    );
  },

  async execute(ctx: SkillContext<MySkillInput>): Promise<SkillOutput<MySkillOutput>> {
    const { target, verbose = false } = ctx.input;
    ctx.logger.info(`开始执行技能：target=${target}`);

    try {
      // 主逻辑...

      return {
        success: true,
        data: {
          message: `处理完成: ${target}`,
          details: { processed: true, verbose },
        },
      };
    } catch (cause) {
      ctx.logger.error(`技能执行失败：${(cause as Error).message}`);
      return {
        success: false,
        error: {
          code: "SKILL_EXECUTION_FAILED" as never,
          message: `处理失败：${(cause as Error).message}`,
          cause: cause instanceof Error ? cause : undefined,
        },
      };
    }
  },
};

export default mySkill;
```

### 7.2 JSON 技能清单模板

```json
{
  "id": "skill-example",
  "agentType": "code",
  "name": "示例技能",
  "version": "1.0.0",
  "category": "tool",
  "triggerTags": ["example"],
  "trigger": "当需要处理示例任务时触发",
  "steps": [
    "分析输入参数",
    "执行示例处理逻辑",
    "返回处理结果"
  ],
  "expectedOutput": "示例技能执行结果",
  "outputFile": "output/example-result.md",
  "status": "draft",
  "discoveredBy": "开发者",
  "createdAt": 1
}
```

### 7.3 测试单元模板

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { type SkillDefinition, SkillCategory } from "../src/types.js";
import { PipelineExecutor } from "../src/executor.js";

// === 夹具 ===
function makeSkill(id: string, overrides?: Partial<SkillDefinition>): SkillDefinition {
  return {
    meta: {
      id, name: `技能 ${id}`, version: "1.0.0",
      description: "测试技能", category: SkillCategory.TOOL,
      triggerTags: ["test"], trigger: "测试触发",
      steps: ["步骤1"], expectedOutput: "测试输出",
    },
    async execute(ctx) {
      return { success: true, data: { id, input: ctx.input } };
    },
    ...overrides,
  };
}

// === 测试套件 ===
describe("模块名", () => {
  let instance: /* 被测试的类 */;

  beforeEach(() => {
    instance = new /* 被测试的类 */({ /* 配置 */ });
  });

  describe("正常路径", () => {
    it("应成功执行核心功能", async () => {
      // Arrange
      // Act
      // Assert
    });
  });

  describe("异常路径", () => {
    it("应在输入无效时返回错误", async () => { /* ... */ });
    it("应在超时时返回 TIMEOUT", async () => { /* ... */ });
  });

  describe("边界条件", () => {
    it("应处理空输入", async () => { /* ... */ });
    it("应处理大体积数据", async () => { /* ... */ });
  });
});
```

---

## 8. 技能定义模板

### 8.1 TypeScript 技能模板（完整实现）

参见 §7.1 基础技能模板。

### 8.2 JSON 技能清单模板（声明式）

参见 §7.2 JSON 技能清单模板。

### 8.3 SkillFactory 使用模板

```typescript
import { SkillFactory } from "@cortex/skill-kit";
import { DynamicImportLoader } from "@cortex/skill-kit";
import { DefaultSkillCache } from "@cortex/skill-kit";
import path from "node:path";

// 1. 初始化工厂
const factory = new SkillFactory({
  loader: new DynamicImportLoader({
    baseDir: path.resolve(process.cwd(), "skills"),
  }),
  cache: new DefaultSkillCache({ maxSize: 50, defaultTtlMs: 120_000 }),
});

// 2. 注册技能
factory.registerMany([
  { id: "my-skill", path: "my-skill.ts" },
  { id: "json-skill", path: "json-skill.json" },
]);

// 3. 执行技能
const result = await factory.execute("my-skill", {
  target: "example",
  verbose: true,
});

// 4. 处理结果
if (result.success) {
  console.log("执行成功:", result.data);
} else {
  console.error("执行失败:", result.error.message);
}
```

---

## 9. 检查清单

### 9.1 设计阶段检查清单

- [ ] 设计文档包含：目标、架构图、核心类型、接口、示例
- [ ] 类型定义完整（TInput / TOutput / TEnv）
- [ ] 接口签名明确（方法名、参数、返回值、异常）
- [ ] 与现有系统的关系已分析（依赖、冲突、兼容）
- [ ] 开放问题已记录

### 9.2 实现阶段检查清单

- [ ] 类型层零依赖
- [ ] 实现层 implements 接口
- [ ] 工厂层提供默认值回退
- [ ] 导出层使用 `export type` 导出类型
- [ ] 无 `as never` 绕过类型系统
- [ ] 无声明未使用的配置选项
- [ ] 错误信息使用统一语言（推荐英文）
- [ ] 错误处理使用 Result 模式而非 throw
- [ ] JSON Schema 校验真实有效

### 9.3 测试阶段检查清单

- [ ] 每个模块有对应的单元测试文件
- [ ] 测试技能使用夹具工厂函数
- [ ] 覆盖：正常路径、异常路径、边界条件
- [ ] 临时文件在 afterEach / finally 中清理
- [ ] E2E 测试覆盖完整闭环
- [ ] 避免动态 import() 引入 Node.js 内置模块

### 9.4 验证阶段检查清单

- [ ] `tsc --noEmit` 零错误通过
- [ ] `tsc` 构建产物完整（JS + DTS + SourceMap）
- [ ] `vitest run` 全部通过
- [ ] `docs/govern.md` — 治理审计完成
- [ ] `docs/review.md` — 代码审查完成
- [ ] `docs/ops-check.md` — 运维就绪检查完成
- [ ] `docs/test-report.md` — 测试报告生成
- [ ] 设计文档 vs 实现一致性已确认

### 9.5 固化阶段检查清单

- [ ] `docs/patterns.md` — 模式提炼已更新
- [ ] 技能 JSON 文件已更新 / 创建
- [ ] 检查清单已确认
- [ ] 技能状态已标记为 `active`

---

## 附录 A：模式索引

| 编号 | 模式 | 分类 | 文件 | 行号参考 |
|:----:|------|------|------|---------|
| P01 | 分层四件套架构 | 架构 | `src/types.ts`, `src/factory.ts`, `src/index.ts` | — |
| P02 | 接口契约优先 | 架构 | `src/types.ts` (所有接口), `src/validator.ts` (implements) | — |
| P03 | 工厂统一入口 | 架构 | `src/factory.ts` | 全文件 |
| P04 | Result 判别联合 | 范式 | `src/types.ts` (SkillOutput) | L140–142 |
| P05 | 泛型三件套 | 范式 | `src/types.ts` (SkillDefinition) | L76–82 |
| P06 | 注册表映射 | 范式 | `src/loader.ts` (registry Map) | L48–51 |
| P07 | 适配器包装 | 范式 | `src/loader.ts` (adaptManifest) | L213–253 |
| P08 | 管线执行器 | 范式 | `src/executor.ts` | L87–200 |
| P09 | LRU + TTL 缓存 | 范式 | `src/cache.ts` | L46–160 |
| P10 | 多级校验器 | 范式 | `src/validator.ts` | L56–130 |
| P11 | 技能结晶循环 | 流程 | `docs/design.md` + 各 src 文件 | — |
| P12 | 设计文档先行 | 流程 | `docs/design.md` | 全文件 |
| P13 | 治理-审查-测试三角 | 文档 | `docs/govern.md`, `docs/review.md`, `docs/test-report.md` | — |
| P14 | 可执行设计文档 | 文档 | `docs/design.md` (类型定义与代码一致) | — |

---

## 附录 B：关键决策记录

| 决策 ID | 决策 | 可选方案 | 选择理由 |
|:-------:|------|---------|---------|
| ADR-001 | 使用 `Map` 实现 LRU 而非 `lru-cache` 包 | `lru-cache` npm 包 | 零依赖原则；实现简单，15 行核心逻辑 |
| ADR-002 | 使用 Result 模式而非 throw | throw 异常 | 类型安全；强制消费者处理错误 |
| ADR-003 | 接口定义在 `types.ts` 而非独立文件 | 独立 `interfaces.ts` | 保持核心类型集中，减少文件数 |
| ADR-004 | JSON 技能适配返回 `{ prompt }` 而非直接执行 | 直接执行 steps | JSON 技能无程序化逻辑，需 LLM 理解执行 |
| ADR-005 | 缓存默认 TTL 60 秒 | 30 秒 / 120 秒 / 无 TTL | 平衡内存占用与加载频率 |
| ADR-006 | 使用 `NodeNext` 模块解析 | `Node16` / `ESNext` | 与 monorepo 约定一致；支持 ESM 显式扩展名 |

---

> **模式版本**：v0.1.0  
> **最后更新**：2026-07-30  
> **提炼者**：莫娜（Mona）— Pattern Analysis Agent  
> **下次回顾建议**：在完成下一个技能包开发后，验证本模式体系的通用性和完整性。
