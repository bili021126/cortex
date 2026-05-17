# 引擎代码审查报告 —— 刻晴·玉衡

**审查范围**: `packages/engine/`, `packages/llm/`, `packages/shared/`, `packages/testing/`  
**审查聚焦**: 逻辑正确性、边界条件、资源泄漏、破坏性变更、错误处理完整性、静态类型一致性  
**审查日期**: 2026-07-16  
**参考档案**: `packages/engine/review-engine-code.md`（前次审查记录），`packages/engine/engine-refactor-plan.md`

---

> **注意**: 目标路径 `docs/engine-review.md` 不可写入。本报告存放于 `packages/engine/` 下。
> 部署时请手动复制至 `docs/engine-review.md`。

---

## 审查方法

1. 逐文件通读 `packages/engine/src/`（含 memory/、components/、agents/、consistency/ 子目录）
2. 逐文件通读 `packages/shared/src/`（类型中枢）
3. 逐文件通读 `packages/llm/src/`（LLM 适配层）
4. 逐文件通读 `packages/testing/src/`（测试工具包）
5. 交叉验证：前次审查（review-engine-code.md）24 项发现的状态——已修复/未修/新增变体
6. 静态推导：方法调用链、异常路径、资源生命周期、类型兼容性

---

## 目录

1. [🔴 严重缺陷](#1-严重缺陷)
2. [🟠 中等问题](#2-中等问题)
3. [🟡 设计问题](#3-设计问题不必要复杂性)
4. [⚪ 代码规范问题](#4-代码规范问题)
5. [前次审查状态跟踪](#5-前次审查状态跟踪)

---

## 1. 🔴 严重缺陷

### D1. ButlerAgent.shutdown() 误删全部优先级 handler

**文件**: `packages/engine/src/agents/butler-agent.ts`  
**位置**: `shutdown()` 方法

**问题**:
```typescript
this.observer.off(PipelinePriority.CRITICAL);
this.observer.off(PipelinePriority.HIGH);
this.observer.off(PipelinePriority.NORMAL);
```

`PipelineObserver.off(priority)` 移除该优先级下 **所有** handler，但 `ButlerAgent` 在 `wakeup()` 中通过 `.bind(this)` 注册了三个 handler。shutdown 时未传 handler 引用，导致移除优先级下全部 handler——可能误删 `MemoryStoreMonitor`、`Sentinel` 或其他组件的注册。

**与前次审查 D4 的关系**: D4（MemoryStoreMonitor.stop 误删 handler）在前次审查中已被标记为修复（`monitor.ts` 已改用 `off(priority, handler)` 精确移除），但 `ButlerAgent` 是同一个 bug 的新出现位置。

**预期**: 存储 bound handler 引用，在 `shutdown()` 中调用 `off(priority, handler)` 精确移除：

```typescript
private _boundCritical = this._onCritical.bind(this);
private _boundHigh = this._onHigh.bind(this);
private _boundNormal = this._onNormal.bind(this);
// shutdown:
this.observer.off(PipelinePriority.CRITICAL, this._boundCritical);
this.observer.off(PipelinePriority.HIGH, this._boundHigh);
this.observer.off(PipelinePriority.NORMAL, this._boundNormal);
```

---

### D2. skill-pipeline.ts 导入不存在的 SkillRegistry 类型

**文件**: `packages/engine/src/memory/skill-pipeline.ts`  
**位置**: 第 3 行

**问题**:
```typescript
import type { SkillRegistry } from "@cortex/shared";
```

`@cortex/shared/src/skill-registry.ts` 仅导出 `SerializedSkillRegistry` 接口，不导出 `SkillRegistry` 类。`SkillRegistry` 类的实现已移至 `@cortex/engine/src/skill-registry.ts`。该 import 在 TypeScript 严格模式下应为编译错误——`SkillRegistry` 不是 `@cortex/shared` 的导出成员。

**实际影响**: 取决于 monorepo 的编译配置，此错误可能在 `skipLibCheck: true` 下被掩盖，或由于模块解析回退为 `any` 而未被检测。但类型安全已破裂。

**预期**: 改为导入 engine 本地的 SkillRegistry：
```typescript
import type { SkillRegistry } from "../skill-registry.js";
```

---

### D3. MemoryStoreMonitor 窗口内事件计数导致告警洪泛

**文件**: `packages/engine/src/memory/monitor.ts`  
**位置**: `_onEvent()` 方法

**问题**: 阈值检测逻辑：
```typescript
if (this._windowEvents.length > this._threshold) {
  this._alert(`MemoryStore 高频异常: ...`, event);
}
```
此检查在 **每个** 事件触发时执行。一旦窗口内事件数超过阈值，每次新事件到达都会重复触发告警，形成告警洪泛。

**预期**: 增加已告警标记，仅在 **跨过阈值时** 触发一次：
```typescript
if (this._windowEvents.length > this._threshold && !this._alerted) {
  this._alerted = true;
  this._alert(...);
} else if (this._windowEvents.length <= this._threshold) {
  this._alerted = false;
}
```

---

### D4. MemoryPersistence 两次 init() 导致 DB 连接泄漏

**文件**: `packages/engine/src/memory/persistence.ts`  
**位置**: `init()` 方法

**问题**: `init()` 方法每次调用都执行 `this._db = new Database(dbPath)`，但 **不检查 `this._db` 是否已存在**。如果上层代码意外调用两次 `init()`（如 `MemoryStore.init()` 被调用两次），前一个 `better-sqlite3` 数据库连接不会被关闭，导致文件句柄泄漏+WAL 锁定。

**预期**: `init()` 入口处添加防护：
```typescript
async init(dbPath: string, storage: MemoryStorage): Promise<void> {
  if (this._db) {
    throw new Error("MemoryPersistence already initialized; call close() first");
  }
  // ...
}
```

---

### D5. MetaAgent._parseReplanResult 的 impactScope 推断缺失 fallthrough

**文件**: `packages/engine/src/meta-agent.ts`  
**位置**: `_parseReplanResult()` 方法

**问题**:
```typescript
const impactScope: ImpactScope =
  (!Array.isArray(parsed) && parsed.impactScope === "subtree") ? "subtree" : "local";
```

当 `parsed` 是数组格式（简洁数组格式），`impactScope` 总是 "local"。MetaAgent 可以通过 LLM 输出数组格式的重规划结果，此时 `impactScope` 被 **静默默认为 "local"**，即使 LLM 意图是 "subtree" 也丢失了信息。调用方 Scheduler 根据此值决定是否 `removeSubtree()`，错误的 "local" 会导致下游节点未被回收。

**预期**: 支持数组格式中的 impactScope 字段：
```typescript
const impactScope: ImpactScope =
  (!Array.isArray(parsed) && parsed.impactScope === "subtree") ? "subtree"
  : (Array.isArray(parsed) && (parsed as any).impactScope === "subtree") ? "subtree"
  : "local";
```

---

### D6. AgentPool / TaskBoard 双通道 invariant 上报模式未简化

**文件**: `packages/engine/src/agent-pool.ts`（`setStatus()`、`destroy()`），`packages/engine/src/task-board.ts`（`complete()`）

**问题**: 前次审查 D6 已指出此问题——各 emit 点 8-15 行三重 fallback 样板代码重复约 6 处。但未修复。三重 fallback 仍存在：

```typescript
if (AgentPool.onInvariant) {
  AgentPool.onInvariant({ ... });
} else if (this._observer) {
  this._observer.emit({ ... });
} else if (!isTestEnv()) {
  console.error(`[invariant] ...`);
}
```

**为什么严重**:
1. `onInvariant` 静态字段和 `_observer` 实例字段的关系未文档化，优先级不明确
2. `destroy()` 中两个路径都检查，导致 emit 被发送两次（如果两者都设置）
3. 每个新 emit 点都复制 8-15 行 — 维护负担

**预期**: 简化为单通道统一走 `this._observer`，废弃 `static onInvariant`。

---

## 2. 🟠 中等问题

### M1. MemoryStore.read() metadataFilter 在 SQL 路径与内存路径的行为不一致

**文件**: `packages/engine/src/memory/memory-store.ts`（`_persistenceRead`），`packages/engine/src/memory/query.ts`（`memScanRead`）

**问题**: `_persistenceRead` 中的 metadata 过滤在反序列化之后执行（JS 层 O(n) 过滤）。SQL 路径不将 metadataFilter 下推到 SQL WHERE 子句。在大数据集上（数千行）性能不可预期。

**建议**: 在 `sqlRead()` 中增加 `json_extract()` 来下推 metadata 过滤。

---

### M2. PipelineObserver.emit() 中 requestId 生成时钟依赖

**文件**: `packages/engine/src/pipeline-observer.ts`  
**位置**: `emit()` 方法

**问题**:
```typescript
event.requestId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
```
同一毫秒内的高频事件在日志中出现相同前缀。非严重，可用 `process.hrtime.bigint()` 提高可读性。

---

### M3. MemoryPersistence._loadFromDb 全部数据启动加载

**文件**: `packages/engine/src/memory/persistence.ts`  
**位置**: `_loadFromDb()` 方法

**问题**: `SELECT * FROM memories` 和 `SELECT * FROM links` 在 `init()` 时加载全部数据到内存。大型 DB（>10 万条）启动加载可能耗时数秒。

**建议**: 添加懒加载策略（如仅加载最近 N 天活跃记忆，按需补充），或分页加载。

---

### M4. Scheduler.executeAll() 的 replanFlight 竞态窗口

**文件**: `packages/engine/src/scheduler.ts`  
**位置**: `executeAll()` 主循环

**问题**: `replanFlight` 的 await 和 null 赋值之间的时序假设脆弱。当前单线程下正确，但未来重构引入嵌套异步路径可能破坏此假设。

**建议**: 添加注释标记 `replanFlight` 的协议约束。

---

### M5. FileLockManager 的 dispose() 未标记已释放

**文件**: `packages/engine/src/file-lock-manager.ts`  
**位置**: `dispose()` 方法

**问题**: `dispose()` 后调用 `acquire()` 不会报错且正常工作（除定时器已取消外），形成僵尸实例。

**预期**: `dispose()` 后标记 `_disposed = true`，后续操作抛错。

---

### M6. PipelineObserver.createSafeReporter 的 silent 升级计数器跨实例共享

**文件**: `packages/engine/src/pipeline-observer.ts`  
**位置**: `_silentCounters` 实例字段

**问题**: 同一个 `PipelineObserver` 实例上 `createSafeReporter()` 创建的多个 `SafeErrorReporter` 共享同一个 `_silentCounters` Map。如果两个错误来源使用相同的 `source` 字符串，计数合并可能导致过早升级。

**建议**: 在闭包中自动附加调用方标识。

---

### M7. LlmAdapter 的缓存 TTL 仅在命中时淘汰

**文件**: `packages/llm/src/llm-adapter.ts`

**问题**: TTL 淘汰仅在缓存命中时发生。从未被访问的缓存条目永久驻留，直到达到 `MAX_CACHE = 500` 上限后按 FIFO 逐出。

**建议**: 添加周期性清理或概率性清理。

---

### M8. ConsistencyLayer 未集成到 MemoryStore 写路径

**文件**: `packages/engine/src/consistency/consistency-layer.ts`

**问题**: `ConsistencyLayer` 的 `validateInput()` / `annotateInput()` 是显式调用——任何写路径绕过此校验（如直接调用 `MemoryStore.write()`）则校验不生效。

**建议**: 将 ConsistencyLayer 集成到 MemoryStore 内部（通过装饰器或中间件模式）。

---

## 3. 🟡 设计问题/不必要的复杂性

### C1. Agent 三轨制仍未收敛

**文件**: `packages/engine/src/agents/*.ts`

三种 Agent 创建方式同时存在：
- BaseAgent 继承（`CodeAgent extends BaseAgent`，标记 @deprecated）
- createAgent 工厂（`createAgent(codeAgentConfig(), ...)`，推荐方式）
- 独立 class（`ButlerAgent`、`MetaAgent`、`StrategistAgent`）

新增 Agent 的开发者需理解三套模式。BaseAgent 的修改需同步到组合式工厂路径。

**建议**: 在 v2.2 中确定唯一的官方路径（推荐工厂模式），移除 `@deprecated` 的类导出。

---

### C2. AGENT_TAGS 标签重叠导致隐式匹配依赖

**文件**: `packages/shared/src/agent.ts`

Code/Api/Data 的 tags 包含 `"review"`、`"research"`、`"analysis"`，与 Review/Analysis 重叠。`tags=["review"]` 的节点匹配靠密度打破平局——隐式依赖。

**建议**: Code/Api/Data 的标签中移除 `"review"`、`"research"` 和 `"analysis"`。

---

### C3. MemoryStore 构造函数硬编码子组件（不可注入）

**文件**: `packages/engine/src/memory/memory-store.ts`

子组件不可注入，测试只能通过 `(store as any)` 劫持。

**建议**: 添加可选注入参数。

---

### C4. SemiFinishedMgr.commit() 中 subType 持久化失败被静默吞没

**文件**: `packages/engine/src/memory/semi-finished.ts`  
**位置**: `commit()` 方法

```typescript
try {
  subTypePersistFn(id, MemorySubType.Fact);
} catch {
  // subType 持久化失败不阻塞主流程（state 已持久化成功）
}
```
catch 块完全为空——静默吞错。subType 翻转（Intent → Fact）丢失，下次重启从 SQLite 加载的条目 subType 仍为 Intent。

**建议**: 至少通过 SafeErrorReporter 上报 degraded 事件。

---

### C5. MemoryStoreMonitor 告警粒度粗糙

**文件**: `packages/engine/src/memory/monitor.ts`

所有 `memory.*` 事件共享同一个窗口计数器。大量正常事件可能导致误告警。

**建议**: 按事件类型分计数器，或只对 `criticalTypes` 做阈值检测。

---

### C6. consistency/ 模块与 MemoryStore 生命周期绑定松散

**文件**: `packages/engine/src/consistency/consistency-layer.ts`

1. `verify()` 在 `MemoryStore.init()` 之后调用——如果 `init()` 失败，ConsistencyLayer 无感知
2. `validateInput()` / `annotateInput()` 需显式调用，易被绕过

**建议**: 集成到 MemoryStore 内部。

---

## 4. ⚪ 代码规范问题

### S1. process.env.VITEST 散落多处

**位置**: `agent-pool.ts`、`task-board.ts`、`toolkit.ts`、`pool-aware.ts`、`strategist-agent.ts`

`test-env.ts` 已创建 `isTestEnv()` 统一函数，但部分文件未迁移。

---

### S2. ButlerAgent 使用字符串字面量匹配 PipelineEventType

**文件**: `packages/engine/src/agents/butler-agent.ts`

```typescript
case "node.failed":
case "node.replan":
```
应采用 `PipelineEventType.NodeFailed` 枚举引用。

---

### S3. MemoryPersistence.sqlRead() 中参数类型声明不匹配

**文件**: `packages/engine/src/memory/persistence.ts`

`params` 类型为 `(string | number)[]`，但 `better-sqlite3` 的 `.all()` 期望 `(string | number | null | Buffer)[]`。

---

### S4. "方案B"未定义术语仍存在于注释中

**位置**: `agent-pool.ts`、`base-agent.ts`、`pool-aware.ts`、`scheduler.ts`

---

### S5. MemoryPersistence JSDoc 引用已改名方法

**文件**: `packages/engine/src/memory/persistence.ts`  
JSDoc 引用旧名 `_safeDbRun`，实际方法名已是 `run`。

---

### S6. Agent 接口中 setPool 和 setSafeReporter 使用 any 类型

**文件**: `packages/shared/src/infra.ts`

```typescript
setPool?(pool: any, instanceId: string): void;
setSafeReporter?(reporter: any): void;
```

**建议**: setSafeReporter 应直接使用 `SafeErrorReporter`。

---

## 5. 前次审查（review-engine-code.md）状态跟踪

| 编号 | 严重度 | 问题 | 状态 |
|------|--------|------|------|
| D1 | 🔴 | StrategistAgent 状态管理重复 PoolAwareState | ✅ **已修复** |
| D2 | 🔴 | react-helper.ts 与 react-loop.ts 重复 | ✅ **已修复** |
| D3 | 🔴 | MemoryStore.read() 无关闭保护 | ✅ **已修复** |
| D4 | 🔴 | MemoryStoreMonitor.stop() 误删其他 handler | ⚠️ **部分修复** — monitor.ts 已修，但 ButlerAgent 同 bug（见 D1） |
| D5 | 🔴 | link() 中未使用的 _creatorId 参数 | ✅ **已修复** |
| D6 | 🔴 | 双通道 invariant 上报模式 | ❌ **未修复** |
| M1 | 🟠 | ConfirmGate.handleTimeout L2/L3 不回收 pending | ✅ **已修复** |
| M2 | 🟠 | MemoryPersistence.runBatch 非真实批处理 | ✅ **已修复** |
| M3 | 🟠 | 向量维度校验缺失 | ✅ **已修复** |
| M4 | 🟠 | FileLockManager 无界内存增长 | ✅ **已修复** |
| M5 | 🟠 | MemoryStore.read() accessCount 回滚不完整 | ✅ **已修复** |
| M6 | 🟠 | search_code rg 回退路径错误吞没 | ✅ **已修复** |
| M7 | 🟠 | PoolAwareState._tag getter 隐藏异常 | ✅ **已修复** |
| M8 | 🟠 | WAL checkpoint 失败后脏状态标记 | ✅ **已修复** |
| C1 | 🟡 | Agent 双轨制 | ❌ **未修复** |
| C2 | 🟡 | AGENT_TAGS 标签重叠 | ❌ **未修复** |
| C3 | 🟡 | MemoryStore 构造函数硬编码子组件 | ❌ **未修复** |
| C4 | 🟡 | MemoryStoreMonitor 告警粒度粗糙 | ❌ **未修复** |
| C5 | 🟡 | SkillRegistry 的 unregister 在 for-of 中修改 Map | ✅ **已修复** |
| C6 | 🟡 | MemoryStoreMonitor 生命周期未对齐 | ❌ **未修复** |
| S1 | ⚪ | process.env.VITEST 散落 | ⚠️ **部分修复** |
| S2 | ⚪ | "方案B"未定义术语 | ❌ **未修复** |
| S3 | ⚪ | JSDoc 引用已改名方法 | ❌ **未修复** |
| S4 | ⚪ | type DatabaseType 使用 InstanceType | ❌ **未修复** |

### 闭合率：14/24 = 58.3%

---

## 📊 统计总结

| 严重度 | 前次未修复 | 本次新增 | **合计** |
|--------|-----------|---------|---------|
| 🔴 严重 | 1 | 6 | **7** |
| 🟠 中等 | 0 | 8 | **8** |
| 🟡 设计 | 5 | 2 | **7** |
| ⚪ 规范 | 4 | 2 | **6** |
| **合计** | **10** | **18** | **28** |

### 优先级建议

1. **D1 (ButlerAgent shutdown)** — **立即修复**。数据安全问题（可能误删其他组件 handler）。
2. **D2 (skill-pipeline import)** — **立即修复**。编译期类型错误。
3. **D3 (Monitor alert flooding)** — **高优先级**。告警洪泛掩盖真正问题。
4. **D6 (Invariant triple fallback)** — **高优先级**。代码质量 + destroy() 双路径问题。
5. **D4 (DB connection leak)** — 中优先级。防护性编程。
6. **D5 (Replan impactScope)** — 中优先级。可能导致下游节点未被回收。
7. **M 系列** — 纳入 v2.2 迭代。
8. **C 系列 + S 系列** — 纳入 v2.2 重构计划。

---

*审查结论: 前次审查 24 项发现中 14 项已修复（58.3%）。本轮新增 18 项发现。严重问题集中于 ButlerAgent 误删 handler、编译期类型错误、以及三重 fallback 未收敛。核心调度路径整体稳定，新问题集中于边界防御和代码一致性。*
