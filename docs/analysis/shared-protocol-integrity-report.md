# @cortex/shared 协议完整性分析报告

> 分析者：纳西妲  
> 分析日期：2026.07  
> 分析范围：packages/shared/src/（25 个源文件）+ tests/（6 个测试文件）

---

## 一、协议总览——雨林的根系地图

`@cortex/shared` 是 Cortex 的类型中枢（Public API Surface），不含 `.proto` 文件——所有协议均以 TypeScript `interface` / `type` / `enum` 定义，通过 barrel `src/index.ts` 统一导出。它像须弥雨林的**地下菌丝网络**——表面看不见，但每一棵大树（引擎、CLI、TUI、调度器）都靠它传递养分和信号。

### 1.1 领域分桶

| 领域 | 源文件 | 核心协议接口 | 导出量 |
|------|--------|-------------|--------|
| **Agent** | agent-enums.ts, agent.ts(桶), agent-registry.ts, agent-protocols.ts, agent-skill-types.ts | `Agent`, `AgentCapability`, `MemoryAware`, `Executable`, `AgentPoolLike`, `AgentDefinition` | ~25 个导出 |
| **任务调度** | task.ts | `TaskNode`, `NodeResult`, `ExecutionReport`, `SubTask`, `ReplanResult`, `DensityLevel` | ~10 个导出 |
| **记忆系统** | memory.ts | `IMemoryStore`(25方法), `MemoryEntry`, `MemoryQuery`, `MemoryWriteInput`, `MemoryLink` | ~15 个导出 |
| **工具系统** | toolkit.ts | `Tool`(统一接口), `IConfirmGate`, `ITrustModel`, `ReversibilityLevel` | ~15 个导出 |
| **基础设施** | infra.ts | `IPipelineObserver`, `ICortexApi`, `ObservableEvent`, `LlmMessage/Response` | ~25 个导出 |
| **生命周期** | lifecycle.ts | `ILifecycle`, `BaseLifecycle`, `LifecyclePhase` | 3 个导出 |
| **CLI/TUI** | cli-adapter.ts, tui-bridge.ts | `PlatformBridge`, `ITuiEngineBridge` | 3 个导出 |
| **文件系统** | fs-adapter.ts | `IFileSystemAdapter` (12方法) | 2 个导出 |
| **文件锁** | file-lock-manager.ts | `IFileLockManager` | 3 个导出 |
| **修宪** | amendment.ts | `AmendmentProposal`, `JudgmentResult`, `AmendmentApplyResult` | ~8 个导出 |
| **文档治理** | doc-registry.ts | `DocInput`, `DocEntry`, `DocRegistryIndex` | ~8 个导出 |
| **上下文策略** | context-policy.ts | `ContextPolicy`, `ConversationPolicy`, `RetrievalPolicy`, `PipelinePolicy` | ~10 个导出 |
| **修改记录** | modification-record.ts | `ModificationRecordItem`, `ModificationRecordV1`, `FactAnchor` | ~8 个导出 |
| **技能系统** | skill-registry.ts, agent-skill-types.ts | `SkillTemplate`, `SerializedSkillRegistry` | ~5 个导出 |
| **全景追踪** | panorama-types.ts | `PanoramaSnapshot`, `NodeTrace`, `ToolCallRecord` | ~8 个导出 |
| **索引注册表** | indexed-registry.ts | `IndexedRegistry<T>`, `IndexDefinition<T>` | 2 个导出 |
| **键值存储** | kv-store.ts | `KvStore<T>` | 1 个导出 |
| **工具函数** | json-utils.ts, id-utils.ts | `extractJsonBlock()`, `generateId()`, `shortId()` | 3 个导出 |

---

## 二、结构性完整性评估

### ✅ 强完整性——数据流闭环

以下协议链从根到叶是**完整闭合**的：

**Agent 注册表闭环**：
```
AGENT_DEFS 单一事实源
  → AGENT_TAGS / AGENT_CHINESE_ROLE / AGENT_DISPLAY_BY_TYPE / AGENT_TOOL_PERMISSIONS（自动派生）
  → CHINESE_NAME_TO_TYPE / CHAT_AGENT_ALIASES / AGENT_DISPLAY（自动派生）
  → setAgentRegistry() 运行时覆写
```
测试覆盖：`agent-registry.test.ts` 验证了 14 个 AgentType 与所有子表数量一致、双向映射完整。

**事件管道闭环**：
```
PipelineEventType 枚举（86 个事件）
  → EventPayloadMap 类型联合（每个枚举值有精确 payload 类型）
  → ObservableEvent<T> 泛型（编译期保证 type + payload 一致）
  → IPipelineObserver.emit()/on()/off()
```
测试覆盖：`event-payload-map.test.ts` 验证了唯一性、命名规范、前缀空间合理性。

**记忆系统闭环**：
```
MemoryKind + SemanticState（值定义）
  → MEMORY_VALID_TRANSITIONS（状态机事实源）
  → MemoryEntry / MemoryWriteInput（数据结构）
  → IMemoryStore（25 方法契约）
  → MemoryQuery（检索协议，含 HCA/CSA 模式）
```
测试覆盖：`memory-types.test.ts` 验证了字段完整性、状态机合法性、domain 可选性。

**工具系统闭环**：
```
Tool 统一接口（6 字段 + execute）
  → ReversibilityLevel（L0-L3）→ toReversibilityClass() 显式映射
  → IConfirmGate（确认门契约）
  → ITrustModel（信任模型，8 方法）
```
关键收敛：`toReversibilityClass()` 解决了艾尔海森 P0-1——两套枚举映射同一域。

**修宪流程闭环**：
```
AmendmentProposal → JudgmentResult（评判裁决） → AmendmentApplyResult（执行结果）
```
三段式，输入/评判/输出都有独立类型。

---

### 🟡 一致性缺口——根系未完全舒展

#### 缺口 1：`AgentContext` 被声明但未使用

- **文件**：`agent-enums.ts` 定义了 `AgentContext.Production` / `.SelfExamination` / `.PostVerification`
- **问题**：`agent-registry.ts` 的 `resolveAgentPermissions()` 第二个参数 `_context` 被 `_` 前缀标记为**忽略**，注释写"向后兼容占位"
- **影响**：三个枚举场景实际上没有任何权限差异——Inspector 在 Production 和 PostVerification 下拿到完全相同的工具集
- **严重度**：黄牌——当前行为正确（权限表静态分配），但枚举声明与实现语义不匹配

#### 缺口 2：LockType 与 ReversibilityLevel 无映射

- **文件**：`file-lock-manager.ts` 定义 `LockType.Read / Write`；`toolkit.ts` 定义 `ReversibilityLevel.L0~L3`
- **问题**：两套枚举描述的是"同一棵树的根和冠"——文件锁的 `Write` 应该对应 `L1+/L2/L3` 的工具，但没有任何映射函数
- **影响**：FileLockManager 在决定是否需要锁时，只能看 `Tool.needsLock` 的 boolean，无法从 `level` 推导
- **严重度**：黄牌——当前 Boolean 方案可用，但扩展性有限

#### 缺口 3：ICortexApi 是 God Interface（已知债务）

- **文件**：`infra.ts` 定义 `ICortexApi`（21 成员，横跨生命周期/对话/任务/记忆/引擎组件 5 域）
- **代码法典 §9.6** 已追踪此违规：计划 Core-2 拆分
- **影响**：CLI 命令工厂和 TUI 桥接均依赖此接口，任何方法签名变更影响面大
- **严重度**：已知债务，Core-2 计划拆分

#### 缺口 4：ITuiEngineBridge 与 ICortexApi 签名不完全一致

- **`ICortexApi.chat()`**：`(systemPrompt, messages, opts?) => Promise<string>`
- **`ITuiEngineBridge.chat()`**：相同签名
- **`ITuiEngineBridge.streamChat()`**：多了 `onChunk` 回调和 `tools` 参数
- ICortexApi 没有 streamChat——TUI 的流式能力在 CLI 层无对应
- **严重度**：信息性——这是设计差异（CLI 直接对话 vs TUI 流式渲染），不是缺陷

#### 缺口 5：AGENT_DEFS 的 FIXME 循环依赖

- **文件**：`agent-registry.ts` 注释标注：
  > `FIXME: 应迁入 @cortex/config，但因 config→shared→config 循环依赖暂缓。`
- **数据副本**已保留在 `packages/config/src/data/agent-defs.ts`
- **影响**：两处定义需要手动同步，有漂移风险
- **严重度**：黄牌——有测试覆盖双向一致性，但架构上不够干净

---

### 🟢 测试覆盖——菌丝的加固网

| 测试文件 | 覆盖率 | 验证内容 |
|---------|--------|---------|
| `types.test.ts` | 25 个 it | 所有核心枚举/接口的编译期可用性与字段完整性 |
| `agent-registry.test.ts` | ~45 个 it | AGENT_DEFS 单源派生、运行时覆写、双向映射一致性 |
| `event-payload-map.test.ts` | 8 个 it | PipelineEventType 唯一性、命名规范、前缀空间 |
| `memory-types.test.ts` | ~12 个 it | MemoryEntry 字段完整性、state machine、domain gate |
| `indexed-registry.test.ts` | ~12 个 it | IndexedRegistry 注册/索引/覆盖/清理 |
| `smoke.test.ts` | 5 个 it | barrel 导出可用性冒烟 |

**关键测试发现**：
- `agent-registry.test.ts` 验证了 `AgentType 枚举与 AGENT_DEFS 派生数量一致——无遗漏`
- `memory-types.test.ts` 验证了 `MemoryKind 应包含全部 5 种类别` 和 `SemanticState 应包含全部 4 种状态`
- `event-payload-map.test.ts` 验证了 `所有命名空间前缀不超过 20 个` 和 `枚举值唯一`

---

## 三、模块引用一致性核查

### 3.1 barrel 导出 vs 文件内容

barrel (`index.ts`) 列出了 20 个 `export * from` 语句。实际 src/ 下 25 个 `.ts` 文件。

**未在 barrel 中单独导出的文件**（通过其父桶间接导出）：
- `agent-enums.ts` → 通过 `agent.ts` 桶重新导出 ✅
- `agent-protocols.ts` → 通过 `agent.ts` 桶重新导出 ✅
- `agent-skill-types.ts` → 通过 `agent.ts` 桶重新导出 ✅

**结论**：barrel 覆盖完整，无符号泄漏。

### 3.2 跨包引用一致性

| 消费方包 | 依赖的 shared 协议 | 验证 |
|---------|-------------------|------|
| `@cortex/engine` | `Tool`, `ToolCategory`, `ReversibilityLevel`, `IConfirmGate`, `ITrustModel` | toolkit.ts 定义齐全 |
| `@cortex/engine` | `IMemoryStore`, `MemoryEntry`, `MemoryQuery` | memory.ts 定义齐全 |
| `@cortex/engine` | `IPipelineObserver`, `PipelineEventType`, `ObservableEvent` | infra.ts 定义齐全 |
| `@cortex/engine` | `Agent`, `AgentCapability`, `AgentPoolLike` | agent-protocols.ts 定义齐全 |
| `@cortex/engine` | `TaskNode`, `NodeResult`, `ExecutionReport` | task.ts 定义齐全 |
| `@cortex/engine` | `ILifecycle`, `BaseLifecycle` | lifecycle.ts 定义齐全 |
| `@cortex/engine` | `IFileSystemAdapter`, `IFileLockManager` | fs-adapter.ts + file-lock-manager.ts 定义齐全 |
| `@cortex/engine` | `KvStore`, `KvStoreEntry` | kv-store.ts 定义齐全 |
| `@cortex/engine` | `extractJsonBlock` | json-utils.ts 定义齐全 |
| `@cortex/engine` | `ModificationRecordItem`, `ModificationSession` | modification-record.ts 定义齐全 |
| `@cortex/scheduler` | `AgentPoolLike`, `Agent`, `TaskNode` | 定义齐全 |
| `@cortex/cli` | `ICortexApi`, `ChatOptions`, `LlmMessage` | infra.ts 定义齐全 |
| `@cortex/tui` | `ITuiEngineBridge` | tui-bridge.ts 定义齐全 |
| `@cortex/governance` | `DocInput`, `DocEntry`, `DocType` | doc-registry.ts 定义齐全 |
| `@cortex/governance` | `AmendmentProposal`, `JudgmentResult` | amendment.ts 定义齐全 |

**结论**：已知消费方的协议引用均有对应定义，无缺失。

---

## 四、结论与建议

### 总体评估：🟢 协议完整性可靠

shared 包的协议定义结构清晰、领域分桶合理、barrel 覆盖完整、测试覆盖充分。86 个事件类型均有精确 payload 类型约束，"菌丝网络"的每一条根都连通了对应的树。

### 三棵需要修剪的盆栽

| # | 缺口 | 建议动作 | 优先级 |
|---|------|---------|--------|
| 1 | `AgentContext` 三个枚举场景与 `resolveAgentPermissions` 实际实现不一致 | 要么删除未使用的枚举值，要么实现上下文感知的权限解析 | Core-2 |
| 2 | `LockType` 与 `ReversibilityLevel` 无映射 | 在 file-lock-manager.ts 或 toolkit.ts 中补充 `lockTypeFromLevel(level): LockType` | Core-2 |
| 3 | `AGENT_DEFS` 因循环依赖在 shared/config 两处保留 | 设计解耦方案（如纯数据文件不受循环依赖限制），消除数据副本 | Core-2 |

### 一片需要补种的苗圃

目前 `@cortex/shared` 没有 `.proto` 文件，所有协议以 TS 类型定义。如果将来需要跨语言互通（如 Python runtime / gRPC 插件），建议补充一个独立的 `protocols/` 目录存放 `.proto` 定义，从 proto 编译出 TS 类型而非反向推导。
