# 刻晴代码审查报告：@cortex/skill-kit

**审查日期**：2026-07-30  
**审查人**：刻晴（CodeReviewAgent）  
**审查范围**：`src/`（9 个源文件）+ `tests/`（9 个测试文件）  
**审查维度**：类型安全 · 错误处理 · 模块边界 · 可测试性 · 代码风格  
**参考基准**：monorepo 约定、`docs/design.md`、TypeScript strict 模式

---

## 审查摘要

| 维度 | 评级 | 关键问题数 |
|:----|:----:|:--------:|
| 类型安全 | ⚠️ 良好 | 2 🔴 + 2 🟡 |
| 错误处理 | ✅ 良好 | 1 🔴 + 1 🟡 |
| 模块边界 | ✅ 良好 | 1 🟡 |
| 可测试性 | ⚠️ 良好 | 2 🟡 |
| 代码风格 | ⚠️ 一般 | 2 🔴 + 3 🟡 |

**综合评级**：⚠️ **有条件通过** — 整体质量良好，核心逻辑清晰，但存在 4 个高优先级缺陷需在合入前修复。

---

## 一、🔴 高优先级缺陷（必须修复）

### H1. [类型安全] `factory.ts` 使用 `as never` 绕过类型系统

**文件**：`src/factory.ts` 第 131、141 行  
**严重等级**：🔴 **高**

```typescript
// 当前代码 — 类型不安全
code: "SKILL_NOT_FOUND" as never,
// ...
code: "SKILL_VALIDATION_FAILED" as never,
```

**问题分析**：`SkillErrorCode` 已在 `types.ts` 中定义为字符串枚举，且在 `factory.ts` 的 import 语句中已引入 `SkillErrorCode`（实际并未使用）。当前代码使用字符串字面量配合 `as never` 完全绕过了类型检查。如果未来枚举值变更（如重命名 `SKILL_NOT_FOUND`），这里会静默失效。

**修复建议**：

```typescript
// 修正：从 types 导入并使用枚举
import { ..., SkillErrorCode } from "./types.js";

// 使用枚举值
code: SkillErrorCode.NOT_FOUND,
// ...
code: SkillErrorCode.VALIDATION_FAILED,
```

---

### H2. [代码风格] `template-engine.ts` 条件渲染存在死代码（双重 else 分割逻辑）

**文件**：`src/template-engine.ts` 第 177–203 行  
**严重等级**：🔴 **高**

```typescript
// 问题：第一个 else 分割逻辑（第 177–191 行）被第二个 "更精确" 的分割（第 192–201 行）完全覆盖
// 第 177–191 行的计算是无用功，应删除
if (elseIndex !== -1) {
  trueBody = body.substring(0, elseIndex);                          // ← 被覆盖
  falseBody = body.substring(elseIndex + ... + 1);                  // ← 被覆盖
  // 更精确的 else 分割
  const elseMatch = body.match(...);
  if (elseMatch) {
    trueBody = body.substring(0, body.indexOf(...));                // ← 覆盖
    falseBody = elseMatch[1];                                       // ← 覆盖
  }
}
```

**问题分析**：第一个 `elseIndex` 分支对 `trueBody`/`falseBody` 的赋值完全被第二个 `elseMatch` 分支覆盖。这不仅是死代码，还意味着第一个分支的计算逻辑中存在 bug（close tag 定位有误），但因为被覆盖而从未触发。这降低了代码的可维护性，并隐藏了潜在逻辑错误。

**修复建议**：

```typescript
// 删除第 177–191 行的死代码，只保留精确分割逻辑
private renderConditionals(template: string, context: TemplateContext): string {
  const ifRegex = new RegExp(/* ... */);

  return template.replace(ifRegex, (_match, condition: string, body: string) => {
    const conditionValue = this.evaluateCondition(condition.trim(), context);

    let trueBody: string;
    let falseBody: string;

    const elseMatch = body.match(
      new RegExp(
        `${this.escapeRegex(this.openTag)}\\s*else\\s*${this.escapeRegex(this.closeTag)}([\\s\\S]*)`,
      ),
    );
    if (elseMatch) {
      trueBody = body.substring(0, body.indexOf(this.openTag + "else" + this.closeTag));
      falseBody = elseMatch[1];
    } else {
      trueBody = body;
      falseBody = "";
    }

    const selectedBody = conditionValue ? trueBody : falseBody;
    return this.render(selectedBody, context);
  });
}
```

---

### H3. [代码风格] `loader.ts` 声明未使用的配置选项 `autoInitJsonSkills`

**文件**：`src/loader.ts` 第 22 行  
**严重等级**：🔴 **高**

```typescript
export interface DynamicImportLoaderOptions {
  baseDir?: string;
  /** 是否自动将 .json 技能标记为已初始化 */
  autoInitJsonSkills?: string;  // ← 声明了但从未在任何地方读取或使用
}
```

**问题分析**：该选项经搜索确认在 `DynamicImportLoader` 的任何方法中均未被引用。保留未使用的配置项会误导消费者，让他们以为可以配置此行为。由于 `noUnusedLocals` 和 `noUnusedParameters` 已开启但该字段在接口中（不是局部变量），TypeScript 不会报错。

**修复建议**：删除该声明，或添加对应的实现逻辑：

```typescript
export interface DynamicImportLoaderOptions {
  baseDir?: string;
  // 删除 autoInitJsonSkills，或按以下模式实现：
  // autoInitJsonSkills?: boolean;
}
```

---

### H4. [代码风格] `loader.ts` JSON 适配器的 `validateInput` 类型守卫是伪校验

**文件**：`src/loader.ts` 第 234–240 行  
**严重等级**：🔴 **高**

```typescript
// 当前代码
if (meta.inputSchema) {
  skill.validateInput = function (input: unknown): input is unknown {
    if (typeof input !== "object" || input === null) {
      return false;
    }
    return true;
  };
}
```

**问题分析**：
1. **类型守卫返回 `input is unknown`** — 这是无意义的类型断言，应返回 `input is SomeType` 或直接返回 `boolean`。
2. **校验逻辑虚假** — 只要输入是对象（非 null）就通过，完全忽略了 `inputSchema` 的具体约束。例如 `inputSchema: { type: "string" }` 但传入一个对象也会通过。
3. **欺骗性** — 消费者看到 `validateInput` 存在会以为做了真正的 Schema 校验，但实际形同虚设。

**修复建议**：

```typescript
// 方案 A：移除 validateInput，在 execute 中做真正的校验
// 方案 B（推荐）：基于 inputSchema 做真正的运行时校验
if (meta.inputSchema) {
  skill.validateInput = function (input: unknown): input is unknown {
    // 使用 executor.ts 中已有的 validateAgainstSchema 逻辑
    // 或引入轻量 JSON Schema 校验库
    if (!meta.inputSchema) return true;
    // 实际校验逻辑...
    const schema = meta.inputSchema;
    if (typeof schema.type === "string" && typeof input !== schema.type) {
      return false;
    }
    return true;
  };
}
```

---

## 二、🟡 中优先级缺陷（建议修复）

### M1. [类型安全] `cache.ts` 方法命名混淆：`this.cache` vs `this`

**文件**：`src/cache.ts`  
**严重等级**：🟡 **中**

**问题分析**：`DefaultSkillCache` 类的底层存储命名为 `private cache: Map<string, CacheEntry>`，而类本身也实现了 `SkillCache` 接口（有 `get`、`set` 等方法）。内部的 `get`/`set`/`has`/`delete` 方法调用 `this.cache.get()`（Map 的 get），而不是 `this.get()`（类的 get）。虽然当前实现是正确的，但这种命名容易导致：
1. 新维护者误调用 `this.get()` 而非 `this.cache.get()`，产生无限递归
2. `markInitialized` 方法中调用 `this.cache.get(skillId)` 返回 `CacheEntry`，但外部看代码容易误解为调用 `this.get()`（返回 `SkillDefinition`）

**修复建议**：将底层存储重命名为更清晰的名称：

```typescript
// 将
private cache: Map<string, CacheEntry> = new Map();
// 改为
private storage: Map<string, CacheEntry> = new Map();
// 或
private entries: Map<string, CacheEntry> = new Map();
```

---

### M2. [错误处理] `executor.ts` 外部 AbortSignal 未传播到执行上下文

**文件**：`src/executor.ts` 第 111–120 行  
**严重等级**：🟡 **中**

**问题分析**：`PipelineExecutor.execute()` 内部创建一个 `AbortController` 用于超时控制，并将此 controller 的 `signal` 传递给 `SkillContext`。但 `ExecuteOptions` 接口并没有定义传入外部 `AbortSignal` 的方式，导致调用方无法手动取消正在执行的技能（例如用户取消操作）。

```typescript
// 当前：无法从外部传递 AbortSignal
const result = await executor.execute(skill, input, {
  timeout: 30_000,
  // 无法传入 signal
});

// 期望：支持外部信号合并
const ac = new AbortController();
const result = await executor.execute(skill, input, {
  signal: ac.signal,  // 外部取消
});
```

**修复建议**：在 `ExecuteOptions` 中增加 `signal` 字段，并在 `PipelineExecutor` 中合并内外信号（使用 `AbortSignal.any` 或 `abort-controller` 库）：

```typescript
// types.ts — ExecuteOptions
export interface ExecuteOptions {
  env?: Record<string, unknown>;
  timeout?: number;
  logger?: SkillLogger;
  traceId?: string;
  signal?: AbortSignal;  // 新增
}

// executor.ts — 信号合并
const externalSignal = options?.signal;
const abortController = new AbortController();

// 合并信号
const onExternalAbort = () => {
  abortController.abort(externalSignal?.reason);
};
externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

// 超时
const timeoutId = setTimeout(() => {
  abortController.abort(new Error(`超时 (${mergedOptions.timeout}ms)`));
}, mergedOptions.timeout);

// 清理
try { /* execute logic */ }
finally {
  clearTimeout(timeoutId);
  externalSignal?.removeEventListener("abort", onExternalAbort);
}
```

---

### M3. [可测试性] `executor.ts` `DEFAULT_LOGGER` 直接绑定 `console` 难以 Mock

**文件**：`src/executor.ts` 第 28–43 行  
**严重等级**：🟡 **中**

**问题分析**：`DEFAULT_LOGGER` 直接调用 `console.log/warn/error/debug`。在单元测试中，如果需要断言日志输出或验证错误日志被记录，需要 Mock `console` 全局对象。更好的做法是使默认日志器可注入或使用依赖倒置。

**修复建议**：

```typescript
// 方案 A：允许通过构造函数传入 logger factory
// 方案 B：使用可替换的日志适配器
export function createDefaultLogger(prefix = "[skill]"): SkillLogger {
  return {
    info: (msg, ...args) => console.log(`${prefix} ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`${prefix} ${msg}`, ...args),
    error: (msg, ...args) => console.error(`${prefix} ${msg}`, ...args),
    debug: (msg, ...args) => console.debug(`${prefix} ${msg}`, ...args),
  };
}

const DEFAULT_LOGGER = createDefaultLogger();
```

---

### M4. [代码风格] 错误信息语言不一致（中文混英文）

**文件**：多个源文件  
**严重等级**：🟡 **中**

**问题分析**：项目错误信息在中英文间不统一。例如：

```
// loader.ts — 中文
"技能 \"${skillId}\" 未注册。请先调用 register() 注册入口路径。"

// validator.ts — 中文
"steps 不能为空数组——技能至少需要一个步骤"

// executor.ts — 英文
"Division by zero"
"Modulo by zero"
```

在 monorepo 环境中，错误信息语言一致性很重要。建议统一为英文（便于国际化、Stack Overflow 搜索、CI 日志解析）。

**修复建议**：将所有面向开发者的错误消息统一为英文，并保持一致的格式：

```typescript
// 统一格式示例
`[DynamicImportLoader] Skill "${skillId}" is not registered. Call register() first.`
`[SimpleSkillValidator] "steps" must not be empty — a skill needs at least one step.`
```

---

### M5. [类型安全] `calculator.ts` 浮点数精度问题

**文件**：`src/calculator.ts` 第 29–32 行  
**严重等级**：🟡 **中**

**问题分析**：`toFixed` 函数使用 `10 ** precision` 缩放后取整再缩回，这是经典的浮点数精度陷阱。

```typescript
function toFixed(value: number, precision: number, mode: RoundMode): number {
  const factor = 10 ** precision;
  const scaled = value * factor;       // 浮点乘法可能引入误差
  const rounded = applyRound(scaled, mode);
  return rounded / factor;             // 浮点除法可能引入误差
}
```

例如 `toFixed(1.005, 2, "round")` 在某些 JavaScript 引擎中返回 `1.00` 而非期望的 `1.01`，因为 `1.005 * 100 = 100.49999999999999`。

**修复建议**：使用 `Number.EPSILON` 修正或使用整数运算：

```typescript
function toFixed(value: number, precision: number, mode: RoundMode): number {
  const factor = 10 ** precision;
  // 使用 epsilon 修正浮点误差
  const scaled = value * factor + Number.EPSILON * (value >= 0 ? 1 : -1);
  const rounded = applyRound(scaled, mode);
  return rounded / factor;
}
```

或对于关键场景，推荐使用 `Intl.NumberFormat` 或专门的 decimal 库。

---

## 三、🟢 低优先级（建议优化）

### L1. [模块边界] `loader.ts` 缺少路径解析防御性校验

**文件**：`src/loader.ts` 第 119–122 行  
**严重等级**：🟢 **低**

`resolvePath` 方法不校验 `baseDir` 是否存在。如果构造函数传入不存在的 baseDir，相对路径解析会静默生成无效路径，后续错误信息（"文件不存在"）可能让用户困惑。建议在构造时验证 `baseDir`。

---

### L2. [可测试性] `validator.ts` 文件末尾的 `SEMVER_REGEX` 在类定义之后

**文件**：`src/validator.ts` 第 311 行  
**严重等级**：🟢 **低**

`SEMVER_REGEX` 定义在类 `SimpleSkillValidator` 之后。虽然 ES 模块提升确保其在运行时可用，但写在类定义之前更符合阅读习惯（依赖前置原则）。

---

### L3. [代码风格] `calculator.ts` 的 `reset()` 重置为硬编码 0，而非初始值

**文件**：`src/calculator.ts` 第 88 行  
**严重等级**：🟢 **低**

```typescript
reset(): this {
  this.value = 0;  // 硬编码 0，不是构造函数传入的 initialValue
  return this;
}
```

如果要支持"重置到初始值"语义，应保存构造函数传入的 `initialValue`。当前行为是"归零"而非"重置"。

---

### L4. [模块边界] `executor.ts` `validateAgainstSchema` 校验能力有限

**文件**：`src/executor.ts` 第 243–270 行  
**严重等级**：🟢 **低**

`validateAgainstSchema` 只校验了顶层 `type` 和 `required` 字段，未实现嵌套对象、数组元素类型、`enum`、`pattern`、`minLength`/`maxLength` 等 JSON Schema 核心约束。如上文 H4 所述，这可能导致校验漏洞。建议在后续迭代中引入轻量 JSON Schema 校验库（如 `jsonschema` 或 `@cfworker/json-schema`）。

---

### L5. [可测试性] 测试文件使用动态 `import()` 而非顶层静态 import

**文件**：`tests/loader.test.ts` 第 62–63 行  
**严重等级**：🟢 **低**

```typescript
const fs = await import("node:fs");
const path = await import("node:path");
```

使用动态 `import()` 而不是顶层 `import` 引入 Node.js 内置模块是不必要的，而且会增加测试的异步复杂度。建议改为顶层静态 import。

---

## 四、代码风格一致性检查

### 4.1 Import 顺序规范

当前文件间 import 顺序不一致：

```typescript
// loader.ts — ✅ 好（外部 → 内部）
import { readFileSync } from "node:fs";
import { extname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { type SkillDefinition, ... } from "./types.js";

// template-engine.ts — ⚠️ 不一致（内部类型在外部包之前）
import { type TemplateEngineOptions, type TemplateContext } from "./types.js";
// 无外部 import
```

**建议**：统一按以下顺序分组，每组空行分隔：
1. Node.js 内置模块（`node:fs`, `node:path`）
2. 外部依赖（如 `vitest`）
3. 内部模块（`./types.js`, `./loader.js`）

### 4.2 空行和注释规范

- `src/types.ts` 和 `src/index.ts` 的注释规范非常优秀 ✅
- `src/calculator.ts` 的 JSDoc 较少，缺少 `@throws` 标签 ⚠️
- 部分函数缺少返回值 JSDoc（如 `cache.ts` 的 `markInitialized` 缺少说明）

### 4.3 TypeScript `strict` 配置利用

当前 tsconfig 启用了 `strict: true`，但未启用 `noUncheckedIndexedAccess`。在频繁使用 `Record<string, unknown>` 和 `Record<string, unknown>` 索引访问的场景中（如 `types.ts` 的 `inputSchema`、`template-engine.ts` 的 `TemplateContext`），启用此选项能进一步提升类型安全性。

---

## 五、测试覆盖率评估

| 模块 | 测试文件 | 覆盖率估算 | 评价 |
|:----|:---------|:---------:|:----|
| `types.ts` | `types.test.ts` | 100% | ✅ 覆盖了所有枚举值 |
| `loader.ts` | `loader.test.ts` | 85% | ✅ 注册/映射/异常路径覆盖良好；缺少 `loadTsModule` 的 mock |
| `validator.ts` | `validator.test.ts` | 90% | ✅ 结构/语义/版本校验覆盖完整 |
| `executor.ts` | `executor.test.ts` | 90% | ✅ 执行管线/超时/异常覆盖完整；缺少 `resetInitialization` 边界测试 |
| `cache.ts` | `cache.test.ts` | 95% | ✅ LRU/TTL/统计/evict/clear 覆盖完整 |
| `factory.ts` | `factory.test.ts` | 80% | ⚠️ 缺少 `execute` 完整路径测试（load+validate+execute 链） |
| `calculator.ts` | `calculator.test.ts` | 95% | ✅ 边界/精度/链式调用覆盖完整 |
| `template-engine.ts` | `template-engine.test.ts` | 85% | ⚠️ 缺少嵌套条件渲染测试、深层嵌套循环测试 |
| — | `e2e.test.ts` | — | ✅ 完整闭环覆盖，包含 10+ 场景 |

**测试总体评价**：✅ **良好**。单元测试覆盖了主要功能路径和异常路径，E2E 测试验证了完整闭环。缺口在于：
1. `factory.ts` 缺少 `execute` 完整路径的独立测试（当前依赖 E2E 覆盖）
2. 缺少嵌套条件/循环的模板引擎测试（影响 LLM prompt 渲染场景）

---

## 六、模块边界完整性检查

### 6.1 循环依赖检查

```
types.ts ← loader.ts  ✅ （types 被依赖，不依赖他人）
types.ts ← validator.ts ✅
types.ts ← executor.ts ✅
types.ts ← cache.ts ✅
types.ts ← template-engine.ts ✅
types.ts ← factory.ts ✅
loader.ts ← factory.ts ✅
validator.ts ← factory.ts ✅
executor.ts ← factory.ts ✅
cache.ts ← factory.ts ✅
index.ts ← 所有模块 ✅
```

**结论**：无循环依赖。模块依赖方向清晰（类型 → 实现 → 工厂 → 桶导出）。✅

### 6.2 公共 API 导出完整性

`index.ts` 导出了所有公开类型和类，与设计文档一致。✅

但注意到 `types.ts` 中定义了 `SkillInitContext` 但实际上在 `executor.ts` 中使用了匿名类型 `{ env, logger }`（第 137 行），未使用 `SkillInitContext` 类型。建议统一。

---

## 七、综合缺陷列表（按优先级排序）

| # | 优先级 | 文件 | 行号 | 类型 | 简述 |
|:-:|:-----:|:----|:---:|:----|:-----|
| H1 | 🔴 高 | `factory.ts` | 131, 141 | 类型安全 | `as never` 绕过 SkillErrorCode 枚举 |
| H2 | 🔴 高 | `template-engine.ts` | 177–203 | 代码风格 | 条件渲染死代码（双重 else 分割） |
| H3 | 🔴 高 | `loader.ts` | 22 | 代码风格 | 声明了未使用的 `autoInitJsonSkills` 选项 |
| H4 | 🔴 高 | `loader.ts` | 234–240 | 类型安全 | `validateInput` 伪校验，忽略 inputSchema |
| M1 | 🟡 中 | `cache.ts` | 全局 | 代码风格 | `this.cache` 命名与类方法混淆 |
| M2 | 🟡 中 | `executor.ts` | 111–120 | 错误处理 | 外部 AbortSignal 未传播 |
| M3 | 🟡 中 | `executor.ts` | 28–43 | 可测试性 | DEFAULT_LOGGER 硬绑定 console |
| M4 | 🟡 中 | 多个 | 多处 | 代码风格 | 错误信息中英文混用 |
| M5 | 🟡 中 | `calculator.ts` | 29–32 | 类型安全 | 浮点数精度问题 |
| L1 | 🟢 低 | `loader.ts` | 119–122 | 模块边界 | 缺少 baseDir 存在性校验 |
| L2 | 🟢 低 | `validator.ts` | 311 | 代码风格 | SEMVER_REGEX 定义位置 |
| L3 | 🟢 低 | `calculator.ts` | 88 | 代码风格 | reset() 硬编码 0 |
| L4 | 🟢 低 | `executor.ts` | 243–270 | 模块边界 | JSON Schema 校验能力有限 |
| L5 | 🟢 低 | `loader.test.ts` | 62–63 | 可测试性 | 动态 import() 替代静态 import |

---

## 八、修复建议总结

### 8.1 必须修复（合入前）

1. **`factory.ts` H1** — 导入 `SkillErrorCode` 枚举，替换 `as never` 字符串
2. **`template-engine.ts` H2** — 删除死代码，保留精确的 else 分割逻辑
3. **`loader.ts` H3** — 删除 `autoInitJsonSkills` 或补齐实现
4. **`loader.ts` H4** — 重写 JSON 技能的 `validateInput`，基于 `inputSchema` 做真实校验

### 8.2 建议修复（本周内）

5. **`cache.ts` M1** — 将 `private cache` 重命名为 `private storage`
6. **`executor.ts` M2** — `ExecuteOptions` 增加 `signal` 字段，实现信号合并
7. **`executor.ts` M3** — 将 DEFAULT_LOGGER 改为工厂函数可测试
8. **全项目 M4** — 统一错误信息为英文
9. **`calculator.ts` M5** — 使用 `Number.EPSILON` 修正浮点精度

### 8.3 可优化（后续迭代）

10. 考虑引入轻量 JSON Schema 校验库（替代 L4 的自实现）
11. 启用 `noUncheckedIndexedAccess` 提升索引访问安全性
12. 补充模板引擎嵌套条件/循环的边界测试

---

## 九、最终裁定

| 审查维度 | 评级 | 判据 |
|:---------|:----:|:------|
| **类型安全** | ⚠️ 良好 | 核心类型定义严谨，但存在 2 处 `as never` 绕过类型系统 + 1 处伪类型守卫 |
| **错误处理** | ✅ 良好 | 异常捕获链完整，Result 模式正确；仅缺少外部取消信号传播 |
| **模块边界** | ✅ 良好 | 无循环依赖，依赖方向清晰；index.ts 导出完整 |
| **可测试性** | ✅ 良好 | 测试覆盖率高（80–95%），组件可 mock；仅 DEFAULT_LOGGER 硬绑定 console |
| **代码风格** | ⚠️ 一般 | 整体规范，但存在死代码、未使用选项、中英文混用等问题 |

**最终裁定**：⚠️ **有条件通过** — 修复 4 个高优先级缺陷（H1–H4）后评审通过。其余中/低优先级问题建议在本迭代内逐步解决。

---

*审查报告结束。所有缺陷已分类登记，高优先级问题均附带修复建议。*
