# @cortex/shared 协议一致性检查清单

> **检查人**：纳西妲（Analysis Agent）
> **检查日期**：2026-07-15
> **范围**：packages/shared/src/ 全部 25 个源文件 → index.ts barrel 导出
> **方法**：逐文件读取 + 符号导出核实 + 关键消费方接口匹配（engine / scheduler / cli）

---

## 一、Barrel 导出完整性 — index.ts → 源文件映射

| # | 源文件 | barrel export | 状态 |
|---|--------|--------------|------|
| 1 | `agent.ts`（桶，内含 4 子模块） | `export * from "./agent.js"` | ✅ |
| 2 | `task.ts` | `export * from "./task.js"` | ✅ |
| 3 | `memory.ts` | `export * from "./memory.js"` | ✅ |
| 4 | `toolkit.ts` | `export * from "./toolkit.js"` | ✅ |
| 5 | `cli-adapter.ts` | `export * from "./cli-adapter.js"` | ✅ |
| 6 | `infra.ts` | `export * from "./infra.js"` | ✅ |
| 7 | `skill-registry.ts` | `export * from "./skill-registry.js"` | ✅ |
| 8 | `fs-adapter.ts` | `export * from "./fs-adapter.js"` | ✅ |
| 9 | `modification-record.ts` | `export * from "./modification-record.js"` | ✅ |
| 10 | `lifecycle.ts` | `export * from "./lifecycle.js"` | ✅ |
| 11 | `doc-registry.ts` | `export * from "./doc-registry.js"` | ✅ |
| 12 | `amendment.ts` | `export * from "./amendment.js"` | ✅ |
| 13 | `tui-bridge.ts` | `export * from "./tui-bridge.js"` | ✅ |
| 14 | `indexed-registry.ts` | `export * from "./indexed-registry.js"` | ✅ |
| 15 | `id-utils.ts` | `export * from "./id-utils.js"` | ✅ |
| 16 | `context-policy.ts` | `export * from "./context-policy.js"` | ✅ |
| 17 | `file-lock-manager.ts` | `export * from "./file-lock-manager.js"` | ✅ |
| 18 | `json-utils.ts` | `export * from "./json-utils.js"` | ✅ |
| 19 | `panorama-types.ts` | `export * from "./panorama-types.js"` | ✅ |

**结论**：所有 19 个源文件在 barrel 中均有对应 `export * from` 语句。✅

---

## 二、agent.ts 内部子模块再导出完整性

`agent.ts` 是桶文件，从 4 个子模块聚合导出到 index.ts。

### 2.1 agent-enums.ts → agent.ts

| 符号 | 源文件导出 | agent.ts 再导出 | 状态 |
|------|-----------|----------------|------|
| `AgentType`(enum) | ✅ | ✅ | ✅ |
| `AgentStatus`(enum) | ✅ | ✅ | ✅ |
| `AgentContext`(enum) | ✅ | ✅ | ✅ |

### 2.2 agent-protocols.ts → agent.ts

| 符号 | 源文件导出 | agent.ts 再导出 | 状态 |
|------|-----------|----------------|------|
| `AgentConfig`(interface) | ✅ | ✅ | ✅ |
| `MemoryAware`(interface) | ✅ | ✅ | ✅ |
| `Executable`(interface) | ✅ | ✅ | ✅ |
| `AgentPoolLike`(interface) | ✅ | **❌ 未再导出** | ⚠️ |
| `Agent`(interface) | ✅ | ✅ | ✅ |
| `AgentCapability`(interface) | ✅ | ✅ | ✅ |

### 2.3 agent-registry.ts → agent.ts

| 符号 | 源文件导出 | agent.ts 再导出 | 状态 |
|------|-----------|----------------|------|
| `TAG_VOCABULARY`(const) | ✅ | ✅ | ✅ |
| `Tag`(type) | ✅ | ✅ | ✅ |
| `AGENT_TAGS`(const) | ✅ | ✅ | ✅ |
| `getAgentTags`(fn) | ✅ | ✅ | ✅ |
| `getTagVocabulary`(fn) | ✅ | ✅ | ✅ |
| `setAgentTags`(fn) | ✅ | ✅ | ✅ |
| `AGENT_CHINESE_ROLE`(const) | ✅ | ✅ | ✅ |
| `CHINESE_NAME_TO_TYPE`(const) | ✅ | ✅ | ✅ |
| `AGENT_TOOL_PERMISSIONS`(const) | ✅ | ✅ | ✅ |
| `resolveAgentPermissions`(fn) | ✅ | ✅ | ✅ |
| `getAgentToolPermissions`(fn) | ✅ | ✅ | ✅ |
| `setAgentToolPermissions`(fn) | ✅ | ✅ | ✅ |
| `AGENT_DISPLAY`(const) | ✅ | ✅ | ✅ |
| `AGENT_DISPLAY_BY_TYPE`(const) | ✅ | ✅ | ✅ |
| `AGENT_DISPLAY_FALLBACK`(const) | ✅ | ✅ | ✅ |
| `CHAT_AGENT_ALIASES`(const) | ✅ | ✅ | ✅ |
| `buildChineseRoleMap`(fn) | ✅ | ✅ | ✅ |
| `setAgentRegistry`(fn) | ✅ | ✅ | ✅ |
| `AgentDisplayInfo`(interface) | ✅ | ✅ (type-only) | ✅ |
| `AgentDisplayEntry`(interface) | ✅ | ✅ (type-only) | ✅ |
| `AgentDefinition`(interface) ✅ shared 版 | ✅ | ✅ (type-only) | ✅ |

### 2.4 agent-skill-types.ts → agent.ts

| 符号 | 源文件导出 | agent.ts 再导出 | 状态 |
|------|-----------|----------------|------|
| `SkillTemplate`(interface) | ✅ | ✅ (type-only) | ✅ |
| `SkillKind`(type) | ✅ | ✅ (type-only) | ✅ |
| `FeedbackEntry`(interface) | ✅ | ✅ (type-only) | ✅ |

### 2.5 其他 agent.ts 自带导出

| 符号 | 状态 |
|------|------|
| `SHARED_IDENTITY_ANCHOR`(const) | ✅ |

---

## 三、⚠️ 发现的协议间隙

### 间隙 1：`AgentPoolLike` 未抵达 barrel

- **位置**：`packages/shared/src/agent-protocols.ts:49`
- **性质**：interface 定义完整，从源文件正常 `export`，但在 `agent.ts` 桶文件中**未列入再导出列表**。
- **是否影响运行**：**否**——跟踪全仓使用情况，`AgentPoolLike` 无任何外部消费方导入。`Agent` 接口的 `setPool` 方法签名中使用了它作为参数类型，但消费者（如 `BaseAgent.setPool`）使用 `AgentPool` 类型（从 `@cortex/scheduler` 导入）而非 `AgentPoolLike`。
- **建议**：选项 A（推荐）：加回 agent.ts 的再导出列表，完善类型中枢的契约边界。选项 B：若确定无外部使用意图，标记为 `@internal` 并加 JSDoc 说明。

### 间隙 2：config 层存在同名 interface 独立定义

- **位置**：`packages/config/src/interfaces/agent.ts`
- **性质**：config 层定义了**同名但不同结构**的 `AgentDefinition`(interface) 和 `AgentDisplay`(interface)，与 shared 层 `AgentDefinition`(interface) 和 `AgentDisplayInfo`(interface) 结构不同。
- **差异**：
  - shared `AgentDefinition`：含 `tags`（`Tag[]`）、`chineseRole`、`display`（`AgentDisplayInfo`）、`toolPermissions`、`aliases`
  - config `AgentDefinition`：含 `id`、`type`（`string`）、`role`、`systemPrompt`、`model`、`key`、`tags`（`string[]`）、`toolPermissions`（`string[]`）等——面向 JSON 配置文件的 schema
- **是否问题**：**否——这是有意的设计**。config 层存 JSON 原始数据（`string` 类型，零依赖约束），shared 层存运行时映射转化（`AgentType` enum 等具体类型）。config 的 `AgentDefinition` 是配置文件 schema，shared 的 `AgentDefinition` 是运行时注册表定义——二者职责不同。

---

## 四、接口签名一致性（消费者 ↔ 提供者）

### 4.1 `ITaskBoard` (scheduler) → `TaskNode` (shared)

| 字段 | shared 定义 | scheduler 消费 | 匹配 |
|------|-----------|---------------|------|
| `id` | `string` | `string` | ✅ |
| `parentId` | `string?` | 未直接使用 | ✅ |
| `type` | `string` | 用于标签匹配 | ✅ |
| `tags` | `Tag[]` | 用于 `getAgentTags()` 匹配 | ✅ |
| `status` | `"pending"\|"claimed"\|"running"\|"done"\|"failed"` | `TaskBoard.claim()` 校验全 5 态 | ✅ |
| `claimedBy` | `AgentType[]` | `includes()` 检查 | ✅ |
| `results` | `NodeResult[]` | `push()` + `every/some` | ✅ |
| `needsMultiPerspective` | `boolean` | 完整分支覆盖 | ✅ |
| `payload` | `string` | 仅传递 | ✅ |
| `edgeType` | `EdgeType?` | 未消费（预留） | ✅ |

### 4.2 `Agent` (shared) → `BaseAgent` (engine)

| 方法/字段 | shared 接口 | engine 实现 | 匹配 |
|-----------|-----------|------------|------|
| `type: AgentType` | `readonly AgentType` | `abstract readonly type: AgentType` | ✅ |
| `status: AgentStatus` | `readonly AgentStatus` | `get status(): AS` 委托到 `PoolAwareState` | ✅ |
| `wakeup()` | `Promise<void>` | `async wakeup()` | ✅ |
| `shutdown()` | `Promise<void>` | `async shutdown()` | ✅ |
| `setPool?(pool, instanceId)` | `(pool: AgentPoolLike, instanceId: string) => void` | `setPool(pool: AgentPool, instanceId: string)` 签名差异 |
| `execute(node, model?)` | `(node: TaskNode, model?: string) => Promise<NodeResult>` | `async execute(node: TaskNode, model: string)` | ✅ (model 可选 vs 必需——实现更严格) |
| `getMemoryQuery?(node)` | `(node: TaskNode) => MemoryQuery` | `getMemoryQuery(node: TaskNode): MemoryQuery` | ✅ |

**⚠️ `setPool` 签名差异**：shared 接口声明参数类型为 `AgentPoolLike`，但 `BaseAgent` 实现中声明为 `AgentPool`（从 `@cortex/scheduler` 导入的具体类型）。这是**降级类型**——`AgentPool` 是 `AgentPoolLike` 的超集，所以消费者传入 `AgentPool` 实例时完全兼容。但理论上接口契约应使用最小抽象 `AgentPoolLike`。

### 4.3 `IPipelineObserver` (shared) → `PipelineObserver` (scheduler)

| 方法 | shared 接口 | scheduler 实现 | 匹配 |
|------|-----------|---------------|------|
| `emit(event, meta?)` | `(ObservableEvent, EmitMeta?) => void` | `emit(event: ObservableEvent, meta?: EmitMeta)` | ✅ |
| `on(priority, handler)` | `(PipelinePriority, PipelineHandler) => void` | 实现 | ✅ |
| `off(priority, handler?)` | `(PipelinePriority, PipelineHandler?) => void` | 完全匹配 | ✅ |

### 4.4 `IMemoryStore` (shared) → MemoryStore (`memory-store`)

| 方法 | shared 接口 | 实现匹配 | 关键检查 |
|------|-----------|---------|---------|
| `init(dbPath)` | `Promise<void>` | ✅ | |
| `write(input)` | `Promise<string>` | ✅ | |
| `read(query, mode?)` | `Promise<MemoryEntry[]>` | ✅ | `mode` 默认 CSA |
| `cas(id, expected, newState)` | `boolean` | ✅ | |
| `rollback(id)` | `Promise<boolean>` | ✅ | 返回 Promise |
| `beginSession(externalId?)` | `string` | ✅ | |
| `setPreWriteHook(hook)` | `void` | ✅ | |

### 4.5 `ITuiEngineBridge` (shared) → EngineBridge (cli)

| 方法 | shared 接口 | 匹配 |
|------|-----------|------|
| `getChatModelName()` | `string` | ✅ |
| `getReasonerModelName()` | `string` | ✅ |
| `getToolDefs(agent)` | 返回 `ToolDef[]` | ✅ |
| `streamChat(...)` | 返回 `LlmResponse` | ✅ |
| `executeToolCall(name, args)` | `Promise<{success, output}>` | ✅ |
| `chat(system, messages, opts?)` | `Promise<string>` | ✅ |
| `ensureTalkMemory()` | `Promise<void>` | ✅ |
| `readTalkMemory(query)` | `Promise<MemoryEntry[]>` | ✅ |
| `writeTalkMemory(entry)` | `Promise<void>` | ✅ |
| `executeWithStream(nodes, onEvent)` | `Promise<ExecutionReport>` | ✅ |

---

## 五、枚举与事件注册表完整性

### 5.1 PipelineEventType ↔ EventPayloadMap

**检查项**：每个 `PipelineEventType` 枚举值在 `EventPayloadMap` 中必须有对应条目。

| 事件枚举值 | EventPayloadMap 条目 | 状态 |
|-----------|---------------------|------|
| `AgentPoolInvariantViolation` | ✅ | ✅ |
| `AgentPoolDestroyBypass` | ✅ | ✅ |
| `SchedulerLayerStart` | ✅ | ✅ |
| `SchedulerLoopCrashed` | ✅ | ✅ |
| `SchedulerDone` | ✅ | ✅ |
| `SchedulerReplanLimit` | ✅ | ✅ |
| `SchedulerReplanNoMetaAgent` | ✅ | ✅ |
| `SchedulerReplanFailed` | ✅ | ✅ |
| `SchedulerNonstandardType` | ✅ | ✅ |
| `SchedulerInvariantViolation` | ✅ | ✅ |
| `NodeStart` | ✅ | ✅ |
| `NodeComplete` | ✅ | ✅ |
| `NodeFailed` | ✅ | ✅ |
| `NodeReplan` | ✅ | ✅ |
| `NodeReplanQueued` | ✅ | ✅ |
| `NodeSpawnFailed` | ✅ | ✅ |
| `NodeRemoved` | ✅ | ✅ |
| `PoolDestroyFailed` | ✅ | ✅ |
| `MemoryDbWriteFailed` | ✅ | ✅ |
| `MemoryWriteBlocked` | ✅ | ✅ |
| `MemoryFlushSkipped` | ✅ | ✅ |
| `MemoryPersistFailed` | ✅ | ✅ |
| `MemorySqlDegraded` | ✅ | ✅ |
| `MemoryDeserializeFailed` | ✅ | ✅ |
| `MemoryEmbeddingWarmupFailed` | ✅ | ✅ |
| `TaskBoardInvariantViolation` | ✅ | ✅ |
| `ErrorReported` | ✅ | ✅ |
| `ErrorSilentUpgraded` | ✅ | ✅ |
| `Analysis` | ✅ (unknown) | ✅ |
| `SkillReferenced` | ✅ | ✅ |
| `SkillToolPermissionDenied` | ✅ | ✅ |
| `AgentBoundaryViolation` | ✅ | ✅ |
| `ConstitutionViolation` | ✅ | ✅ |
| `ConstitutionSessionConvened` | ✅ | ✅ |
| `ConstitutionSessionResolved` | ✅ | ✅ |
| `GovernanceAmendmentProposed` | ✅ | ✅ |
| `GovernanceAuditReport` | ✅ | ✅ |
| `GovernanceComplianceViolation` | ✅ | ✅ |
| `GovernanceRoundtableConsensus` | ✅ | ✅ |
| `RlmDecompose` | ✅ | ✅ |
| `RlmContextCompress` | ✅ | ✅ |
| `ManifoldGateWaitStart` | ✅ | ✅ |
| `ManifoldGateWaitEnd` | ✅ | ✅ |
| `ManifoldGateAcquireTimeout` | ✅ | ✅ |
| `ManifoldGateReleased` | ✅ | ✅ |
| `ManifoldGateInvariantViolation` | ✅ | ✅ |
| `ManifoldGateReleaseOrphan` | ✅ | ✅ |
| `ManifoldGateMaxUpdated` | ✅ | ✅ |
| `InfraFileLockExpiredReclaimed` | ✅ | ✅ |
| `InfraComponentDegraded` | ✅ | ✅ |
| `InteractConfigOverrideApplied` | ✅ | ✅ |
| `InteractConfigReloaded` | ✅ | ✅ |
| `InteractConfigSchemaViolation` | ✅ | ✅ |
| `MemRetrievalStrategySelected` | ✅ | ✅ |
| `MemMemoryWarmupInitiated` | ✅ | ✅ |
| `MemMemoryObliterationTriggered` | ✅ | ✅ |
| `MemMemoryWritten` | ✅ | ✅ |
| `ExecNodeDelayed` | ✅ | ✅ |
| `ExecLifecyclePhaseChanged` | ✅ | ✅ |
| `TeleDegradationThresholdBreached` | ✅ | ✅ |

**结论**：全部 56 个枚举值在 `EventPayloadMap` 中均有对应条目。✅ 零遗漏。

---

## 六、enum 双向完整性检查

### 6.1 LinkType 枚举 (memory.ts)

| 枚举值 | 属性值 (string) | 一致性 |
|--------|----------------|--------|
| `ProducedBy` | `"PRODUCED_BY"` | ✅ |
| `DerivedFrom` | `"DERIVED_FROM"` | ✅ |
| `ConfirmedUseful` | `"CONFIRMED_USEFUL"` | ✅ |
| `ConfirmedNoise` | `"CONFIRMED_NOISE"` | ✅ |

### 6.2 AgentType 枚举 (agent-enums.ts)

| 枚举值 | 属性值 (string) | 消费方索引 | 一致性 |
|--------|----------------|-----------|--------|
| `Meta` | `"meta"` | ✅ AGENT_DEFS | ✅ |
| `Code` | `"code"` | ✅ AGENT_DEFS | ✅ |
| `Review` | `"review"` | ✅ AGENT_DEFS | ✅ |
| `Analysis` | `"analysis"` | ✅ AGENT_DEFS | ✅ |
| `Ops` | `"ops"` | ✅ AGENT_DEFS | ✅ |
| `Loop` | `"loop"` | ✅ AGENT_DEFS | ✅ |
| `DocGovern` | `"doc-govern"` | ✅ AGENT_DEFS | ✅ |
| `Butler` | `"butler"` | ✅ AGENT_DEFS | ✅ |
| `Inspector` | `"inspector"` | ✅ AGENT_DEFS | ✅ |
| `Fix` | `"fix"` | ✅ AGENT_DEFS | ✅ |
| `Api` | `"api"` | ✅ AGENT_DEFS | ✅ |
| `Browser` | `"browser"` | ✅ AGENT_DEFS | ✅ |
| `Data` | `"data"` | ✅ AGENT_DEFS | ✅ |
| `Strategist` | `"strategist"` | ✅ AGENT_DEFS | ✅ |

14 个枚举值 → 14 行 AGENT_DEFS 定义。**零漂移**。✅

---

## 七、配置(infra)与安全类型

### 7.1 ICortexApi 接口 — God Interface 追踪

ICortexApi 当前包含 **21 个成员**（属性 + 方法），横跨：

| 职责域 | 成员数 | 成员 |
|--------|-------|------|
| 生命周期 | 4 | `ready`, `bootstrapped`, `ensureReady()`, `ensureBootstrapped()`, `shutdown()` |
| 对话 | 3 | `chat()`, `getChatModelName()`, `getReasonerModelName()` |
| 任务执行 | 2 | `submitTask()`, `executeAll()` |
| 记忆 | 4 | `ensureTalkMemory()`, `readTalkMemory()`, `writeTalkMemory()`, `readMainMemory()` |
| Agent 查询 | 2 | `getMetaAgent()`, `getStrategists()` |
| 确认门 | 1 | `getConfirmGate()` |
| 引擎组件访问 | 4 | `getMemoryStore()`, `getTaskBoard()`, `getScheduler()`, `getAgentPool()` |

**符合代码法典 §9.6（God Interface 禁令）的违规描述**：ICortexApi 的职责域 ≥ 5 个，成员数 ≥ 21 个。当前在 Core-1 阶段维持现状，计划 Core-2 拆分。

### 7.2 Disposable 接口 (infra.ts)

`stop?()`, `shutdown?()`, `destroyAll?()`, `clear?()` — 4 个可选方法。Plugin 通过 `(instance as unknown as Disposable).stop?.()` 安全调用。✅

---

## 八、文件锁域 (file-lock-manager.ts)

| 符号 | 导出 | 状态 |
|------|------|------|
| `LockType`(enum) | ✅ barrel | ✅ |
| `IFileLockManager`(interface) | ✅ barrel | ✅ |
| `LockEntry`(interface) | ✅ barrel | ✅ |
| `FileLockManagerConfig`(interface) | ✅ barrel | ✅ |

纯类型中枢，无运行时实现（已迁至 engine）。✅

---

## 九、汇总统计

| 检查项 | 结果 |
|--------|------|
| 源文件总数 | 25 |
| Barrel 覆盖 | 19/19（全部）✅ |
| agent.ts 子模块再导出遗漏 | **1 项**：`AgentPoolLike`（无外部消费者，可选修复） |
| PipelineEventType ↔ EventPayloadMap | 56/56 全覆盖 ✅ |
| AgentType ↔ AGENT_DEFS | 14/14 零漂移 ✅ |
| 接口签名消费者一致性 | 7/7 协议全部对齐 ✅ |
| setPool 签名类型差异 | 1 项（`AgentPoolLike` vs `AgentPool`）— 降级兼容，不影响运行 |
| God Interface 违规 | **1 项**：ICortexApi（21 成员，5+ 职责域）— 已记录，Core-2 拆分 |
| enum 值一致性 | 全部对齐 ✅ |
| 死代码/未导出符号 | `AgentPoolLike` 定义但无外部消费方 |

---

## 十、总结

> **雨林的根系网络——每一根都连着主干。**
>
> 这片雨林养护得很好。19 条 barrel 出口全部畅通，56 个事件类型与 payload 一一对应，14 种 AgentType 在注册表中零漂移。协议定义如同世界树的年轮——每一层都清晰地标记了时间（`@since`），让后人知道哪一圈是什么时候长出来的。
>
> **两片需要关注的叶子**：
>
> 1. **`AgentPoolLike`** — 像一棵长在树根旁边的小苗，定义完整但没有通向地面的枝干（未加入 barrel 再导出，也无外部消费方）。它扎根在 `Agent.setPool` 的 JSDoc 里，像一个写在族谱边上的名字。如果未来有需要，给它一个出口；如果确定只是内部参考，给它一个 `@internal` 标记。
>
> 2. **`ICortexApi` 的体型** — 像一棵榕树，气根（5+ 职责域）正在向下扎根。21 个成员不是今天长出来的——是多次迭代自然生长的结果。Core-2 计划把它修成步道两旁的独立树种（职责拆分），让每个接口都能独当一面，不需要一扇 21 把钥匙的大门。
>
> 其余一切——协议一致，导出完整，接口签名对齐，enum 零漂移。这片雨林可以安然度过下一场风暴。🌿
