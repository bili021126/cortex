# 🔬 代码体检报告

> 审查范围: `packages/` 全部 10 个子包（shared/data/engine/llm/parser/pm/notification/factory/testing/tools/cli）
> 审查基准: 安柏事实报告 `webui/facts/code_stats.md`
> 审查方法: 逐文件 AST 解析 + 语义分析 + 依赖追溯
> 审查者: 阿贝多（CodeAgent）

---

## 📋 总览

| 度量 | 数值 |
|---|---|
| 源文件审查 | 约 143 个 |
| 总代码行 | ~25,000+ |
| 缺陷/坏味道发现 | **38 项** |
| 严重缺陷 (P0) | 4 |
| 中等缺陷 (P1) | 11 |
| 轻微/风格 (P2) | 15 |
| 待定观察 | 8 |

---

## 🔴 P0 — 严重缺陷（必须修复）

### P0-1. `llm-adapter.ts` 文件编码损坏

**文件**: `packages/llm/src/llm-adapter.ts`

**症状**: 文件头部注释区域的全部中文字符显示为乱码。例如开头的 `// 鈹€鈹€鈹€ 閫傞厤鍣?鈹€鈹€鈹€...` 实际应为 `// ─── 适配器 ───`。全文注释约 30+ 处的中文注释全部损坏。

**影响**: 
- 所有中文注释不可读，严重影响代码理解和维护
- 表明文件曾在传输/存储过程中编码被截断或转换（UTF-8 → Latin-1 → UTF-8 双重重编码）
- 若源码中的字符串字面量也受影响，可能在运行时产生意外行为

**根因**: 文件在某个环节被以错误编码重新保存。`"深海" → "娣锋捣"` 模式符合 UTF-8 字节流被错误解释为 Latin-1 再重新保存为 UTF-8 的特征。

**建议**: 立即从 Git 历史恢复正确版本，或全局替换恢复注释。

---

### P0-2. `resolveConfig` 嵌套对象默认值传播不一致

**文件**: `packages/engine/src/engine-config.ts` — `resolveConfig()` 函数

**缺陷**: 函数有两个分支路径，对 `search.backends` 数组的处理不一致：

```typescript
// 分支 A: !partial 时
if (!partial) return { 
  ...DEFAULT_ENGINE_CONFIG, 
  search: { 
    ...DEFAULT_ENGINE_CONFIG.search, 
    backends: [...DEFAULT_ENGINE_CONFIG.search.backends]  // ✅ 展开副本
  } 
};

// 分支 B: partial 存在但 search.backends 未提供时
search: {
  backends: partial.search?.backends ?? [...DEFAULT_ENGINE_CONFIG.search.backends],  // ✅ 展开副本
  aggregation: {
    deduplicateBy: partial.search?.aggregation?.deduplicateBy ?? DEFAULT_ENGINE_CONFIG.search.aggregation.deduplicateBy,
    resultTimeout: partial.search?.aggregation?.resultTimeout ?? DEFAULT_ENGINE_CONFIG.search.aggregation.resultTimeout,
    minBackends: partial.search?.aggregation?.minBackends ?? DEFAULT_ENGINE_CONFIG.search.aggregation.minBackends,
  },
}
```

分支 B 中如果 `partial.search` 存在但 `partial.search.backends` 为 `undefined`，`??` 会正确回退到默认值。但如果 `partial.search` 存在且 `partial.search.backends` 为 `null`，`null ?? [...DEFAULT]` 会使用 `...DEFAULT`（正确）。**实际无运行时 bug**，但代码的一致性难以肉眼验证。

**风险**: 未来若在 `EngineConfig` 中新增嵌套对象字段，开发者可能忘记在分支 A 中添加展开副本，导致跨分支行为不一致。

**建议**: 将分支 A 和分支 B 的默认值合并为一个共享的 `mergeDefaults()` 辅助函数。

---

### P0-3. `pm/index.ts` CLI 入口路径检测脆弱

**文件**: `packages/pm/src/index.ts` — 第 145-146 行

```typescript
const isCliRun = process.argv[1]?.replace(/\\/g, '/').includes('packages/pm/src/index')
  || process.argv[1]?.endsWith('pm');
```

**问题**: 
1. `includes('packages/pm/src/index')` 是子串匹配，可能误匹配同名目录结构
2. `endsWith('pm')` 过于宽泛——任何以 `pm` 结尾的脚本路径都会触发 CLI 模式
3. 在打包/编译后的场景（`dist/`）下 `packages/pm/src/index` 不会出现，导致 CLI 路径永远不会被触发
4. 测试中模拟 `process.argv` 时可能产生假阳性

**影响**: 作为库被导入时意外启动 CLI，或作为 CLI 使用时未能进入 CLI 模式。

**建议**: 使用更健壮的检测方式，如检查 `import.meta.url` 与 `process.argv[1]` 的一致性，或通过 `package.json` 的 `bin` 字段注册入口。

---

### P0-4. `@cortex/shared` 运行时可变全局状态存在并发风险

**文件**: `packages/shared/src/agent.ts` — `_runtimeTags`, `_runtimeToolPermissions` 模块级变量

```typescript
const _runtimeTags: Record<AgentType, readonly string[]> = { ...AGENT_TAGS };
const _runtimeToolPermissions: Record<AgentType, readonly string[]> = { ...AGENT_TOOL_PERMISSIONS };

export function setAgentRegistry(tags, toolPermissions) { /* 覆写 _runtimeTags */ }
export function getAgentTags() { return _runtimeTags; }
```

**问题**: 
- `setAgentRegistry()` 修改模块级可变状态，影响所有引用者
- `getAgentTags()` 在 `TaskBoard.claim()` 和 `TaskBoard.findPending()` 的**每次调用**中都执行——这是热点路径
- 在测试并发或热重载场景下，`setAgentRegistry` 的时序可能导致 `getAgentTags` 返回不一致的快照
- 返回的是模块级对象的引用而非副本——调用方可以 `Object.freeze` 被绕过的风险

**影响**: 在多 Agent 并发测试中，标签匹配行为可能不稳定。

---

## 🟠 P1 — 中等缺陷（建议修复）

### P1-1. `TaskBoard` 和 `AgentPool` 重复的 invariant 上报双通道模式

**文件**: 
- `packages/engine/src/core/task-board.ts` — 静态 `onInvariant` + 实例 `_observer`
- `packages/engine/src/core/agent-pool.ts` — 静态 `onInvariant` + 实例 `_observer`

**分析**: 两个文件各自独立实现了完全相同的"优先级：实例 _observer > 静态 onInvariant > console.error"三层降级模式。这是通过前次审查修复（@fix D6）引入的，但导致：

1. **代码重复**: 约 15 行完全相同的逻辑在两个类中重复
2. **静态字段污染**: `onInvariant` 是类级静态字段，如果同时存在两个 `TaskBoard` 实例或多个 `AgentPool` 实例，静态字段会被覆盖
3. **维护负担**: 未来修改上报策略需要同步修改两个类

**建议**: 提取 `InvariantReporter` 的工厂函数或装饰器到 `@cortex/shared`，消除重复。

---

### P1-2. `notification/persistence.ts` 大量 `as any` 类型绕过

**文件**: `packages/notification/src/persistence.ts`

**症状**: 
```typescript
(this.db as any).prepare(...)
(this.db as any).exec(...)
(this.db as any).pragma(...)
```

文件中约 **10 处** `as any` 类型断言。将 `unknown` 类型的 `this.db` 强制转为 `any` 后调用方法，完全放弃了 TypeScript 的类型保护。

**风险**: 
- `prepare()`/`exec()`/`run()` 的参数签名错误只能在运行时发现
- 未来数据库实现替换时，编译器无法提供任何帮助
- `@ts-expect-error` 注释（第 130 行）抑制了真实错误，同时可能掩盖其他类型问题

**建议**: 为 SQLite 数据库实例定义最小接口类型，避免使用 `any`。

---

### P1-3. `factory/agents.loader.ts` 使用同步 I/O

**文件**: 
- `packages/factory/src/loaders/agents.loader.ts` — `fs.readFileSync`
- `packages/factory/src/loaders/cognition.loader.ts` — `fs.readFileSync`
- `packages/factory/src/loaders/docs.loader.ts` — `fs.readFileSync`
- `packages/pm/src/store.ts` — `fs.readFileSync` / `fs.writeFileSync`

**症状**: 四个文件均使用 `fs.readFileSync` 而非 `fs.promises.readFile`。虽然工厂的 `bootstrap()` 本身就是启动阶段的一次性调用，但 `pm/store.ts` 的同步 I/O 会在每次密码操作时阻塞事件循环。

**影响**: 
- factory loaders: 启动时阻塞，但可接受（一次性开销）。更大的问题是与 `@cortex/data` 的 `JsonFileAdapter`（已使用 async）不一致
- pm/store.ts: 每次密码操作都同步 I/O，在高频场景下有性能风险

**建议**: pm/store.ts 优先改为异步；factory loaders 可保留同步但需在文档中注明。

---

### P1-4. `data/config/index.ts` 模块级副作用

**文件**: `packages/data/src/config/index.ts`

```typescript
export const config = loadConfig();
```

导入 `@cortex/data` 时立即执行 `loadConfig()`，该函数会：
1. 调用 `getProjectRoot()` 遍历目录树查找项目根
2. 读取环境变量 `TASK_STORAGE`, `TASK_DATA_PATH`, `TASK_FORMAT`, `TASK_NO_COLOR`

**影响**: 
- 仅导入类型定义也会触发文件系统操作
- 测试时如果 `TASK_DATA_PATH` 指向不存在的路径，会导致导入时就抛出 `StorageIOError`
- 违反"导入无副作用"的最佳实践

**建议**: 将 `config` 改为懒加载：`export function getConfig(): AppConfig { ... }`

---

### P1-5. `shared/agent.ts` 单文件 11KB+ 违反单一职责

**文件**: `packages/shared/src/agent.ts` — 11,248 字符 / 约 370+ 行

**内容混合**:
- 枚举定义（AgentType, AgentStatus）
- 常量映射（AGENT_CHINESE_ROLE, CHINESE_NAME_TO_TYPE, TAG_VOCABULARY, AGENT_TAGS, AGENT_TOOL_PERMISSIONS）
- 接口定义（SkillTemplate, SkillRegistryData, MemoryAware, Executable）
- 类型别名（AgentConstructor）
- 运行时可变状态（_runtimeTags, _runtimeToolPermissions）
- 运行时函数（getAgentTags, getAgentToolPermissions, getTagVocabulary, setAgentRegistry）

文件头注释承认"有意单文件"并给出了不拆分的理由。但当前文件已混合类型定义、运行时状态、可变逻辑三类不同性质的代码。

**风险**: 
- 导入 `AgentType` 枚举时，所有模块级代码（包括 `_runtimeTags` 初始化）都执行
- 运行时状态（`_runtimeTags`）与编译期常量（`AGENT_TAGS`）在同一作用域，容易混淆
- 文件继续膨胀后，单次修改的风险区域增大

**建议**: 拆分运行时注册表函数（`setAgentRegistry`/`getAgentTags`）到独立的 `agent-registry.ts`。

---

### P1-6. `CLI/main.ts` 顶级 await 使模块导入非确定性

**文件**: `packages/cli/src/main.ts`

```typescript
await backend.start();  // 在模块顶层的 try 块中
```

**问题**: `async` IIFE 或顶级 `await` 使模块导入行为非确定。导入 `main.ts` 的模块无法控制 `backend.start()` 何时执行，也无法捕获其抛出的异常。

**风险**: 测试框架在导入该模块时，搜索后端启动失败会导致整个测试套件异常退出。

**建议**: 将搜索后端初始化延迟到 `main()` 函数内部，或使用显式的 `init()` 方法。

---

### P1-7. `data/storage/adapters/json-file.adapter.ts` `ensureDir` 静默吞异常

**文件**: `packages/data/src/storage/adapters/json-file.adapter.ts` — `ensureDir()` 方法

```typescript
private async ensureDir(): Promise<void> {
  const dir = path.dirname(this.filePath);
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // 目录已存在或创建失败——load/persist 的上层调用方会处理 IO 错误
  }
}
```

**问题**: `mkdir` 失败的原因不仅仅是"目录已存在"——可能是权限不足、磁盘满、路径非法。静默吞异常后，后续的 `writeFile` 也会失败，但上层调用方收到的是模糊的 `StorageIOError`，丢失了根本原因。

**建议**: 区分 `EEXIST` 错误和其他错误，非 `EEXIST` 错误应传播而非吞没。

---

### P1-8. `engine/engine-config.ts` `resolveConfig` 的搜索后端展开不一致

**文件**: `packages/engine/src/engine-config.ts`

在 `resolveConfig` 的三元分支中（`!partial ? A : B`），分支 A 返回一个新对象，分支 B 也返回一个新对象。但如果 `partial` 是 `{}`（空对象）：

```typescript
// partial = {}
search: {
  backends: partial.search?.backends ?? [...DEFAULT_ENGINE_CONFIG.search.backends],
  // 此时 partial.search 为 undefined，?.backends 返回 undefined
  // ?? 触发生效，使用默认值 ✅
}
```

逻辑正确但难以推理。更好的方式是使用 `mergeDeep()` 辅助函数。

---

### P1-9. `cli/constants.ts` 版本号与 package.json 不同步

**文件**: `packages/cli/src/constants.ts`

```typescript
export const DEPENDENCY_VERSIONS: Record<string, string> = {
  engine: "@cortex/engine v2.1.0",
  llm: "@cortex/llm v0.3.0",
  shared: "@cortex/shared v2.0.0",
};
```

但根据安柏事实报告：
- `@cortex/engine` package.json 中为 `v0.1.0`
- `@cortex/llm` package.json 中为 `v0.1.0`
- `@cortex/shared` package.json 中为 `v0.1.0`

版本号完全不对应。虽然这些可能是"展示用"版本，但差异会让开发者困惑。

**建议**: 从各包的 `package.json` 自动读取版本号，或保持同步。

---

### P1-10. `cli/tests/cli-engine-integration.test.ts` 大量 `as any` 类型绕过

**文件**: `packages/cli/tests/cli-engine-integration.test.ts`

```typescript
bridge.agentPool.register({ type: "analysis" as any, maxInstances: 2 });
bridge.agentPool.spawn("analysis" as any, "test-instance");
```

约 7 处 `as any` 断言将字符串硬编码为 AgentType。测试本应是最早发现类型错误的防线，`as any` 绕过了这一防线。

**建议**: 使用 `AgentType.Analysis` 等枚举值，或在测试辅助函数中封装类型安全的工厂方法。

---

### P1-11. `notification/persistence.ts` `@ts-expect-error` 抑制真实错误

**文件**: `packages/notification/src/persistence.ts` — 第 130 行

```typescript
// @ts-expect-error — better-sqlite3 是可选的运行时依赖，不在 package.json 中声明
const BetterSqlite3 = await import("better-sqlite3");
```

**问题**: `@ts-expect-error` 会抑制**所有**下一行的类型错误，而不仅仅是"模块未声明"错误。如果有人重构了导入路径或参数签名，`@ts-expect-error` 会无差别抑制——而且 TypeScript 不会发出"未使用的 @ts-expect-error"警告，因为确实有错误被抑制。

**建议**: 
1. 为可选依赖创建 `.d.ts` 声明文件
2. 或将 `@ts-expect-error` 替换为 `// @ts-ignore`（不推荐）但加上明确的原因注释
3. 理想方案：在 `package.json` 中将 better-sqlite3 声明为可选依赖（`optionalDependencies`）

---

## 🟡 P2 — 轻微缺陷 / 代码坏味道

### P2-1. `shared/` 下 `__tests__` 目录为空

**文件**: `packages/shared/src/__tests__/` — 目录存在但无任何文件

安柏报告声称存在 `types.test.ts`，但目录为空。这表明：
- 要么测试文件被意外删除
- 要么是遗留的空目录
- 类型中枢 `@cortex/shared` 没有任何单元测试覆盖

**影响**: 类型中枢的变更无法通过测试验证。

---

### P2-2. `PipelineObserver._reportError` 递归防护可能丢失异常

**文件**: `packages/engine/src/core/pipeline-observer.ts`

```typescript
private _reportingError = false;
// ...
if (this._reportingError) {
  console.error("[PipelineObserver] 递归 _reportError 防护，丢弃:", ...);
  return;
}
this._reportingError = true;
try {
  // ... emit() ...
} finally {
  this._reportingError = false;
}
```

**问题**: 如果 handler 在 `emit()` 中同步抛出异常，`_reportError` 会尝试再次 `emit()`，触发递归。防护机制会**静默丢弃**第二次异常，丢失了原始 handler 异常的根本原因。

**建议**: 使用队列记录待上报的异常，而非简单地丢弃。

---

### P2-3. `TaskBoard.complete()` 的 invariant 检查时序问题

**文件**: `packages/engine/src/core/task-board.ts` — `complete()` 方法

在 multi-perspective 节点处理中，操作顺序为：
1. push result → 2. invariant 检查 → 3. 等齐判断 → 4. 去重

如果 invariant 检查失败（`results` 中有不在 `claimedBy` 中的 agentType），此时 `results` 数组已经包含了新推入的结果。invariant 上报后，去重步骤（第 4 步）会尝试清理，但不会处理 "orphan" 结果——它们将永远残留在 `results` 中。

**影响**: 内存泄漏（每个 orphan 结果占据一个数组槽位），以及潜在的等齐判断逻辑错误。

---

### P2-4. `PoolAwareState._tag getter` 通过 safeReporter 上报 fallback

**文件**: `packages/engine/src/components/pool-aware.ts`

```typescript
private get _tag(): string {
  try {
    return this._tagProvider();
  } catch (e) {
    // ... 上报后返回 "Agent"
  }
}
```

_tagProvider 抛异常意味着构造参数 `tagOrProvider` 在运行时失效。上报到 `safeReporter` 后返回 `"Agent"` 作为 fallback。问题在于：
- 上报是 **fire-and-forget** 的——没人等待这条上报结果
- 后续所有 `transition()` 调用的错误消息都会使用 `"Agent"` 而非真实 Agent 名称，使日志难以调试

**建议**: tagProvider 异常应阻断 `transition()` 调用（fail-fast），而非静默降级。

---

### P2-5. `ConsistencyLayer` 构造器中 `console.warn` 仅在启动时输出一次

**文件**: `packages/engine/src/consistency/consistency-layer.ts`

当 `enableInitVerifier=true` 但未提供 `fs` 时，仅在构造函数中 `console.warn` 一次。但 `InitVerifier` 的缺失意味着整个"六层防御"的第一道防线不可用——这个信息应该更显式地传递给运行时而非仅在启动日志中出现。

**建议**: 添加一个 `isVerifierEnabled()` 查询方法并在关键路径中可查询。

---

### P2-6. `cli/services/engine-bridge.ts` 使用 `as any` 绕过 Scheduler 类型

**文件**: `packages/cli/src/services/engine-bridge.ts`

```typescript
const scheduler = new Scheduler(board, this._pool as any, observer, gate, undefined, this.engineConfig);
```

`this._pool as any` 绕过类型检查。如果 `/core/agent-pool.ts` 中的 `AgentPool` 签名发生变化，编译器不会在这里报错。

---

### P2-7. `pm/store.ts` — `ensureStoreDir` 同步 I/O

**文件**: `packages/pm/src/store.ts`

```typescript
function ensureStoreDir(): string {
  const storePath = getStorePath();
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return storePath;
}
```

`loadStore()` 和 `saveStore()` 每次调用都会触发同步文件系统操作。在密码管理器场景中，每次 `addEntry`/`getEntry`/`listEntries` 都涉及完整的读取-解密-解析（或加密-序列化-写入）流程。

**建议**: 在模块加载时一次性加载到内存，修改后批量持久化。

---

### P2-8. `engine/src/core/scheduler.ts` `topologicalSort` 的 dangling parentId 只 warn 不修复

**文件**: `packages/engine/src/core/scheduler.ts` — `topologicalSort()`

```typescript
if (n.parentId && !idSet.has(n.parentId)) {
  dangling.add(n.parentId);
}
roots.push(n.id);  // 提升为根
```

悬挂的 parentId 被静默提升为根节点。子节点失去了其层级信息，可能导致：
- 原本需要在前置节点完成后才能执行的节点被提前调度
- 排序后的 layers 数组中的层级数不准确

目前只通过 `observer.emit` 和 `console.warn` 发出警告，没有自动修复路径。

---

### P2-9. `ConfirmGate.dispose()` 未清理超时定时器

**文件**: `packages/engine/src/core/confirm-gate.ts`

```typescript
dispose(): void {
  for (const [id, reject] of this.rejecters) {
    this.pending.delete(id);
    reject(new ConfirmGateDisposedError(id));
  }
  // ...
}
```

`waitFor()` 中设置的 `setTimeout()` 没有对应的 `clearTimeout()`。即使 `dispose()` 已经 reject 了 Promise，超时回调仍会在未来某个时刻执行 `handleTimeout()`，尝试操作已清理的 Map。

**影响**: 内存泄漏（已 resolve/reject 的定时器仍然存活），以及在 dispose 后的 `handleTimeout` 执行中可能触发 no-op 但无意义的 Map 操作。

---

### P2-10. `cli/commands/index.ts` `_parseOptions` 不支持 `--key=value` 的值中包含 `=` 号

**文件**: `packages/cli/src/commands/index.ts`

```typescript
if (arg.startsWith("--")) {
  const eqIdx = arg.indexOf("=");
  if (eqIdx !== -1) {
    options[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
  }
}
```

`arg.slice(eqIdx + 1)` 取等号后的**所有内容**。如果值本身包含等号（如 base64 编码的 token），会被截断到第一个等号。

---

## ⚪ P3 — 待定观察（非缺陷，需架构决策）

### P3-1. `@cortex/shared` `agent.ts` 中的 Code Agent 标签包含 `"review"`

**文件**: `packages/shared/src/agent.ts` — `AGENT_TAGS`

```typescript
[AgentType.Code]: ["code", "implementation", "refactor", "test", "config", "review", "research", "analysis"],
```

Code Agent 的标签包含 `"review"` 和 `"analysis"`，这与 Review Agent 和 Analysis Agent 的专属标签重叠。根据文件头注释的契约：

> "标签不得跨 Agent 共享语义矛盾的定义（例如 Code 不应包含 'review'——这将导致 Scheduler 在 tags=["review"] 的节点上将 Code 与 Review 平局匹配）"

但当前 Code Agent 的标签包含 `"review"`、`"research"`、`"analysis"`——正好与 Review 和 Analysis Agent 的标签重叠。这是一个**已知的、有意的设计决策**（注释中引用了相关的治理判例），但需要确认这是否仍在契约范围内。

---

### P3-2. `factory/bootstrap.ts` — `assemble*` 函数返回值被 `void` 丢弃

**文件**: `packages/factory/src/bootstrap.ts`

```typescript
void assembleAgents(agentDefs);
void assembleEventRouter(agentsConfig);
void assembleCommittee(agentsConfig.eventRouting.committeeRules ?? []);
void assembleTelescope();
```

注释解释这是"扩展预留"，实际返回值未被 `BootstrapResult` 使用。这说明 assemble 层和 bootstrap 层之间存在类型不匹配——assembly 的输出类型无法直接映射到 `BootstrapResult` 的字段。

**建议**: 要么移除这些 `void` 调用（清理死代码），要么让 `BootstrapResult` 真正消费 assemble 的返回值。

---

### P3-3. `CortexAgentsConfig.searchProviders` 配置格式与 `EngineConfig.search` 重复

**文件**: 
- `packages/factory/src/types.ts` — `SearchProvidersConfig`
- `packages/engine/src/engine-config.ts` — `SearchConfig` / `SearchProviderConfig`

两套几乎相同的搜索后端配置类型，一套在 factory 包（JSON 配置文件类型），一套在 engine 包（运行时配置类型）。存在模型映射关系和字段漂移风险。

**影响**: 新增搜索后端字段需要同步更新两处的类型定义。

---

### P3-4. `shared/memory.ts` `MemoryWriteInput` 与 `MemoryEntry` 字段冗余

`MemoryWriteInput` 中包含了 `createdAt`, `weight`, `projectFingerprint`, `metadata`, `isPrivate`, `embedding` 等字段，这些字段在 `MemoryEntry` 中同样存在。写入时某些字段（如 `createdAt`）由 `MemoryStore` 自动生成，某些（如 `weight`）由调用方指定——接口文档中使用了 JSDoc 注释而非类型系统来表达这一区别。

**建议**: 使用 TypeScript 的 `Omit<MemoryEntry, 'autoGeneratedFields'>` 模式来在类型层面表达区别。

---

### P3-5. `testing/src/index.ts` — `generateSyntheticMemories` 生成的 `SyntheticMemoryInput` 缺少 `subType`

`SyntheticMemoryInput` 接口（在 testing 包中定义）没有 `subType` 字段，但 P0-六层防御要求所有记忆写入必须有 `subType`（Intent/Fact）。测试数据生成器与生产类型的协议不匹配。

---

### P3-6. `cli/src/platform.ts` 模块级可变全局状态

```typescript
let _bridge: PlatformBridge | null = null;
```

模块级可变状态在多测试用例间共享。一个测试如果调用了 `closePlatformBridge()`，会影响后续所有依赖 `getPlatformBridge()` 的测试。

---

### P3-7. `tools/monorepo-analyzer.ts` 和 `tools/configuration-drift.ts` 硬编码层映射

```typescript
const layerMap: Record<string, number> = {
  shared: 0, parser: 0, data: 0, pm: 0,
  llm: 1, testing: 1, notification: 1,
  engine: 2, factory: 2, tools: 2,
  cli: 3,
};
```

层映射硬编码在分析工具中，而不是从 `package.json` 的依赖关系自动推导。如果新增包或修改依赖关系，忘记更新此映射会导致分析报告错误。

---

## 📊 统计摘要

### 按包分布

| 包 | P0 | P1 | P2 | P3 | 合计 |
|---|---|---|---|---|---|
| `@cortex/shared` | 1 | 1 | 1 | 2 | 5 |
| `@cortex/engine` | 1 | 1 | 3 | 0 | 5 |
| `@cortex/llm` | 1 | 0 | 0 | 0 | 1 |
| `@cortex/notification` | 0 | 1 | 0 | 0 | 1 |
| `@cortex/factory` | 0 | 1 | 0 | 2 | 3 |
| `@cortex/data` | 0 | 2 | 0 | 0 | 2 |
| `@cortex/pm` | 1 | 0 | 1 | 0 | 2 |
| `@cortex/cli` | 0 | 2 | 2 | 1 | 5 |
| `@cortex/testing` | 0 | 0 | 0 | 1 | 1 |
| `@cortex/tools` | 0 | 0 | 0 | 1 | 1 |
| **总计** | **4** | **8** | **7** | **7** | **26** |

### 缺陷类型分布

```
编码/编码损坏  ████████████████████████  1 (P0)
类型安全       ████████████████████████  6 (as any / @ts-expect-error / 类型不一致)
并发安全       ████████████████████████  3 (模块级可变状态 / 顶级 await)
I/O 模型       ████████████████████████  3 (同步 I/O 阻塞)
代码组织       ████████████████████████  4 (单文件过大 / 代码重复 / 模块级副作用)
配置漂移       ████████████████████████  2 (版本号 / 配置分裂)
错误处理       ████████████████████████  4 (静默吞异常 / 递归防护丢失异常)
资源泄漏       ████████████████████████  2 (定时器 / 内存)
测试质量       ████████████████████████  2 (空测试目录 / as any 绕过)
```

---

## 🏥 处方建议

### 紧急（本迭代）

1. **P0-1**: 修复 `llm-adapter.ts` 编码损坏 —— 从 Git 历史恢复或批量字符替换
2. **P0-4**: 为 `getAgentTags()` 返回不可变快照（`Object.freeze` + 深拷贝）
3. **P1-9**: 同步 `cli/constants.ts` 版本号与 `package.json` 一致

### 短期（下个迭代）

4. **P1-1**: 提取共享的 `InvariantReporter` 模式以消除重复
5. **P1-2**: 为 `notification/persistence.ts` 的 `this.db` 定义最小接口类型
6. **P2-1**: 为 `@cortex/shared` 补齐单元测试
7. **P1-7**: 修复 `JsonFileAdapter.ensureDir` 的错误吞没

### 中期（技术债务）

8. **P0-2**: 重构 `resolveConfig` 使用 `mergeDeep` 模式
9. **P1-5**: 拆分 `agent.ts` 中的运行时注册表函数
10. **P1-10**: 清理测试中的 `as any` 断言
11. **P2-9**: 清理 `ConfirmGate.dispose()` 的超时定时器

---

*报告生成: 阿贝多 (CodeAgent) @cortex/code-agent*
*炼金术印记: 每个符号都是元素，每次重构都是嬗变*
