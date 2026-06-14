# 测试覆盖率分析报告

> **生成日期**: 2026-06-06  
> **分析范围**: `packages/engine/src/` → `packages/engine/tests/`  
> **测试框架**: Vitest v2.x（`@vitest/coverage-v8`）  
> **覆盖配置**: `include: ["src/**/*.ts"]`，排除 `src/index.ts` 及 `.d.ts`

---

## 目录

1. [测试文件全景清单](#1-测试文件全景清单)
2. [模块覆盖率逐项分析](#2-模块覆盖率逐项分析)
3. [测试覆盖 vs 未覆盖模块矩阵](#3-测试覆盖-vs-未覆盖模块矩阵)
4. [已知未覆盖的模块/函数/分支](#4-已知未覆盖的模块函数分支)
5. [补测优先级建议](#5-补测优先级建议)
6. [测试组织模式总结](#6-测试组织模式总结)

---

## 1. 测试文件全景清单

| # | 测试文件 | 标签 | 覆盖模块 | 测试用例数(约) |
|---|---------|------|---------|--------------|
| 1 | `scheduler.test.ts` | `@ci: unit` | `Scheduler`, `topologicalSort`, `TaskBoard`, `AgentPool`, `PipelineObserver`, `ConfirmGate`, `MemoryStore` | 8 |
| 2 | `scheduler-dispatch.test.ts` | `@ci: unit` | `Scheduler._dispatchNode`, `Scheduler.executeAll`, `密度平局打破` | 7 |
| 3 | `scheduler-cycle-recovery.test.ts` | `@ci: unit` | `topologicalSort` 循环检测 | 6 |
| 4 | `task-board.test.ts` | `@ci: unit` | `TaskBoard.claim/release/complete/findPending` | 16 |
| 5 | `task-board-stress.test.ts` | `@ci: unit` | `TaskBoard` 暗雷场景（8 类）、`Scheduler` 集成、`MemoryStore.CAS` | 19 |
| 6 | `agent-pool.test.ts` | `@ci: unit` | `AgentPool.spawn/destroy/setStatus/setObserver` | 8 |
| 7 | `agent-pool-status-ownership.test.ts` | `@ci: unit` | `AgentPool` 状态所有权（方案B）、`BaseAgent.setPool` | 7 |
| 8 | `confirm-gate.test.ts` | `@ci: unit` | `ConfirmGate.needsConfirmation/request/resolve/handleTimeout/waitFor` | 8 |
| 9 | `trust-model.test.ts` | `@ci: unit` | `TrustModel` 冷启动、晋升、衰减、拒绝、重置、快照、二维隔离 | 13 |
| 10 | `pipeline-observer.test.ts` | `@ci: unit` | `PipelineObserver.on/emit/off`, requestId 幂等键（D4） | 8 |
| 11 | `pipeline-observer-reporting.test.ts` | `@ci: unit` | `SafeErrorReporter` silent 升级、fatal/degraded 上报 | 6 |
| 12 | `topological-sort-edge.test.ts` | `@ci: unit` | `topologicalSort` hard/soft/trigger 边、dangling、循环、基础 | 16 |
| 13 | `manifold-gate.test.ts` | `@ci: unit` | `ManifoldGate` 流约束、FIFO、超时、reset、Scheduler 集成 | 10 |
| 14 | `memory-store.test.ts` | `@ci: unit` | `MemoryStore` 写入/检索/过滤/归档/CAS/四态/关联/权重/embedding | 25 |
| 15 | `memory-store-write-rollback.test.ts` | `@ci: unit` | `MemoryStore` 写回滚、writePending 湮灭 | — |
| 16 | `memory-store-lifecycle.test.ts` | `@ci: unit` | `MemoryStore` session 生命周期 | — |
| 17 | `memory-store-save.test.ts` | `@ci: unit` | `MemoryStore` 持久化 | — |
| 18 | `memory-store-close-read.test.ts` | `@ci: unit` | `MemoryStore` close/read 边界 | — |
| 19 | `memory-pipeline.test.ts` | `@ci: unit` | `MemoryStore` 管线上下文传递 | — |
| 20 | `memory-concurrency.test.ts` | `@ci: unit` | `MemoryStore` 并发读写 | — |
| 21 | `meta-agent.test.ts` | `@ci: llm` | `MetaAgent.plan/clarifyIntent`、JSON 解析失败回退、空数组 | 9 |
| 22 | `multi-agent-collab.test.ts` | `@ci: llm` | 串行协作、多视角并行、重规划、InspectorAgent | 9 |
| 23 | `skill-registry.test.ts` | `@ci: unit` | `SkillRegistry.queryByTags/register/get/unregister/recordFeedback/deriveStatus/持久化` | 30+ |
| 24 | `skill-executor.test.ts` | `@ci: unit` | 技能执行器 | — |
| 25 | `skill-extractor.test.ts` | `@ci: unit` | 技能提取器 | — |
| 26 | `skill-bootstrap-integration.test.ts` | `@ci: unit` | 技能引导集成 | — |
| 27 | `skill-system-integration.test.ts` | `@ci: unit` | 技能系统集成 | — |
| 28 | `file-lock-manager.test.ts` | `@ci: unit` | `FileLockManager` 读写锁 | 6 |
| 29 | `toolkit.test.ts` | `@ci: unit` | `Toolkit` 沙箱机制（P2-5 回归） | 5 |
| 30 | `confirm-gate-cleanup.test.ts` | `@ci: unit` | `ConfirmGate` dispose/cleanup | — |
| 31 | `confirm-gate-timeout.test.ts` | `@ci: unit` | `ConfirmGate` 超时场景 | — |
| 32 | `confirm-gate-cli.test.ts` | `@ci: unit` | `ConfirmGate` CLI 集成 | — |
| 33 | `butler-agent.test.ts` | `@ci: unit` | `ButlerAgent` | — |
| 34 | `code-agent.test.ts` | `@ci: unit` | `CodeAgent` | — |
| 35 | `review-agent.test.ts` | `@ci: unit` | `ReviewAgent` | — |
| 36 | `analysis-agent.test.ts` | (推测) | `AnalysisAgent` | — |
| 37 | `strategist-agent.test.ts` | `@ci: unit` | `StrategistAgent` | — |
| 38 | `inspector-agent.test.ts` | `@ci: unit` | `InspectorAgent` | — |
| 39 | `doc-govern-agent.test.ts` | `@ci: unit` | `DocGovernAgent` | — |
| 40 | `density-compress.test.ts` | `@ci: unit` | `density-compress.ts` | — |
| 41 | `rlm-decompose.test.ts` | `@ci: unit` | `rlm-decompose.ts` | — |
| 42 | `react-loop.test.ts` | `@ci: unit` | `react-loop.ts` | — |
| 43 | `react-loop-canonical.test.ts` | `@ci: unit` | `react-loop.ts` 正则场景 | — |
| 44 | `amendment-judge.test.ts` | `@ci: unit` | `amendment-judge.ts` | — |
| 45 | `amendment-timeout.test.ts` | `@ci: unit` | `amendment-timeout.ts` | — |
| 46 | `governance-loop.test.ts` | `@ci: unit` | `governance-loop.ts` | — |
| 47 | `bootstrap-integration.test.ts` | `@ci: unit` | bootstrap 集成 | — |
| 48 | `intent-fact-wall.test.ts` | `@ci: unit` | `intent-fact-wall.ts` | — |
| 49 | `key-routing.test.ts` | `@ci: unit` | key 路由 | — |
| 50 | `path-safety.test.ts` | `@ci: unit` | `path-utils.ts` 路径安全 | — |
| 51 | `agent-factory.test.ts` | `@ci: unit` | `agent-factory.ts` | — |
| 52 | `cli-adapter.test.ts` | `@ci: unit` | `CLIAdapter` | — |
| 53 | `system-stress.test.ts` | `@ci: unit` | 系统压力测试 | — |

> **注**: `—` 表示该文件存在但本文未逐行审阅其具体断言内容；"推测"表示文件推断存在（因 `tests/` 目录下可确认）。

---

## 2. 模块覆盖率逐项分析

### 2.1 核心调度层 (src/core/)

#### ✅ `scheduler.ts` — **高覆盖**
- 测试文件: `scheduler.test.ts`, `scheduler-dispatch.test.ts`, `task-board-stress.test.ts`, `manifold-gate.test.ts`, `multi-agent-collab.test.ts`
- 覆盖场景：
  - 单节点单 Agent 成功执行
  - 父子节点按依赖顺序执行
  - 无匹配 Agent 节点标记失败
  - 多视角节点并行执行
  - 调度事件发布（layer.start / node.start / node.complete / scheduler.done）
  - 集成 MemoryStore 写入 EPISODIC 记忆
  - 空板无节点
  - Agent execute 抛异常标记 fail
  - NodeFailed 去重
  - ManifoldGate 流控集成（5节点超池排队全部成功）
  - 父子节点拓扑 + 流控
  - 重规划集成
  - 密度平局打破（Review vs Code）
- **未覆盖**:
  - `boundaryHandler` 监听/退订的边界违规事件路径
  - `_buildLlmChat()` — 构建 RLM 拆解 LlmCallable（依赖 MetaAgent.llmAdapter）
  - `executeAll()` 全局超时分支（`Date.now() >= deadline`）
  - `executeAll()` replanFlight 多轮等待逻辑
  - `_dispatchMulti()` 的 `resultTypes` 与 `claimedBy` invariant 校验
  - `endSession()` 的异常处理分支
  - `sessionId` 生成路径

#### ✅ `task-board.ts` — **高覆盖**
- 测试文件: `task-board.test.ts`, `scheduler.test.ts`, `task-board-stress.test.ts`
- 覆盖场景：
  - 普通节点 claim（匹配标签、拒绝不匹配、拒绝重复）
  - findPending 过滤
  - 多视角节点并行认领、同类型拒绝、等齐自动 complete
  - release（普通→pending、非认领者拒绝、done/failed 拒绝）
  - 多视角 release 移除单个 agentType、回归 pending
  - 高频 claim→release→claim 无僵尸节点
  - 同节点快速 claim-release-claim 不丢状态
  - release 后其他 Agent 类型可立即认领
  - `failNode`, `allPerspectivesComplete`
- **未覆盖**:
  - `removeNode()` — NodeRemoved 事件发射
  - `removeSubtree()` — BFS 移除 + invariant 上报
  - `cancel()` — 取消 pending/claimed/running/done 节点
  - `_reportInvariant()` — 实例 `_observer` > 静态 `onInvariant` 优先级校验
  - `complete()` 的多视角去重（重入保护）
  - `complete()` 的 invariant orphanTypes 上报
  - `findPending()` 中 multi-perspective 节点的非认领态过滤（不覆盖所有组合）

#### ✅ `agent-pool.ts` — **高覆盖**
- 测试文件: `agent-pool.test.ts`, `agent-pool-status-ownership.test.ts`
- 覆盖场景：
  - spawn 配额内/超配额/未注册
  - destroy 回收后可再 spawn
  - setStatus 非法流转拒绝
  - setObserver 注入后 observer 管道优先
  - 无 observer 时 console.error 兜底
  - _observer > onInvariant 优先级
  - getStatus 查询、BaseAgent.setPool 委托
  - wakeup/shutdown 走 Pool
  - ButlerAgent 兼容
- **未覆盖**:
  - `spawnSubtask()` — RLM 子任务独立配额
  - `setMaxInstances()` — 热扩容/缩容
  - `hasAwake()` — Awake 实例检查
  - `canSpawn()` — 配额余量检查
  - `getStatuses()` — 某类型下所有实例状态
  - `destroy()` 中非法流转直写 Map 兜底路径 + 治理判例 NG-2026-0511-Destroy-Bypass
  - `VALID_TRANSITIONS` 全部花式流转组合

#### ✅ `topological-sort.ts` — **高覆盖**
- 测试文件: `topological-sort-edge.test.ts`, `scheduler-cycle-recovery.test.ts`
- 覆盖场景：
  - 空节点、单节点
  - hard 边（父不同层）、soft 边（父子同层）、trigger 边（同层）
  - 线性链、分叉、多层嵌套
  - 循环依赖（简单/三方/自环/部分循环）
  - dangling parentId 提升为根
  - 混合边（soft + trigger + hard）
- **未覆盖**:
  - observer 参数传 null/undefined 时的安全路径
  - `SchedulerNonstandardType` 事件（dangling 发射）
  - 超大节点集性能退化

#### ⚠️ `pipeline-observer.ts` — **中高覆盖**
- 测试文件: `pipeline-observer.test.ts`, `pipeline-observer-reporting.test.ts`
- 覆盖场景：
  - on/emit/off 注册/发射/移除
  - 优先级过滤（只调用匹配的 handler）
  - D4 精确移除指定 handler
  - requestId 自动生成/保留/唯一性
  - SafeErrorReporter silent 升级（3次阈值）
  - degraded/fatal 上报
  - non-silent 重置计数器
- **未覆盖**:
  - `_reportingError` 递归防护门闩（N-01）
  - `onHandlerError()` 注入路径
  - handler 抛异常时 `_onHandlerError` 回调
  - `SILENT_UPGRADE_THRESHOLD` 可配置性
  - 连续 silent 超过阈值后的计数器重置逻辑

#### ⚠️ `pipeline-runner.ts` — **低覆盖**
- 仅定义 `IStep` 接口和 `PipelineRunner.run()` 静态方法
- 通过 `BaseAgent.execute()` → `executeWithMemoryPipeline` 间接触发
- 无直接单元测试
- **覆盖**: 通过 Scheduler 集成测试间接覆盖

#### ⚠️ `meta-agent.ts` — **中覆盖**
- 测试文件: `meta-agent.test.ts`, `multi-agent-collab.test.ts`
- 覆盖场景：
  - `plan()` 意图拆解为 TaskNode 树
  - JSON 解析失败回退单节点
  - parentId 传递
  - setSafeReporter 注入后 JSON 解析失败走 reporter
  - 空数组 `[]` 不生成兜底节点
  - `clarifyIntent()` 结构化解析/回退/非法值归一化
  - 重规划成功/超限
- **未覆盖**:
  - `requestBoundaryReplan()` — 边界违规重规划
  - `_extractJson()` — JSON 标记围栏 + 平衡数组完整路径
  - `_tryParseItems()` — 所有 6 种解析策略
  - `_toTaskNode()` — `reasoningEffort` 智能默认 + contextPolicyId 匹配
  - `_resolveContextPolicy()` — 三条匹配规则
  - `setSkillRegistry()` 注入后的技能增强规划路径
  - `setObserver()` / `_unsubscribe()` 订阅/退订生命周期
  - `_enqueuePipelineCtx()` 硬上限防泄漏
  - `_getPipelineContext()` 注入管线上下文
  - `<RlmExecuteStep>` 协作路径（`schedule-impl.ts` 引用）

#### ❌ `replan-manager.ts` — **低覆盖**
- 无直接单元测试
- 通过 `multi-agent-collab.test.ts`、`task-board-stress.test.ts` 集成测试间接覆盖
- **覆盖**: 基础 enqueue → tryFireReplan → _drain → resolveChains 路径
- **未覆盖**:
  - `enqueue()` 中 `isReActTimeout` 跳过分支
  - `enqueue()` 超限跳过分支
  - `tryFireReplan()` 全局上限触顶分支
  - `_emitBudgetExhausted()` 事件发射
  - `_drain()` 中无 MetaAgent 时的 `SchedulerReplanNoMetaAgent` 事件
  - `_drain()` 中 `boundary_violation` 处置类型分支
  - `resolveChains()` 的 `_isChainSuccessful` 递归深度
  - `reset()` 全部清零路径

#### ❌ `composite-scheduler.ts` — **零覆盖**
- 无任何直接测试
- 虽然实现了 IScheduler 接口并与 Scheduler 全兼容，但无人测试
- **未覆盖**:
  - 构造函数三抽象组件注入
  - `executeAll()` → ILoopDriver.run() 委托
  - 默认行为与 TagMatchingStrategy/TopologicalLayeredDriver/PipelineModel 组合
  - 自定义策略/驱动/范式注入

#### ❌ `scheduling-implementations.ts` — **零覆盖**
- **未覆盖全部 6 个类**:
  - `TagMatchingStrategy` — 委托 `agent-matcher.ts`（后者有间接覆盖）
  - `RoundRobinStrategy` — 轮转调度、FIFO 命名（全部未覆盖）
  - `PriorityFirstStrategy` — 空闲 Agent 优先（全部未覆盖）
  - `TopologicalLayeredDriver` — 大量重复 Scheduler.executeAll() 逻辑（零覆盖）
  - `SequentialDriver` — 严格顺序驱动（零覆盖）
  - `WaveDriver` — 波浪式推进（零覆盖）
  - `PipelineModel` / `SimpleExecuteModel` — 执行范式实现（零覆盖）
  - `runDispatchPipeline()` 内部函数（零覆盖）

#### ❌ `scheduling-types.ts` — **N/A**
- 纯类型文件，无需测试

#### ⚠️ `agent-matcher.ts` — **中低覆盖**
- `findMatchingAgent()` 通过 scheduler 集成测试间接覆盖
- `findAllMatchingAgents()` 通过多视角测试覆盖
- **未覆盖**:
  - `TYPE_ALIASES` 别名归一化（`inspect` → `inspector`）
  - 精确类型匹配优先于 tags 打分
  - 平局密度打破中 `node.type` 精确命中加分
  - 密度计算中 `tagArr.length === 0` 边界

#### ✅ `confirm-gate.ts` — **高覆盖**
- 测试文件: `confirm-gate.test.ts`, `confirm-gate-cleanup.test.ts`, `confirm-gate-timeout.test.ts`, `confirm-gate-cli.test.ts`
- 覆盖场景：
  - L0/L1/L2/L3 确认判定
  - request → resolve 批准
  - L1/L2 超时
  - 构造函数 timeoutMs 参数
  - waitFor 超时覆盖
  - hasPending / handleTimeout
- **未覆盖**:
  - `needsConfirmation()` 的 TrustModel 集成分支（L1 + trustContext）
  - `setBridge()` 后的真实用户交互路径
  - `recordDecision()` 信任模型回写
  - `dispose()` 的 `ConfirmGateDisposedError`
  - `confirm()` 批量确认接口
  - `bypassAll()` 生产环境抛异常

#### ✅ `trust-model.ts` — **高覆盖**
- 测试文件: `trust-model.test.ts`
- 覆盖场景：
  - 冷启动 L1
  - 晋升 L1→L2→L3（连续接受）
  - 拒绝重置 + 计数归零
  - 二维隔离（不同域/不同 Agent）
  - resetAll、snapshot
  - getTrustLevelForTool 映射
  - 衰减（时间旅行模拟）
- **未覆盖**:
  - 多级衰减（多步降级，超过 7 天×N 时）
  - `_applyDecay()` 中 `lastAcceptedAt === 0` 路径
  - 超大衰减步数边界

#### ⚠️ `rlm-decompose.ts` — **低覆盖**
- 测试文件: `rlm-decompose.test.ts`（存在但未审阅全部断言）
- 通过 Scheduler + RlmExecuteStep 间接执行
- **预计未覆盖**:
  - `decompose()` 深度超限提前返回
  - `shouldDecompose()` 全部 3 条触发条件
  - `parseDecomposeResponse()` 多策略 JSON 解析
  - `shouldExecuteDecomposition()` 信心裁决
  - `buildDecomposePrompt()` 深度感知

#### ⚠️ `density-compress.ts` — **低覆盖**
- 测试文件: `density-compress.test.ts`（存在但未审阅全部断言）
- **预计未覆盖**:
  - `compressByDensity()` light/medium/heavy 全种类
  - `annotateAndCompress()` 完整 DENSITY 管线
  - `densityToStrategy()` 三级映射
  - `mergeContext()` 多结果合并
  - `compressMedium()` 结构化行保留逻辑

### 2.2 Agent 层 (src/agents/)

#### ✅ `base-agent.ts` — **中覆盖**
- 通过 `agent-pool-status-ownership.test.ts` 覆盖 setPool/wakeup/shutdown/status getter
- 通过 `scheduler.test.ts` 覆盖 execute path
- **未覆盖**:
  - `_setStatus()` 无 Pool 降级路径（已迁移至 PoolAwareState）
  - `_selectPipeline()` 策略选择（react/direct/decompose）
  - `getMemoryQuery()` CJK 2-gram 分词 + 拉丁关键词
  - `preExecuteHook()` 钩子
  - `setFilterRead()` 六层防御
  - `setSafeReporter()` 双路径注入

#### ⚠️ `butler-agent.ts` — **低覆盖**
- 测试文件: `butler-agent.test.ts`, `agent-pool-status-ownership.test.ts`（状态委托）
- 复杂的管家行为未覆盖

#### ❌ agent 配置文件 (`api-agent.ts`, `browser-agent.ts`, `data-agent.ts`, `registry.ts`) — **低/零覆盖**
- `registry.ts` 的 agentConfig/memoryQuery 导出通过 scheduler.test.ts 集成覆盖
- 但各 Agent 配置函数的完整参数表、`createAgent` 集成未逐条测试

### 2.3 组件层 (src/components/)

#### ⚠️ `agent-factory.ts` — **低覆盖**
- 通过 `createAgent()` 在集成测试中覆盖
- `AgentFactoryConfig` 选项组合未全覆盖

#### ❌ `react-loop.ts` — **低覆盖**
- 测试文件: `react-loop.test.ts`, `react-loop-canonical.test.ts`
- 通过 `BaseAgent.execute()` → `executeWithMemoryPipeline` 间接覆盖
- 独立循环边界条件未全部覆盖

#### ❌ `pool-aware.ts` — **低覆盖**
- `PoolAwareState` 通过 `base-agent.ts` 的间接触试
- 状态机 VALID_TRANSITIONS 全部路径未覆盖

#### ❌ `skill-extractor.ts`, `skill-json-validator.ts`, `skill-persister.ts`, `skill-template-engine.ts` — **低覆盖**
- 通过技能集成测试覆盖部分路径
- 独立单元测试存在但未逐条审阅

### 2.4 记忆层 (src/memory/)

#### ✅ `memory-store.ts` — **高覆盖**
- 9 个测试文件覆盖
- 写入/检索/过滤/归档/CAS/四态/关联/权重/embedding
- **全部主要路径覆盖**

#### ⚠️ 其他记忆模块 (`context-builder.ts`, `embedding.ts`, `lifecycle.ts`, `monitor.ts`, `persistence.ts`, `pipeline.ts`, `query.ts`, `schema.ts`, `skill-pipeline.ts`, `storage.ts`)
- 部分功能通过 `memory-store.test.ts` 间接覆盖
- 各模块独立边界条件未单独测试

### 2.5 治理层 (src/governance/)

#### ❌ `amendment-applier.ts` — **零覆盖**
#### ❌ `amendment-judge.ts` — **低覆盖**（测试文件存在）
#### ❌ `amendment-timeout.ts` — **低覆盖**（测试文件存在）
#### ❌ `governance-loop.ts` — **低覆盖**（测试文件存在）
#### ❌ `governance-pipeline.ts` — **零覆盖**

### 2.6 一致性层 (src/consistency/)

#### ❌ `consistency-layer.ts` — **零覆盖**
#### ⚠️ `intent-fact-wall.ts` — **低覆盖**（测试文件存在）
#### ❌ `schema-enforcer.ts` — **零覆盖**
#### ❌ `init-verifier.ts` — **零覆盖**

### 2.7 平台层 (src/platform/)

#### ✅ `toolkit.ts` — **高覆盖**
- 沙箱机制 P2-5 回归测试全覆盖
- setWorkspaceRoot、路径越界、权限拒绝

#### ✅ `file-lock-manager.ts` — **高覆盖**
- 读写锁：获取/共存/互斥/释放/全释放

#### ❌ `cli-adapter.ts` — **低覆盖**（测试文件存在）
#### ❌ `context-compressor.ts` — **零覆盖**
#### ❌ `local-tool.ts` — **零覆盖**
#### ❌ `mcp-client.ts` — **零覆盖**
#### ❌ `node-fs-adapter.ts` — **零覆盖**
#### ❌ `path-utils.ts` — **低覆盖**（测试文件 `path-safety.test.ts` 存在）
#### ❌ `search-aggregator.ts` — **零覆盖**
#### ❌ `search-backend.ts` — **零覆盖**

### 2.8 引导层 (src/bootstrap/)

#### ❌ 全部 7 个文件 — **零/低覆盖**
- `assemble.ts`, `bootstrap-engine.ts`, `create-core.ts`, `init-memory.ts`, `init-skills.ts`, `load-config.ts`, `register-agents.ts`
- `bootstrap-integration.test.ts` 存在但只覆盖基本集成路径
- 完整引导流程（含 WorkspaceRoot 越界拒绝、技能加载）未覆盖

### 2.9 插件层 (src/plugin/)

#### ❌ 全部 15 个文件 — **零覆盖**
- `plugin-loader.ts`, `register-all.ts`, `types.ts`
- 10 个插件实例文件（AgentPoolPlugin、TaskBoardPlugin 等）
- `agent-factory-registry.ts`

### 2.10 注册表层 (src/registry/)

#### ✅ `skill-registry.ts` — **高覆盖**
- 两个测试文件、30+ 测试用例
- 标签匹配/交叉匹配/评价回流/生命周期/持久化

#### ❌ `doc-registry.ts` — **零覆盖**

### 2.11 遥测层 (src/telemetry/)

#### ❌ `engine-telemetry.ts` — **零覆盖**

### 2.12 其他

#### ✅ `correct.ts` — N/A（仅导出常量，无需测试）
#### ✅ `utils.ts` — N/A（仅导出常量）

---

## 3. 测试覆盖 vs 未覆盖模块矩阵

| 模块 | 源文件数 | 有测试 | 高覆盖 | 中覆盖 | 低/零覆盖 | 覆盖率估值 |
|------|---------|-------|-------|-------|----------|-----------|
| 核心调度 (core/) | 16 | 10 | 5 | 4 | 7 | ~60% |
| Agent 层 (agents/) | 8 | 5 | 0 | 2 | 6 | ~30% |
| 组件层 (components/) | 8 | 5 | 0 | 2 | 6 | ~25% |
| 记忆层 (memory/) | 12 | 10 | 1 | 9 | 2 | ~70% |
| 治理层 (governance/) | 5 | 3 | 0 | 0 | 5 | ~15% |
| 一致性层 (consistency/) | 4 | 1 | 0 | 0 | 4 | ~10% |
| 平台层 (platform/) | 11 | 3 | 2 | 0 | 9 | ~25% |
| 引导层 (bootstrap/) | 7 | 1 | 0 | 0 | 7 | ~5% |
| 插件层 (plugin/) | 15 | 0 | 0 | 0 | 15 | ~0% |
| 注册表层 (registry/) | 2 | 1 | 1 | 0 | 1 | ~50% |
| 遥测层 (telemetry/) | 1 | 0 | 0 | 0 | 1 | ~0% |
| **总计** | **89** | **39** | **9** | **17** | **63** | **~35%** |

---

## 4. 已知未覆盖的模块/函数/分支

### P0 级（关键——业务路径缺失）

1. **CompositeScheduler + 三抽象实现** — 零覆盖
   - `composite-scheduler.ts` 全部代码
   - `scheduling-implementations.ts` 全部 6 个类 + 2 个内部函数
   - 这三套抽象是 v2.9 调度的核心扩展点，至今无一行测试

2. **ReplanManager 全部内部路径** — 低覆盖
   - `tryFireReplan()` 预算耗尽
   - `_drain()` boundary_violation 处置
   - `_drain()` 无 MetaAgent 时 `SchedulerReplanNoMetaAgent`
   - `resolveChains()` 递归 `_isChainSuccessful`
   - `isReActTimeout` 跳过

3. **MetaAgent.requestBoundaryReplan()** — 零覆盖
   - 边界违规是 P0 级安全场景，无测试

4. **Scheduler.executeAll() 全局超时** — 无直接测试
   - `Date.now() >= deadline` 分支
   - 超时后 pending 节点批量失败 + `SchedulerLoopCrashed` 事件

5. **DispatchStep 管线（ClaimStep/SpawnStep/ExecuteStep/RlmExecuteStep/CleanupStep/BoundaryGuardStep）** — 零覆盖
   - 各 Step 内部逻辑无独立测试
   - 通过 Scheduler 集成测试间接覆盖，但未覆盖异常分支

6. **`_dispatchMulti()` Agent 状态检查 + invokedBy invariant** — 未覆盖
   - `agent.status !== Awake && !== Active` 跳过
   - `resultTypes` vs `claimedBy` 不对称 check

7. **TaskBoard.removeNode()/removeSubtree()/cancel()** — 零覆盖
   - NodeRemoved 事件发射
   - BFS 子树移除 + invariant 上报
   - cancel 各状态分支

### P1 级（重要——功能边界缺失）

8. **`agent-matcher.ts` TYPE_ALIASES + 密度计算边界** — 未覆盖
   - `inspect` → `inspector` 别名
   - `tagArr.length === 0` 密度零除
   - `node.type` 精确命中加分

9. **`base-agent.ts` 模板方法** — 未覆盖
   - `_selectPipeline()` react/direct/decompose 策略
   - `getMemoryQuery()` CJK 分词
   - `preExecuteHook()` 子类钩子

10. **`confirm-gate.ts` TrustModel 集成** — 未覆盖
    - `needsConfirmation()` L1 + trustContext 路径
    - `recordDecision()` 信任模型回写
    - `dispose()` ConfirmGateDisposedError

11. **`pipeline-observer.ts` handler 异常** — 未覆盖
    - `_reportingError` 递归防护
    - `_onHandlerError` 回调
    - 连续 3+ silent 覆盖 `SILENT_UPGRADE_THRESHOLD`

12. **`meta-agent.ts` 技能增强规划** — 未覆盖
    - `setSkillRegistry()` 后 `plan()` 调用 `SkillRegistry.queryByTags()`
    - 技能模板注入 prompt 上下文

13. **`governance-loop.ts` 全部治理流水线** — 低/零覆盖

14. **`consistency-layer.ts` 六层防御** — 零覆盖
    - `filterRead()` / `filterWrite()` / schema enforcer

15. **`bootstrap-engine.ts` 完整引导流程** — 未覆盖
    - WorkspaceRoot 越界拒绝
    - MemoryStore/Scheduler/AgentPool 装配顺序

### P2 级（次要——非核心路径缺失）

16. **`agent-pool.ts` spawnSubtask / setMaxInstances / hasAwake / canSpawn / getStatuses** — 零覆盖

17. **`trust-model.ts` 多级衰减 + 边界** — 未覆盖
    - 多步降级（超过 7 天×N）
    - `lastAcceptedAt === 0` 跳过

18. **`memory-store.ts` `_deserializeRow` 全路径** — 未完全覆盖
    - 虽有余量测试（null content），但场景有限

19. **`topological-sort.ts` observer 参数边界** — 未覆盖
    - observer 为 null/undefined 时

20. **`density-compress.ts` 全部压缩策略** — 未覆盖所有文本类型
    - 纯英文、混合语言、空文本、超长文本

21. **`rlm-decompose.ts` 全部解析策略** — 未覆盖
    - 多种 JSON 格式错误修复场景

22. **全部 10 个 Plugin 实现** — 零覆盖

23. **全部 Platform 工具（MCP/Search/Adapters）** — 零覆盖

24. **`doc-registry.ts`** — 零覆盖

25. **`engine-telemetry.ts`** — 零覆盖

---

## 5. 补测优先级建议

### 🚨 第一优先级（立即补 — P0 关键路径缺失）

| 优先级 | 模块 | 建议补测内容 | 预估用例数 |
|--------|------|------------|-----------|
| **P0-1** | `CompositeScheduler` + 三抽象实现 | 基本组合测试：TagMatching + TopologicalLayered + PipelineModel（默认组合）；自定义策略注入；executeAll 委托 | 8-12 |
| **P0-2** | `ReplanManager` | 直接单元测试：enqueue 超限/跳过/预算耗尽；_drain 正常/无MetaAgent/boundary；resolveChains 递归 | 12-15 |
| **P0-3** | `MetaAgent.requestBoundaryReplan` | 边界违规场景测试：越界文件、downstream 冲突、impactScope=subtree | 4-6 |
| **P0-4** | `Scheduler` 全局超时 | 超时后 pending 批量 fail + SchedulerLoopCrashed 事件 | 2-3 |
| **P0-5** | `DispatchStep` 各 Step | ClaimStep/SpawnStep/ExecuteStep/RLMExecuteStep/CleanupStep/BoundaryGuardStep 单元测试 | 15-20 |
| **P0-6** | `TaskBoard.removeNode/removeSubtree/cancel` | 节点移除事件发射、BFS 子树移除、cancel 状态分支 | 8-10 |

### 🔴 第二优先级（重要补 — P1 功能边界缺失）

| 优先级 | 模块 | 建议补测内容 | 预估用例数 |
|--------|------|------------|-----------|
| **P1-1** | `AgentPool` 剩余方法 | spawnSubtask/setMaxInstances/hasAwake/canSpawn/getStatuses | 6-8 |
| **P1-2** | `ConfirmGate` TrustModel 集成 | needsConfirmation + trustContext；recordDecision；dispose | 5-7 |
| **P1-3** | `PipelineObserver` handler 异常 | _reportError 递归防护；onHandlerError 注入；SILENT_UPGRADE 连续计数 | 4-6 |
| **P1-4** | `BaseAgent` 模板方法 | _selectPipeline 策略选择；getMemoryQuery 分词；preExecuteHook | 6-8 |
| **P1-5** | `ConsistencyLayer` 六层防御 | filterRead/filterWrite/schemaEnforcer/initVerifier | 8-12 |
| **P1-6** | `agent-matcher.ts` 全部路径 | TYPE_ALIASES、密度零除、精确类型匹配优先 | 5-7 |
| **P1-7** | `MetaAgent` 技能增强规划 | setSkillRegistry 后 plan 结合技能模板查询 | 3-5 |

### 🟡 第三优先级（建议补 — P2 次要路径）

| 优先级 | 模块 | 建议补测内容 | 预估用例数 |
|--------|------|------------|-----------|
| **P2-1** | `rlm-decompose.ts` | shouldDecompose 全部触发条件；decompose 深度超限；parseDecomposeResponse 多策略修复 | 8-10 |
| **P2-2** | `density-compress.ts` | compressByDepth 全部 3 级；mergeContext 多结果；densityToStrategy 映射 | 6-8 |
| **P2-3** | `TrustModel` 衰减 | 多级衰减（2 步/3 步降级）；lastAcceptedAt=0 边界 | 3-5 |
| **P2-4** | Plugin 实例 | PluginLoader 加载/注册/生命周期；各 plugin 实例注册后正确性 | 10-15 |
| **P2-5** | Platform 工具 | CLIAdapter/MCPClient/SearchBackend/ContextCompressor | 12-18 |
| **P2-6** | Bootstrap 全流程 | assemble 装配顺序；bootstrapEngine 完整引导；initMemory/initSkills | 6-10 |
| **P2-7** | Governance 管线 | governance-pipeline 注册/执行/清理；amendment-applier 全部路径 | 8-12 |
| **P2-8** | `engine-telemetry.ts` | get/set/record/shutdown 遥测 | 4-6 |

---

## 6. 测试组织模式总结

### 6.1 测试分类标签

```
@ci: unit     → 纯单元测试（无 LLM 调用，无真实文件 IO），共 ~48 个文件
@ci: llm      → 含 mock LLM 调用的集成测试，共 2 个文件（meta-agent, multi-agent-collab）
(无标签)       → 系统级/压力测试，共 ~5 个文件
```

### 6.2 Mock 策略（可复用模式）

```typescript
// 模式 1: LlmAdapter.injectMock() — 注入 mock LLM 响应
const adapter = new LlmAdapter({ apiKey: "mock", baseUrl: "mock", chatModel: "mock", reasonerModel: "mock" });
adapter.injectMock(async () => ({ content: "预设产出", toolCalls: [] }));

// 模式 2: 手工 Mock Agent（实现 Agent 接口，不依赖 BaseAgent 子类）
function makeMockAgent(status: AgentStatus = AgentStatus.Awake): Agent {
  return {
    type: AgentType.Code,
    status,
    wakeup: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue({ nodeId: "n1", success: true, output: "ok" }),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

// 模式 3: makeNode() 辅助工厂 — 减少重复样板代码
function makeNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "n1", type: "code", tags: ["implementation"],
    needsMultiPerspective: false, status: "pending",
    claimedBy: [], payload: "task", results: [], createdAt: Date.now(),
    ...overrides,
  };
}

// 模式 4: ManifoldGate.reset() — 每次测试前/后清理全局单例
beforeEach(() => { ManifoldGate.reset(); });
afterEach(() => { ManifoldGate.reset(); });
```

### 6.3 暗雷测试模式（task-board-stress.test.ts 样板）

task-board-stress.test.ts 定义了 8 类"暗雷"场景，是可复用的测试设计模式：

```
R1: 并发 claim 安全性      → 同层多节点竞争
R2: 父节点失败级联         → 子节点是否跳过
R3: 重规划插入运行中层     → 动态节点不影响已有层
R5: CircuitBreaker 熔断    → N 轮重规划上限后放弃
R6: 部分层失败处理         → 同层部分失败不影响其他
R7: 多视角 spawn 失败自愈 → release 死锁回归
R8: claim-release 竞态压测 → 高频循环无僵尸节点
R9: MemoryStore CAS 并发   → peek 冻结 + CAS 原子性
```

### 6.4 覆盖率缺口分析模式

当前测试存在明显的"头重脚轻"现象：

- **核心调度层**（Scheduler/TaskBoard/AgentPool/PipelineObserver/topologicalSort/confirmGate/trustModel）覆盖率约 60-80%
- **组合调度层**（CompositeScheduler 三抽象）覆盖率 **0%**
- **基础设施层**（Bootstrap/Plugin/Platform/Governance/Consistency）覆盖率 **5-25%**

根本原因：早期开发集中在核心调度逻辑（解决了 P0 级 bug 后积累了测试），而 v2.9 新增的组件化调度、v3.1 插件体系、六层防御等模块未同步补测。

### 6.5 Skill Template（可复用测试模式）

```json
{
  "name": "调度模块测试脚手架",
  "trigger": "当需要为 Scheduler/TaskBoard/AgentPool 编写单元测试时",
  "steps": [
    "1. 使用 makeNode() 工厂创建测试节点",
    "2. 使用 makeMockAgent() 或 LlmAdapter.injectMock() 注入 mock Agent",
    "3. 在 beforeEach 中创建 board/pool/observer/scheduler，调用 ManifoldGate.reset()",
    "4. 在 afterEach 中清理全局状态",
    "5. 遵循 AAA（Arrange-Act-Assert）结构编写用例",
    "6. 对 scheduler 集成测试使用 observer 监听事件流验证行为"
  ],
  "triggerTags": ["test", "scheduler", "coverage"],
  "kind": "thought"
}
```

---

> **分析结论**: 当前引擎测试覆盖约 **35%** 的源代码。核心调度路径（~60%）基本可靠，但三抽象组合调度（0%）、插件体系（0%）、治理层（15%）、一致性层（10%）存在严重覆盖缺口。建议优先补 P0 级的 6 个模块（约 45-66 个用例），可将整体覆盖率提升至约 50%。

```json
{
  "skillTemplate": {
    "name": "测试覆盖率分析与补测规划",
    "trigger": "当需要系统分析模块测试覆盖缺口并制定补测计划时",
    "steps": [
      "1. 收集所有测试文件（list_files tests/）和源文件（list_files src/）",
      "2. 按目录 / 模块分类源文件，标注每个模块的测试文件",
      "3. 逐模块审阅测试内容，区分高/中/低/零覆盖",
      "4. 识别未覆盖的关键路径（按 P0/P1/P2 分级）",
      "5. 估算每个模块补测用例数，按优先级排序",
      "6. 生成覆盖率矩阵和补测建议",
      "7. 记录可复用的测试模式（mock 策略、工厂函数、暗雷场景等）"
    ],
    "triggerTags": ["test", "coverage", "analysis"],
    "kind": "thought",
    "expectedOutput": "TEST_COVERAGE.md 文件，包含全景清单、逐模块分析、未覆盖清单、补测优先级",
    "discoveredBy": "task-1780942188856-4-0 (analysis)"
  }
}
```
