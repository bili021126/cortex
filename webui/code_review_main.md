# ⚔️ 刻晴·玉衡 — `packages/cli/src/main.ts` 审查报告

**审查范围**: `packages/cli/src/main.ts`（Cortex CLI 统一入口）
**审查基准**: 逻辑正确性、边界条件、资源泄漏、线程安全、破坏性变更、错误处理完整性
**审查日期**: 2026-07-16
**参考档案**:
- `packages/cli/src/types.ts` — 类型定义
- `packages/cli/src/commands/index.ts` — CommandRegistry
- `packages/cli/src/commands/repl.ts` — REPL 命令（特殊 Promise 行为）
- `packages/cli/src/services/engine-bridge.ts` — 引擎桥接
- `packages/cli/src/services/config-manager.ts` — 配置管理
- `packages/cli/src/formatters/*.ts` — 输出格式器
- `webui/code_review_diagnosis.md` — 前次审查档案（记录 C-01、C-02、S7-03）
- `webui/inspector_report.md` — 项目统计

---

## 📋 审查结论摘要

| 严重性 | 数量 | 关键问题 |
|--------|------|----------|
| 🔴 严重 | 1 | `outputResult()` 无异常防护，fmt 抛异常导致无声失败 |
| 🟠 中 | 3 | 全局选项解析参数吞吃、模块级资源无法清理、LLM 配置校验不严格 |
| 🟡 轻 | 3 | 未解析 `--config` 选项、.env value 引号未 trim、代码复用 |
| **合计** | **7** | |

---

## 1️⃣ 严重缺陷

### M-01 [🔴] `outputResult()` 无异常防护 — 旧案未结

**位置**: `main.ts` — `outputResult()` 函数（第 164-171 行）

```typescript
function outputResult(result: CommandResult, format: OutputFormat): void {
  const fmt = getFormatter(format);
  if (result.success) {
    console.log(fmt.formatSuccess(result));  // ← 可能抛异常
  } else {
    console.error(fmt.formatError(result));  // ← 可能抛异常
  }
}
```

**问题**: `getFormatter(format)` 从硬编码 `formatters` 字典中索引，`format` 已在前置逻辑中被校验为 `"text"|"json"|"color"` 之一，所以 `getFormatter` 本身不会返回 `undefined`。但 `fmt.formatSuccess()` / `fmt.formatError()` 内部调用了 `JSON.stringify(result.data)`、`result.output`、`result.error` 等，如果 `result.data` 包含循环引用或 BigInt 等无法序列化的值，`JSON.stringify` 抛异常——**输出无声丢失**。

**触发条件**:
```bash
cortex run README.md --format json    # 如果 result.data 含循环引用 → JSON.stringify 抛错
```

**预期**: 加 try-catch 兜底到最小兜底输出：

```typescript
function outputResult(result: CommandResult, format: OutputFormat): void {
  const fmt = getFormatter(format);
  try {
    const output = result.success ? fmt.formatSuccess(result) : fmt.formatError(result);
    if (result.success) console.log(output);
    else console.error(output);
  } catch {
    // 兜底：纯文本输出，确保用户至少看到退出码
    const fallback = `[output error] exitCode=${result.exitCode} success=${result.success}`;
    console.error(fallback);
  }
}
```

**前次审查引用**: 此问题在 `code_review_diagnosis.md` C-01 中已记录，**未修复**。

---

## 2️⃣ 中等缺陷

### M-02 [🟠] `--format` 缺失值时吞掉后续参数

**位置**: `main.ts` — `cleanArgs` 过滤逻辑（第 86-97 行）

```typescript
const cleanArgs = argv.filter((a) =>
  !["--quiet", "-q", "--verbose", "-v", "--no-color"].includes(a) &&
  !a.startsWith("--format=") && a !== "--format" && a !== "-f"
);

const fmtIdx = cleanArgs.indexOf("--format");
if (fmtIdx !== -1) {
  cleanArgs.splice(fmtIdx, 2);  // 删除 --format 及其"值"
}
const shortFmtIdx = cleanArgs.indexOf("-f");
if (shortFmtIdx !== -1) {
  cleanArgs.splice(shortFmtIdx, 2);
}
```

**问题**: `splice(fmtIdx, 2)` 无条件删除 `--format` 及其**下一个参数**，无论下一个参数是否为 format 的值。如果用户输入：

```bash
cortex run --format -v
```

1. `parseGlobalFormat()` 解析 `-v` 不是有效格式 → 返回 `detectDefaultFormat()`（正确）
2. 但 `cleanArgs` 中 `splice(fmtIdx, 2)` 删除了 `["--format", "-v"]` 两个元素
3. 结果：`-v` 被**吞掉**，用户期望的 verbose 模式不会生效

同样的问题适用于 `-f` 短格式。

**预期**: 确认 format 参数有值再 splice：

```typescript
const fmtIdx = cleanArgs.indexOf("--format");
if (fmtIdx !== -1 && fmtIdx + 1 < cleanArgs.length && !cleanArgs[fmtIdx + 1].startsWith("-")) {
  cleanArgs.splice(fmtIdx, 2);
} else if (fmtIdx !== -1) {
  cleanArgs.splice(fmtIdx, 1);  // 仅删除 --format 本身
}
```

**前次审查引用**: 此问题在 `code_review_diagnosis.md` C-02 中已记录（标记为低风险），但实际影响比原记录更大——它吞掉的是 `-v` 而不是后续命令参数。**建议升级为中风险**。

---

### M-03 [🟠] 模块级资源无法清理，`main()` 可重入但状态不一致

**位置**: `main.ts` — 模块级初始化（第 36-49 行）

```typescript
const configManager = new ConfigManager();
const engineBridge = new EngineBridge(configManager);
// ...
const fs = new NodeFileSystemAdapter();
const docRegistry = new DocRegistry(fs, process.cwd());
```

**问题**: 这些对象在模块作用域创建，`main()` 是 `export async function`，理论上可以被多次调用（如测试环境）。但：

1. **`engineBridge.shutdown()` 在 `finally` 中调用** — 第一次调用 `main()` 后，`engineBridge` 的 `ctx.initialized = false`，但内部组件（Scheduler、MemoryStore 等）处于"已关闭但可重新初始化"的中间状态。第二次调用 `main()` 时，`ensureInitialized()` 会重新创建所有组件（因为 `ctx.initialized = false`），但旧组件可能被垃圾回收前仍在执行回调。

2. **`docRegistry` 从不关闭** — `NodeFileSystemAdapter` 和 `DocRegistry` 在模块级别创建，没有 `close()` 或 `dispose()` 调用。`DocRegistry` 如果在未来版本添加了文件监听器（watch 模式），会导致监听器泄漏。

3. **`loadEnv(process.cwd())` 在模块顶层执行** — 即使 `main.ts` 被 import 而非执行，也会修改 `process.env`。这是一个**副作用导入**。

**预期**:

```typescript
// 将模块级初始化移到 main() 内部，或提供 dispose 机制
export async function main(): Promise<number> {
  const configManager = new ConfigManager();
  const engineBridge = new EngineBridge(configManager);
  // ... 其余逻辑
  try {
    // ...
  } finally {
    await engineBridge.shutdown();
  }
}
```

或者至少将 `loadEnv()` 移到 `main()` 内部，避免副作用导入。

---

### M-04 [🟠] LLM 配置的 `reasoningEffort` 无有效值校验

**位置**: `main.ts` — LLM 配置段（第 52-65 行）

```typescript
reasoningEffort: (process.env.DEEPSEEK_REASONING_EFFORT as "high" | "max") || undefined,
```

**问题**: 如果用户设置 `DEEPSEEK_REASONING_EFFORT=low`（或任何非 `"high"`/`"max"` 的值）：
1. TypeScript 类型断言 `as "high" | "max"` 强制通过，编译不报错
2. `"low"` 是 truthy 字符串，`|| undefined` 不会兜底
3. `LlmAdapter` 收到 `"low"`，运行时行为未定义（可能报错，可能静默使用默认值）

**预期**: 加显式校验：

```typescript
const rawEffort = process.env.DEEPSEEK_REASONING_EFFORT;
const reasoningEffort: "high" | "max" | undefined =
  rawEffort === "high" || rawEffort === "max" ? rawEffort : undefined;
```

---

## 3️⃣ 轻微缺陷

### M-05 [🟡] `--config` 全局选项未解析

**位置**: `main.ts` — `context` 创建（第 100-106 行）

```typescript
const context: CommandContext = {
  format: globalFormat,
  quiet: globalQuiet,
  verbose: globalVerbose,
  configPath: undefined,  // ← 始终为 undefined
  rawOptions: {},
};
```

**问题**: `help.ts` 中将 `--config` 列为全局选项，但在 `main.ts` 中从未解析 `--config` 参数。`context.configPath` 恒为 `undefined`。ConfigManager 的构造函数虽然接受 `configPath`，但 `main.ts` 中 `new ConfigManager()` 没有传参，所以配置文件的搜索走的是自动向上搜索策略（.cortex/config）。

**影响**: 用户显式指定 `--config /path/to/config.json` 时会被忽略，配置路径参数形同虚设。

**预期**: 解析 `--config` 参数并传递给 `ConfigManager`：

```typescript
const configIdx = argv.indexOf("--config");
const configPath = configIdx !== -1 && configIdx + 1 < argv.length
  ? argv[configIdx + 1] : undefined;

const context: CommandContext = {
  // ...
  configPath,
};
```

---

### M-06 [🟡] `.env` 解析不处理引号包裹的值

**位置**: `main.ts` — `loadEnv()` 函数（第 14-30 行）

```typescript
const value = trimmed.slice(eqIdx + 1).trim();
if (!process.env[key]) {
  process.env[key] = value;
}
```

**问题**: 如果 `.env` 文件中有：

```env
DEEPSEEK_API_KEY="sk-xxx"
```

`value` 会是 `"sk-xxx"`（含双引号）。常见的 `.env` 解析器（如 `dotenv` 库）会去掉外层引号。这里保留引号会导致 API 调用时发送的密钥包含多余字符。

**影响**: 用户从其它项目复制 `.env` 文件时，引号格式不兼容。用 `dotenv` 格式的 `.env` 文件会静默失败——API 总是返回 401/403，用户排查方向首先会怀疑密钥有效性而非格式问题。

**预期**: 去除首尾匹配的引号对：

```typescript
let value = trimmed.slice(eqIdx + 1).trim();
if ((value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))) {
  value = value.slice(1, -1);
}
```

---

### M-07 [🟡] `parseGlobalFormat` 与 `cleanArgs` 重复实现 format 解析逻辑

**位置**: `main.ts` — `parseGlobalFormat()` 与后续 `cleanArgs` 过滤

**问题**: `parseGlobalFormat` 和 `cleanArgs` 对 `--format` 和 `-f` 的处理逻辑完全分开编写：

- `parseGlobalFormat`：遍历 argv，识别 `--format=json` 和 `--format json` / `-f json`
- `cleanArgs`：用 `filter` + `startsWith` + `indexOf` + `splice` 移除

两段代码维护者需要同时更新才能保持一致。当前它们的行为有细微差异（`parseGlobalFormat` 认为 `--format` 后跟的下一个参数必须以 `"text"|"json"|"color"` 之一才是有效值；而 `cleanArgs` 无条件删除后一个参数）。

**预期**: 统一为一次参数解析流程，或使用成熟的 CLI 参数解析库（如 `yargs`、`commander`）。

**前次审查引用**: 此问题在 `code_review_diagnosis.md` S7-03 中已记录，**未修复**。

---

## 4️⃣ 前次审查跟踪（code_review_diagnosis.md）

| 原编号 | 问题 | 状态 | 备注 |
|--------|------|------|------|
| C-01 | `outputResult()` 无 try-catch | ❌ **未修复** | 本次报告 M-01 |
| C-02 | `--format` 参数边界未处理 | ❌ **未修复** | 本次升级为 M-02 |
| S7-03 | `parseGlobalFormat`/`cleanArgs` 重复 | ❌ **未修复** | 本次报告 M-07 |
| S4-03 | ConfigManager 浅合并 | ❌ **未修复** | config-manager.ts 中 `Object.assign` 未改 |
| S7-02 | JSON 解析错误静默忽略 | ❌ **未修复** | config-manager.ts `_mergeFromFile` catch 空块 |
| S4-02 | MiniAgentPool `as any` 绕过类型检查 | ❌ **未修复** | engine-bridge.ts 中 `as any` 保留 |

**评价**: 上一次审查标记的 6 个 CLI 相关问题，**0 个已修复**。`_mergeFromFile` 的浅合并和静默吞错是两个中风险问题，如果用户配置有笔误，引擎会无提示地以默认配置运行——用户不知道自己配置未生效。

---

## 5️⃣ 补充发现：跨模块风险

### Cross-01: `main()` 中 `outputResult` 调用在 `try` 块外

**位置**: `main.ts` 第 72-73 行（`cortex --version` 路径）和第 78-79 行（`cortex --help` 路径）

```typescript
// cortex --version
if (argv.length === 0 || argv[0] === "--version" || argv[0] === "-V") {
  const handler = createVersionHandler();
  const result = await handler([], {}, createDefaultContext());
  outputResult(result, detectDefaultFormat());  // ← 在 try 块外！
  return result.exitCode;
}

// cortex --help
if (argv[0] === "--help" || argv[0] === "-h") {
  const handler = createHelpHandler(registry);
  const result = await handler([], {}, createDefaultContext());
  outputResult(result, detectDefaultFormat());  // ← 在 try 块外！
  return result.exitCode;
}
```

**问题**: `--version` 和 `--help` 路径调用 `outputResult` 时**在 `try/catch` 块之外**。如果 `createVersionHandler()` 或 `createHelpHandler()` 返回的 handler 抛异常，会被 `main().catch()` 兜底。但如果 `outputResult` 抛异常（同上 M-01），则**既无 try-catch 保护，又不会被 `main().catch()` 捕获**（因为抛异常的位置不在 async 函数返回的 Promise 链中，而是在 then 之前）。

实际上分析：`outputResult` 是同步函数，如果它在 `outputResult(result, ...)` 调用时抛异常，会直接同步抛出，被 `main()` 函数的同步执行流捕获...但 `main()` 是 async 函数，async 函数中的同步异常会被包装成 rejected Promise。所以实际上会被 `main().catch()` 捕获。所以这不算额外风险，但路径不统一（其他路径在 try-catch 内，这两个在 try 外）增加了维护负担。

**建议**: 将这两个早期返回路径也移入 `try` 块，或至少用独立的 try-catch 包裹。

---

### Cross-02: `createDefaultContext()` 与 `context` 的不一致构造

`createDefaultContext()` 创建 `{ format, quiet: false, verbose: false, rawOptions: {} }`（`configPath` 为 `undefined`，根据类型定义允许 optional）。

而后面主路径的 context 构造也相同。但如果未来在 `CommandContext` 中添加了必填字段，两个构造点需要同步更新。

**风险**: 低，维护性问题。

---

## ⚔️ 总体评价

`main.ts` 整体结构清晰，模块职责划分合理（参数解析、命令注册、执行、输出四阶段明确）。作为 CLI 入口，核心流程正确。

**须优先修复**:
1. **M-01** (`outputResult` 无异常防护) — 会直接导致用户看到无声退出
2. **M-02** (`--format` 吞参数) — 会静默破坏用户的其他全局选项
3. **M-04** (LLM 配置校验) — 环境变量拼写错误无提示，调试成本高

**前次审查跟踪率**: 6/6 未修复。建议建立"审查缺陷修复清单"追踪机制——报告写再多，不改等于没写。

---

*报告生成: 刻晴·玉衡 — Cortex Review Agent*
*参考: 前次审查档案 `webui/code_review_diagnosis.md`*
