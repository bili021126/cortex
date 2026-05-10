# 安柏变更规模侦察报告

> 产出方式：安柏（Inspector Agent）独立侦察
> 侦察日期：2026-05-09（更新）
> 侦察范围：packages/、.cortex/、tmp/、test-output/self-examination/
> 此文件由安柏单 Agent 侦察生成，纯客观数据，无推断无建议。

---

## 1. test-output/self-examination/ 关键文件存在性

| 文件 | 状态 | 路径 |
|------|------|------|
| self-examination-summary.md | ✅ 存在 | test-output/self-examination/self-examination-summary.md |
| consensus-fix-list.md | ✅ 存在 | test-output/self-examination/consensus-fix-list.md |
| archive/ | 目录 | test-output/self-examination/archive/ |
| archive/2026-05-04/ | 子目录 | test-output/self-examination/archive/2026-05-04/ |
| amber-change-summary.md | ✅ 存在（当前文件） | test-output/self-examination/amber-change-summary.md |

**archive/2026-05-04/ 下文件清单：** albedo-core-code-audit.md, albedo-p0-code-review.md, amber-change-summary.md, amber-filesystem-inspect.md, beidou-deploy-readiness.md, beidou-ops-readiness.md, beidou-p2-verification.md, deployment-readiness-cross-platform-assessment.md, keqing-code-quality-audit.md, keqing-p1-verification.md, mona-quality-trend.md, nahida-architecture-analysis.md, nahida-p3-verification.md, ningguang-fixlist-consistency.md, scan-report.md（共 15 个归档文件）

**观察结论：** 必检文件均存在。archive/ 内含一个日期子目录，存储了 15 个历史侦察产出。

---

## 2. .cortex/ 下 *.db 临时文件路径规范性

| 文件名 | 路径 |
|--------|------|
| conversation-学术研讨会.db | .cortex/conversation-学术研讨会.db |
| memory-browser.db | .cortex/memory-browser.db |
| memory-self-exam.db | .cortex/memory-self-exam.db |
| memory.db | .cortex/memory.db |
| shared-consensus.db | .cortex/shared-consensus.db |
| shared-meeting.db | .cortex/shared-meeting.db |

DB 文件总数：6 个。
路径特征：全部位于 `.cortex/` 根级别，无子目录分类。其中 5 个 ASCII 命名，1 个（conversation-学术研讨会.db）含中文字符。
额外非 DB 文件：`.cortex/.llm-cache.json`（LLM 响应缓存文件）、`.cortex/e2e-output/`（e2e 输出子目录）。

`.gitignore` 第 19-20 行已配置 `.cortex/` 整体忽略。

**观察结论：** 所有临时 DB 文件路径符合规范，无嵌套在深层子目录的异常情况。`conversation-学术研讨会.db` 含中文字符——是否合规取决于命名约定，不在本次侦察范围。

---

## 3. .gitignore 包含 tmp/ — 验证

`.gitignore` 第 19-21 行：

```
# Cortex runtime artifacts
.cortex/
tmp/
```

**观察结论：** `tmp/` ✅ 已明确列入 `.gitignore` 忽略列表，与 `.cortex/` 同属运行时产物忽略区。

`tmp/` 目录当前内容（6 个文件）：

| 文件 | 来源说明 |
|------|----------|
| memory_diff.txt | Git diff 输出（memory-store.ts 变更），含 "fatal: bad revision 'HEAD'" 错误 |
| review_diff.txt | 空文件 |
| staged_meta.txt | Git diff staged meta-agent.ts（new file，+314 行），含旧版 MetaAgent 代码 |
| staged_shared.txt | Git diff staged shared/index.ts（new file，+922 行），含旧版 shared 类型定义 |
| unstaged_meta.txt | 未跟踪的 meta 相关变更 |
| unstaged_shared.txt | 未跟踪的 shared 相关变更 |

**观察结论：** `tmp/` 内容表明存在 Git 变更缓冲区文件，其中 memory_diff.txt 执行 git diff 时因无 HEAD 而报错。

---

## 4. 核心文件改动行数统计

### 4.1 engine/src/ 核心文件当前规模

| 文件 | 行数 | 引用 @cortex/shared |
|------|------|-------------------|
| memory-store.ts | ~390 | ✅（8 个符号：MemoryEntry, MemoryLink, MemoryQuery, MemoryType, AgentType, MemoryState, LinkType, PipelinePriority） |
| scheduler.ts | ~330 | ✅（8 个符号：TaskNode, NodeResult, ExecutionReport, AgentType, Agent, AGENT_TAGS, PipelinePriority, AgentStatus） |
| pipeline-observer.ts | ~110 | ✅（3 个符号：ObservableEvent, PipelineHandler, PipelinePriority, SafeErrorReporter, SafeErrorContext） |
| task-board.ts | ~215 | ✅（3 个符号：AgentType, TaskNode, AGENT_TAGS） |
| index.ts（barrel） | 24 | ❌（自身是桶导出，不引用 shared） |

### 4.2 shared/src/ 类型定义层

| 文件 | 行数 | 域 |
|------|------|-----|
| index.ts | 7 | barrel re-export（4 条 export *） |
| agent.ts | ~93 | AgentType/AgentStatus/TAG_VOCABULARY/AGENT_TAGS/AGENT_TOOL_PERMISSIONS |
| task.ts | ~56 | TaskNode/NodeResult/ImpactScope/ReplanResult/ExecutionReport |
| memory.ts | ~81 | MemoryType/MemoryState/MemoryEntry/MemoryLink/MemoryQuery |
| infra.ts | ~186 | ToolCategory/ToolDefinition/ReversibilityLevel/ConfirmGate/PipelineObserver/LockType/PlatformBridge/LLM协议/Agent接口 |
| **小计** | **~423** | |

### 4.3 engine/src/ 全量文件

| 文件 | 行数 | 引用 @cortex/shared |
|------|------|-------------------|
| scheduler.ts | ~330 | ✅ |
| memory-store.ts | ~390 | ✅ |
| toolkit.ts | ~290 | ✅ |
| meta-agent.ts | ~320 | ✅ |
| llm-adapter.ts | ~265 | ✅ |
| task-board.ts | ~215 | ✅ |
| react-helper.ts | ~95 | ✅ |
| base-agent.ts | ~165 | ✅ |
| review-agent.ts | ~60 | ✅ |
| confirm-gate.ts | ~95 | ✅ |
| ops-agent.ts | ~55 | ✅ |
| cli-adapter.ts | ~65 | ✅ |
| file-lock-manager.ts | ~85 | ✅ |
| butler-agent.ts | ~175 | ✅ |
| pipeline-observer.ts | ~110 | ✅ |
| agent-pool.ts | ~105 | ✅ |
| doc-govern-agent.ts | ~60 | ✅ |
| code-agent.ts | ~60 | ✅ |
| analysis-agent.ts | ~60 | ✅ |
| browser-agent.ts | ~175 | ✅ |
| inspector-agent.ts | ~120 | ✅ |
| loop-agent.ts | ~30 | ✅ |
| index.ts | 24 | ❌（自身是 barrel） |
| **engine 小计** | **~3,289** | **22/23 = 95.7%** |

### 4.4 汇总

| 包 | 文件数 | 总行数 |
|----|--------|--------|
| @cortex/shared | 5 | ~423 |
| @cortex/engine | 23 | ~3,289 |
| **合计** | **28** | **~3,712** |

**观察结论：** 核心三大文件（memory-store.ts ~390 行、scheduler.ts ~330 行、meta-agent.ts ~320 行）覆盖 engine 近 31% 的代码量。

---

## 5. shared/ 拆分后通过 index.ts barrel 导入的影响范围

### 5.1 Barrel 结构

`packages/shared/src/index.ts`：

```ts
export * from "./agent.js";
export * from "./task.js";
export * from "./memory.js";
export * from "./infra.js";
```

4 条 `export *` 聚合 4 个领域文件。所有下游消费者统一通过包名 `@cortex/shared` 导入，无深层路径直接引用。

### 5.2 shared 内部跨域依赖图

```
agent.ts ←── memory.ts（依赖 AgentType）
agent.ts ←── task.ts（依赖 AgentType, Tag）
agent.ts + task.ts ←── infra.ts（依赖 AgentType, AgentStatus, TaskNode, NodeResult）
```

- agent.ts：零依赖根（4 域中唯一无内部依赖的文件）
- 跨域依赖总数：3 条

### 5.3 下游消费者明细（engine 包，22 个文件）

| 文件 | 导入符号数 | 来源域 |
|------|-----------|--------|
| memory-store.ts | 8 | memory(MemoryEntry,MemoryLink,MemoryQuery,MemoryType,AgentType) + (MemoryState,LinkType) + infra(PipelinePriority) |
| scheduler.ts | 8 | task(TaskNode,NodeResult,ExecutionReport) + agent(AgentType,Agent,AGENT_TAGS,AgentStatus) + infra(PipelinePriority) |
| toolkit.ts | 9 | infra(ToolInvocation,ToolResult,ToolDefinition,ToolHandler,ReversibilityLevel,ToolCategory,LockType) + agent(AgentType,AGENT_TOOL_PERMISSIONS) |
| base-agent.ts | 8 | agent(AgentType,Agent,AgentStatus) + task(TaskNode,NodeResult) + memory(MemoryQuery,MemoryType,LinkType) + infra(SafeErrorReporter) |
| butler-agent.ts | 7 | agent(AgentType,AgentStatus) + infra(ObservableEvent,PipelinePriority,PlatformBridge) |
| doc-govern-agent.ts | 7 | agent(AgentType) + memory(MemoryQuery,MemoryType,MemoryState,LinkType) + task(TaskNode) |
| react-helper.ts | 7 | task(TaskNode,NodeResult) + agent(AgentType) + infra(LlmMessage,LlmToolCall,ToolDef) |
| analysis-agent.ts | 6 | agent(AgentType) + memory(MemoryQuery,MemoryType,LinkType) + task(TaskNode) |
| code-agent.ts | 6 | agent(AgentType) + memory(MemoryQuery,MemoryType,LinkType) + task(TaskNode) |
| llm-adapter.ts | 6 | infra(LlmMessage,LlmToolCall,LlmResponse,ToolDef,LlmAdapterConfig,SafeErrorReporter) |
| review-agent.ts | 6 | agent(AgentType) + memory(MemoryQuery,MemoryType,LinkType) + task(TaskNode) |
| cli-adapter.ts | 5 | infra(PlatformBridge,ConfirmationRequest,ConfirmationResponse,PlatformContext,PlatformKind) |
| confirm-gate.ts | 5 | infra(ConfirmationRequest,ConfirmationResponse,ReversibilityLevel,PlatformBridge) + (ReversibilityLevel as RL) |
| meta-agent.ts | 5 | task(TaskNode,Tag,ImpactScope,ReplanResult) + infra(LlmAdapter) |
| browser-agent.ts | 4 | agent(AgentType,AgentStatus) + task(TaskNode) |
| agent-pool.ts | 3 | agent(AgentType,AgentConfig,AgentStatus) |
| inspector-agent.ts | 3 | agent(AgentType) + task(TaskNode) |
| loop-agent.ts | 3 | agent(AgentType) |
| ops-agent.ts | 3 | agent(AgentType) |
| pipeline-observer.ts | 5 | infra(ObservableEvent,PipelineHandler,PipelinePriority,SafeErrorReporter,SafeErrorContext) |
| task-board.ts | 3 | agent(AgentType,AGENT_TAGS) + task(TaskNode) |
| file-lock-manager.ts | 1 | infra(LockType) |

### 5.4 影响范围统计

| 指标 | 数值 |
|------|------|
| shared barrel 域文件数 | 4（agent.ts, task.ts, memory.ts, infra.ts） |
| shared 内部跨域依赖数 | 3 |
| engine 引用 @cortex/shared 文件数 | 22 / 23（95.7%） |
| 不引用 shared 的 engine 文件 | engine/src/index.ts（barrel 自身，仅 re-export） |
| 所有下游导入方式 | 统一通过包名 `@cortex/shared`，无深层路径导入 |
| 最热门的 shared 域 | agent.ts — 被 21/22 个文件引用（95.5%） |
| 次热门的 shared 域 | infra.ts — 被 10/22 个文件引用（45.5%） |
| 导入符号数最多的文件 | toolkit.ts（9 个符号） |

### 5.5 域热度分析

| shared 域 | 被引用文件数 | 代表性消费者 |
|-----------|------------|-------------|
| agent.ts（AgentType/AgentStatus/AGENT_TAGS） | 21 / 22（95.5%） | 几乎所有 engine 文件 |
| task.ts（TaskNode/NodeResult/ExecutionReport） | 11 / 22（50%） | scheduler, base-agent, task-board, meta-agent 等 |
| memory.ts（MemoryEntry/MemoryQuery/MemoryType 等） | 7 / 22（31.8%） | memory-store, base-agent, 各 Agent 文件 |
| infra.ts（PipelinePriority/ObservableEvent/SafeErrorReporter 等） | 10 / 22（45.5%） | pipeline-observer, butler, toolkit, llm-adapter 等 |

**观察结论：** `agent.ts` 是 shared 拆分后耦合度最高的域（95.5% 的 engine 文件依赖它），任何对 AgentType/AgentStatus 的变更都会波及几乎整个 engine 包。`memory.ts` 虽然只有 7 个消费者，但 memory-store.ts（~390 行）是其中最大的使用者。

---

## 6. 编译/测试验证状态（系统采集）

以下为系统自动采集的编译与测试结果：

| 检验项 | 状态 | 说明 |
|--------|------|------|
| `tsc --noEmit` | ❌ 失败（exit 1） | 输出为 tsc 帮助信息，疑似未找到 tsconfig.json 或参数问题 |
| `tsx` 测试运行 | ❌ 失败（exit 1） | 找不到 `test/calculator.test.ts`，测试入口路径不匹配 |

**观察结论：** 当前代码库的编译和测试入口均存在配置问题。

---

## 7. 其他文件系统发现

- `tmp/` 目录含 6 个 Git diff 缓存文件（memory_diff.txt, review_diff.txt, staged_meta.txt, staged_shared.txt, unstaged_meta.txt, unstaged_shared.txt），表明存在未完成的 Git 变更追踪
- `staged_meta.txt` 显示旧版 MetaAgent 代码（import uuidv4, TaskTree, TaskNodeStatus, RiskLevel, Orientation, CorticalArea, PillarId 等——这些类型不在当前 shared 中）
- `staged_shared.txt` 显示旧版 shared/index.ts 含 ~922 行（远超当前的 7 行），包含完整的 Meso-Lite 架构类型（Orientation, TaskTree, PillarId, CommitteeSession 等）
- `.cortex/.llm-cache.json`：LLM 响应缓存文件（非 DB 文件）
- `.cortex/e2e-output/`：e2e 测试输出目录
- `packages/shared/src/__tests__/`：含 `types.test.ts` 1 个测试文件
- `packages/engine/src/__tests__/`：目录存在但为空
- `docs/` 目录存有大量设计文档（Core-1 重构计划、v1.1 设计理念保留等）

---

*侦察报告完毕。以上为纯客观数据，不含推断与建议。*
