# @cortex/skill-kit 设计文档

> 设计者：纳西妲（AnalysisAgent）  
> 版本：v0.1.0  
> 状态：draft  
> 更新：2026-06-15

---

## 目录

1. [设计目标](#1-设计目标)
2. [架构总览](#2-架构总览)
3. [核心类型定义](#3-核心类型定义)
4. [接口设计](#4-接口设计)
5. [动态加载机制](#5-动态加载机制)
6. [缓存策略](#6-缓存策略)
7. [执行管线](#7-执行管线)
8. [与现有系统的关系](#8-与现有系统的关系)
9. [开放问题](#9-开放问题)

---

## 1. 设计目标

`@cortex/skill-kit` 定位为 **技能开发工具包**，提供一套简洁、类型安全的接口，使开发者能够：

1. **定义技能** —— 以 `.ts` 模块或 `.json` 文件形式声明技能
2. **动态加载** —— 支持 `import()` 运行时加载 `.ts` 技能模块（含依赖解析）
3. **校验技能** —— 确保技能定义符合契约，包含完整元信息
4. **执行技能** —— 提供统一的执行上下文、中止信号、超时控制
5. **缓存技能** —— 缓存已解析的技能实例，避免重复加载

### 非目标

- 不取代 `@cortex/engine` 中的 `DefaultSkillRegistry`（专业注册表）
- 不管理技能依赖图（依赖图由注册表负责，skill-kit 只做单技能加载）
- 不实现技能发现/扫描（由 `SkillScanner` 在 engine 层完成）

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    @cortex/skill-kit                      │
│                                                          │
│  ┌─────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ SkillLoader  │  │ SkillCache  │  │ SkillExecutor    │  │
│  │ (动态加载)    │  │ (缓存管理)  │  │ (执行管线)       │  │
│  └──────┬──────┘  └─────┬──────┘  └───────┬──────────┘  │
│         │               │                  │              │
│  ┌──────┴───────────────┴──────────────────┴────────┐    │
│  │              SkillDefinition 类型系统              │    │
│  │  (SkillDef / SkillMeta / SkillInput / SkillOutput)│    │
│  └──────────────────────┬───────────────────────────┘    │
│                         │                                 │
│  ┌──────────────────────┴───────────────────────────┐    │
│  │         Validator / Schema 校验层                  │    │
│  │  (运行时校验 SkillDef 完整性 + JSON Schema 校验)  │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
           │                          ▲
           │ import() / fs.read       │ 返回 SkillDef
           ▼                          │
┌────────────────────┐    ┌───────────────────────────┐
│  skills/*.ts 模块   │    │  skills/*.json 声明       │
│  (动态加载,含实现)   │    │  (静态声明,仅元信息+步骤)  │
└────────────────────┘    └───────────────────────────┘
```

### 分层职责

| 层 | 模块 | 职责 |
|----|------|------|
| **类型层** | `types.ts` | `SkillDefinition`, `SkillMeta`, `SkillInput`, `SkillOutput` 等核心类型 |
| **加载层** | `loader.ts` | `SkillLoader` 接口 + `DynamicImportLoader` 实现（支持 `.ts`/`.json`） |
| **缓存层** | `cache.ts` | `SkillCache` 接口 + `DefaultSkillCache`（LRU + TTL） |
| **校验层** | `validator.ts` | `SkillValidator` 接口 + JSON Schema / 运行时双重校验 |
| **执行层** | `executor.ts` | `SkillExecutor` 接口 + 执行管线（前置校验→执行→后置处理） |
| **桶导出** | `index.ts` | 公开 API surface |

---

## 3. 核心类型定义

### 3.1 SkillDefinition —— 技能定义（开发者视角）

```typescript
/**
 * 技能定义——开发者编写技能时的核心类型。
 *
 * 兼容两种形态：
 * 1. TypeScript 模块（.ts）—— 完整实现，通过 export default 导出
 * 2. JSON 文件（.json）—— 仅声明元信息 + 步骤，执行时由适配器包装
 *
 * @template TInput  技能输入参数类型
 * @template TOutput 技能输出结果类型
 * @template TEnv    执行环境依赖类型（可选，用于依赖注入）
 */
export interface SkillDefinition<TInput = unknown, TOutput = unknown, TEnv = Record<string, unknown>> {
  /** 技能元信息 */
  meta: SkillMeta;

  /**
   * 技能主执行函数。
   * 接受 SkillContext 上下文，返回执行结果。
   * 支持异步，支持 AbortSignal 中止。
   */
  execute(ctx: SkillContext<TInput, TEnv>): Promise<SkillOutput<TOutput>>;

  /**
   * （可选）输入参数校验函数。
   * 返回 true 表示参数有效，false 表示无效。
   * 未实现时使用 meta.inputSchema 做 JSON Schema 校验。
   */
  validateInput?(input: unknown): input is TInput;

  /**
   * （可选）技能初始化钩子——在技能第一次执行前调用。
   * 可用于建立连接、加载资源等。
   */
  onInit?(ctx: SkillInitContext<TEnv>): Promise<void>;

  /**
   * （可选）技能销毁钩子——在技能被卸载时调用。
   * 可用于释放资源、关闭连接等。
   */
  onDestroy?(): Promise<void>;
}
```

### 3.2 SkillMeta —— 技能元信息

```typescript
/**
 * 技能元信息——描述技能的身份、分类、能力。
 *
 * 字段设计原则：
 * - 与 @cortex/shared 的 SkillTemplate 保持语义兼容（id/name/triggerTags/steps）
 * - 新增 version/entry/category/inputSchema/outputSchema 以支持可执行技能
 * - name 和 description 支持中文，便于 LLM 理解技能用途
 */
export interface SkillMeta {
  /** 唯一标识符（如 "skill-p10-ci-gate"） */
  id: string;

  /** 展示名称（如 "CI 门禁全流程"），支持中文 */
  name: string;

  /** 语义化版本号（遵循 semver，如 "1.0.0"） */
  version: string;

  /** 详细描述——解释技能的能力、适用场景 */
  description: string;

  /** 技能类别 */
  category: SkillCategory;

  /** 触发标签——与 Agent 标签匹配 */
  triggerTags: string[];

  /** 触发条件描述（自然语言，供 LLM 理解） */
  trigger: string;

  /** 执行步骤（自然语言描述，供 LLM 注入使用） */
  steps: string[];

  /** 预期产出描述 */
  expectedOutput: string;

  /** 技能作者 */
  author?: string;

  /** 依赖的其他技能 ID 列表 */
  dependencies?: string[];

  /** 入口文件路径（相对于 skills/ 目录），供 loadFromFile 使用 */
  entry?: string;

  /** （可选）输入参数 JSON Schema */
  inputSchema?: Record<string, unknown>;

  /** （可选）输出结果 JSON Schema */
  outputSchema?: Record<string, unknown>;

  /** 支持的操作系统平台 */
  platforms?: Array<'node' | 'browser' | 'worker'>;

  /** 自定义扩展元数据 */
  extensions?: Record<string, unknown>;

  /** 创建时间戳 */
  createdAt?: number;
}

/**
 * 技能分类枚举。
 * 与 @cortex/engine 的 SkillCategory 保持一致。
 */
export enum SkillCategory {
  DATA = 'data',           // 数据获取与处理
  NLP = 'nlp',             // 文本生成与 NLP
  TOOL = 'tool',           // 工具调用（API/Shell/FS）
  REASONING = 'reasoning', // 认知推理
  MEMORY = 'memory',       // 记忆存储
  COMMUNICATION = 'communication', // 通信交互
  SYSTEM = 'system',       // 系统内置
}
```

### 3.3 SkillContext —— 执行上下文

```typescript
/**
 * 技能执行上下文——技能执行时接收的运行时环境。
 *
 * 设计要点：
 * - input: 技能输入参数（类型由泛型 TInput 约束）
 * - env: 环境依赖（类型由泛型 TEnv 约束，如 toolkit/memory 等）
 * - signal: AbortSignal 用于支持超时/取消
 * - logger: 结构化日志接口
 * - store: 技能间共享的 KV 存储
 */
export interface SkillContext<TInput = unknown, TEnv = Record<string, unknown>> {
  /** 技能输入参数 */
  input: TInput;

  /** 环境依赖注入（toolkit, memory, llm 等） */
  env: TEnv;

  /** 中止信号（超时 / 手动取消） */
  signal: AbortSignal;

  /** 结构化日志记录器 */
  logger: SkillLogger;

  /** 上下文存储（技能间共享临时数据） */
  store: Map<string, unknown>;

  /** 调用方跟踪 ID */
  traceId: string;
}

/**
 * 技能初始化上下文——onInit 钩子接收的环境。
 * 比 SkillContext 更轻量，不含 input。
 */
export interface SkillInitContext<TEnv = Record<string, unknown>> {
  env: TEnv;
  logger: SkillLogger;
}

/**
 * 结构化日志接口。
 * 与 @cortex/engine 的 Logger 接口保持一致。
 */
export interface SkillLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}
```

### 3.4 SkillOutput —— 执行结果

```typescript
/**
 * 技能执行结果。
 *
 * 遵循 Result 模式（成功/失败判别联合）：
 * - success: true  → data 包含输出
 * - success: false → error 包含错误信息
 */
export type SkillOutput<TOutput = unknown> =
  | { success: true; data: TOutput; meta?: ExecutionMeta }
  | { success: false; error: SkillError; meta?: ExecutionMeta };

/**
 * 执行元信息——记录技能执行的运行时数据。
 */
export interface ExecutionMeta {
  /** 执行耗时（毫秒） */
  duration: number;
  /** 实际使用的技能版本 */
  version: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 技能错误。
 */
export interface SkillError {
  code: SkillErrorCode;
  message: string;
  details?: unknown;
  cause?: Error;
}

/**
 * 技能错误码枚举。
 */
export enum SkillErrorCode {
  NOT_FOUND = 'SKILL_NOT_FOUND',
  LOAD_FAILED = 'SKILL_LOAD_FAILED',
  VALIDATION_FAILED = 'SKILL_VALIDATION_FAILED',
  EXECUTION_FAILED = 'SKILL_EXECUTION_FAILED',
  TIMEOUT = 'SKILL_TIMEOUT',
  ABORTED = 'SKILL_ABORTED',
  INIT_FAILED = 'SKILL_INIT_FAILED',
  INTERNAL_ERROR = 'SKILL_INTERNAL_ERROR',
}
```

### 3.5 SkillManifest —— JSON 技能清单

```typescript
/**
 * 技能清单——JSON 文件格式的技能声明。
 *
 * 对应 skills/ 目录下的 *.json 文件。
 * 与 SkillTemplate 结构兼容，扩展了 version/category 字段。
 * JSON 技能没有自定义 execute 实现——执行时由包装器
 * 将 steps 作为 prompt 注入 LLM 上下文执行。
 */
export interface SkillManifest {
  /** 技能唯一标识 */
  id: string;
  /** 归属 Agent 类型 */
  agentType: string;
  /** 展示名称 */
  name: string;
  /** 版本号 */
  version?: string;
  /** 技能类别 */
  category?: SkillCategory;
  /** 触发标签 */
  triggerTags: string[];
  /** 触发条件 */
  trigger: string;
  /** 步骤序列 */
  steps: string[];
  /** 预期产出 */
  expectedOutput: string;
  /** 输出文件模板 */
  outputFile?: string;
  /** 技能状态 */
  status?: 'draft' | 'trial' | 'active' | 'deprecated';
  /** 作者 */
  discoveredBy?: string;
  /** 创建时间 */
  createdAt?: number;
}
```

---

## 4. 接口设计

### 4.1 SkillLoader —— 技能加载器

```typescript
/**
 * 技能加载器接口——按 ID 或文件路径加载技能定义。
 *
 * 核心职责：
 * 1. 将技能来源（.ts 模块 / .json 文件）统一为 SkillDefinition
 * 2. 处理动态 import() 加载（对 .ts 文件）
 * 3. 将 JSON 清单包装为可执行的 SkillDefinition
 *
 * 兼容 dynamic import() 的设计原则：
 * - .ts 文件使用 dynamic import() 加载（通过 tsx/esbuild 运行时编译）
 * - 加载后的模块应 export default 一个 SkillDefinition 对象
 * - 加载器不处理依赖图——只负责单文件加载
 */
export interface SkillLoader {
  /**
   * 按技能 ID 加载。
   * 内部通过注册的映射表查找技能入口路径，然后调用 loadFromFile。
   */
  load(skillId: string): Promise<SkillDefinition>;

  /**
   * 从文件路径加载技能。
   *
   * 根据文件后缀决定加载策略：
   * - .ts  → dynamic import() + 运行时编译
   * - .json → JSON.parse + 包装为 SkillDefinition（steps 注入 prompt）
   * - .js  → dynamic import()
   */
  loadFromFile(filePath: string): Promise<SkillDefinition>;

  /**
   * 注册技能入口路径。
   * 建立 skillId → filePath 的映射。
   */
  register(skillId: string, filePath: string): void;

  /**
   * 批量注册技能入口。
   */
  registerMany(entries: Array<{ id: string; path: string }>): void;
}
```

### 4.2 SkillValidator —— 技能校验器

```typescript
/**
 * 技能校验器接口——校验 SkillDefinition 的完整性。
 *
 * 校验维度：
 * 1. 结构校验：必填字段是否存在、类型是否正确
 * 2. 语义校验：name 非空、steps 非空、triggerTags 非空
 * 3. Schema 校验：inputSchema/outputSchema 符合 JSON Schema 规范
 * 4. 版本校验：version 符合 semver 格式
 * 5. 依赖校验：dependencies 无自引用
 */
export interface SkillValidator {
  /**
   * 校验技能定义。
   * @returns 校验结果，包含所有错误信息。
   */
  validate(skill: SkillDefinition): ValidationResult;

  /**
   * 校验技能元信息。
   * 轻量级校验——不要求有完整的 SkillDefinition。
   */
  validateMeta(meta: SkillMeta): ValidationResult;

  /**
   * 校验 JSON 技能清单。
   * 将 SkillManifest 转为 SkillMeta 后再校验。
   */
  validateManifest(manifest: SkillManifest): ValidationResult;
}

/**
 * 校验结果。
 */
export interface ValidationResult {
  /** 是否完全通过校验 */
  valid: boolean;
  /** 校验错误列表（valid=true 时为空数组） */
  errors: ValidationError[];
  /** 校验警告列表（不影响 valid 状态） */
  warnings: string[];
}

/**
 * 校验错误。
 */
export interface ValidationError {
  /** 错误字段路径（如 "meta.name"） */
  path: string;
  /** 错误信息 */
  message: string;
  /** 错误严重级别 */
  severity: 'error' | 'warning';
}
```

### 4.3 SkillExecutor —— 技能执行器

```typescript
/**
 * 技能执行器接口——执行技能定义并返回结果。
 *
 * 执行管线：
 *   1. 参数校验（validateInput 或 inputSchema）
 *   2. 执行前钩子（onInit——仅首次执行时调用）
 *   3. 执行主逻辑（execute）
 *   4. 超时控制（AbortSignal + timeout）
 *   5. 执行元信息收集（duration, timestamp）
 *   6. 结果返回（成功/失败）
 *
 * 执行器不管理生命周期——每次 execute 调用独立。
 * 缓存管理由 SkillCache 负责。
 */
export interface SkillExecutor {
  /**
   * 执行技能。
   *
   * @param skill   技能定义
   * @param input   技能输入参数
   * @param options 执行选项（超时、环境依赖等）
   * @returns 执行结果
   */
  execute<TInput, TOutput>(
    skill: SkillDefinition<TInput, TOutput>,
    input: TInput,
    options?: ExecuteOptions,
  ): Promise<SkillOutput<TOutput>>;
}

/**
 * 执行选项。
 */
export interface ExecuteOptions {
  /** 环境依赖注入 */
  env?: Record<string, unknown>;
  /** 超时时间（毫秒），默认 30_000 */
  timeout?: number;
  /** 自定义日志记录器 */
  logger?: SkillLogger;
  /** 调用方跟踪 ID */
  traceId?: string;
}
```

### 4.4 SkillCache —— 技能缓存

```typescript
/**
 * 技能缓存接口——缓存已加载/已初始化的技能定义。
 *
 * 缓存策略：
 * - LRU（最近最少使用）淘汰
 * - TTL（存活时间）过期
 * - 主动失效（evict/unregister）
 *
 * 缓存粒度：按 skill ID 缓存完整的 SkillDefinition 实例。
 * 已初始化的技能（onInit 已调用）会标记 initialized。
 */
export interface SkillCache {
  /**
   * 获取缓存的技能定义。
   * 返回 undefined 表示缓存未命中。
   */
  get(skillId: string): SkillDefinition | undefined;

  /**
   * 设置缓存。
   * @param ttlMs 可选——自定义 TTL，不传则使用默认 TTL。
   */
  set(skillId: string, skill: SkillDefinition, ttlMs?: number): void;

  /**
   * 检查技能是否在缓存中。
   */
  has(skillId: string): boolean;

  /**
   * 主动失效指定技能缓存。
   */
  evict(skillId: string): void;

  /**
   * 清空所有缓存。
   */
  clear(): void;

  /**
   * 获取缓存统计信息（命中率、大小等）。
   */
  stats(): CacheStats;
}

/**
 * 缓存统计。
 */
export interface CacheStats {
  /** 缓存条目数 */
  size: number;
  /** 缓存最大容量 */
  maxSize: number;
  /** 命中次数 */
  hits: number;
  /** 未命中次数 */
  misses: number;
  /** 命中率 */
  hitRate: number;
}
```

### 4.5 SkillFactory —— 统一入口工厂

```typescript
/**
 * SkillFactory —— 技能系统的统一入口。
 *
 * 组合 Loader + Validator + Executor + Cache 四件套，
 * 对外提供简洁的 API。
 *
 * 典型用法：
 * ```typescript
 * const factory = new SkillFactory({
 *   loader: new DynamicImportLoader(),
 *   cache: new DefaultSkillCache({ maxSize: 100, ttl: 60_000 }),
 * });
 *
 * // 加载并执行技能
 * const result = await factory.execute('skill-p10-ci-gate', {
 *   branch: 'feature/xxx',
 * });
 * ```
 */
export interface SkillFactory {
  /** 加载技能（优先查缓存，未命中则调用 loader.load） */
  load(skillId: string): Promise<SkillDefinition>;

  /** 执行技能（load + validate + execute 一站式） */
  execute<TInput, TOutput>(
    skillId: string,
    input: TInput,
    options?: ExecuteOptions,
  ): Promise<SkillOutput<TOutput>>;

  /** 校验技能 */
  validate(skillId: string): Promise<ValidationResult>;

  /** 获取加载器引用 */
  getLoader(): SkillLoader;

  /** 获取缓存引用 */
  getCache(): SkillCache;

  /** 释放资源（销毁所有缓存的技能实例） */
  dispose(): Promise<void>;
}

/**
 * SkillFactory 配置选项。
 */
export interface SkillFactoryOptions {
  loader: SkillLoader;
  validator?: SkillValidator;
  executor?: SkillExecutor;
  cache?: SkillCache;
  /** 默认超时时间（毫秒） */
  defaultTimeout?: number;
  /** 默认日志记录器 */
  logger?: SkillLogger;
}
```

---

## 5. 动态加载机制

### 5.1 .ts 技能模块规范

每个 `.ts` 技能模块应遵循以下约定：

```typescript
// skills/my-skill.ts
import type { SkillDefinition } from '@cortex/skill-kit';

interface MySkillInput {
  target: string;
  verbose?: boolean;
}

interface MySkillOutput {
  message: string;
  details: Record<string, unknown>;
}

const skill: SkillDefinition<MySkillInput, MySkillOutput> = {
  meta: {
    id: 'my-skill',
    name: '我的技能',
    version: '1.0.0',
    description: '这是一个示例技能',
    category: SkillCategory.TOOL,
    triggerTags: ['code', 'refactor'],
    trigger: '需要执行自定义操作时',
    steps: ['步骤1', '步骤2'],
    expectedOutput: '完成操作并返回结果',
    author: '纳西妲',
  },

  validateInput(input: unknown): input is MySkillInput {
    return (
      typeof input === 'object' &&
      input !== null &&
      'target' in input &&
      typeof (input as Record<string, unknown>).target === 'string'
    );
  },

  async execute(ctx) {
    const { target, verbose } = ctx.input;
    ctx.logger.info(`执行技能: target=${target}`);

    return {
      success: true,
      data: {
        message: `处理完成: ${target}`,
        details: { processed: true, verbose: verbose ?? false },
      },
    };
  },
};

export default skill;
```

### 5.2 DynamicImportLoader 实现策略

```typescript
/**
 * DynamicImportLoader —— 基于 dynamic import() 的技能加载器。
 *
 * 加载策略：
 * - .ts 文件：通过 tsx 注册的 loader（--loader tsx）或 esbuild 运行时编译
 *   实现 dynamic import() 加载 TypeScript 模块
 * - .json 文件：import() 会自动解析为对象，或 fallback 到 fs.readFile + JSON.parse
 * - .js 文件：原生 dynamic import() 支持
 *
 * 路径解析：
 * - 相对路径：相对于 skills/ 目录
 * - 绝对路径：直接使用
 * - 模块名：通过注册表映射表查找
 *
 * 注意事项：
 * - dynamic import() 返回模块命名空间对象，需提取 default export
 * - 同一文件多次 import() 可能返回同一模块缓存（Node.js ESM 缓存）
 * - 如需强制重新加载，需操作 require.cache 或使用 URL 查询参数
 */
export class DynamicImportLoader implements SkillLoader {
  // ... 实现细节参见 src/loader/dynamic-import-loader.ts
}
```

### 5.3 JSON 技能适配器

对于 `skills/` 目录下的 `.json` 技能文件（如 `skill-p10-ci-gate.json`），加载器会自动将其包装为 `SkillDefinition`：

```typescript
/**
 * JSON 技能适配策略：
 * - meta: 从 JSON 字段映射（id/name/triggerTags/steps → SkillMeta）
 * - execute: 注入式执行——将 steps 格式化为 prompt 文本，
 *   由上层 LLM Agent 理解并执行，非程序化调用
 * - validateInput: 默认 JSON Schema 校验（如果有 inputSchema）
 * - onInit / onDestroy: 空实现
 */
function adaptManifest(manifest: SkillManifest): SkillDefinition {
  return {
    meta: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version ?? '0.1.0',
      description: `${manifest.trigger} → ${manifest.expectedOutput}`,
      category: manifest.category ?? SkillCategory.TOOL,
      triggerTags: manifest.triggerTags,
      trigger: manifest.trigger,
      steps: manifest.steps,
      expectedOutput: manifest.expectedOutput,
      author: manifest.discoveredBy,
      createdAt: manifest.createdAt,
    },
    async execute(ctx) {
      // JSON 技能的执行是将 steps 以 prompt 形式注入
      // 实际由 LLM Agent 理解执行，此处返回 prompt 文本
      const prompt = this._formatPrompt(manifest, ctx.input);
      return { success: true, data: { prompt } as never };
    },
  };
}
```

---

## 6. 缓存策略

### 6.1 DefaultSkillCache 设计

```
缓存键: skillId (string)
缓存值: { skill: SkillDefinition; initialized: boolean; loadedAt: number }
淘汰策略: LRU (最近最少使用)
TTL: 默认 60 秒，可在 set() 时按技能自定义
最大容量: 默认 100 个技能
```

### 6.2 缓存生命周期

```
load(skillId)
  ├─ 缓存命中 && 未过期
  │    └─ 返回缓存值（更新 LRU）
  ├─ 缓存命中 && 已过期
  │    ├─ 删除旧缓存
  │    ├─ 调用 loader.load(skillId) 重新加载
  │    └─ 写入缓存
  └─ 缓存未命中
       ├─ 调用 loader.load(skillId)
       └─ 写入缓存

evict(skillId)
  └─ 如果技能已初始化，调用 skill.onDestroy()
  └─ 从缓存中删除

clear()
  └─ 遍历所有已缓存的技能，调用 onDestroy()
  └─ 清空缓存
```

---

## 7. 执行管线

### 7.1 execute 流程图

```
execute(skill, input, options)
  │
  ├─ 检查 AbortSignal（若已中止，直接返回 SKILL_ABORTED）
  │
  ├─ 参数校验
  │   ├─ skill.validateInput? → 类型守卫校验
  │   └─ skill.meta.inputSchema? → JSON Schema 校验
  │   └─ 校验失败 → 返回 VALIDATION_FAILED
  │
  ├─ onInit 调用（仅首次）
  │   └─ 初始化失败 → 返回 INIT_FAILED
  │
  ├─ 设置超时控制
  │   ├─ 创建 AbortController + timeout
  │   └─ 合并传入的 signal
  │
  ├─ 执行主逻辑
  │   ├─ skill.execute(ctx)
  │   └─ 捕获异常 → 封装为 SKILL_EXECUTION_FAILED
  │
  ├─ 收集执行元信息
  │   └─ duration / version / timestamp
  │
  └─ 返回 SkillOutput
```

---

## 8. 与现有系统的关系

### 8.1 与 @cortex/shared 的关系

| @cortex/shared 类型 | @cortex/skill-kit 对应 | 关系 |
|---------------------|----------------------|------|
| `SkillTemplate` | `SkillManifest` | JSON 技能清单兼容 SkillTemplate 结构 |
| `SkillRegistryData` | — | skill-kit 不管理注册表数据 |
| `SerializedSkillRegistry` | — | skill-kit 不管理序列化 |
| `Tag` | `string`（triggerTags） | 使用相同标签词汇表 |

### 8.2 与 @cortex/engine 的关系

| @cortex/engine 组件 | @cortex/skill-kit 对应 | 关系 |
|----------------------|----------------------|------|
| `DefaultSkillRegistry` | `SkillFactory` | skill-kit 提供简化版，engine 提供完整版 |
| `Skill` (interface) | `SkillDefinition` | 语义等价，命名不同避免混淆 |
| `BaseSkill` | — | skill-kit 无基类，使用纯接口 + 函数式 |
| `SkillLoader` (interface) | `SkillLoader` | 同名但职责精简（无扫描功能） |
| `SkillContainer` | `SkillCache` | 容器的缓存部分 |
| `SkillExecutor` | `SkillExecutor` | skill-kit 的更轻量 |
| `ExecutionContext` | `SkillContext` | 语义等价，字段对齐 |

### 8.3 技能文件对照

```
skills/ 目录（monorepo 根）:
  skill-p10-ci-gate.json          ← SkillManifest 格式
  skill-p11-skill-crystallization.json
  ...
  skill-p37-full-chain-final-acceptance.json

skills/ 目录（按 Agent 分类，未来）:
  skills/code/                    ← .ts 可执行技能模块
  skills/analysis/                ← .ts 分析型技能
  skills/review/                  ← .ts 审查型技能
```

---

## 9. 开放问题

1. **动态 import() 的运行时编译**：`.ts` 文件的 `import()` 需要 `tsx` 或 `esbuild` 注册 loader。在 `@cortex/skill-kit` 中，我们是否应内置编译能力，还是要求消费者自行注册 loader？

2. **缓存一致性**：当技能文件在磁盘上被修改后，缓存如何感知？是否需要文件监听（`fs.watch`）？

3. **校验 Schema 格式**：`inputSchema` 和 `outputSchema` 使用 JSON Schema 哪一版本？Draft-07 / 2020-12？

4. **SkillManifest 的 status 语义**：`draft/trial/active/deprecated` 状态机是否应与 `@cortex/shared` 的 `SkillTemplate.status` 完全一致？是否需要在 skill-kit 中实现状态转换逻辑？

5. **跨包类型复用**：`SkillCategory`、`SkillErrorCode` 等枚举是否应定义在 `@cortex/shared` 中以实现跨包统一，还是保持在 `@cortex/skill-kit` 本地以降低耦合？

> 建议：将 SkillCategory 和 SkillErrorCode 上提到 @cortex/shared，使 engine 和 skill-kit 共用同一套枚举定义。

---

## 附录 A：文件结构

```
packages/skill-kit/
├── docs/
│   └── design.md              ← 本文档
├── src/
│   ├── index.ts               ← 桶导出
│   ├── types.ts               ← 核心类型定义
│   ├── interfaces.ts          ← 接口定义
│   ├── loader/
│   │   ├── types.ts           ← 加载器类型
│   │   └── dynamic-import-loader.ts  ← 动态加载实现
│   ├── cache/
│   │   ├── types.ts           ← 缓存类型
│   │   └── default-cache.ts   ← 默认 LRU 缓存实现
│   ├── validator/
│   │   ├── types.ts           ← 校验器类型
│   │   └── schema-validator.ts ← 校验器实现
│   ├── executor/
│   │   ├── types.ts           ← 执行器类型
│   │   └── pipeline-executor.ts ← 执行管线实现
│   └── factory.ts             ← SkillFactory 实现
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## 附录 B：使用示例

```typescript
// 初始化
const factory = new SkillFactory({
  loader: new DynamicImportLoader({
    baseDir: path.resolve(process.cwd(), 'skills'),
  }),
  cache: new DefaultSkillCache({ maxSize: 50, defaultTtlMs: 120_000 }),
});

// 注册技能入口
factory.getLoader().registerMany([
  { id: 'ci-gate', path: 'skill-p10-ci-gate.json' },
  { id: 'code-review', path: 'code/review-skill.ts' },
]);

// 执行 JSON 技能（注入式 prompt）
const result = await factory.execute('ci-gate', {
  branch: 'feature/xxx',
  steps: ['build', 'test'],
});

// 执行 .ts 技能（程序化执行）
const tsResult = await factory.execute('code-review', {
  prNumber: 42,
  files: ['src/main.ts'],
}, {
  timeout: 60_000,
  env: { toolkit, memory },
});
```
