# @cortex/shared 域分组说明

## 域划分原则

按**业务语义**而非文件来源分组。一个源文件的导出可能分布在多个域中，
但一个导出符号始终只属于一个域。

---

## Agent 域

**源文件**: `agent-enums.ts` / `agent-registry.ts` / `agent-skill-types.ts` / `agent-protocols.ts`

核心 Agent 类型系统：
- 枚举：`AgentType`、`AgentStatus`、`AgentContext`——零依赖基础枚举
- 注册表：`TAG_VOCABULARY`、`AGENT_TAGS`、`AGENT_CHINESE_ROLE`、`AGENT_DISPLAY`、`AGENT_TOOL_PERMISSIONS` 等运行时/编译期常量
- 技能类型：`SkillTemplate`、`SkillKind`、`FeedbackEntry`——Agent 产出的结构化认知
- 能力协议：`Agent`、`MemoryAware`、`Executable`、`AgentCapability`——Agent 的最小契约

**演变方向**：随 Agent 类型增加，`AGENT_DEFS` 单一起源持续扩展。技能类型可能独立为子域。

---

## Task 域

**源文件**: `task.ts`

任务调度类型——TaskBoard / Scheduler / MetaAgent 共享的 DAG 节点类型：
- `TaskNode`——任务节点（含推理深度、策略偏好、上下文策略引用）
- `NodeResult`——节点执行结果
- `ExecutionReport`——调度全貌报告
- `SubTask` / `DecomposeResult`——RLM 子任务拆解
- `EdgeType` / `ImpactScope`——DAG 边语义与重规划范围

**演变方向**：RLM 递归拆解持续深化时可能拆出 `rlm-types.ts` 子模块。

---

## Memory 域

**源文件**: `memory.ts`

记忆系统 v3 类型体系：
- `MemoryKind` / `SemanticState`——认知类别与语义生命周期
- `MemoryEntry` / `MemoryWriteInput`——记忆条目与写入输入
- `MemoryQuery`——检索策略（BFS/关键词/向量/门控）
- `IMemoryStore`——记忆存储接口（所有存储后端必须实现）
- `LinkType` / `MemoryLink`——记忆关联图

**演变方向**：检索模式（HCA/CSA）与门控（DomainGate）独立演化。

---

## Toolkit 域

**源文件**: `toolkit.ts` + `file-lock-manager.ts`

工具系统 + 安全模型的全部类型：
- `Tool` / `ToolCategory` / `ToolDefinition`——工具定义
- `ReversibilityLevel` / `TrustLevel`——可逆性等级与信任模型
- `IConfirmGate` / `ITrustModel`——确认门与信任模型接口
- `IFileLockManager` / `LockType`——文件锁抽象
- `RiskDomain` / `toolNameToRiskDomain`——风险域映射

**演变方向**：确认门与信任模型可能在 Core-3 中合并为统一安全层。

---

## Infra 域

**源文件**: `infra.ts`

基础设施类型：
- `PipelineEventType` / `PipelinePriority`——可观测事件类型（封闭枚举，~50+ 事件）
- `EventPayloadMap`——按事件类型锁定的 payload 类型联合
- `IPipelineObserver`——可观测管道接口
- `ICortexApi`——CLI ↔ Engine 统一通信契约
- `LlmMessage` / `LlmToolCall` / `LlmResponse`——LLM 协议类型
- `SafeErrorReporter`——统一错误上报
- `Disposable`——资源清理契约
- Span ID 前缀常量（`SPAN_PREFIX_TASK` 等）

**演变方向**：事件类型枚举随新组件增长（同步更新 `EventPayloadMap`）。LLM 协议可能独立为子域。

---

## Platform 域

**源文件**: `cli-adapter.ts` / `fs-adapter.ts` / `tui-bridge.ts`

平台适配抽象：
- `PlatformKind` / `PlatformBridge` / `PlatformContext`——运行平台枚举与桥接
- `IFileSystemAdapter` / `DirectoryEntry`——文件系统抽象
- `ITuiEngineBridge`——TUI ↔ Engine 通信契约

**演变方向**：Core-2 追加 ElectronAdapter（IPC 弹窗）。IFileSystemAdapter 可能并入 Toolkit 域。

---

## Lifecycle 域

**源文件**: `lifecycle.ts`

标准组件生命周期：
- `LifecyclePhase`——六阶段枚举（Created → Initializing → Running → Stopping → Stopped → Disposed）
- `ILifecycle`——生命周期接口
- `BaseLifecycle`——基础实现（phase 管理 + 状态校验）

**演变方向**：`@constitutional §9.1` 要求所有可管理生命周期的组件实现此接口。

---

## Governance 域

**源文件**: `doc-registry.ts` / `amendment.ts` / `skill-registry.ts`

治理与宪法相关类型：
- `DocType` / `DocStatus` / `DocEntry`——文档治理注册表
- `AmendmentProposal` / `JudgmentResult`——修宪提案与评判
- `SerializedSkillRegistry`——技能注册表序列化形状

**演变方向**：治理体系扩展时可能拆出 `constitution-types.ts`。

---

## Context 域

**源文件**: `context-policy.ts`

上下文生命周期管理策略：
- `ContextPolicy`——三部分策略（对话保留 + 事实检索 + 筛选组合）
- `ConversationMode` / `RetrievalPolicy` / `PipelinePolicy`
- `SortMode` / `AssembleTier` / `TokenBudget`

**演变方向**：预设策略库已迁入 `@cortex/config`，类型定义留在 shared。

---

## Utility 域

**源文件**: `id-utils.ts` / `json-utils.ts` / `kv-store.ts` / `indexed-registry.ts` / `modification-record.ts` / `panorama-types.ts`

通用工具类型：
- `generateId` / `shortId`——统一 ID 生成
- `extractJsonBlock`——从 LLM 输出中提取 JSON
- `KvStore` / `KvStoreEntry`——通用键值存储抽象
- `IndexedRegistry`——泛型索引注册表基类
- `ModificationRecordItem` / `ModificationSession`——修改记录 Schema
- `PanoramaSnapshot`——执行周期全景快照

**演变方向**：工具函数随需求横向扩展，不拆子域。
