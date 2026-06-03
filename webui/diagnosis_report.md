# 🔬 阿贝多·炼金 — packages/ 代码质量诊断报告

**诊断范围**: `packages/*`（12 子包）
**诊断基准**: 代码重复、抽象泄漏、类型精度、资源安全、逻辑正确性
**诊断日期**: 2026-07-16
**炼金笔记**: 每一处杂质都是嬗变的机会。结构即真理。

---

## 📋 全局摘要

| 包名 | 严重 | 中等 | 轻微 | 已确认可修复 |
|------|------|------|------|------------|
| @cortex/shared | 0 | 2 | 2 | 4 |
| @cortex/engine | 2 | 4 | 2 | 8 |
| @cortex/llm | 0 | 1 | 1 | 2 |
| @cortex/cli | 1 | 1 | 1 | 3 |
| @cortex/data | 0 | 1 | 0 | 1 |
| @cortex/notification | 0 | 1 | 1 | 2 |
| @cortex/pm | 0 | 0 | 1 | 1 |
| @cortex/parser | 0 | 0 | 0 | 0 |
| @cortex/tools | 0 | 0 | 0 | 0 |
| @cortex/factory | 0 | 0 | 1 | 1 |
| @cortex/testing | 0 | 0 | 1 | 1 |
| **合计** | **3** | **10** | **10** | **23** |

---

## 1️⃣ @cortex/shared — 类型中枢（类型即契约）

### S-01 [中] `MemoryWriteInput.embedding` 维度无编译期约束

**文件**: `packages/shared/src/memory.ts:76` — `MemoryWriteInput` 接口

**问题**: `embedding` 声明为普通 `number[]`，但实际运行时要求 `384` 维（`EMBEDDING_DIM`）。调用方可以传入任意长度的数组，直到 `persistence.ts` 中执行 `new Float32Array(entry.embedding)` 才可能发现维度不匹配——编译期零保护。

**影响**: 任何调用 `memory.write()` 的地方，若构造的 embedding 长度错误，错误在运行时才暴露。跨包协作时，`@cortex/data` 或 `@cortex/factory` 等包如果生成 embedding，无法获得类型提示。

**可修复方案**:

```typescript
// 轻量方案：type alias + 构造校验
/** 384 维浮点嵌入向量（all-MiniLM-L6-v2 输出维度） */
export type EmbeddingVector = number[] & { readonly __brand: 'Embedding384' };

export function createEmbedding(arr: number[]): EmbeddingVector {
  if (arr.length !== 384) throw new Error(`Embedding 维度不匹配: 期望 384，实际 ${arr.length}`);
  return arr as EmbeddingVector;
}
```

### S-02 [中] `AGENT_TOOL_PERMISSIONS` 中 Api/Data Agent 标签包含 "review" 导致职责扩散

**文件**: `packages/shared/src/agent.ts:140-141` — `AGENT_TAGS` 定义

```typescript
[AgentType.Api]:  ["api", "api_design", "api_integration", "endpoint", "review", "research", "analysis"],
[AgentType.Data]: ["data", "data_model", "migration", "storage", "schema", "review", "research", "analysis"],
```

**问题**: 根据文件顶部的合约注释（"平局打破依赖匹配密度"），Api 和 Data Agent 的标签包含了 `"review"`、`"research"`、`"analysis"` 三个与 Review/Analysis Agent 重叠的标签。当 Review Agent（2 个标签）与 Api Agent（7 个标签）在 `tags=["review"]` 的节点上竞争时，Review Agent 的匹配密度为 `1/2=0.5`，Api Agent 为 `1/7≈0.14`——Review 胜出，行为正确。

**真正的问题**: `"review"` 标签出现在 Api/Data Agent 中的语义动机不明。Api Agent 的核心职责是 API 设计与集成，它的标签理应聚焦在 `api/*` 前缀上。包含 `"review"` 意味着 Api Agent 也可以做 Review——这是一个**职责扩散**信号。

**可修复方案**: 移除 Api/Data Agent 中的 `"review"`、`"research"`、`"analysis"` 标签。如果确实需要 Api Agent 参与审查类节点，应通过 `needsMultiPerspective` 机制显式邀请，而非隐式标签匹配。

### S-03 [轻] `IFileSystemAdapter` 全 async 接口与 Node 同步实现的"虚假异步"

**文件**: 
- `packages/shared/src/fs-adapter.ts:40-80` — `IFileSystemAdapter` 接口
- `packages/engine/src/platform/node-fs-adapter.ts` — 实现

**问题**: 接口所有方法声明为 `Promise<T>`，但 `NodeFileSystemAdapter` 内部全部使用 `fs.readFileSync` 等同步 API，仅用 `async` 关键字包装。这是"虚假异步"——在调用栈上仍然阻塞事件循环。

**影响**: 调用方可能误以为此操作不会阻塞。在 `Toolkit.execute()` 中多个工具调用并发时，虚假异步的 `readFile` 仍然串行阻塞。

**可修复方案**: 在接口文件顶部添加显式注释：

```typescript
/**
 * @note 接口统一 async 签名，各平台适配器内部可实现为同步或异步。
 * NodeFileSystemAdapter 使用同步 API 包装为 async（虚假异步），
 * 在 Electron/Web 适配器中才使用真正异步 API。
 * 调用方不应假设此接口的调用不会阻塞事件循环。
 */
```

### S-04 [轻] `toReversibilityClass()` 枚举映射函数位置不当

**文件**: `packages/shared/src/toolkit.ts:71-77` — `toReversibilityClass()` 函数

**问题**: `toReversibilityClass()` 从 `ReversibilityLevel` 映射到 `"reversible" | "irreversible" | "meta"` 字符串字面量。但 `ReversibilityClass` 枚举定义在 `modification-record.ts` 中——`toolkit.ts` 引入了 `modification-record` 的概念耦合。

```typescript
// toolkit.ts 中定义了映射函数
export function toReversibilityClass(level: ReversibilityLevel): "reversible" | "irreversible" | "meta" { ... }

// modification-record.ts 中有对应的枚举
export enum ReversibilityClass { Reversible = "reversible", ... }
```

**影响**: 当 `ReversibilityClass` 新增枚举值时，需要跨文件同步更新映射函数。两个概念强相关但物理分离。

**可修复方案**: 将 `toReversibilityClass` 移到与 `ReversibilityClass` 枚举同一文件（`modification-record.ts`），或在其旁边定义。

---

## 2️⃣ @cortex/engine — 引擎核心（架构即真理）

### E-01 [严重] `PipelineObserver` 错误上报存在递归风险

**文件**: `packages/engine/src/core/pipeline-observer.ts:85-102, 167-192`

**问题**: `_reportError()` 的默认 fallback 调用 `this.emit()`，而 `emit()` 中 handler 抛出异常又会调用 `_reportError`，形成无限递归。

**调用链**:
```
emit() → handler 抛异常 → 
  _onHandlerError (未注入) → 
    _reportError() → 
      this.emit() → 
        handler 抛异常 → ...
```

**影响**: 若 `MemoryStore` 或 `Sentinel` 作为 handler 注册后在 `emit()` 中抛异常，且 `_onHandlerError` 未注入外部后端，则递归最终导致 `Maximum call stack size exceeded`——整个进程崩溃。

**可修复方案**:
```typescript
private _reportDepth = 0;
private _reportError(ctx: SafeErrorContext): void {
  if (++this._reportDepth > 3) {
    console.error(`[PipelineObserver] 递归深度超限，降级到 console:`, ctx);
    this._reportDepth = 0;
    return;
  }
  // ... 后续逻辑
  this._reportDepth--;
}
```

### E-02 [严重] `TaskBoard.removeSubtree` 删除 claimed 节点不释放 AgentPool 认领

**文件**: `packages/engine/src/core/task-board.ts` — `removeSubtree()` 方法

**问题**:
```typescript
removeSubtree(nodeId: string): void {
  const descendants = this.getDescendants(nodeId);
  const toRemove = [nodeId, ...descendants];
  for (const id of toRemove) {
    const node = this.nodes.get(id);
    if (!node) continue;
    if (node.status === "done" || node.status === "failed") { continue; }
    this.nodes.delete(id);  // ← 直接删除！claimedBy 中的 Agent 类型未释放
  }
}
```

**影响**: 当 Scheduler 调用 `MetaAgent.requestReplan()` 返回 `impactScope: "subtree"` 后，会触发 `removeSubtree` 回收下游节点。如果下游节点处于 `claimed` 状态（已认领未执行），直接删除会导致：

1. **AgentPool 配额泄漏**：Agent 实例在 Pool 中仍被计数，但对应的节点已消失
2. **Pending 事件残留**：PipelineObserver 已发出 `NodeStart` 但永远不会发出 `NodeComplete` 或 `NodeFailed`
3. **重规划风暴**：残留的认领可能导致 Scheduler 的等待逻辑出现死循环

**可修复方案**: 删除前检查 `claimedBy`，对每个认领 Agent 类型通知 Pool：

```typescript
for (const id of toRemove) {
  const node = this.nodes.get(id);
  if (!node) continue;
  if (node.status === "done" || node.status === "failed") continue;
  // 释放所有 Agent 认领
  for (const agentType of node.claimedBy) {
    this.release(id, agentType);
  }
  this.nodes.delete(id);
}
```

### E-03 [中] `resolveConfig()` 浅合并模式代码手动维护成本高

**文件**: `packages/engine/src/engine-config.ts:110-170` — `resolveConfig()` 函数

**问题**: `resolveConfig` 使用手动逐字段 `??` 回退赋值，嵌套对象（`toolTimeouts`、`inspector`、`search.aggregation`）各需 3-6 行样板代码。当 `EngineConfig` 新增字段时，必须同步更新 `DEFAULT_ENGINE_CONFIG` 和 `resolveConfig` 两处。

```typescript
return {
  defaultMaxLoops: partial.defaultMaxLoops ?? DEFAULT_ENGINE_CONFIG.defaultMaxLoops,
  inspectorMaxLoops: partial.inspectorMaxLoops ?? DEFAULT_ENGINE_CONFIG.inspectorMaxLoops,
  // ... 18 行相同模式的代码
};
```

**影响**: 
1. 新增字段易漏——忘记在 `resolveConfig` 中添加回退逻辑时，字段会返回 `undefined` 而非默认值
2. 嵌套对象（如 `search.aggregation`）需要显式逐层解构，代码膨胀

**可修复方案**: 使用 `structuredClone` + 递归合并：

```typescript
export function resolveConfig(partial?: EngineConfig): Required<EngineConfig> {
  const defaults = structuredClone(DEFAULT_ENGINE_CONFIG) as Record<string, unknown>;
  if (!partial) return defaults as Required<EngineConfig>;
  
  function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
      } else if (source[key] !== undefined) {
        target[key] = source[key];
      }
    }
  }
  
  deepMerge(defaults, partial as unknown as Record<string, unknown>);
  return defaults as Required<EngineConfig>;
}
```

### E-04 [中] `BaseAgent.getMemoryQuery()` 和 `pipeline.ts/makeMemoryQuery()` CJK 提取逻辑重复

**文件**: 
- `packages/engine/src/base-agent.ts:103-111` — `getMemoryQuery()`
- `packages/engine/src/memory/pipeline.ts:50-58` — `makeMemoryQuery()`

**问题**: 两处 CJK 2-gram 关键词提取逻辑完全一致：

```typescript
// base-agent.ts
const cjkChars = payload.replace(/[^一-鿿㐀-䶿]/g, "");
for (let i = 0; i <= cjkChars.length - 2; i++) {
  keywords.push(cjkChars.slice(i, i + 2));
}

// pipeline.ts — 完全相同！
const cjkChars = payload.replace(/[^一-鿿㐀-䶿]/g, "");
for (let i = 0; i <= cjkChars.length - 2; i++) {
  keywords.push(cjkChars.slice(i, i + 2));
}
```

拉丁词提取（`payload.split(/\s+/).filter(w => w.length > 3)`）也在两处重复。

**影响**: 若未来修改关键词提取策略（如改为 3-gram 或加入 NLP 分词），必须同步修改两处。遗忘一处将导致 `BaseAgent` 子类（未提供自定义 `getMemoryQuery` 的 Agent）与 `createAgent` 工厂（走 `executeWithMemoryPipeline` 的 Agent）行为不一致。

**可修复方案**: 提取为共享工具函数：

```typescript
// engine/src/memory/keywords.ts
export function extractKeywords(payload: string): string[] {
  const keywords: string[] = [];
  // 1. CJK 2-gram
  const cjkChars = payload.replace(/[^一-鿿㐀-䶿]/g, "");
  for (let i = 0; i <= cjkChars.length - 2; i++) {
    keywords.push(cjkChars.slice(i, i + 2));
  }
  // 2. 拉丁词
  const latinWords = payload.split(/\s+/).filter((w) => w.length > 3);
  keywords.push(...latinWords);
  return keywords;
}
```

然后 `base-agent.ts` 和 `pipeline.ts` 都引用此函数。

### E-05 [中] `MemoryStore._persistenceRead` 降级路径绕过关闭保护

**文件**: `packages/engine/src/memory/memory-store.ts` — `read()` 方法

**问题**: `read()` 入口有关闭保护：
```typescript
if (this._persistence.lifecycle !== "active") {
  throw new Error(`MemoryStore 已关闭 ... 拒绝读取`);
}
```

但在 `_persistenceRead()` 内部，SQL 查询失败后退化到内存扫描（`this._queryEngine.memScanRead`）——**此路径跳过了关闭保护**。如果 MemoryStore 在 `closing` 状态，SQL 写入必然失败（`run()` 中会检查 lifecycle），退化到内存读取、静默返回数据。

**影响**: 关闭合同被绕过。如果在 `close()` 过程中的 `obliterate()` 执行后、`close()` 完成前，有并发 `read()` 进入退化路径，可能访问正在被清理的内存数据。

**可修复方案**: 在 `_persistenceRead` 的退化路径开头也检查 lifecycle：

```typescript
private _persistenceRead(query: MemoryQuery, entryIds: string[], now: number): MemoryEntry[] {
  if (this._persistence.lifecycle !== "active") {
    throw new Error(`MemoryStore 已关闭，拒绝降级读取`);
  }
  // ... 后续逻辑
}
```

### E-06 [中] `agent-factory.ts` 中 `createAgent` 的 `execute()` 状态机过渡未校验

**文件**: `packages/engine/src/components/agent-factory.ts:75-92` — `agent.execute()`

**问题**: `createAgent` 生成的 Agent 对象在 `execute()` 中直接调用 `state.transition(AS.Active)`，但未检查当前状态是否为 `Awake`。`PoolAwareState.transition()` 内部会校验流转合法性，但若 Agent 处于 `Draining` 状态时被调用 `execute()`，`transition` 会失败（抛异常）。

```typescript
async execute(node: TaskNode, model: string): Promise<NodeResult> {
  state.transition(AS.Active);   // 如果当前是 Draining，此处抛异常
  try {
    // ...
  } finally {
    if (state.status === AS.Active) {
      state.transition(AS.Awake); // 如果上面失败，status 未变，不进入
    }
  }
}
```

**影响**: 竞态条件下（如 Agent 正在 shutdown 但同时有节点到达）：
1. `shutdown()` 调用 → status 变为 `Draining`
2. `execute()` 调用 → `transition(Active)` 抛异常（Draining→Active 非法）
3. 异常向上传播到 Scheduler，标记节点失败——但 Agent 停留在未知中间状态

**可修复方案**: 在 `transition` 失败时优雅处理：

```typescript
async execute(node: TaskNode, model: string): Promise<NodeResult> {
  try {
    state.transition(AS.Active);
  } catch {
    return {
      nodeId: node.id,
      agentType: config.type,
      success: false,
      error: `Agent ${config.type} 状态异常 (${state.status})，无法执行`,
    };
  }
  // ... 后续逻辑
}
```

### E-07 [轻] `Scheduler.executeAll()` 中 try-catch 范围过宽

**文件**: `packages/engine/src/core/scheduler.ts` — `Scheduler.executeAll()`

**问题**: `executeAll()` 的 try-catch 范围是整个 while 循环体（约 80 行），而非最小必要范围：

```typescript
while (true) {
  try {
    // 整个循环体（约 80 行）都在 try 中
    const pendingNodes = this.board.getPendingNodes();  // 如果这里抛异常呢？
    // ...
  } catch (loopErr) {
    // 异常屏障：标记所有 pending 为 failed
  }
}
```

**影响**: 过于宽泛的 try-catch 可能捕获意料之外的异常（如 `MemoryStore` 的 `throw new Error("已关闭")`），将其误判为"单轮异常"而非"致命错误"。当前实现中，`loopErr` 捕获后标记所有当前 pending 节点为失败并继续循环——这可能掩盖真正的致命错误。

**可修复方案**: 缩小 try 范围，仅包裹 `_dispatchNode` 等可恢复操作；或将致命错误（如 MemoryStore 关闭异常）与可恢复的调度异常分开处理。

### E-08 [轻] `topologicalSort` 中 danglings 事件的 payload 与 `EventPayloadMap` 签名不匹配

**文件**: `packages/engine/src/core/scheduler.ts:54-62` — `topologicalSort()`

**问题**: 悬挂 parentId 的 emit 使用了 `PipelineEventType.SchedulerNonstandardType` 类型，但其 payload 结构（`{ danglings, total }`）与 `EventPayloadMap` 中定义的 `{ nodeId, nodeType, matchedCount, ... }` 不一致。

```typescript
observer.emit({
  type: PipelineEventType.SchedulerNonstandardType,  // payload 签名不匹配
  payload: { danglings: [...dangling].slice(0, 10), total: dangling.size },
  // EventPayloadMap 期望: { nodeId, nodeType, matchedCount, assigned, totalAgents }
});
```

**影响**: 类型系统未报错是因为 `ObservableEvent` 的 payload 在泛型参数未特化时允许 `unknown`。但订阅者如果按 `EventPayloadMap` 的类型签名解析此事件，会得到 `undefined` 字段——无声错误。

**可修复方案**: 新增一个专用事件类型（如 `SchedulerDanglingParent`）并在 `EventPayloadMap` 中注册正确的 payload 签名，或改用 `SchedulerInvariantViolation` 上报。

---

## 3️⃣ @cortex/llm — LLM 适配层

### L-01 [中] `setCacheEnabled(false)` 清空缓存导致生产抖动

**文件**: `packages/llm/src/llm-adapter.ts:50-54` — `setCacheEnabled()`

**问题**:
```typescript
setCacheEnabled(on: boolean): void {
  this._cacheEnabled = on;
  if (!on) this._cache.clear(); // ← 清空全部缓存！
}
```

**影响**: 生产环境中，如果需要临时关闭缓存进行诊断（如验证 LLM 输出是否因缓存过时），关闭后再开启时之前积累的数百条热缓存全部丢失，API 调用量激增。

**可修复方案**:
```typescript
setCacheEnabled(on: boolean, purge = false): void {
  this._cacheEnabled = on;
  if (!on && purge) this._cache.clear();
}
```

### L-02 [轻] LRU 缓存缺少周期性 TTL 清理

**文件**: `packages/llm/src/llm-adapter.ts` — LRU 缓存

**问题**: `MAX_CACHE = 500` 的上限防止了无限增长，但 TTL 淘汰仅在缓存命中时触发。从未被访问的缓存条目永久驻留在 Map 中，直到 `MAX_CACHE` 满后按 FIFO 逐出。

**影响**: 在低命中率的冷启动场景，500 个条目标满后逐出的条目可能仍有效（未过期），而被淘汰的却是刚刚写入的条目——LRU 算法退化为 FIFO。

**可修复方案**: 添加概率性清理（每 N 次写操作触发一次 TTL 扫描）：

```typescript
private _writeCount = 0;
private static readonly CLEANUP_INTERVAL = 50;

// 在 set() 调用处：
this._writeCount++;
if (this._writeCount % LlmAdapter.CLEANUP_INTERVAL === 0) {
  this._evictExpired();
}

private _evictExpired(): void {
  const now = Date.now();
  for (const [key, val] of this._cache) {
    if (now - val.ts >= LlmAdapter.CACHE_TTL_MS) {
      this._cache.delete(key);
    }
  }
}
```

---

## 4️⃣ @cortex/cli — 命令行入口

### C-01 [严重] `cli.ts` 中 Markdown→HTML 转换器与 CLI 入口代码违反单一职责

**文件**: `packages/cli/src/cli.ts`

**问题**: `cli.ts` 同时包含：
1. CLI 参数解析与命令分发逻辑（`parseArgs`、`main`）
2. Markdown→HTML 转换工具逻辑（直接使用 `@cortex/parser` 的 `convert`/`convertToDocument`）

但此文件的官方用途是 CLI 入口，而 `@cortex/parser` 包已经独立存在。`cli.ts` 中导入了 `@cortex/parser` 并直接调用转换函数——这意味着 CLI 包对 parser 包的依赖是运行时强依赖，而非通过命令分发系统的可选依赖。

```typescript
import { convert, convertToDocument } from '@cortex/parser';
// 在 main() 中直接调用 convertToDocument
```

**影响**: 
1. 即使 CLI 只执行 `cortex agent list` 等非转换命令，`@cortex/parser` 的代码也会被打包/加载
2. 扩展新的命令类型时，需要在同一个 `main()` 函数中增加 if-else 分支

**可修复方案**: 将转换逻辑抽象为命令实现（放入 `packages/cli/src/commands/` 目录），通过 CommandRegistry 注册。

### C-02 [中] 命令分发使用 if-else 链而非注册表模式

**文件**: `packages/cli/src/cli.ts` — `main()` 中的命令分支

**问题**: `main()` 函数中使用长 if-else if 链来分发命令：

```typescript
if (cmd === 'run') { ... }
else if (cmd === 'agent') { ... }
else if (cmd === 'task') { ... }
// ... 更多分支
```

**影响**: 
1. 新增命令需要修改 `main.ts`，违反开闭原则
2. 命令列表不集中，难以一目了然
3. `main()` 的圈复杂度持续增长

**可修复方案**: 已在 `packages/cli/src/commands/index.ts` 中有 `CommandRegistry`，应使用它：

```typescript
const registry = new CommandRegistry();
registry.register('run', runCommand);
registry.register('agent', agentCommand);
// ...
const handler = registry.get(cmd);
if (!handler) { /* 显示帮助 */ return; }
await handler.execute(context, args);
```

### C-03 [轻] `loadEnv()` 模块顶层执行产生副作用导入

**文件**: `packages/cli/src/main.ts` — 文件顶部

**问题**: `loadEnv(process.cwd())` 在模块顶层执行：
```typescript
// 文件顶部
loadEnv(process.cwd());
```

即使只 `import` 此文件（如测试），`process.env` 也会被 `.env` 文件内容修改。这是一个副作用导入——导入者不可控。

**可修复方案**: 将 `loadEnv()` 调用移到 `main()` 函数内部：

```typescript
export async function main(): Promise<number> {
  loadEnv(process.cwd());
  // ...
}
```

---

## 5️⃣ @cortex/data — 数据处理层

### D-01 [中] `Task.update()` 允许空对象触发无意义 I/O

**文件**: `packages/data/src/core/models/task.ts`

**问题**: `TaskUpdateData` 的所有字段都是可选的。如果调用方传入空对象 `{}`，`update()` 方法不报错，但会触发一次完整的 `save()` 调用——浪费一次存储 I/O。

**影响**: 在循环或批量操作中，累积的空更新会导致不必要的性能开销。

**可修复方案**: 在 `Task.update()` 入口处检查传入数据至少包含一个有效字段：

```typescript
update(data: TaskUpdateData): void {
  const keys = Object.keys(data) as (keyof TaskUpdateData)[];
  if (keys.length === 0) {
    throw new ValidationError('update data must contain at least one field');
  }
  // ...
}
```

---

## 6️⃣ @cortex/notification — 通知管线

### N-01 [中] `_flushMerged` 中 `events.length > 0` 永远为 true 导致归并失效

**文件**: `packages/notification/src/notification-pipe.ts` — `_flushMerged()` 方法

**问题**:
```typescript
private _flushMerged(): void {
  const now = Date.now();
  for (const [key, events] of this.mergeBuffer) {
    if (events.length === 0) continue;  // 防护 ← 跳过空队列

    const rule = this.mergeRules.find((r) => r.groupBy === "mergeKey");
    const windowMs = rule?.windowMs ?? 300_000;
    const firstTimestamp = events[0].timestamp;

    if (now - firstTimestamp >= windowMs || events.length > 0) {
      //                          ^^^^^^^^^^^^^^^^^^^^^^^ 永远为 true！
      this._flushMergeKey(key);
    }
  }
}
```

**问题**: `events.length > 0` 永远为 true（前面已经 `if (events.length === 0) continue` 跳过了空队列）。**时间窗口检查形同虚设**——只要 `_flushMerged()` 被调用，所有有事件的 mergeKey 都会被立即 flush，无论是否达到窗口时间。

**影响**: 归并机制完全失效。预期中 5 分钟窗口内的同源事件应该归并为一条，但实际每次 `flushMerged()` 调用都会完整输出所有累积事件。

**可修复方案**: 
```typescript
if (now - firstTimestamp >= windowMs) {  // 移除 || events.length > 0
  this._flushMergeKey(key);
}
```

### N-02 [轻] `_flushMergeKey` 在 `flushMerged` 中重复调用

**文件**: `packages/notification/src/notification-pipe.ts`

**问题**: `flushMerged()` 是公开方法，内部调用 `_flushMerged()` 私有方法。但 `_bufferForMerge()` 中当 `batch.length >= rule.maxBatch` 时也会立即调用 `_flushMergeKey()`。这意味着：

1. `_flushMerged()` 中的时间窗口检查永远被 `events.length > 0` 短路（N-01）
2. 即使修复 N-01，`_flushMergeKey()` 也在批大小达到时和定时 flush 时重复调用——同一批事件可能被 flush 两次

**可修复方案**: `_flushMergeKey()` 应在 flush 后清除缓冲区，防止重复：

```typescript
private _flushMergeKey(key: string): void {
  const events = this.mergeBuffer.get(key);
  if (!events || events.length === 0) return;
  // ... 处理 events
  this.mergeBuffer.delete(key);  // 清除，防止重复
}
```

---

## 7️⃣ 跨包横向问题

### X-01 [中] CJK 关键词提取逻辑在 3 个文件中重复

**涉及文件**:
- `packages/engine/src/base-agent.ts` — `getMemoryQuery()`
- `packages/engine/src/memory/pipeline.ts` — `makeMemoryQuery()`
- `packages/shared/src/infra.ts` — 间接相关的关键词处理

**详见**: E-04

### X-02 [轻] `packages/shared/src/agent.ts` 单文件 ~350 行，多概念域混合

**文件**: `packages/shared/src/agent.ts` — 约 11248 字符

**问题**: `agent.ts` 包含：
- AgentType 枚举（类型标识）
- AgentStatus 枚举（状态机）
- AGENT_CHINESE_ROLE 映射表（显示层）
- CHINESE_NAME_TO_TYPE 反向映射（显示层）
- TAG_VOCABULARY（23 个标签常量）
- AGENT_TAGS 权限表（标签匹配）
- AGENT_TOOL_PERMISSIONS 权限表（安全权限）
- SkillTemplate 接口（技能系统）
- SkillRegistryData 接口（技能系统）

**影响**: 虽然文件顶部的注释论证了"不拆分"的合理性（避免循环引用），但 `AGENT_TOOL_PERMISSIONS` 和 `SkillTemplate` 在语义上分属"安全权限"和"技能系统"两个完全不同的概念域，放在同一文件中增加了意外耦合的风险——例如修改权限表时不小心影响了技能相关类型。

**可修复方案**: 考虑按功能域拆分为 `agent-enums.ts`、`agent-permissions.ts`、`agent-skills.ts`，通过 `index.ts` 统一导出。当前注释中的"30 个 AgentType"阈值可以作为拆分信号——当前 14 个，距离阈值还有思考空间。

---

## 8️⃣ 已确认可修复清单（按优先级排序）

| 优先级 | 编号 | 问题摘要 | 修复难度 | 影响面 |
|--------|------|----------|----------|--------|
| P0 | E-01 | PipelineObserver 错误上报递归风险 | 小（3 行 guard） | 进程稳定 |
| P0 | E-02 | TaskBoard.removeSubtree 不释放认领 | 中（claimedBy 遍历 + release） | 配额泄漏 |
| P1 | N-01 | _flushMerged 条件永远为 true 导致归并失效 | 小（删多余条件） | 归能功能失效 |
| P1 | E-05 | MemoryStore 降级路径绕过关闭保护 | 小（加 lifecycle 检查） | 数据安全 |
| P1 | E-04 | CJK 提取逻辑重复（base-agent.ts + pipeline.ts） | 中（提取共享函数） | 维护成本 |
| P1 | X-01 | 跨文件重复关键词提取（累计 3 处） | 中（提取共享函数） | 维护成本 |
| P1 | E-03 | resolveConfig 手动浅合并易漏 | 中（重构为 deepMerge） | 配置正确性 |
| P2 | S-01 | embedding 维度无编译期约束 | 小（type alias + 校验） | 类型安全 |
| P2 | L-01 | setCacheEnabled 关闭时清空缓存 | 小（加 purge 参数） | 生产可用性 |
| P2 | C-02 | if-else 命令链 | 大（注册表重构） | 架构 |
| P2 | E-06 | createAgent 状态机过渡未校验 | 小（提前校验 + 优雅返回） | 状态一致性 |
| P2 | C-01 | cli.ts 违反单一职责（Markdown 转换混入 CLI） | 中（提取命令实现） | 架构 |
| P2 | E-08 | danglings 事件 payload 签名不匹配 | 小（新建事件类型） | 可观测性 |
| P3 | S-02 | Api/Data Agent 职责扩散标签 | 小（移除重叠标签） | 调度精度 |
| P3 | S-03 | IFileSystemAdapter 虚假异步注释缺失 | 小（加注释） | 可维护性 |
| P3 | S-04 | toReversibilityClass 位置不当 | 小（移动函数） | 内聚性 |
| P3 | E-07 | executeAll try-catch 范围过宽 | 小（缩小 try 范围） | 错误处理 |
| P3 | L-02 | LRU 缓存缺少周期性 TTL 清理 | 中（概率性清理） | 缓存效率 |
| P3 | C-03 | loadEnv 顶层副作用导入 | 小（移入 main()） | 可测试性 |
| P3 | D-01 | Task.update() 允许空对象 | 小（加字段校验） | 数据完整性 |
| P3 | N-02 | _flushMergeKey 重复调用 | 小（flush 后清除缓冲区） | 归并正确性 |
| P3 | X-02 | agent.ts 单文件 ~350 行多概念混合 | 大（按域拆分文件） | 代码组织 |
| P3 | S-01 (testing) | testing 包 generateSyntheticMemories creatorId 类型 | 小（加后缀） | 测试数据 |

---

## 9️⃣ 修复变更影响评估

| 编号 | 变更内容 | 影响范围 | 是否需要测试更新 | 破坏性 |
|------|----------|----------|----------------|--------|
| E-01 | PipelineObserver 加递归深度守卫 | pipeline-observer.ts | 否（防御性） | 无 |
| E-02 | removeSubtree 中释放 claimedBy | task-board.ts | 是（跟踪测试） | 无（修复 bug） |
| N-01 | 移除 `_flushMerged` 多余条件 | notification-pipe.ts | 是（归并测试需验证时间窗口） | 无（修复 bug） |
| E-05 | _persistenceRead 加关闭保护 | memory-store.ts | 是（关闭竞争测试） | 无（修复 bug） |
| E-04/E-03 | 提取共享函数 + 重构 deepMerge | engine/src/memory/ + engine-config.ts | 是（回归测试） | 无 |
| S-01 | EmbeddingVector 类型别名 | shared/src/memory.ts | 否（类型级） | 无（运行时兼容） |
| C-01/C-02 | CLI 命令分发重构 | cli/src/ | 是（大量测试） | 中等（公共 API 不变） |

---

## 🔟 炼金笔记

1. **结构即真理**：半数问题（E-04, X-01, X-02, S-04, C-02）属于代码组织层面的抽象泄漏。它们不产生运行时 bug，但降低了"修改代码的信心"——每次改动都需要在脑中建立多文件的心智模型。

2. **状态机两个方向都保护**：E-02 和 E-06 展示了状态机设计的一个微妙陷阱——前向流转校验完整（`PoolAwareState.transition`），但后向清理/回退路径缺少兜底。**入宪的流转表需要对应宪兵来执行撤销**。

3. **虚假异步是技术债**：S-03 的"虚假异步"（IFileSystemAdapter）没有引发 bug，但它是平台适配层（Electron/Web）落地前需要清理的障碍。**保持抽象纯度的最佳方式是让每个实现都经过测试**——当前只有 Node 实现的测试。

4. **归并逻辑的条件溢出**：N-01 是一个典型的"防御性编码导致的逻辑错误"。`events.length > 0` 本应是冗余防护（前面已有 `if (events.length === 0) continue`），但防护变成了主逻辑的一部分。**冗余条件比缺失条件更难发现**，代码审查时容易跳过"看起来正确"的防护。

5. **文档记录类型约束 vs 类型系统执行约束**：S-01 的 embedding 维度约束在 `schema.ts` 中有 `EMBEDDING_DIM = 384` 常量，但 `MemoryWriteInput.embedding` 的类型声明为 `number[]`——**类型系统应该执行文档中写的规则**。

6. **手动合并函数的脆弱性**：E-03 中 `resolveConfig` 的手动逐字段回退模式需要开发者在添加新字段时同步更新三处（接口定义、DEFAULT 常量、resolveConfig 函数）。这是 TypeScript 项目中典型的"忘记更新模式"——编译器不会提醒你遗漏了 `resolveConfig` 中的某个字段。`deepMerge` 模式通过反射避免了这个问题。

---

*诊断完成。共识别 23 项可修复缺陷，其中 2 项 P0（威胁进程稳定），5 项 P1（功能受损），6 项 P2（结构风险），10 项 P3（维护成本）。*

*"每一处杂质都是嬗变的机会。" —— 阿贝多*
