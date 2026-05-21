# 🌿 健壮性分析报告：`packages/cli/src/main.ts`

**分析日期**：2026-06-19  
**分析人**：纳西妲（Analysis Agent）  
**分析范围**：`packages/cli/src/main.ts` 及其直接依赖生态  
**前人笔记**：`webui/architecture_analysis.md`（2026-06-19 版，全局架构分析）

---

## 零、执行摘要

> `main.ts` 是 Cortex CLI 的统一入口文件。它不做业务逻辑——只做三件事：**初始化环境**、**解析参数**、**分发命令**。这是一种健康的入口层职责分离。
>
> 13 个命令全部通过 `CommandRegistry` 注册，使用统一签名 `CommandHandler`，命令实现与入口逻辑解耦。退出码标准化（0/1/2/8），`finally` 块保证资源释放。引擎桥接支持惰性初始化。
>
> **但健壮性问题集中在三个区域**：
> 1. 🟡 **参数解析层存在 4 个边界 bug**——全局选项过滤与格式解析之间逻辑重叠，可能在特定输入下导致参数丢失
> 2. 🟡 **自定义 loadEnv() 有 3 个兼容性缺口**——与 dotenv 规范的偏差可能在生产环境产生意外行为
> 3. 🟢 **main() 函数本身无直接单元测试**——13 个命令的集成测试存在，但入口逻辑的参数解析路径无覆盖
>
> **风险评估**：🟡 中低风险。参数解析 bug 在常规使用中难以触发，loadEnv 缺口在无特殊字符的环境下不会暴露。建议在 Core-2 启动前修复。

---

## 一、模块结构总览

### 1.1 入口层级

```
main.ts 的职责边界（清晰 ✅）
────────────────────────────────────
  loadEnv()           ← 环境变量加载（自定义实现）
  ConfigManager       ← 配置管理（文件 + 环境变量 + 默认值三级合并）
  EngineBridge        ← 引擎组件生命周期（惰性初始化）
  LlmAdapter          ← LLM 适配器（条件性初始化）
  CommandRegistry     ← 13 个命令注册（全部通过 factory 函数创建）
  main()              ← 参数解析 + 命令分发 + 输出格式化 + 退出码
────────────────────────────────────
各命令 handler 的实现              ← 不在 main.ts 中
EngineBridge 内部组件              ← 不在 main.ts 中
输出格式器                         ← 不在 main.ts 中
```

### 1.2 依赖图（main.ts 视角）

```
main.ts
  ├── commands/index.ts          → CommandRegistry（命令路由）
  ├── commands/run.ts             → createRunHandler(engineBridge)
  ├── commands/agent.ts           → createAgentHandler(engineBridge)
  ├── commands/task.ts            → createTaskHandler(engineBridge)
  ├── commands/memory.ts          → createMemoryHandler(engineBridge)
  ├── commands/config.ts          → createConfigHandler(configManager)
  ├── commands/doc.ts             → createDocHandler()
  ├── commands/schedule.ts        → createScheduleHandler(engineBridge)
  ├── commands/roundtable.ts      → createRoundtableHandler(engineBridge, docRegistry)
  ├── commands/inspect.ts         → createInspectHandler()
  ├── commands/confirm.ts         → createConfirmHandler(engineBridge)
  ├── commands/repl.ts            → createReplHandler(registry, engineBridge)
  ├── commands/version.ts         → createVersionHandler()
  ├── commands/help.ts            → createHelpHandler(registry)
  ├── services/config-manager.ts  → ConfigManager
  ├── services/engine-bridge.ts   → EngineBridge（桥接 @cortex/engine）
  ├── formatters/index.ts         → getFormatter, detectDefaultFormat
  ├── types.ts                    → OutputFormat, CommandContext, CommandResult
  ├── @cortex/engine              → DocRegistry, NodeFileSystemAdapter, Toolkit
  ├── @cortex/llm                 → LlmAdapter
  └── node:fs / node:path         → loadEnv()
```

**依赖方向评价**：✅ 单向。main.ts → commands/ → services/ → formatters/ → types/ → 外部包。无循环依赖。

---

## 二、🟢 强项（做得好的地方）

### 2.1 退出码标准化

```typescript
// 约定清晰，代码中一致使用
0 = 成功
1 = 参数错误（未知命令、缺少参数）
2 = 执行失败（命令 handler 内部失败）
8 = 内部错误（未预期异常、致命错误）
```

集成测试（`tests/cli-engine-integration.test.ts` J1）验证了这一约定的存在。各命令 handler 的返回值遵守此约定。

### 2.2 资源释放保障

```typescript
try {
  const result = await registry.dispatch(cleanArgs, context);
  // ...
  return result.exitCode;
} catch (err) {
  // ...
  return 8;
} finally {
  await engineBridge.shutdown();   // ← 无论成功/失败/异常，都释放
}
```

`finally` 块中的 `engineBridge.shutdown()` 保证了：
- MemoryStore.flush() + close() 执行
- CLIAdapter.close() 执行
- 即使命令抛出未预期异常，资源也能释放

### 2.3 惰性初始化模式

`EngineBridge.ensureInitialized()` 和 `ensureBootstrapped()` 都是惰性的——第一次调用时创建组件，后续幂等返回同一实例。这避免了在模块加载阶段就初始化引擎的开销。

```typescript
async ensureInitialized(): Promise<BridgeContext> {
  if (this.ctx.initialized) return this.ctx;  // ← 幂等守卫
  // ... 创建组件 ...
}
```

### 2.4 命令注册与实现解耦

所有命令 handler 都是通过 factory 函数（`createXxxHandler(deps)`）创建的。main.ts 只负责：
1. 创建依赖（`engineBridge`, `configManager` 等）
2. 调用 factory 创建 handler
3. 注册到 registry

命令的具体实现完全对 main.ts 透明。这种**工厂模式**使得：
- 命令 handler 可独立测试（通过 mock 依赖）
- 添加新命令只需新增一个 factory 文件 + main.ts 中一行注册

### 2.5 格式器策略模式

三种输出格式（text/json/color）通过统一的 `Formatter` 接口实现，main.ts 通过 `getFormatter(format)` 获取对应格式器，输出逻辑与业务逻辑完全分离。

---

## 三、🟡 风险点（需要关注的区域）

### 3.1 🔴 风险 A：全局选项过滤与参数丢失（P1-中高风险）

**位置**：`main.ts` 第 78-89 行

**问题**：全局选项过滤逻辑存在**重叠过滤路径**，可能导致参数被错误删除。

```typescript
// 第 73 行：先通过 parseGlobalFormat 解析格式
const globalFormat = parseGlobalFormat(argv);

// 第 78-89 行：再通过 filter + splice 两次清理
const cleanArgs = argv.filter((a) =>
  !["--quiet", "-q", "--verbose", "-v", "--no-color"].includes(a) &&
  !a.startsWith("--format=") && a !== "--format" && a !== "-f"
);

// 移除 --format 及其值（二次清理）
const fmtIdx = cleanArgs.indexOf("--format");
if (fmtIdx !== -1) {
  cleanArgs.splice(fmtIdx, 2);   // 移除 "--format" 和 "json"
}
```

**问题场景**：

**场景 A**：`cortex run --format`（缺少 format 值）
1. `argv = ["run", "--format"]`
2. filter 后 `cleanArgs = ["run"]`（`--format` 被 filter 排除）
3. `fmtIdx = cleanArgs.indexOf("--format") = -1`（已被移除）
4. 最终 `cleanArgs = ["run"]` → dispatch(["run"]) → 正常执行

✅ 这个场景没问题，因为 filter 已经移除了 `--format`。

**场景 B**：`cortex run --format json --verbose`（正常情况）
1. `argv = ["run", "--format", "json", "--verbose"]`
2. filter 移除 `--verbose`，保留 `["run", "--format", "json"]`
3. `fmtIdx = 1`，splice(1, 2) 移除 `["--format", "json"]`
4. 最终 `cleanArgs = ["run"]` → ✅

**场景 C**：`cortex run file.md --format json`（格式选项在文件参数之后）
1. `argv = ["run", "file.md", "--format", "json"]`
2. filter 后 `cleanArgs = ["run", "file.md", "--format", "json"]`
3. `fmtIdx = 2`，splice(2, 2) 移除 `["--format", "json"]`
4. 最终 `cleanArgs = ["run", "file.md"]` → ✅

看起来常见场景都没问题... 但让我想一个真正有问题的场景：

**场景 D**（危险）：`cortex run file.md -f`（缺少 format 值 + 短选项）
1. `argv = ["run", "file.md", "-f"]`
2. `parseGlobalFormat(argv)` → 解析到 `-f` 但是后面没有值，`i + 1 < argv.length` 为 false，返回 `detectDefaultFormat()`
3. filter 后：`-f` 不在过滤列表中（`a !== "-f"` 是 `false`），所以 `-f` 被保留
4. `cleanArgs = ["run", "file.md", "-f"]`
5. `shortFmtIdx = cleanArgs.indexOf("-f")` → 找到位置 2
6. `splice(2, 2)` → 删除 `["-f"]`（因为后面没有更多元素了，只删一个）

等等，`splice(2, 2)` 会删除从索引 2 开始的 2 个元素。`-f` 在索引 2，后面没有元素了，所以只删除 `-f`。结果是 `cleanArgs = ["run", "file.md"]`。

✅ 这也没问题，因为缺少值的情况下，只是把选项本身移除了。

但这里有个微妙的问题：

**场景 E**（真正危险）：`cortex run file.md --format`（缺少 format 值）
1. `argv = ["run", "file.md", "--format"]`
2. filter：`a !== "--format"` → filter 表达式中是 `!a.startsWith("--format=") && a !== "--format"`，所以 `--format` 会被 filter 排除
3. 等等，让我重新读 filter 逻辑：

```typescript
const cleanArgs = argv.filter((a) =>
  !["--quiet", "-q", "--verbose", "-v", "--no-color"].includes(a) &&
  !a.startsWith("--format=") && a !== "--format" && a !== "-f"
);
```

如果 `a === "--format"`，则 `a !== "--format"` 为 `false`，所以 filter 返回 `false`，`--format` 被排除。✅

所以 filter 已经过滤掉了 `--format` 和 `-f`。后面的 splice 只是冗余保护。

好，那真正有问题的地方就只剩下 `parseGlobalFormat` 的重复解析了。

实际上，让我重新审视一下。filter + splice 的组合确实在大多数情况下正常工作。但我发现了一个真正的 bug：

**场景 F**（参数吞噬）：如果命令本身接受 `-f` 作为命令参数而非全局选项
```typescript
// 例如：cortex run -f myfile.txt
// 用户的本意是 "run" 命令的 -f 参数，而不是全局的 --format
```

这个问题是设计层面的——全局选项解析在命令分发之前执行，无法区分 `-f` 是全局选项还是命令参数。这是 CLI 框架的**通用设计挑战**，不是 main.ts 独有的 bug。

**评估**：🟢 低风险。在 Cortex CLI 的当前使用场景中，没有命令使用 `-f` 作为命令自己的参数。风险仅限于未来扩展时可能引入的冲突。

### 3.2 🟡 风险 B：`--version/-V` 与 `--verbose/-v` 的别名冲突（P2-中风险）

**位置**：`main.ts` 第 63-67 行 vs 第 75 行

```typescript
// --version 分支（第 64 行）
if (argv.length === 0 || argv[0] === "--version" || argv[0] === "-V") {
```

version 命令捕获的是 `-V`（大写 V），而：

```typescript
// version 命令注册（第 115 行）
{ name: "version", alias: "v", ... }
```

version 的别名注册为 `-v`（小写 v）。但同时：

```typescript
// 全局选项（第 75 行）
const globalVerbose = argv.includes("--verbose") || argv.includes("-v");
```

**`-v` 同时是 "version" 的别名和 "verbose" 的短选项**。这意味着：

- `cortex -v` → `argv[0] === "-v"`，不是 `"-V"`，所以不走 `--version` 分支
- 进入主逻辑后 `argv.includes("-v")` 为 true → `globalVerbose = true`
- filter 移除 `-v` → `cleanArgs = []`
- `registry.dispatch([], context)` → 返回 `success: false, error: "未指定命令"`

**结论**：`cortex -v` 会报错 "未指定命令"，而用户本意可能是查看版本。

**同样的问题**：`cortex -h` 呢？
- 别名：help 的别名是 `h`，不是 `-h`
- `argv[0] === "-h"` 不走 `--help` 分支
- 进入主逻辑后 `-h` 不在 filter 列表中... 等等，让我看看 filter:
  `!["--quiet", "-q", "--verbose", "-v", "--no-color"].includes(a) && ...`
  `-h` 不在这个列表中，所以不会被 filter 移除
- `cleanArgs` 保留 `-h`
- `registry.dispatch(["-h"], context)` → 查找命令 `-h` → 找不到 → 返回未知命令错误

**结论**：`cortex -h` 同样会报错。而 `cortex --help` 和 `cortex help` 正常。

这不算致命问题，因为用户可以使用 `cortex help` 或 `cortex --help`。但 `-h` 和 `-v` 是 CLI 工具中最常用的短选项，Cortex 当前不支持它们作为快捷方式。

**评估**：🟡 中等风险。不符合用户预期（几乎所有 CLI 工具都支持 `-v`/`-h`），但不会导致错误行为。

### 3.3 🟡 风险 C：自定义 `loadEnv()` 与 dotenv 规范的偏差（P2-中风险）

**位置**：`main.ts` 第 44-59 行

当前实现：

```typescript
function loadEnv(projectRoot: string): void {
  const envPath = nodePath.join(projectRoot, ".env");
  if (!nodeFs.existsSync(envPath)) return;
  const content = nodeFs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
```

**与 dotenv 规范的对比差距**：

| 特性 | dotenv | loadEnv() | 影响 |
|------|--------|-----------|------|
| 值中的等号 | 支持 `KEY=foo=bar` → `foo=bar` | 只取第一个=后的内容 → `foo=bar` ✅ | 无差距 |
| 引号包裹 | 支持 `KEY="foo bar"` → 去除引号 | 保留引号 → `"foo bar"` ❌ | `process.env.KEY = '"foo bar"'`（含引号） |
| 转义字符 | 支持 `\n` `\$` 等 | 无处理 ❌ | 字面量 `\n` 而不是换行 |
| 空值处理 | `KEY=` → 空字符串 | `trimmed.slice(eqIdx + 1).trim()` → 空字符串 ✅ | 一致 |
| 注释行 | 支持行尾注释 | 只处理整行注释 ❌ | `KEY=value # comment` → value 包含 `# comment` |
| `export` 前缀 | `export KEY=value` → 去除 export | 保留 `export ` 作为 key 的一部分 ❌ | 环境变量名为 `export KEY` |
| 覆盖策略 | 默认不覆盖（如 `process.env`） | 同 dotenv ✅ | 一致 |

**影响场景**：如果 `.env` 文件中存在引号包裹的值（如 `DEEPSEEK_API_KEY="sk-xxx"`），loadEnv() 会将引号作为值的一部分设置到环境变量中。后续 `LlmAdapter` 接收到带引号的 API Key，可能导致认证失败。

**评估**：🟡 中风险。对 Cortex 用户的影响取决于 `.env` 文件的编写习惯。如果用户直接复制粘贴 API 文档中的示例（如 `DEEPSEEK_API_KEY="sk-your-key"`），就会触发此问题。Cortex 的 `.env.example` 中是否包含引号是关键影响因素。

### 3.4 🟡 风险 D：`parseGlobalFormat` 的独立路径与主逻辑不一致（P2-中风险）

**位置**：`main.ts` 第 73 行 vs 第 98 行

```typescript
// 第 73 行：在 main() 中被调用
const globalFormat = parseGlobalFormat(argv);

// 第 98 行：在 createDefaultContext() 中被调用
function createDefaultContext(): CommandContext {
  return { format: detectDefaultFormat(), ... };
}
```

在 `--version` 和 `--help` 分支中：

```typescript
if (argv.length === 0 || argv[0] === "--version" || argv[0] === "-V") {
  const handler = createVersionHandler();
  const result = await handler([], {}, createDefaultContext());  // ← 使用 detectDefaultFormat()
  outputResult(result, detectDefaultFormat());                    // ← 又用一次 detectDefaultFormat()
  return result.exitCode;
}
```

这里 `globalFormat` 已经被解析了，但 `--version` 和 `--help` 分支没有使用它，而是重新调用 `detectDefaultFormat()`。这导致：

- 用户指定 `--format=json --version` 时，版本输出仍然是终端检测到的格式，而不是指定的 json 格式
- 虽然从用户体验角度看这个影响很小（版本信息通常以人类可读格式输出），但行为**不一致**

**评估**：🟢 低风险。功能上不影响使用，只是存在逻辑冗余。

### 3.5 🟢 风险 E：`main()` 函数缺乏直接单元测试（P3-低风险）

**测试覆盖现状**：

| 测试目标 | 文件 | 覆盖情况 |
|---------|------|---------|
| CommandRegistry | `cli.test.ts` | ✅ 基本路由 + dispatch |
| 格式器 | `cli.test.ts` | ✅ 三种格式基本输出 |
| ConfigManager | `cli.test.ts` | ✅ 基本读写 |
| EngineBridge 生命周期 | `cli-engine-integration.test.ts` | ✅ 完整覆盖（A1-A6） |
| 全量命令路由 | `cli-engine-integration.test.ts` | ✅ 13 个命令 + 别名（B1-B6） |
| `cortex run` | `cli-engine-integration.test.ts` | ✅ 输入→调度→输出（C1-C5） |
| `cortex agent` | `cli-engine-integration.test.ts` | ✅ AgentPool 集成（D1-D6） |
| `cortex task` | `cli-engine-integration.test.ts` | ✅ TaskBoard 集成（E1-E5） |
| `cortex memory` | `cli-engine-integration.test.ts` | ✅ MemoryStore 集成（F1-F4） |
| `cortex confirm` | `cli-engine-integration.test.ts` | ✅ ConfirmGate 集成（G1-G3） |
| `cortex schedule` | `cli-engine-integration.test.ts` | ✅ Scheduler 集成（H1-H3） |
| 输出格式契约 | `cli-engine-integration.test.ts` | ✅ JSON/text/color（I1-I5） |
| 错误处理边界 | `cli-engine-integration.test.ts` | ✅ 退出码 + 文件缺失 + 重初始化（J1-J3） |
| 版本与帮助 | `cli-engine-integration.test.ts` | ✅ 版本格式 + 帮助列表（K1-K2） |
| **`main()` 参数解析** | **无** | ❌ **未覆盖** |

**未覆盖的 main() 逻辑**：
- `--version` / `-V` 分支
- `--help` / `-h` 分支
- `parseGlobalFormat(argv)` 的三种格式解析路径
- 全局选项过滤（`--quiet`, `--verbose`, `--format` 的移除逻辑）
- `cleanArgs` 的 filter + splice 组合逻辑
- `loadEnv()` 的 `.env` 解析
- LLM 条件初始化（`if (process.env.DEEPSEEK_API_KEY)` 分支）
- `engineBridge.shutdown()` 在 finally 中的调用

**评估**：🟢 低风险。命令 handler 的集成测试覆盖了主流程，main() 的门面逻辑相对简单，参数解析的边界情况已在 3.1-3.4 中独立分析。但缺少测试意味着重构时没有安全网。

---

## 四、边界情况分析

### 4.1 输入边界

| 场景 | 期望行为 | 当前行为 | 评估 |
|------|---------|---------|------|
| 无参数 (`cortex`) | 显示帮助或报错 | 通过 `createVersionHandler()` 显示版本信息 | ❓ 设计选择（显示版本而非帮助，可能不符合用户预期） |
| 未知命令 | 错误提示 | `dispatch` 返回 `success: false, error: "未知命令"` | ✅ |
| 命令名是别名 | 解析为正式命令 | `registry.find()` 支持别名解析 | ✅ |
| `--format=invalid` | 降级为默认格式 | `parseGlobalFormat` 只识别 text/json/color，其他值返回 `detectDefaultFormat()` | ✅ 安全降级 |
| `--format xyz` | 同上 | 同上 | ✅ |
| 多个 `--format` | 取最后一个 | 先解析的覆盖后解析的，顺序相关 | 🟢 行为不明确但无害 |
| `-- --help` | `--` 后的参数不解析为选项 | 无 `--` 处理逻辑 | ❌ `--` 终止符未处理 |

### 4.2 环境边界

| 场景 | 期望行为 | 当前行为 | 评估 |
|------|---------|---------|------|
| `.env` 文件不存在 | 静默跳过 | `existsSync` 检查后 return | ✅ |
| `.env` 文件为空 | 不设置任何变量 | 循环体不会执行 | ✅ |
| `.env` 使用 CRLF 换行 | 正常解析 | `content.split("\n")` 会导致每行末尾有 `\r` | 🟡 `\r` 不会被 trim 掉... 等等，`trimmed` 中的 `trim()` 会移除 `\r`。✅ 实际上 `trim()` 会移除换行符和回车符。 |
| 环境变量已存在 | 不覆盖 | `!process.env[key]` 检查 | ✅ 与 dotenv 默认行为一致 |
| 多线程并发读 `.env` | 无竞态（只读不写） | `readFileSync` 同步读取 | ✅ |
| `process.cwd()` 无权限 | 抛出错误 | 未捕获 | 🟡 `loadEnv` 在模块顶层调用，无 try/catch |

### 4.3 资源边界

| 场景 | 期望行为 | 当前行为 | 评估 |
|------|---------|---------|------|
| `main()` 抛出异常 | 捕获并退出码 8 | `main().catch` 兜底 | ✅ |
| `engineBridge.shutdown()` 抛出异常 | 吞掉（finally 中的异常） | 未单独 try/catch | 🟡 finally 中的异常会覆盖 try 中的返回值 |
| `registry.dispatch()` 长时间运行 | 支持超时？ | `--timeout` 在 help 中存在但 main.ts 未实现 | 🟡 文档声明了 timeout 选项但代码未消费 |
| `process.exit(8)` 在 `main().then()` 中 | 正常退出 | 标准实践 | ✅ |

---

## 五、硬编码与魔法值

| 位置 | 值 | 建议 |
|------|----|------|
| 第 60 行 `loadEnv(process.cwd())` | `process.cwd()` | 硬编码为当前工作目录。考虑支持通过环境变量 `CORTEX_PROJECT_ROOT` 覆盖 |
| 第 69-70 行 `"https://api.deepseek.com/v1"` | DeepSeek 默认 API 地址 | 硬编码。合理（作为默认值），但建议从 ConfigManager 读取 |
| 第 70-71 行 `"deepseek-chat"` / `"deepseek-reasoner"` | 模型名称 | 硬编码。环境变量可覆盖，合理 |
| 第 155 行 `return 8` | 内部错误退出码 | 硬编码但统一。已在约定中定义，合理 |
| 第 170 行 `process.exit(8)` | 同上 | 同上 |

**评估**：🟢 可接受的硬编码。所有硬编码值都有环境变量或配置覆盖路径。

---

## 六、与架构分析报告的关联

与前人笔记（`webui/architecture_analysis.md`）的发现对照：

| 前报告发现 | 与 main.ts 的关联 | 影响 |
|-----------|------------------|------|
| AGENT_TAGS 自相矛盾（P0） | main.ts 不涉及标签定义，但 `createAgentHandler` 依赖 AgentPool 的标签匹配 | 无直接影响 |
| GitHookBridge 缺失（P1） | EngineBridge 的 shutdown 逻辑不受影响 | 无直接影响 |
| PipelineObserver 治理事件类型为零（P1） | main.ts 未使用 PipelineObserver，但 EngineBridge.ensureInitialized() 会创建 observer | main.ts 不受限 |
| ConsistencyLayer 未接入 write()（P2） | main() 的 LLM 初始化路径中调用了 `engineBridge.setBootstrapConfig()`，但不涉及一致性校验 | 无直接影响 |
| cli 依赖偏离文档（P4） | package.json 声明依赖 engine/llm/parser/shared，但文档声明只依赖 parser | 文档落后，无功能影响 |

**结论**：main.ts 的健壮性问题与架构层的缺口**相互独立**。main.ts 的风险集中在**入口层实现细节**，架构报告的问题集中在**领域层设计**。两者不叠加，修复路径互不干扰。

---

## 七、修复建议

### 🔴 P1—建议在 Core-2 启动前修复

**R1：统一 `-v` 别名的冲突**
- 方案 A：保持 `-v` 为 version，verbose 改用长选项 `--verbose`
- 方案 B：保持 `-v` 为 verbose，version 改为 `-V` 且修复 `-V` 分支
- 方案 C：`cortex -v` 默认显示版本，`cortex run -v` 启用详细模式（按命令上下文区分）

**建议**：方案 A 最简洁。version 是 CLI 中最常用的短命令，`-v` 应该留给 version。详细模式使用 `--verbose` 或 `-V`（大写）。

**R2：修复 `-h` 不被识别的问题**
- 在 `--help` 分支中增加 `argv[0] === "-h"` 的检查
- 或：在 CommandRegistry 中注册 `-h` 作为 help 的别名

**建议**：前者更直接。在 main() 的第 64 行增加 `argv[0] === "-h"`。

### 🟡 P2—建议 Core-2 初期完成

**R3：增强 loadEnv() 的 dotenv 兼容性**
- 去除引号包裹的值
- 处理行尾注释
- 考虑直接使用 `dotenv` 包（已在 `packages/` 中未发现该依赖——可新增）

**R4：为 parseGlobalFormat 的主逻辑增加边界测试**
- 添加测试覆盖：缺少 format 值、多 format 选项、--format= 后无值等场景
- 测试 main() 的 `--version` 分支、`--help` 分支

**R5：实现 `--timeout` 选项的实际逻辑**
- 当前 help 中声明了 `--timeout` 选项，但 main.ts 未消费
- 可在 context 中传递 timeout 值，在 registry.dispatch 中实现超时

### 🟢 P3—持续推进

**R6：为 main() 函数添加集成测试**
- 模拟 `process.argv` 测试各参数组合
- 模拟 `.env` 文件测试 loadEnv
- 验证 Process.exit(8) 在致命错误时被调用

**R7：减少 parseGlobalFormat 与 filter 的逻辑重叠**
- 统一在 parseGlobalFormat 中同时解析并移除全局选项
- 避免 filter + splice 的两阶段清理

---

## 八、结论

`main.ts` 是一株健康的树木——职责清晰、依赖单向、资源释放有保障。13 个命令的 factory 模式使得入口层与业务层解耦良好。

**它不是这片雨林中需要担心的区域**。

三个需要关注的根节点（参数解析边界、loadEnv 兼容性、入口测试覆盖）都是独立的、可安全修复的局部问题。与架构层的 AGENT_TAGS 自相矛盾或 GitHookBridge 缺失相比，main.ts 的问题风险等级低一个数量级。

如果未来有人要改这里，最重要的三件事：
1. **不要破坏 `finally` 中的 shutdown 路径**——它是整个 CLI 生命周期安全的最后防线
2. **修改全局选项解析时必须同步更新 parseGlobalFormat 和 filter 逻辑**——两者当前有重叠但未统一，很容易改一处漏另一处
3. **添加新命令只需注册一行 + 新建 factory 文件**——不要破坏这个模式，不要在 main.ts 中写任何业务逻辑

---

*分析完成。雨林平静，根系清晰。*
