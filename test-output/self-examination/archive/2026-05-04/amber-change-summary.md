# 安柏侦察报告：变更规模与文件合规

> 侦察 Agent：安柏（Inspector Agent）
> 侦察日期：2025-07-18
> 侦察范围：packages/、docs/、test-output/self-examination/、根目录配置

---

## 一、self-examination 目录文件存在性

`test-output/self-examination/` 目录现存 16 个文件：

| 文件 | 存在 |
|------|------|
| albedo-core-code-audit.md | ✅ |
| albedo-p0-code-review.md | ✅ |
| amber-change-summary.md | ✅（本次覆盖） |
| amber-filesystem-inspect.md | ✅ |
| beidou-deploy-readiness.md | ✅ |
| beidou-ops-readiness.md | ✅ |
| beidou-p2-verification.md | ✅ |
| consensus-fix-list.md | ✅ |
| deployment-readiness-cross-platform-assessment.md | ✅ |
| keqing-code-quality-audit.md | ✅ |
| keqing-p1-verification.md | ✅ |
| mona-quality-trend.md | ✅ |
| nahida-architecture-analysis.md | ✅ |
| nahida-p3-verification.md | ✅ |
| ningguang-fixlist-consistency.md | ✅ |
| scan-report.md | ✅ |

**结论**：16/16 文件全部存在，无缺失。

---

## 二、.gitignore 中 tmp/ 条目

`.gitignore` 第 22 行：

```
# Cortex runtime artifacts
.cortex/
tmp/
```

**结论**：`tmp/` 条目已存在于 `.gitignore`。

---

## 三、临时 DB 路径规范

`tmp/` 目录当前包含 6 个文件：

| 文件 | 内容 |
|------|------|
| `memory_diff.txt` | `git diff HEAD -- packages/engine/src/memory-store.ts` 的输出（HEAD 不存在，报错） |
| `review_diff.txt` | 空文件 |
| `staged_meta.txt` | `packages/engine/src/meta-agent.ts` 的 staged diff（314 行新增） |
| `staged_shared.txt` | `packages/shared/src/index.ts` 的 staged diff（922 行新增） |
| `unstaged_meta.txt` | `packages/engine/src/meta-agent.ts` 的 unstaged diff（314→189 行） |
| `unstaged_shared.txt` | `packages/shared/src/index.ts` 的 unstaged diff（922→380 行） |

**路径规范观察**：
- 命名模式：`{staged|unstaged}_{模块名}.txt` 或 `{模块}_diff.txt`
- 路径层级：直接位于 `tmp/` 根下，无子目录嵌套
- 内容格式：标准 unified diff 格式

---

## 四、关键文件变更行数统计

### 4.1 从 tmp/ diff 文件统计

| 文件 | Staged 行数 | Unstaged 行数 | 中间缩减 |
|------|------------|--------------|---------|
| `packages/engine/src/meta-agent.ts` | 314 行（新增） | 189 行 | -125 行 |
| `packages/shared/src/index.ts` | 922 行（新增，单文件） | 380 行 | -542 行 |

### 4.2 当前实际文件行数

| 文件 | 当前行数（估） | 说明 |
|------|--------------|------|
| `packages/shared/src/index.ts` | 9 行 | 纯 re-export（5 条 export 语句） |
| `packages/shared/src/agent.ts` | ~105 行 | AgentType、AgentStatus、TAG_VOCABULARY、AGENT_TAGS、AGENT_TOOL_PERMISSIONS |
| `packages/shared/src/task.ts` | ~55 行 | TaskNode、NodeResult、ImpactScope、ReplanResult、ExecutionReport |
| `packages/shared/src/memory.ts` | ~92 行 | MemoryType、MemoryState、MemoryEntry、MemoryLink、MemoryQuery、LinkType |
| `packages/shared/src/infra.ts` | ~185 行 | 工具定义、确认门、管线、平台、文件锁、LLM 协议、Agent 接口 |
| `packages/engine/src/meta-agent.ts` | ~260 行 | 含 PLANNING_SYSTEM + REPLAN_SYSTEM 两段长 prompt |
| `packages/testing/src/index.ts` | ~114 行 | 合成数据生成器 |

### 4.3 shared/ 拆分前后对比

| 指标 | 拆分前（staged） | 拆分后（当前） |
|------|-----------------|---------------|
| `shared/src/index.ts` | 922 行（所有类型集中） | 9 行（re-export） |
| `shared/src/agent.ts` | 不存在 | ~105 行 |
| `shared/src/task.ts` | 不存在 | ~55 行 |
| `shared/src/memory.ts` | 不存在 | ~92 行 |
| `shared/src/infra.ts` | 不存在 | ~185 行 |
| shared 总行数 | ~922 行 | ~446 行（index + 4 域文件） |
| 行数净变化 | — | **减少 ~476 行**（从单文件拆分为模块化后，去重/精简） |

---

## 五、shared/ 拆分影响范围

### 5.1 域文件职责划分

| 域文件 | 主要导出 |
|--------|---------|
| `agent.ts` | AgentType 枚举、AgentStatus 枚举、TAG_VOCABULARY、AGENT_TAGS 映射、AGENT_TOOL_PERMISSIONS 权限表 |
| `task.ts` | TaskNode、NodeResult、ImpactScope、ReplanResult、ExecutionReport |
| `memory.ts` | MemoryType 枚举、MemoryState 枚举、MemoryEntry、MemoryLink、MemoryQuery、LinkType |
| `infra.ts` | ToolCategory、ToolDefinition、ToolInvocation、ToolResult、ReversibilityLevel、ConfirmationRequest/Response、IConfirmGate、TrustScore、PipelinePriority、ObservableEvent、LockType、IFileLockManager、PlatformKind、PlatformContext、PlatformBridge、LlmMessage、LlmToolCall、LlmResponse、ToolDef、LlmAdapterConfig、Agent 接口、AgentConfig |

### 5.2 engine/ 对 shared 的依赖矩阵

`packages/engine/src/` 共 23 个源文件。所有文件均通过 `import ... from "@cortex/shared"` 统一入口导入，**不感知 shared 内部拆分**。

| 域 | engine 中引用该域的文件数 |
|----|------------------------|
| `agent.ts`（AgentType 等） | 18/23（最高频） |
| `task.ts`（TaskNode 等） | 13/23 |
| `memory.ts`（MemoryEntry 等） | 7/23 |
| `infra.ts`（工具/确认/LLM） | 9/23 |

### 5.3 跨域依赖

- `task.ts` → `agent.ts`：`import type { AgentType, Tag } from "./agent.js"`
- `memory.ts` → `agent.ts`：`import type { AgentType } from "./agent.js"`
- `infra.ts` → `agent.ts` + `task.ts`：`import type { AgentType, AgentStatus }` 和 `TaskNode, NodeResult`

域文件间通过 `import type` 建立依赖，编译后零运行时开销。

### 5.4 影响总结

- **engine 层 0 变动**：re-export 模式使 shared 内部重组对消费者完全透明
- **shared 层变化集中在 index.ts**：从 922 行缩减为 9 行 re-export，4 个域文件各负其责
- **类型间无循环依赖**：agent → task → memory → infra 依赖链单向

---

## 六、其他发现

### 6.1 memory_diff.txt 中 git 错误

`tmp/memory_diff.txt` 内容为 git 错误：`fatal: bad revision 'HEAD'`。表明生成该 diff 时仓库无 HEAD 引用（可能为初始提交前）。

### 6.2 meta-agent.ts 变更要点（unstaged diff 对比 staged）

- `import` 简化：4 个 Node.js 内置模块导入被移除（`uuid`、`node:fs`、`node:path`、`node:url`）
- `LLMProvider` 接口（本地定义）移除，改为从 `./llm-adapter.js` 导入 `LlmAdapter`
- `OrientationKeywords` 接口及相关关键字分类逻辑被完全移除
- `classifyOrientation()` → 方向分类被移除
- `generateTaskTree()` → 替换为简化的 `plan()` 和 `_planningPrompt()`
- `parseTaskTreeResponse()` + `fallbackPlan()` + `normalizeNode()` + `defaultCorticalArea()` + `buildIntrospection()` 等 → 替换为 `_parsePlan()` + `_toTaskNode()` + `_fallbackNode()` + `_extractJson()`
- 新增 `requestReplan()` 方法和 `ReplanResult` 返回类型
- 大段中文 prompt 模板从源代码内嵌改为常量 `PLANNING_SYSTEM` 和 `REPLAN_SYSTEM`

### 6.3 shared/index.ts 变更要点（unstaged diff 对比 staged）

- 移除类型：`Orientation`、`ActivationState`、`CorticalArea`、`PillarId`、`PillarActivationProfile`、`BaselineActivation`、`ActivationOverride`、`CorticalRegion`
- 移除事件系统：`CortexEventType`、`CausalChain`、`CortexEvent`、`EventHandler`、`SubscriptionFilter`、`SubscriptionId`、`DeliveryStatus`、`TransportDiagnostics`、`Transport`
- 移除 Committee：`CommitteeSession`、`CommitteeMessage`、`CommitteeContentType`、`PillarPersonality`、`CommitteeReport`、`CommitteeDivergence`
- 移除旧任务模型：`RiskLevel`、`TaskNodeStatus`、`TaskNodeResult`、`TaskTree`、`PlanningDirective`、`BlockedNode`、`FailedNode`、`NodeResult`（旧版）
- 移除引擎消息：`MessageType`、`EngineMessage`、`EngineRequest`、`EngineResponse`、`EngineConfig`、`LLMConfig`、`EngineDiagnostics`、`SchedulerSnapshot`、`SchedulerConfig`
- 移除其他：`SystemOutputType`、`SystemOutput`、`InteractionChannel`、`ConfirmationRequest`（旧版）、`ConfirmationHandler`、`ResourceLock`
- 移除 `ErrorCode` 常量与 `CortexError`
- 移除 `ReActStatus`、`ReActAction`、`ReActState`、`ExecutionContext`、`PillarRunner`
- **新增**：`AgentType` 枚举、`AgentStatus` 枚举、`TAG_VOCABULARY`、`AGENT_TAGS`、`AGENT_TOOL_PERMISSIONS`、`ToolCategory`、`ToolDefinition`、`ToolInvocation`、`ToolResult`、`ToolHandler`、`ReversibilityLevel` 枚举、`ConfirmationRequest`（新）、`ConfirmationResponse`、`IConfirmGate`、`RiskDomain`、`TrustScore`、`PipelinePriority`、`ObservableEvent`、`PipelineHandler`、`IFileLockManager`、`LockType`、`PlatformKind`、`PlatformContext`、`PlatformBridge`、`LlmMessage`、`LlmToolCall`、`LlmResponse`、`ToolDef`、`LlmAdapterConfig`、`Agent` 接口、`AgentConfig`、`TaskNode`（新）、`NodeResult`（新）、`ImpactScope`、`ReplanResult`、`ExecutionReport`、`MemoryType` 枚举、`MemoryState` 枚举、`MemoryEntry`、`LinkType`、`MemoryLink`、`MemoryQuery`

---

*安柏，侦察骑士，2025-07-18*
