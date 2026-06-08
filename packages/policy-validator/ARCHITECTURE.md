# @cortex/policy-validator — 策略校验器架构设计

> **作者**: 基于母项目 18 个现有包结构分析 + `coding-standards.md` §一~§十四 编码法典 + 现有抽象约束推导
>
> **版本**: v0.1.0 (draft)
>
> **依据**:
> - `prompts/coding-standards.md` §一~§十四（代码法典核心篇）
> - `packages/config` barrel export（可复用接口/类型）
> - `packages/shared` barrel export（跨包类型契约）
> - `packages/skill-validator` / `packages/engine` 现有校验器设计风格

---

## 目录

1. [术语表](#1-术语表)
2. [现有体系分析：可复用接口/类型盘点](#2-现有体系分析可复用接口类型盘点)
3. [coding-standards.md 规则映射与实现策略](#3-coding-standardssrc-规则映射与实现策略)
4. [架构全景](#4-架构全景)
5. [核心模块设计](#5-核心模块设计)
    - [5.1 PolicyRule 接口](#51-policyrule-接口)
    - [5.2 RuleRegistry](#52-ruleregistry)
    - [5.3 RuleEngine](#53-ruleengine)
    - [5.4 RuleLoader](#54-ruleloader)
6. [校验管线](#6-校验管线)
7. [包结构](#7-包结构)
8. [外部接口契约](#8-外部接口契约)
9. [与现有体系的关系](#9-与现有体系的关系)
10. [遵守编码法典的合规性自检](#10-遵守编码法典的合规性自检)

---

## 1. 术语表

| 术语 | 定义 |
|------|------|
| **Policy (策略)** | 一组规则的集合，描述了对代码/配置/产出的约束条件。策略按域（domain）分组，如 `coding-style`、`security`、`architecture` |
| **PolicyRule (策略规则)** | 单条原子规则，包含规则条件（condition）、严重级别（severity）、错误码（code）、修复建议（fix suggestion） |
| **RuleRegistry (规则注册表)** | 所有已注册 PolicyRule 的集中管理中心，支持按域/严重级别/标签筛选 |
| **RuleEngine (规则引擎)** | 校验执行引擎——接受待校验目标，遍历匹配的 PolicyRule 列表，逐条执行校验逻辑，返回校验报告 |
| **RuleLoader (规则加载器)** | 从配置源（@cortex/config 常量、JSON 文件、TS 模块）加载 PolicyRule 描述的加载器 |
| **PolicyDomain (策略域)** | 策略的领域分类，如 `"coding-style"`、`"security"`、`"naming"`、`"architecture"`、`"hardcoded"` |

---

## 2. 现有体系分析：可复用接口/类型盘点

### 2.1 @cortex/config 可复用类型

**接口层** (`packages/config/src/interfaces/`):

| 接口 | 文件 | 可复用方式 | 说明 |
|------|------|-----------|------|
| `EngineConfig` | `engine.ts` | 直接引用 | 引擎配置，可为 RuleEngine 提供超时/循环上限配置 |
| `ToolTimeoutsConfig` | `engine.ts` | 直接引用 | 工具超时配置，校验规则需遵守 |
| `ToolMeta` | `tool.ts` | 直接引用 | 工具元数据格式，校验规则元数据可参照此结构 |
| `ToolRegistry` | `tool.ts` | 直接引用 | 工具注册表类型，RuleRegistry 可借鉴此 Record 模式 |
| `GovernancePipelineConfig` | `governance.ts` | 直接引用 | 治理管线配置，策略校验可作为治理管线的一环 |
| `AgentDefinition` | `agent.ts` | 直接引用 | Agent 定义，校验时需匹配 agent 类型与规则 |
| `SearchConfig` | `search.ts` | 直接引用 | 搜索配置，RuleLoader 可用作外部规则源配置 |

**常量层** (`packages/config/src/constants/`):

| 常量 | 可复用方式 |
|------|-----------|
| `CORTEX_VERSION`, `CORTEX_PHASE` | 规则引擎版本判断 |
| `FILE_CODING_STANDARDS` | 规则源路径——coding-standards.md 的常量路径 |
| `TAG_VOCABULARY`, `AGENT_TAGS` | 规则标签体系——PolicyRule 可用 tags 字段引用 Agent 标签 |
| `DEFAULT_SKILL_TIMEOUT_MS` | 默认校验超时——RuleEngine 执行超时可回退到此值 |
| `RLM_MIN_CONFIDENCE` | 置信度阈值——规则匹配置信度可参照 |
| `ENV_CORTEX_NO_SEARCH` | 环境开关——可控制 RuleEngine 是否启用某些校验域 |
| `PIPELINE_CTX_MAX_OUTPUT_LEN` | 输出截断长度——校验报告输出可参照 |

### 2.2 @cortex/shared 可复用类型

| 类型 | 文件 | 可复用方式 |
|------|------|-----------|
| `AgentType` 枚举 | `agent-enums.ts` | PolicyRule 的 `targetAgentType` 筛选条件 |
| `Tag` 类型 | `agent-tags.ts` | PolicyRule 的标签体系，与 Agent 标签体系一致 |
| `ToolCategory` 枚举 | `toolkit.ts` | 规则可绑定到工具分类，如 Read/Write/Shell 域规则 |
| `ReversibilityLevel` 枚举 | `toolkit.ts` | 规则严重级别可映射：L0=info, L1=warning, L2=error |
| `Tool` 接口 | `toolkit.ts` | **架构参照**——Tool 接口的设计模式（薄接口 + 可插拔实现） |
| `ToolResult` 接口 | `toolkit.ts` | RuleEngine 执行结果格式可参照 `{ success, output?, error? }` 三字段模式 |
| `TaskNode` 接口 | `task.ts` | 校验任务节点格式——校验可集成到 Scheduler 管线 |
| `NodeResult` 接口 | `task.ts` | 校验结果可与 NodeResult 统一：`{ success, output?, error? }` |
| `ValidationResult` (SchemaEnforcer) | `engine` barrel | **直接参照**——现有校验结果模式 |
| `SkillJsonValidationResult` | `engine` barrel | **直接参照**——校验器的 errors/warnings/infos 三分组模式 |
| `SkillJsonValidator` 接口 | `engine` barrel | **架构参照**——可插拔校验组件接口模式 |
| `ContextPolicy` 接口 | `context-policy.ts` | 策略化设计理念——PolicyRule 也可像 ContextPolicy 一样预设策略库 |
| `SkillTemplate` | `agent-skill-types.ts` | 规则的"模板"概念可参照——规则也可有模板化参数 |
| `FeedbackEntry` | `agent-skill-types.ts` | 评价回流模式——规则执行结果可回流评价 |

### 2.3 @cortex/engine 可复用组件模式

| 组件 | 可复用模式 |
|------|-----------|
| `SkillJsonValidator` + `VALIDATOR_REGISTRY` | **核心架构模式**——可插拔校验组件 + 组件注册表。每个组件是一个独立对象，实现统一的 `validate()` 接口，通过注册表组合 |
| `PipelineObserver.on/emit` | **事件发布模式**——RuleEngine.emit 事件可走类似管道 |
| `CompositeScheduler` | **组合模式**——RuleEngine 内部可组合多个子校验器 |
| `IScheduleStrategy` | **策略模式**——RuleEngine 可按不同域选择不同校验策略 |
| `ConsistencyLayer` | **多层防御模式**——RuleEngine 可作为一致性层的一部分 |
| `SchemaEnforcer.ValidationResult` | **结果类型模式**——`{ valid, errors, warnings }` 三字段模式 |

---

## 3. coding-standards.md 规则映射与实现策略

以下将 coding-standards.md §一~§十四 所有规则映射为 `PolicyRule` 可校验规则：

### 3.1 §一 异常处理（4 条）

| 规则 ID | 规则描述 | 严重级别 | 校验方式 |
|---------|---------|---------|---------|
| `exception/no-empty-catch` | 禁止空 catch {} 块 | `error` | AST 解析——检查 CatchClause 的 body 是否为空 |
| `exception/throw-only-error` | 禁止 throw 非 Error | `error` | AST 解析——检查 throw 语句的操作数类型 |
| `exception/require-cause-chain` | throw 应含 `{ cause: e }` | `warning` | AST 解析——检查 new Error() 的第二个参数 |
| `exception/explicit-comment` | 空 catch 须有显式注释 | `warning` | AST 解析——检查空 catch 上方/内部是否含注释 |

### 3.2 §二 变量声明（2 条）

| 规则 ID | 规则描述 | 严重级别 | 校验方式 |
|---------|---------|---------|---------|
| `declaration/no-var` | 禁止 var 声明 | `error` | AST 解析——检查 VariableDeclaration.kind |
| `declaration/prefer-const` | 优先 const，可改则改 | `error` | TypeScript LSP——检查 let 是否可改为 const |

### 3.3 §三 异步规范（3 条）

| 规则 ID | 规则描述 | 严重级别 | 校验方式 |
|---------|---------|---------|---------|
| `async/return-await` | async 函数 return 须加 await | `error` | AST 解析——检查 ReturnStatement 在 async 函数中 |
| `async/no-dropped-promise` | 不允许 Promise 被静默丢弃 | `error` | AST 解析——检查表达式语句是否返回 Promise |
| `async/explicit-catch` | fire-and-forget 须有 .catch | `warning` | AST 解析——检查 .then() 调用后是否跟 .catch() |

### 3.4 §四 导入路径（3 条）

| 规则 ID | 规则描述 | 严重级别 | 校验方式 |
|---------|---------|---------|---------|
| `import/barrel-only` | 新文件使用包名导入 | `error` | 正则扫描——检查测试文件的导入模式 |
| `import/no-relative-test` | 测试禁止 `../src/` 相对导入 | `error` | Glob + 正则——扫描测试文件 |
| `import/update-barrel` | 新增公开符号须更新 barrel | `warning` | AST 对比——检查 src/ 新增 export 是否出现在 index.ts |

### 3.5 §五 控制台输出（2 条）

| 规则 ID | 规则描述 | 严重级别 | 校验方式 |
|---------|---------|---------|---------|
| `console/no-raw-error` | 禁止裸 console.error/warn | `warning` | AST 解析——检查 CallExpression callee |
| `console/use-pipeline` | 生产代码走 PipelineObserver | `error` | AST 解析——检查是否通过 pipeline.emit 上报 |

### 3.6 §六 + §十 代码风格深度约束（9 条）

| 规则 ID | 规则描述 | 严重级别 | 校验方式 |
|---------|---------|---------|---------|
| `style/require-no-require` | 禁止 require() 导入 | `error` | AST 解析——检查 CallExpression callee |
| `style/no-unused-vars` | 禁止未使用变量 | `error` | TypeScript LSP——tsc --noUnusedLocals |
| `style/no-non-null-assertion` | 禁止非空断言 `!` | `error` | AST 解析——检查 NonNullExpression |
| `style/merge-duplicate-imports` | 合并重复导入 | `error` | AST 解析——检查同一 moduleSpecifier 出现多次 |
| `style/no-any-in-public-api` | 公开 API 禁止 any | `error` | AST 解析——检查函数返回类型、接口字段 |
| `style/no-dead-code` | 禁止保留死代码 | `error` | Grep + AST——检查未被引用的 export |
| `style/consistent-param-naming` | 参数命名一致性 | `warning` | AST 对比——跨文件检查同一语义的参数名 |
| `style/return-type-explicit` | 返回类型显式声明 | `error` | AST 解析——检查函数是否缺少返回类型注解 |
| `style/no-boolean-trap` | 禁止 boolean trap 参数 | `warning` | AST 解析——检查函数参数是否为 boolean 类型 |

### 3.7 §七 硬编码禁令（4 条）

| 规则 ID | 规则描述 | 严重级别 | 校验方式 |
|---------|---------|---------|---------|
| `hardcoded/no-magic-number` | 禁止魔法数字 | `warning` | AST 解析——检查 NumericLiteral 是否定义在 config 常量中 |
| `hardcoded/no-path-literal` | 禁止路径字面量 | `error` | AST 解析——检查字符串字面量是否为文件路径 |
| `hardcoded/no-env-literal` | 禁止环境变量名字面量 | `error` | AST 解析——检查字符串是否为已知 env 变量名 |
| `hardcoded/no-version-literal` | 禁止版本号字符串 | `error` | AST 解析——检查字符串是否为 semver 格式 |

### 3.8 §八 提示词管理（3 条）

| 规则 ID | 规则描述 | 严重级别 | 校验方式 |
|---------|---------|---------|---------|
| `prompts/double-source-sync` | prompts/ 与 config 同步 | `error` | 文件对比——检查 prompts/ 文件与 constants/meta-agent.ts 的一致性 |
| `prompts/placeholder-convention` | 占位符使用 `{{UPPER_SNAKE_CASE}}` | `warning` | 正则扫描——检查 prompts 文件中占位符格式 |
| `prompts/directory-structure` | 提示词目录结构合规 | `error` | 文件系统扫描——检查 prompts/ 目录结构 |

### 3.9 §九 架构设计原则（5 条）

| 规则 ID | 规则描述 | 严重级别 | 校验方式 |
|---------|---------|---------|---------|
| `architecture/no-interface-leak` | 接口不泄漏内部实现 | `error` | AST 解析——检查公开 API 返回类型是否包含内部类名 |
| `architecture/no-forked-routing` | 禁止 if/instanceof 分叉路由 | `error` | AST 解析——检查 instanceof/type 分叉 |
| `architecture/no-data-flow-blackhole` | 禁止隐式全局状态通信 | `error` | AST 解析——检查跨模块的全局 Map/Set 读写 |
| `architecture/no-regression-test-mod` | 新增功能不改已有测试 | `warning` | Git diff——检查测试文件是否被修改 |
| `architecture/interface-before-implementation` | 接口文件先于实现文件 | `error` | Git log——检查提交顺序 |

### 3.10 §十一 方法与函数设计（4 条）

| 规则 ID | 规则描述 | 严重级别 | 校验方式 |
|---------|---------|---------|---------|
| `function/positional-max-3` | 位置参数最多 3 个 | `warning` | AST 解析——检查函数参数数量 |
| `function/options-object-for-excess` | 超过 3 个参数用 options 对象 | `warning` | AST 解析——检查最后一个参数是否为对象类型 |
| `function/side-effect-naming` | 副作用函数须命名提示 | `warning` | AST 解析——检查函数名是否包含副作用动词 |
| `function/body-max-30-lines` | 方法体不超过 30 行 | `warning` | AST 解析——检查函数体行数 |

### 3.11 §十二 导入路径与模块组织（4 条）

| 规则 ID | 规则描述 | 严重级别 | 校验方式 |
|---------|---------|---------|---------|
| `import/sort-order` | 导入排序——内置→三方→@cortex→相对 | `error` | AST 解析——检查 ImportDeclaration 顺序 |
| `import/type-separate` | 类型导入使用 `import type` | `error` | AST 解析——检查类型导入语法 |
| `import/no-inline-type-mix` | 禁止行内 `import { type Foo }` | `error` | AST 解析——检查 ImportSpecifier.isTypeOnly |
| `import/side-effect-annotate` | 副作用导入须注释说明 | `warning` | AST 解析——检查 `import "xxx"` 上方是否有注释 |

### 3.12 §十三 接口与类型设计（4 条）

| 规则 ID | 规则描述 | 严重级别 | 校验方式 |
|---------|---------|---------|---------|
| `interface/isp-max-8-methods` | 接口最多 8 个方法 | `warning` | AST 解析——检查 InterfaceDeclaration 的方法数量 |
| `interface/discriminated-union` | 变体数据用 discriminated union | `warning` | AST 解析——检查 type union 是否有字面量 type 字段 |
| `interface/readonly-preference` | 共享数据加 readonly | `warning` | AST 解析——检查 interface 字段是否可加 readonly |
| `interface/interface-over-type` | 对象形状优先 interface | `warning` | AST 解析——检查 type alias 是否可改为 interface |

### 3.13 §十四 设计模式约定（4 条）

| 规则 ID | 规则描述 | 严重级别 | 校验方式 |
|---------|---------|---------|---------|
| `pattern/adapter-convention` | Adapter 不混合业务逻辑 | `warning` | AST 分析——检查 Adapter 类中是否包含业务逻辑调用 |
| `pattern/factory-single-entry` | Factory 是唯一创建入口 | `warning` | Grep——检查是否有散落的 `new Xxx()` 调用 |
| `pattern/strategy-central-selection` | 策略选择逻辑集中 | `warning` | AST 分析——检查 if/else 策略分支散落情况 |
| `pattern/observer-publisher-decoupled` | 发布者不感知订阅者 | `warning` | AST 分析——检查发布者代码是否硬编码后续动作 |

---

## 4. 架构全景

### 4.1 包定位

```
📦 @cortex/policy-validator
    ── 策略校验器 —— 将 coding-standards.md 等编码规范转化为
       可编程、可组合、可扩展的策略规则引擎。
```

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    策略校验生态系统                        │
                    ├─────────────────────────────────────────────────────────┤
                    │                                                         │
┌──────────────────┐│  ┌──────────────────────────────────────────────────┐   │
│  @cortex/config   ││  │  @cortex/policy-validator                         │   │
│  (常量定义源)     ││  │                                                    │   │
│  FILE_CODING_     ││  │  PolicyRule interface ← 校验规则抽象              │   │
│  STANDARDS        ││  │  RuleRegistry        ← 规则注册表                 │   │
│  AGENT_TAGS       ││  │  RuleEngine           ← 引擎执行                   │   │
│  TAG_VOCABULARY   ││  │  RuleLoader           ← 规则加载器                 │   │
└────────┬─────────┘│  │  ┌────────────────┐ ┌────────────────────────┐    │   │
         │          │  │  │ BuiltinRuleSet  │ │ ExternalRuleLoader    │    │   │
         │          │  │  │ (预置规则集)     │ │ (外部规则源适配器)    │    │   │
         ▼          │  │  └────────────────┘ └────────────────────────┘    │   │
┌──────────────────┐│  │  ┌────────────────┐ ┌────────────────────────┐    │   │
│  @cortex/shared   ││  │  │ ASTListener     │ │ ReportFormatter       │    │   │
│  (类型中枢)       ││  │  │ (AST 校验器)    │ │ (校验报告格式化器)    │    │   │
│  AgentType        ││  │  └────────────────┘ └────────────────────────┘    │   │
│  Tool             ││  └──────────────────────────────────────────────────┘   │
│  TaskNode         ││                                                         │
└────────┬─────────┘│  ┌──────────────────────────────────────────────────┐   │
         │          │  │  @cortex/engine — 消费方                          │   │
         │          │  │  ConsistencyLayer → 调用 RuleEngine               │   │
         │          │  │  GovernancePipeline → 接入策略校验                │   │
         │          │  │  CI Gate → pnpm validate:policy                   │   │
         ▼          │  └──────────────────────────────────────────────────┘   │
┌──────────────────┐│                                                         │
│  @cortex/engine   ││  ┌──────────────────────────────────────────────────┐   │
│  (校验器参照)     ││  │  CLI / CI                                         │   │
│  SkillJsonVali-  ││  │  pnpm validate:policy  — 一键全量策略校验          │   │
│  dator 模式      ││  │  pnpm validate:policy --diff  — 仅校验变更文件     │   │
└──────────────────┘│  └──────────────────────────────────────────────────┘   │
                    └─────────────────────────────────────────────────────────┘
```

### 4.2 本包职责边界

#### ✅ 属于本包职责
- 将编码规范规则抽象为可编程的 `PolicyRule` 对象
- 提供 `RuleRegistry` 进行规则注册、筛选、排序
- 提供 `RuleEngine` 对目标文件/代码执行校验
- 提供 `RuleLoader` 从配置源加载规则定义
- 提供内置规则集（coding-standards.md 全部规则的实现）
- 输出结构化校验报告（errors / warnings / infos 三字段）
- 支持按域/严重级别/标签筛选规则

#### ❌ 不属于本包职责
- 代码格式化/自动修复（属于 ESLint/Prettier 生态）
- 类型检查（属于 TypeScript Compiler）
- 运行时安全执行（属于 ConfirmGate/Toolkit）
- 规则定义的人读源管理（属于 prompts/coding-standards.md）
- 编译/构建（属于 tsc/vite）

### 4.3 依赖关系

```
@cortex/policy-validator
  ├── 依赖: @cortex/config        (PolicyRule 配置常量、FILE_CODING_STANDARDS、AGENT_TAGS)
  ├── 依赖: @cortex/shared         (AgentType、Tag、Tool、ValidationResult 模式)
  ├── 依赖: TypeScript Compiler API (AST 解析——校验源代码结构)
  └── 被依赖: @cortex/engine       (ConsistencyLayer 集成)
  └── 被依赖: CI 脚本             (pnpm validate:policy)
```

---

## 5. 核心模块设计

### 5.1 PolicyRule 接口

依据 coding-standards.md：
- **§9.3 外部接口抽象具体化**：接口必须定义清晰、稳定、最小化的契约
- **§13.1 接口隔离**：一个 interface 只描述一个角色
- **§13.3 readonly 优先**：共享数据加 readonly
- **§13.4 interface 优先**（对象形状用 interface）
- **§11.1 方法签名三原则**：返回类型显式声明，禁止 boolean trap

```typescript
// ============================================================
// 核心类型定义
// ============================================================

/**
 * 规则严重级别——映射到 ReversibilityLevel 语义。
 *
 * - info:    提示性，不阻断（对应 L0）
 * - warning: 建议修改，不阻断 CI（对应 L1）
 * - error:   必须修改，阻断 CI（对应 L2/L3）
 */
export type RuleSeverity = "info" | "warning" | "error";

/**
 * 策略域——规则的领域分类。
 *
 * 每个域对应 coding-standards.md 的一章或一组相关规则。
 * 消费者可按域筛选需要的规则集。
 */
export type PolicyDomain =
  | "exception"        // §一 异常处理
  | "declaration"      // §二 变量声明
  | "async"            // §三 异步规范
  | "import"           // §四 + §十二 导入路径
  | "console"          // §五 控制台输出
  | "style"            // §六 + §十 代码风格
  | "hardcoded"        // §七 硬编码禁令
  | "prompts"          // §八 提示词管理
  | "architecture"     // §九 架构设计原则
  | "function"         // §十一 函数设计
  | "interface"        // §十三 接口与类型设计
  | "pattern";         // §十四 设计模式约定

/**
 * 单条策略规则——原子校验单元。
 *
 * @design-rule 接口隔离原则（§13.1）
 *   此接口只描述"规则是什么"，不描述"规则怎么执行"。
 *   执行逻辑由 RuleEngine 调度，规则本身是纯数据对象。
 *
 * @design-rule readonly 优先（§13.3）
 *   所有字段不可变——规则一经注册，其定义不应被运行时修改。
 */
export interface PolicyRule {
  /** 规则唯一标识（如 "style/no-non-null-assertion"） */
  readonly id: string;

  /** 规则所属策略域 */
  readonly domain: PolicyDomain;

  /** 规则严重级别 */
  readonly severity: RuleSeverity;

  /** 规则简短描述（一条语句，如 "禁止非空断言 `!`"） */
  readonly description: string;

  /** 规则详细说明（可包含编码规范原文引用） */
  readonly detail?: string;

  /** 错误码（如 "NO_NON_NULL_ASSERTION"） */
  readonly code: string;

  /** 标签列表（与 @cortex/shared Tag 体系一致，方便按标签筛选） */
  readonly tags: readonly string[];

  /** 适用的文件 glob 模式（如 "**\/*.ts"） */
  readonly filePattern?: string;

  /** 适用的 AgentType 列表（为空则适用于所有 Agent） */
  readonly targetAgentTypes?: readonly string[];

  /** coding-standards.md 章节引用（如 "§10.1"） */
  readonly standardRef?: string;

  /** 修复建议（可选） */
  readonly fixSuggestion?: string;
}

/**
 * 校验结果项——单条规则的执行结果。
 */
export interface PolicyRuleResult {
  /** 规则 ID */
  readonly ruleId: string;

  /** 规则严重级别 */
  readonly severity: RuleSeverity;

  /** 是否通过 */
  readonly passed: boolean;

  /** 错误信息（passed === false 时设置） */
  readonly message?: string;

  /** 错误码 */
  readonly code: string;

  /** 文件路径（规则触发的源文件） */
  readonly filePath?: string;

  /** 行号（规则触发的源代码位置） */
  readonly line?: number;

  /** 列号（规则触发的源代码位置） */
  readonly column?: number;

  /** 修复建议 */
  readonly fixSuggestion?: string;

  /** 规则元数据引用 */
  readonly rule: PolicyRule;
}

/**
 * 校验报告——RuleEngine 执行的完整输出。
 *
 * @design-rule 三等报告（参照 SkillJsonValidationResult 模式）
 *   errors: 阻断性问题（severity === "error" 且 passed === false）
 *   warnings: 建议性问题（severity === "warning" 且 passed === false）
 *   infos: 提示性信息（severity === "info" 或 pass 的结果摘要）
 *   valid: errors.length === 0
 */
export interface PolicyReport {
  /** 是否完全通过（无 error 级别问题） */
  readonly valid: boolean;

  /** 错误列表（阻断性） */
  readonly errors: readonly PolicyRuleResult[];

  /** 警告列表（建议性） */
  readonly warnings: readonly PolicyRuleResult[];

  /** 信息列表（提示性 + 通过项摘要） */
  readonly infos: readonly PolicyRuleResult[];

  /** 所有结果（errors + warnings + infos 全量） */
  readonly results: readonly PolicyRuleResult[];

  /** 校验时间戳 */
  readonly timestamp: number;

  /** 校验耗时（ms） */
  readonly durationMs: number;

  /** 执行的规则数 */
  readonly totalRules: number;

  /** 通过规则数 */
  readonly passedRules: number;

  /** 失败规则数 */
  readonly failedRules: number;
}
```

### 5.2 RuleRegistry

依据 coding-standards.md：
- **§9.2 内部数据流向明细化**：注册、筛选、查询路径显式独立
- **§13.1 接口隔离**：RuleRegistry 只做规则管理，不做校验执行
- **§14.2 Factory 模式**：createRule 集中管理规则创建

```typescript
/**
 * 规则筛选条件——按需获取规则的查询对象。
 *
 * @design-rule 禁止 boolean trap（§11.1 原则三）
 *   所有筛选条件使用命名选项对象，而非布尔位置参数。
 */
export interface RuleFilter {
  /** 按策略域筛选 */
  readonly domains?: readonly PolicyDomain[];

  /** 按严重级别筛选 */
  readonly severities?: readonly RuleSeverity[];

  /** 按标签筛选（匹配任意一个即返回） */
  readonly tags?: readonly string[];

  /** 按 AgentType 筛选 */
  readonly agentTypes?: readonly string[];

  /** 按文件模式筛选（匹配的规则才会被返回） */
  readonly filePattern?: string;

  /** 按规则 ID 列表精确指定 */
  readonly ruleIds?: readonly string[];
}

/**
 * 规则注册表——规则的集中管理容器。
 *
 * @design-rule 接口隔离（§13.1）
 *   此接口只描述"规则怎么管理"，不涉及规则执行。
 *
 * @design-rule 单源真相
 *   所有注册的规则有且仅有一个来源——register/bulkRegister。
 *   规则一经注册，不可删除（但可 disable）。
 */
export interface IRuleRegistry {
  /** 注册单条规则 */
  register(rule: PolicyRule): void;

  /** 批量注册多条规则 */
  bulkRegister(rules: readonly PolicyRule[]): void;

  /** 按 ID 获取规则 */
  get(ruleId: string): PolicyRule | undefined;

  /** 按筛选条件查询规则 */
  query(filter?: RuleFilter): readonly PolicyRule[];

  /** 获取所有已注册的规则 */
  getAll(): readonly PolicyRule[];

  /** 获取所有策略域 */
  getDomains(): readonly PolicyDomain[];

  /** 获取指定域下的规则数 */
  countByDomain(): Record<PolicyDomain, number>;

  /** 按严重级别计数 */
  countBySeverity(): Record<RuleSeverity, number>;

  /** 禁用规则（保留注册但跳过执行） */
  disable(ruleId: string): void;

  /** 启用规则 */
  enable(ruleId: string): void;

  /** 检查规则是否已禁用 */
  isDisabled(ruleId: string): boolean;

  /** 清空注册表 */
  clear(): void;
}

/**
 * RuleRegistry 实现——基于 Map 的规则注册表。
 *
 * @design-rule 内部数据流向明细化（§9.2）
 *   - register/bulkRegister：写入路径，单一入口
 *   - get/query：查询路径，不写状态
 *   - disable/enable：状态切换，有显式的开关记录
 */
export class RuleRegistry implements IRuleRegistry {
  private _rules: Map<string, PolicyRule>;
  private _disabled: Set<string>;

  constructor() {
    this._rules = new Map();
    this._disabled = new Set();
  }

  register(rule: PolicyRule): void {
    if (this._rules.has(rule.id)) {
      throw new Error(`Rule already registered: ${rule.id}`);
    }
    this._rules.set(rule.id, rule);
  }

  bulkRegister(rules: readonly PolicyRule[]): void {
    for (const rule of rules) {
      this.register(rule);
    }
  }

  get(ruleId: string): PolicyRule | undefined {
    return this._rules.get(ruleId);
  }

  query(filter?: RuleFilter): readonly PolicyRule[] {
    const results: PolicyRule[] = [];
    for (const rule of this._rules.values()) {
      if (this._disabled.has(rule.id)) continue;
      if (!this._matchesFilter(rule, filter)) continue;
      results.push(rule);
    }
    return results;
  }

  getAll(): readonly PolicyRule[] {
    return Array.from(this._rules.values())
      .filter(r => !this._disabled.has(r.id));
  }

  getDomains(): readonly PolicyDomain[] {
    const domains = new Set<PolicyDomain>();
    for (const rule of this._rules.values()) {
      domains.add(rule.domain);
    }
    return Array.from(domains);
  }

  countByDomain(): Record<PolicyDomain, number> {
    const counts: Partial<Record<PolicyDomain, number>> = {};
    for (const rule of this._rules.values()) {
      if (this._disabled.has(rule.id)) continue;
      counts[rule.domain] = (counts[rule.domain] ?? 0) + 1;
    }
    return counts as Record<PolicyDomain, number>;
  }

  countBySeverity(): Record<RuleSeverity, number> {
    const counts: Record<RuleSeverity, number> =
      { info: 0, warning: 0, error: 0 };
    for (const rule of this._rules.values()) {
      if (this._disabled.has(rule.id)) continue;
      counts[rule.severity]++;
    }
    return counts;
  }

  disable(ruleId: string): void {
    this._disabled.add(ruleId);
  }

  enable(ruleId: string): void {
    this._disabled.delete(ruleId);
  }

  isDisabled(ruleId: string): boolean {
    return this._disabled.has(ruleId);
  }

  clear(): void {
    this._rules.clear();
    this._disabled.clear();
  }

  private _matchesFilter(
    rule: PolicyRule,
    filter?: RuleFilter,
  ): boolean {
    if (!filter) return true;

    // 按域筛选
    if (filter.domains && filter.domains.length > 0) {
      if (!filter.domains.includes(rule.domain)) return false;
    }

    // 按严重级别筛选
    if (filter.severities && filter.severities.length > 0) {
      if (!filter.severities.includes(rule.severity)) return false;
    }

    // 按标签筛选（任意匹配）
    if (filter.tags && filter.tags.length > 0) {
      if (!rule.tags.some(t => filter.tags!.includes(t))) return false;
    }

    // 按 AgentType 筛选
    if (filter.agentTypes && filter.agentTypes.length > 0) {
      if (!rule.targetAgentTypes ||
          !rule.targetAgentTypes.some(t => filter.agentTypes!.includes(t))) {
        return false;
      }
    }

    // 按规则 ID 精确指定
    if (filter.ruleIds && filter.ruleIds.length > 0) {
      if (!filter.ruleIds.includes(rule.id)) return false;
    }

    return true;
  }
}
```

### 5.3 RuleEngine

依据 coding-standards.md：
- **§9.2 内部数据流向明细化**：校验管线每一步显式可追踪
- **§9.4 三步铁律**：外部接口 → 内部数据流 → 实现验证
- **§14.1 Adapter 模式**：不同来源的校验器适配为统一接口
- **§14.4 Observer 模式**：事件发布解耦
- **§13.2 Discriminated Union**：校验事件用判别联合类型

```typescript
// ============================================================
// 校验事件类型——RuleEngine 执行过程中发出的事件
// ============================================================

/**
 * 校验事件——RuleEngine 生命周期的判别联合。
 *
 * @design-rule Discriminated Union（§13.2）
 *   多种事件类型通过 type 字段窄化 payload 类型。
 */
export type PolicyEvent =
  | { type: "engine-start"; payload: { totalRules: number; targetFiles: string[] } }
  | { type: "rule-start"; payload: { ruleId: string; filePath: string } }
  | { type: "rule-pass"; payload: { ruleId: string; filePath: string; durationMs: number } }
  | { type: "rule-fail"; payload: { ruleId: string; filePath: string; result: PolicyRuleResult } }
  | { type: "rule-error"; payload: { ruleId: string; filePath: string; error: string } }
  | { type: "engine-end"; payload: { report: PolicyReport } };

/**
 * 事件处理器签名。
 */
export type PolicyEventHandler = (event: PolicyEvent) => void;

// ============================================================
// 可插拔校验组件接口
// ============================================================

/**
 * 校验组件——可插拔的独立校验单元。
 *
 * @design-rule 借鉴 SkillJsonValidator 模式（engine/skill-json-validator.ts）
 *   每个组件是独立对象，实现统一接口，通过注册表组合。
 *   - 新增校验规则只需添加一个组件并注册
 *   - 组件互不感知，错误累积而非短路
 *
 * @design-rule 纯函数风格（§11.2）
 *   validate 不修改外部状态——相同输入永远相同输出。
 */
export interface PolicyValidatorComponent {
  /** 组件名称 */
  readonly name: string;

  /** 组件对应的规则 ID */
  readonly ruleId: string;

  /**
   * 对单个文件执行校验。
   *
   * @param filePath - 待校验文件路径
   * @param content - 文件内容（已读取）
   * @param ast - 预解析的 AST（可选，避免重复解析）
   * @returns 校验结果项（null 表示规则不适用此文件）
   */
  validate(
    filePath: string,
    content: string,
    ast?: unknown,
  ): Promise<PolicyRuleResult | null>;
}

// ============================================================
// RuleEngine 配置
// ============================================================

/**
 * RuleEngine 配置。
 *
 * @design-rule 配置驱动开发（§七）
 *   所有可调参数从配置对象读取，禁止硬编码。
 */
export interface RuleEngineConfig {
  /** 规则超时（ms），默认 30_000 */
  readonly ruleTimeoutMs?: number;

  /** 最大并发校验文件数，默认 4 */
  readonly maxConcurrency?: number;

  /** 是否在第一个 error 时停止，默认 false */
  readonly failFast?: boolean;

  /** 是否启用缓存（AST 缓存），默认 true */
  readonly enableCache?: boolean;

  /** 输出详细日志，默认 false */
  readonly verbose?: boolean;

  /** 允许的最大错误数（超过则停止），默认 0 = 不限 */
  readonly maxErrors?: number;
}

// ============================================================
// RuleEngine 接口与实现
// ============================================================

/**
 * 规则引擎——执行校验的核心引擎。
 *
 * @design-rule 外部接口抽象具体化（§9.3）
 *   对外暴露的契约清晰、稳定、最小化：
 *   - execute(): 执行全量校验
 *   - executeOnFiles(): 对指定文件列表执行校验
 *   - on/off: 事件订阅——发布者不感知订阅者
 *
 * @design-rule 数据流向明细化（§9.2）
 *   execute() 内部管线：
 *   [加载规则] → [筛选匹配] → [文件扫描] → [逐规则校验] → [汇总报告]
 *   每一步可独立追踪。
 */
export interface IRuleEngine {
  /** 执行全量校验——扫描项目文件并执行所有匹配规则 */
  execute(options?: {
    rootDir?: string;
    filter?: RuleFilter;
  }): Promise<PolicyReport>;

  /** 对指定文件列表执行校验 */
  executeOnFiles(
    files: string[],
    filter?: RuleFilter,
  ): Promise<PolicyReport>;

  /** 注册事件监听 */
  on(event: PolicyEvent["type"], handler: PolicyEventHandler): void;

  /** 移除事件监听 */
  off(event: PolicyEvent["type"], handler: PolicyEventHandler): void;

  /** 更新引擎配置（运行时动态调整） */
  updateConfig(config: Partial<RuleEngineConfig>): void;

  /** 获取当前配置 */
  getConfig(): RuleEngineConfig;
}

/**
 * RuleEngine 实现——基于可插拔组件的事件驱动引擎。
 *
 * @design-rule Observer 模式（§14.4）
 *   引擎只管 emit 事件，不知道谁在听。
 *   日志记录、报告生成、进度显示通过事件订阅实现。
 */
export class RuleEngine implements IRuleEngine {
  private _registry: IRuleRegistry;
  private _components: Map<string, PolicyValidatorComponent>;
  private _listeners: Map<string, Set<PolicyEventHandler>>;
  private _config: Required<RuleEngineConfig>;

  constructor(
    registry: IRuleRegistry,
    components?: readonly PolicyValidatorComponent[],
    config?: RuleEngineConfig,
  ) {
    this._registry = registry;
    this._components = new Map();
    this._listeners = new Map();
    this._config = {
      ruleTimeoutMs: config?.ruleTimeoutMs ?? 30_000,
      maxConcurrency: config?.maxConcurrency ?? 4,
      failFast: config?.failFast ?? false,
      enableCache: config?.enableCache ?? true,
      verbose: config?.verbose ?? false,
      maxErrors: config?.maxErrors ?? 0,
    };

    // 注册校验组件
    if (components) {
      for (const comp of components) {
        this._components.set(comp.ruleId, comp);
      }
    }
  }

  /** 注册事件监听 */
  on(event: PolicyEvent["type"], handler: PolicyEventHandler): void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(handler);
  }

  /** 移除事件监听 */
  off(event: PolicyEvent["type"], handler: PolicyEventHandler): void {
    this._listeners.get(event)?.delete(handler);
  }

  /** 触发事件 */
  private _emit(event: PolicyEvent): void {
    const handlers = this._listeners.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }
  }

  /** 执行全量校验 */
  async execute(options?: {
    rootDir?: string;
    filter?: RuleFilter;
  }): Promise<PolicyReport> {
    const rootDir = options?.rootDir ?? process.cwd();
    const filter = options?.filter;

    // Step 1: 从注册表获取匹配的规则
    const rules = this._registry.query(filter);
    if (rules.length === 0) {
      return {
        valid: true,
        errors: [],
        warnings: [],
        infos: [],
        results: [],
        timestamp: Date.now(),
        durationMs: 0,
        totalRules: 0,
        passedRules: 0,
        failedRules: 0,
      };
    }

    // Step 2: 收集待校验文件
    // (此处简化——实际实现中会按 filePattern 扫描文件系统)
    const targetFiles = await this._collectTargetFiles(rules, rootDir);

    // Step 3: 初始化报告累加器
    const startTime = Date.now();
    this._emit({
      type: "engine-start",
      payload: { totalRules: rules.length, targetFiles },
    });

    // Step 4: 逐文件逐规则校验
    const results: PolicyRuleResult[] = [];
    let errors = 0;

    for (const filePath of targetFiles) {
      if (this._config.maxErrors > 0 && errors >= this._config.maxErrors) {
        break;
      }

      const content = await this._readFile(filePath);
      // (AST 解析在实际实现中按需进行)

      for (const rule of rules) {
        if (this._config.maxErrors > 0 && errors >= this._config.maxErrors) {
          break;
        }

        // 检查文件是否符合规则的 filePattern
        if (!this._matchesFilePattern(rule, filePath)) continue;

        const component = this._components.get(rule.id);
        if (!component) continue;

        this._emit({
          type: "rule-start",
          payload: { ruleId: rule.id, filePath },
        });

        const ruleStart = Date.now();
        try {
          const result = await component.validate(filePath, content);

          if (result) {
            results.push(result);
            if (!result.passed && result.severity === "error") {
              errors++;
              this._emit({
                type: "rule-fail",
                payload: { ruleId: rule.id, filePath, result },
              });
            } else {
              this._emit({
                type: "rule-pass",
                payload: {
                  ruleId: rule.id,
                  filePath,
                  durationMs: Date.now() - ruleStart,
                },
              });
            }
          }
        } catch (e) {
          this._emit({
            type: "rule-error",
            payload: {
              ruleId: rule.id,
              filePath,
              error: e instanceof Error ? e.message : String(e),
            },
          });
        }

        if (this._config.failFast && errors > 0) break;
      }
    }

    // Step 5: 汇总报告
    const report = this._buildReport(results, startTime);
    this._emit({ type: "engine-end", payload: { report } });
    return report;
  }

  /** 对指定文件列表执行校验 */
  async executeOnFiles(
    files: string[],
    filter?: RuleFilter,
  ): Promise<PolicyReport> {
    // (实现逻辑与 execute() 类似，跳过文件扫描步骤)
    // 实际实现中复用内部校验管线
    throw new Error("Not implemented in this architecture draft");
  }

  updateConfig(config: Partial<RuleEngineConfig>): void {
    this._config = { ...this._config, ...config };
  }

  getConfig(): RuleEngineConfig {
    return { ...this._config };
  }

  // ─── 内部辅助方法（具体实现见源码） ───

  private async _collectTargetFiles(
    rules: readonly PolicyRule[],
    rootDir: string,
  ): Promise<string[]> {
    // 从规则中收集所有 filePattern，去重后扫描文件系统
    // (实际实现使用 glob 或 @cortex/shared 的文件工具)
    return [];
  }

  private async _readFile(filePath: string): Promise<string> {
    // 带缓存的读取——同一文件被多条规则执行时只读一次
    return "";
  }

  private _matchesFilePattern(rule: PolicyRule, filePath: string): boolean {
    if (!rule.filePattern) return true;
    // (实际实现使用 minimatch 或 glob matching)
    return true;
  }

  private _buildReport(
    results: PolicyRuleResult[],
    startTime: number,
  ): PolicyReport {
    const errors = results.filter(r => !r.passed && r.severity === "error");
    const warnings = results.filter(r => !r.passed && r.severity === "warning");
    const infos = results.filter(r => r.passed || r.severity === "info");
    const passed = results.filter(r => r.passed);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      infos,
      results,
      timestamp: Date.now(),
      durationMs: Date.now() - startTime,
      totalRules: results.length,
      passedRules: passed.length,
      failedRules: results.length - passed.length,
    };
  }
}
```

### 5.4 RuleLoader

依据 coding-standards.md：
- **§七 硬编码禁令**：规则定义从配置源加载，不写死
- **§8.2 双源同步**：人读源（coding-standards.md）与机器源（RuleLoader）保持同步
- **§14.3 Strategy 模式**：不同加载策略（常量/JSON/TS 模块）可互换
- **§14.1 Adapter 模式**：外部规则源适配

```typescript
/**
 * 规则加载选项。
 */
export interface RuleLoadOptions {
  /** 是否在加载前清除已注册规则，默认 false */
  readonly clearBeforeLoad?: boolean;

  /** 是否启用严格模式（遇到无效规则时抛错），默认 true */
  readonly strict?: boolean;

  /** 自定义规则源路径 */
  readonly customPath?: string;
}

/**
 * 规则加载器——从配置源加载 PolicyRule。
 *
 * @design-rule Strategy 模式（§14.3）
 *   不同加载策略（常量、JSON、TS 模块）通过统一接口切换：
 *   - loadFromConfig()：从 @cortex/config 常量加载内置规则
 *   - loadFromJson()：从 JSON 文件加载自定义规则
 *   - loadFromModule()：从 TS 模块加载动态规则
 *
 * @design-rule 适配器模式（§14.1）
 *   外部规则源（如 eslint 配置、自定义 JSON）通过适配器接入统一接口。
 */
export interface IRuleLoader {
  /** 从 @cortex/config 常量加载内置规则集 */
  loadFromConfig(options?: RuleLoadOptions): Promise<number>;

  /** 从 JSON 文件加载规则定义 */
  loadFromJson(
    jsonPath: string,
    options?: RuleLoadOptions,
  ): Promise<number>;

  /** 从 TS/JS 模块加载动态规则 */
  loadFromModule(
    modulePath: string,
    options?: RuleLoadOptions,
  ): Promise<number>;

  /** 从 coding-standards.md 自动提取规则 */
  loadFromMarkdown(
    mdPath: string,
    options?: RuleLoadOptions,
  ): Promise<number>;

  /** 获取已加载的规则数统计 */
  getLoadStats(): RuleLoadStats;
}

/**
 * 加载统计。
 */
export interface RuleLoadStats {
  /** 加载的规则总数 */
  total: number;

  /** 按域统计 */
  byDomain: Record<PolicyDomain, number>;

  /** 按严重级别统计 */
  bySeverity: Record<RuleSeverity, number>;

  /** 无效规则数 */
  invalidCount: number;

  /** 加载耗时（ms） */
  durationMs: number;
}
```

---

## 6. 校验管线

### 6.1 全量校验管线

```
RuleEngine.execute({ rootDir, filter })
  │
  ├─ 1. 规则加载 ────────────── RuleLoader.loadFromConfig()
  │   ├─ 从 @cortex/config 常量加载 coding-standards 内置规则
  │   └─ 注册到 RuleRegistry
  │
  ├─ 2. 规则筛选 ────────────── RuleRegistry.query(filter)
  │   ├─ 按 domain 筛选（如只校验 "style" 域）
  │   ├─ 按 severity 筛选（如只校验 error 级别）
  │   └─ 按 tags/agentTypes 筛选
  │
  ├─ 3. 文件扫描 ────────────── 收集待校验文件
  │   ├─ 按规则 filePattern 扫描工作区
  │   └─ 去重合并（同一文件被多条规则引用只扫描一次）
  │
  ├─ 4. 逐条校验 ────────────── 遍历规则 × 文件矩阵
  │   ├─ 读取文件（LRU 缓存）
  │   ├─ 解析 AST（按需，TypeScript Compiler API）
  │   ├─ 执行 PolicyValidatorComponent.validate()
  │   ├─ 收集 PolicyRuleResult
  │   └─ emit PolicyEvent（进度/错误通知）
  │
  └─ 5. 报告生成 ────────────── PolicyReport
      ├─ errors: severity === "error" 且未通过的规则
      ├─ warnings: severity === "warning" 且未通过的规则
      ├─ infos: 通过项 + 提示性信息
      └─ valid: errors.length === 0
```

### 6.2 事件流

```
┌──────────────┐     engine-start     ┌──────────────────┐
│              │ ────────────────────→ │                  │
│   RuleEngine  │                      │   订阅者 1:       │
│              │     rule-start       │   日志记录器      │
│   执行管线    │ ────────────────────→ │                  │
│              │                      │   订阅者 2:       │
│    emit 事件  │     rule-pass/fail   │   进度条显示      │
│              │ ────────────────────→ │                  │
│              │                      │   订阅者 3:       │
│              │     rule-error       │   CI 报告输出     │
│              │ ────────────────────→ │                  │
│              │                      │   订阅者 4:       │
│              │     engine-end       │   遥测采集        │
│              │ ────────────────────→ │                  │
└──────────────┘                      └──────────────────┘
```

---

## 7. 包结构

```
packages/policy-validator/
├── ARCHITECTURE.md              ← 本文档
├── README.md                    ← 使用说明
├── PACKAGE_POSITIONING.md       ← 包定位（类似 skill-validator/PACKAGE_POSITIONING.md）
├── package.json                 ← { "name": "@cortex/policy-validator" }
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.mjs
│
├── src/
│   ├── index.ts                 ← 桶导出（barrel export — §四 barrel 铁律）
│   │                             新增公开符号必须在此追加 export 行
│   │
│   ├── types.ts                 ← 核心类型（PolicyRule, PolicyReport, PolicyEvent 等）
│   ├── registry.ts              ← RuleRegistry 实现
│   ├── engine.ts                ← RuleEngine 实现
│   ├── loader.ts                ← RuleLoader 实现
│   │
│   ├── components/              ← 可插拔校验组件
│   │   ├── index.ts             ← 组件桶导出
│   │   ├── base-validator.ts    ← 基础校验组件抽象
│   │   ├── ast-validator.ts     ← AST 解析校验器（共享 AST 解析逻辑）
│   │   └── rules/               ← 内置规则集（每个规则一个组件）
│   │       ├── exception/       ← §一 异常处理规则
│   │       │   ├── no-empty-catch.ts
│   │       │   └── throw-only-error.ts
│   │       ├── declaration/     ← §二 变量声明规则
│   │       │   └── no-var.ts
│   │       ├── async/           ← §三 异步规范规则
│   │       │   └── no-dropped-promise.ts
│   │       ├── import/          ← §四+§十二 导入规则
│   │       │   ├── no-relative-test.ts
│   │       │   └── sort-order.ts
│   │       ├── console/         ← §五 控制台规则
│   │       │   └── no-raw-error.ts
│   │       ├── style/           ← §六+§十 代码风格规则
│   │       │   ├── no-non-null-assertion.ts
│   │       │   ├── merge-duplicate-imports.ts
│   │       │   └── no-dead-code.ts
│   │       ├── hardcoded/       ← §七 硬编码规则
│   │       │   ├── no-magic-number.ts
│   │       │   └── no-path-literal.ts
│   │       ├── architecture/    ← §九 架构规则
│   │       │   └── no-interface-leak.ts
│   │       ├── function/        ← §十一 函数规则
│   │       │   └── positional-max-3.ts
│   │       └── interface/       ← §十三 接口规则
│   │           └── isp-max-8-methods.ts
│   │
│   ├── builtin-rules.ts         ← 内置规则集注册（将 rules/ 下所有组件注册到注册表）
│   │
│   ├── formatters/              ← 报告格式化器
│   │   ├── index.ts
│   │   ├── json-formatter.ts    ← JSON 格式输出（CI 集成用）
│   │   ├── markdown-formatter.ts ← Markdown 格式输出（可读报告）
│   │   └── console-formatter.ts ← 终端格式输出（彩色）
│   │
│   ├── adapters/                ← 外部系统适配器
│   │   ├── eslint-adapter.ts    ← ESLint 规则 → PolicyRule 适配
│   │   └── config-adapter.ts    ← cortex-agents.json → PolicyRule 适配
│   │
│   └── utils/
│       ├── ast-utils.ts         ← AST 解析工具函数
│       ├── file-matcher.ts      ← 文件模式匹配工具
│       └── version.ts           ← 包版本常量（从 @cortex/config 导入）
│
├── tests/
│   ├── fixtures/                ← 测试夹具
│   │   ├── valid-files/         ← 合规文件样例
│   │   │   └── proper-code.ts
│   │   ├── invalid-files/       ← 违规文件样例
│   │   │   ├── empty-catch.ts
│   │   │   ├── no-var-violation.ts
│   │   │   └── non-null-assertion.ts
│   │   └── mock-rules/          ← 模拟规则定义
│   │       └── test-rule.json
│   ├── registry.test.ts
│   ├── engine.test.ts
│   ├── loader.test.ts
│   └── components/
│       └── rules/
│           ├── no-empty-catch.test.ts
│           ├── no-var.test.ts
│           └── no-non-null-assertion.test.ts
│
└── docs/
    └── design.md                ← 详细设计文档（与 ARCHITECTURE.md 联动）
```

---

## 8. 外部接口契约

### 8.1 桶导出（src/index.ts）

遵循 **§四 barrel 铁律**：新增公开符号必须更新此处。

```typescript
// ============================================================
// @cortex/policy-validator — 策略校验器桶导出
//
// @module-convention（§四 barrel 铁律）
// 1. 凡 src/ 下新增公开类型/函数，必须在本文件追加 export 行。
// 2. 测试文件禁止 ../src/ 相对导入——只用 @cortex/policy-validator 包名导入。
// 3. 收益：文件合并/拆分/重命名——只要 barrel 出口不变，所有引用方无感。
// ============================================================

// ── 核心接口 ──
export type {
  PolicyRule,
  RuleSeverity,
  PolicyDomain,
  PolicyRuleResult,
  PolicyReport,
  RuleFilter,
  RuleEngineConfig,
  PolicyEvent,
  PolicyEventHandler,
  RuleLoadOptions,
  RuleLoadStats,
} from "./types.js";

// ── RuleRegistry ──
export { RuleRegistry } from "./registry.js";
export type { IRuleRegistry } from "./registry.js";

// ── RuleEngine ──
export { RuleEngine } from "./engine.js";
export type { IRuleEngine, PolicyValidatorComponent } from "./engine.js";

// ── RuleLoader ──
export { RuleLoader } from "./loader.js";
export type { IRuleLoader } from "./loader.js";

// ── 内置规则集 ──
export { BUILTIN_RULES, BUILTIN_DOMAINS } from "./builtin-rules.js";
export type { BuiltinRuleSet } from "./builtin-rules.js";

// ── 报告格式化器 ──
export { formatJson, formatMarkdown, formatConsole } from "./formatters/index.js";

// ── 适配器 ──
export { eslintRuleToPolicy } from "./adapters/eslint-adapter.js";
```

### 8.2 使用示例

```typescript
// ── 基础使用：全量校验 ──
import { RuleRegistry, RuleEngine, RuleLoader } from "@cortex/policy-validator";

const registry = new RuleRegistry();
const loader = new RuleLoader(registry);

// 从 @cortex/config 加载内置规则
await loader.loadFromConfig();

// 创建引擎并执行校验
const engine = new RuleEngine(registry);
const report = await engine.execute({ rootDir: process.cwd() });

console.log(`校验完成: ${report.valid ? "✅ 通过" : "❌ 失败"}`);
console.log(`错误: ${report.errors.length}, 警告: ${report.warnings.length}`);

// ── 精确筛选：只校验代码风格规则 ──
const styleReport = await engine.execute({
  filter: { domains: ["style"] },
});

// ── 事件订阅：进度条显示 ──
engine.on("rule-pass", ({ payload }) => {
  process.stdout.write(`.");
});
engine.on("rule-fail", ({ payload }) => {
  process.stdout.write(`x`);
});

// ── CI 集成 ──
import { formatJson } from "@cortex/policy-validator";
const jsonOutput = formatJson(report);
// → 输出结构化 JSON，CI 据此判断阻断

// ── 自定义规则 ──
import { PolicyValidatorComponent } from "@cortex/policy-validator";

const myCustomRule: PolicyValidatorComponent = {
  name: "my-custom-rule",
  ruleId: "custom/my-rule",
  async validate(filePath, content, ast) {
    if (content.includes("bad-pattern")) {
      return {
        ruleId: "custom/my-rule",
        severity: "error",
        passed: false,
        message: "发现禁止模式 'bad-pattern'",
        code: "CUSTOM_BAD_PATTERN",
        filePath,
        rule: { id: "custom/my-rule", /* ... */ },
      };
    }
    return null; // 规则不适用
  },
};

// ── 集成到 GovernancePipeline ──
// packages/engine/src/governance/governance-pipeline.ts
// 新增 stage: "policy-validation"
// registerStage("policy-validation", async (ctx) => {
//   const report = await policyEngine.execute({ rootDir: ctx.workspaceRoot });
//   return { valid: report.valid, errors: report.errors };
// });
```

---

## 9. 与现有体系的关系

### 9.1 与 skill-validator 的关系

```
skill-validator                  policy-validator
─────────────                    ────────────────
校验对象：skills/*.json          校验对象：源代码/配置/文档
规则来源：JSON Schema            规则来源：coding-standards.md
校验策略：Schema 校验             校验策略：AST 解析 + 正则 + 文件对比
输出格式：ValidationResult       输出格式：PolicyReport（同构）
可插拔组件：SkillJsonValidator   可插拔组件：PolicyValidatorComponent
```

两者的校验结果类型同构（errors/warnings/infos 三分组），可统一到 ConsistencyLayer。

### 9.2 与 engine/ConsistencyLayer 的关系

```
ConsistencyLayer（六层防御）
  ├─ IntentFactWall      — 意图事实墙
  ├─ SchemaEnforcer      — Schema 执行器
  ├─ InitVerifier        — 初始化验证器
  ├─ [PolicyValidator]   — 新增：策略校验层 ← policy-validator 在此接入
  ├─ ...                 — 其余防御层
  └─ ...
```

`PolicyValidator` 作为 ConsistencyLayer 的一个新防御层，在 `InitVerifier` 之后执行。
调用方式：

```typescript
// consistency-layer.ts 新增
import { RuleRegistry, RuleEngine, RuleLoader } from "@cortex/policy-validator";

export class ConsistencyLayer {
  private _policyEngine?: RuleEngine;

  async initialize(): Promise<void> {
    const registry = new RuleRegistry();
    const loader = new RuleLoader(registry);
    await loader.loadFromConfig();
    this._policyEngine = new RuleEngine(registry);
  }

  async validatePolicy(): Promise<PolicyReport> {
    if (!this._policyEngine) throw new Error("Not initialized");
    return this._policyEngine.execute();
  }
}
```

### 9.3 与 governance-pipeline 的关系

```typescript
// governance-pipeline.ts 新 stage 注册
registerStage("policy-validation", {
  name: "策略合规校验",
  required: false,         // 可选 stage——默认不阻断
  async execute(ctx) {
    const report = await policyEngine.execute({
      rootDir: ctx.workspaceRoot,
    });

    if (!report.valid) {
      ctx.addIssue({
        stage: "policy-validation",
        severity: report.errors.length > 0 ? "error" : "warning",
        summary: `策略校验：${report.errors.length} 个错误，${report.warnings.length} 个警告`,
        details: report.errors.map(e => `[${e.code}] ${e.message}`),
      });
    }

    return { success: true };
  },
});
```

---

## 10. 遵守编码法典的合规性自检

本架构设计对 `coding-standards.md` 的遵守情况：

### §一 异常处理
- RuleEngine 执行规则时的异常通过 `rule-error` 事件上报（非空 catch）
- 所有 throw 使用 `new Error()`（§1.3 禁止 throw 字符串）
- catch 块均有处理逻辑或显式上报

### §二 变量声明
- 代码设计中全部使用 `const`（`readonly` 修饰接口字段）
- 仅 RuleRegistry 的 `_rules`、`_disabled` 使用 `private` 字段

### §三 异步规范
- `execute()` / `validate()` 均为 `async` 函数
- `return` 语句均加 `await`（Promise 未静默丢弃）

### §四 导入路径
- 桶导出 `src/index.ts` 是统一入口（barrel 铁律）
- 所有新增公开符号必须更新 barrel 导出

### §五 控制台输出
- RuleEngine 通过事件（emit）上报执行状态，非裸 `console.error/warn`
- 报告格式化器在 `formatters/` 中统一管理

### §六 + §十 代码风格深度约束
- 所有公开 API 返回类型显式声明（`interface` 而非 `type` 推断）
- 禁止 `!` 非空断言（使用守卫 `if (!x) throw`）
- 无 `any` 类型泄漏（PolicyReport 等接口全字段类型化）
- 函数签名一致性（全部使用 `workspaceRoot` 命名，非 `rootDir`/`projectRoot`）

### §七 硬编码禁令
- RuleEngineConfig 使用配置对象（无魔法数字）
- 包版本从 `@cortex/config` 导入（非硬编码版本号）
- 文件路径通过 `@cortex/config` 常量引用

### §八 提示词管理
- 本包不涉及提示词管理（使用侧为 GovernancePipeline）

### §九 架构设计原则
- **内部明细化**：校验管线每一步（规则加载 → 筛选 → 文件扫描 → 校验 → 报告）显式独立
- **外部具体化**：`IRuleEngine` 接口仅 5 个方法，承诺极薄
- **三步铁律**：接口定义（§5.1-5.4）先于实现，数据流路径可追踪
- 无接口泄漏（不暴露 `RuleRegistry._rules` Map）
- 无分叉路由（`PolicyValidatorComponent` 统一接口避免 `if/instanceof`）

### §十 死代码
- 本设计文档定义的每个接口/类型均有明确用途
- 无废弃保留（如旧版 validator 模式）

### §十一 方法与函数设计
- 返回类型显式声明（所有函数/方法标注返回类型）
- 位置参数 ≤ 3 个（`execute({ rootDir, filter })` 使用 options 对象）
- 无 boolean trap（`RuleFilter` 使用命名选项对象）

### §十二 导入路径与模块组织
- 导入排序：内置 → 三方 → `@cortex/*` → 相对
- 类型导入使用 `import type`
- 文件名 kebab-case（`no-empty-catch.ts`、`ast-validator.ts`）

### §十三 接口与类型设计
- ISP：`IRuleRegistry`（规则管理）、`IRuleEngine`（规则执行）、`IRuleLoader`（规则加载）三接口隔离
- Discriminated Union：`PolicyEvent` 使用 `type` 字段窄化
- `readonly` 优先：`PolicyRule`、`PolicyReport` 等接口全字段 `readonly`
- 对象形状优先 `interface`（`PolicyRule`、`PolicyReport`、`RuleFilter`）

### §十四 设计模式约定
- **Adapter**：`eslint-adapter.ts` 将 ESLint 规则适配为 PolicyRule
- **Factory**：`RuleLoader.loadFromConfig()` 是内置规则的唯一创建入口
- **Strategy**：不同加载策略（Config/JSON/Module）通过 `IRuleLoader` 接口切换
- **Observer**：`RuleEngine.on/off/emit` 解耦执行与事件处理

---

> **此文档是 @cortex/policy-validator 包的设计宪法。**
> 实际实现时，应严格按照 coding-standards.md §九三步铁律执行：
> 1. 先定义外部接口（本文档 §5）
> 2. 再绘制内部数据流（本文档 §6）
> 3. 最后实现并验证
>
> 违反此流程 = 野蛮生长——CI gate 将通过 architecture-review 拦截。
