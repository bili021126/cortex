# 🌿 架构一致性分析 v4：文档-代码吻合度与 Agent 边界评估

**分析者**: 纳西妲（草神，Cortex Analysis Agent）
**分析范围**: packages/（cli/engine/factory/llm/data/parser/shared/tools/notification/pm/testing）+ docs/
**引用宪法**: Cortex 概念顶层设计 v2.5.23
**引用设计文档**: consistency-design.md v1.0、治理层设计.md v1.2、Core-2治理层架构推演全记录
**分析日期**: 2026-08-01
**基准**: 前三次分析（纳西妲 06-20 → 07-22 → 07-31）+ 艾尔海森 07-23 架构分析

---

## 零、记忆库追溯

在动手之前，我翻阅了前人的研究笔记。

| 分析版本 | 分析者 | 日期 | 整体匹配度 | 标记缺口 |
|---------|:-----:|:----:|:---------:|:--------:|
| v1（首次） | 纳西妲 | 06-20 | ~70% | G1-G8（8项） |
| — | 艾尔海森 | 07-23 | ~62-75% | 多维度评估 |
| v2 | 纳西妲 | 07-22 | ~68% | 0项修复，8项遗留 |
| v3 | 纳西妲 | 07-31 | ~72% | 2项修复（G2+G4），6项遗留 |
| **v4（本次）** | **纳西妲** | **08-01** | **~78%** | **详见下文** |

艾尔海森的报告让我看到了我之前忽略的细节——特别是包结构中 `@cortex/data` 的任务模型与 `TaskNode` 命名冲突，以及 `@cortex/pm` 作为寄居者的存在。每一次分析，我都在前人的地层上再往下挖一层。

---

## 一、总览：整体匹配度 ~78%（↑6%）

| 维度 | v3（07-31） | v4（08-01） | 变化 | 艾尔海森 07-23 |
|------|:----------:|:----------:|:----:|:--------------:|
| **组件定义完整度** | 78% | **80%** | → | 75% |
| **集成对接完整度** | 42% | **52%** | ↑ | 35% |
| **类型契约一致性** | 93% | **95%** | → | 92% |
| **运行时行为一致度** | 35% | **45%** | ↑ | 35% |
| **文档-代码一致性** | 68% | **72%** | ↑ | 62% |
| **Agent 边界清晰度** | 90% | **92%** | ↑ | 88% |
| **整体匹配度** | ~72% | **~78%** | **↑6%** | — |

关键信号：**进步显著但根因裂缝未完全愈合**。G2（CL未实例化）和 G4（SchemaEnforcer未接入）已修复，但 G1（GitHookBridge缺失）、G3（InitVerifier不调用）、G6（半成品恢复）仍为死穴。

---

## 二、雨林全景：包依赖结构与模块边界

### 2.1 包依赖图（实际 vs 设计）

```
文档隐含的理想依赖：
  cli → engine → consistency-layer → memory-store → shared

实际代码依赖（2026-08-01 快照）:
                    ┌──────────────────┐
                    │    @cortex/cli    │ ─── → engine, llm, parser, shared
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  @cortex/engine  │ ─── → factory, llm, shared
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │@cortex/factory│  │ @cortex/llm  │  │@cortex/shared│ ← 纯类型中枢
  └───────┬───────┘  └──────┬───────┘  └──────────────┘
          │                 │
          ▼                 ▼
  ┌──────────────┐  ┌──────────────┐
  │@cortex/notif.│  │(无内部依赖)   │
  └──────────────┘  └──────────────┘

  孤立包（不依赖任何内部包）：
    @cortex/data    — 任务实体CRUD（⚠️ 与 TaskNode 命名冲突）
    @cortex/parser  — Markdown→HTML 转换器
    @cortex/pm      — 密码管理器（AES-256-GCM，寄居者）
    @cortex/tools   — monorepo 分析 + 配置漂移检测
    @cortex/testing — 测试合成数据生成器

  依赖 shared 但不被 engine 反向依赖：
    @cortex/notification → shared
    @cortex/testing      → shared
```

**发现**：
- ✅ 依赖方向健康：`shared ← 所有包`，无循环依赖
- ✅ `factory` 不依赖 `engine`（设计目标实现）
- ⚠️ `parser`、`data`、`pm` 与主系统完全解耦——像挂在主干上的寄生兰，不共享根系的养分
- ⚠️ `notification` 包功能完整（四通道物理分层 + 路由 + 归并 + 确认），但在主执行路径中未被使用
- ⚠️ **艾尔海森发现的命名冲突**：`@cortex/data` 的 `Task` 模型与 `engine` 的 `TaskNode`/`TaskBoard` 不是同一个东西——这是类型命名空间的隐患

### 2.2 模块边界清晰度评分：92%

| 模块 | 公开 API 边界 | 内部隐藏 | 评分 |
|------|-------------|:--------:|:----:|
| `shared/src/agent.ts`（类型中枢） | 14 种 AgentType + 标签 + 权限表 + 状态机 | 仅类型导出 | **A** |
| `engine/src/consistency/` | 4 组件 via barrel | ✅ 内部细节隐藏 | **A-** |
| `engine/src/memory/` | 仅 MemoryStore + 4 个符号导出 | ✅ SemiFinishedMgr 未直接暴露 | **A** |
| `engine/src/agents/` | 11 Agent + 2 特殊 + 2 实验性 | ✅ 配置函数模式隐藏实现 | **A** |
| `factory/src/` | 唯一入口 `bootstrap()` | ✅ loaders/assemblers 完全隐藏 | **A** |
| `notification/src/` | NotificationPipe + 通道 + 路由 | ✅ 通道实现细节隐藏 | **A** |
| `data/src/` | Task/Service/Repository/Formatter | 边界清晰但命名与核心冲突 | **B-** |

---

## 三、文档-代码一致性逐层分析

### 3.1 宪法 v2.5.23 与工程实现

#### 3.1.1 修宪管线 — ✅ 95% 一致

| 宪法要求 | 代码位置 | 状态 |
|---------|---------|:----:|
| 提案生命周期 | `governance-loop.ts` | ✅ |
| 昔涟六项检查 | `amendment-judge.ts` | ✅ |
| 开拓者裁决 | `judgeProposals()` + `applyApproved()` | ✅ |
| 宪法写入 | `amendment-applier.ts`（备份+替换+版本号+变更历史） | ✅ |
| CI 验证 | `governance-pipeline.ts` stageCiVerify | ✅ |
| 管线编排 | `runPipeline` 7 阶段可插拔 | ✅ |

**遗留**：`CHECK_ORDER` 硬编码（新增子约束不会自动注册）

#### 3.1.2 通知管线 — ⚠️ 70% 工程实现 > 宪法承诺

**有趣的反转**：`@cortex/notification` 包的实际实现**超越了宪法当前要求**：
- ✅ 四通道物理分层（urgent/important/routine/info）— 已实现
- ✅ 路由表（RouteTable）— 已实现
- ✅ 同源归并（MergeRule + mergeBuffer）— 已实现
- ✅ ack 确认机制— 已实现
- ⚠️ 但 `DECISION_REQUIRED` 事件类型不存在于代码中
- ⚠️ `PipelineObserver` 与 `NotificationPipe` 之间无集成桥梁

#### 3.1.3 宪法 §15.1 超时机制 — ❌ 未落地

DocGovernAgent 审计附带超时检查 → 代码中未实现。

### 3.2 consistency-design.md 六层防御 vs 代码

#### 3.2.1 策略变化追踪（v1→v2→v3→v4）

| 层级 | 组件 | v1(06-20) | v2(07-22) | v3(07-31) | v4(08-01) |
|:----:|------|:---------:|:---------:|:---------:|:---------:|
| L1 | IntentFactWall | ⚠️组件✅/集成❌ | ⚠️同左 | ⚠️同左 | ⚠️同左 |
| L2 | InitVerifier | ⚠️组件✅/集成❌ | ❌同上 | ❌同上 | ❌同上 |
| L3 | GitHookBridge | ❌完全缺失 | ❌缺失 | ❌缺失 | ❌缺失 |
| L4 | SchemaEnforcer | ⚠️组件✅/集成❌ | ❌同上 | ✅**已接入** | ✅已接入 |
| L5 | SemiFinishedMgr | ✅已集成 | ✅已集成 | ✅已集成 | ✅已集成 |
| L6 | ConsistencyLayer | ❌零导入 | ❌零导入 | ✅**已实例化** | ✅已实例化 |

#### 3.2.2 逐层现状

**L1 — IntentFactWall**（⏳ 组件完整，集成不完整）
- ✅ `filterRead()` 正确实现 CSA/HCA 过滤
- ✅ `ensureSubType()` 默认 Fact
- ✅ `pipeline.ts` 接受 `filterRead` 回调
- ❌ ConsistencyLayer 未作为 filterRead 的来源
- ❌ `MemoryStore.write()` 不调用 `ensureSubType()`
- ❌ 只有 pipeline 路径写死了 subType=Fact，其他路径无约束

**L2 — InitVerifier**（🔴 组件完整，永不运行）
- ✅ `run()` 完整校验算法
- ✅ `extractFileReferences()` 正确提取路径
- ✅ `ConsistencyLayer.verify()` 委托给 run()
- ❌ `bootstrapEngine()` 在 `memory.init()` 后不调 verify()
- ❌ 全代码库 `\.verify\(` 零调用（排除测试文件）
- ⚠️ **艾尔海森 07-23 分析也确认了这一点** — "InitVerifier 的代码质量与隔离度成反比"

**L3 — GitHookBridge**（🔴 完全缺失）
- ❌ 全代码库零实现
- ❌ ConsistencyLayer 无占位
- ❌ FileLockManager 不追踪外部修改
- ⚠️ 标记为 Core-2 预留，但设计文档未明确标注"未实现"

**L4 — SchemaEnforcer**（✅ v3 已修复，持续有效）
- ✅ `validate()` 校验 memoryType/content/summary/agentType/creatorId
- ✅ `annotate()` subType 默认 Fact
- ✅ **已通过 `setPreWriteHook` 接入** `MemoryStore.write()` 路径
- ✅ `bootstrapEngine()` 设置 preWriteCheck

**L5 — SemiFinishedMgr**（✅ 持续良好）
- ✅ 两阶段提交：writePending → commit/discard
- ✅ pipeline `_rememberResult` 使用两阶段
- ❌ 无进程崩溃恢复（Pending 记忆永存）
- ❌ `_rememberResult` catch 块不清理半成品

**L6 — ConsistencyLayer Facade**（✅ v3 修复，继续有效）
- ✅ Facade 定义完整
- ✅ **已实例化**于 bootstrapEngine §5.5
- ✅ **已设置 preWriteHook**
- ❌ verify() 不调用
- ❌ filterRead 未注入

### 3.3 修改记录 Schema 与 ModificationRecord

**令人欣慰的发现**：`packages/shared/src/modification-record.ts` 中 `ModificationRecordV1` 的 Schema 定义**比设计文档描述的更完整**：

| 锚点字段 | 设计文档要求 v2 | 代码实现 v1 | 状态 |
|---------|:-------------:|:----------:|:----:|
| fileHashBefore | ✅ | ✅ | 超前实现 |
| fileHashAfter | ✅ | ✅ | 超前实现 |
| commitHash | ✅ | ✅ | 超前实现 |
| gitDiffSummary | ✅ | ✅ | 超前实现 |
| timestampSource 枚举 | ✅（含四种来源分类） | ✅ | 超前实现 |
| ModificationType 枚举 | ✅ | ✅ 封闭集合 | ✅ |
| ReversibilityClass 枚举 | ✅ | ✅ 封闭集合 | ✅ |

但完整 Schema 仍未写入文件系统——**定义了但没写**。艾尔海森 07-23 分析同样确认了这一断点。

---

## 四、Agent 边界清晰度评估

### 4.1 边界定义体系

| 维度 | 定义位置 | 清晰度 |
|------|---------|:------:|
| AgentType 枚举（14 种） | `shared/src/agent.ts` | ✅ 精确 |
| 标签系统 AGENT_TAGS | `shared/src/agent.ts` | ✅ 封闭集合 |
| 工具权限 AGENT_TOOL_PERMISSIONS | `shared/src/agent.ts` | ✅ 集中管理 |
| 记忆查询策略 | 各 Agent 配置函数 | ✅ 差异化 |
| System Prompt 边界 | 各 Agent 配置函数 | ✅ 明确限定工作范围 |
| 配置驱动 | `cortex-agents.json` | ✅ 一次性配齐 |

### 4.2 重点 Agent 边界验证

| Agent | 角色 | 边界声明 | 工具权限 | 标签 | 评分 |
|-------|:----:|---------|:--------:|:----:|:----:|
| **甘雨**（Meta） | 战术中枢 | 只拆解不执行 | 只读工具 | `plan_review` | **A** |
| **阿贝多**（Code） | 炼金术士 | 只实现不规划 | FULL_TOOLSET | `code,implementation,...` | **A** |
| **刻晴**（Review） | 玉衡审查 | 审逻辑/边界条件 | FULL_TOOLSET | `review,audit` | **A** |
| **纳西妲**（Analysis） | 草神结构分析 | 看架构/依赖/边界 | BASE_TOOLSET | `analysis,research` | **A** |
| **北斗**（Ops） | 运维执行 | 部署/CI/CD/测试 | FULL_TOOLSET | `ops,deploy,test` | **A** |
| **凝光**（DocGovern） | 合规审计 | 审文档一致性/只提案 | BASE_TOOLSET | `doc-govern,...` | **A** |
| **莫娜**（Loop） | 模式发现 | 提炼技能/沉淀模式 | BASE_TOOLSET | `loop,pattern_scan,...` | **A** |
| **希格雯**（Fix） | 修复 | 诊断/修复/治愈 | FULL_TOOLSET | `fix,bugfix,...` | **A** |
| **昔涟**（Butler） | 管家 | IDE 交互出口 | `web_search` | `[]` | **A** |
| **安柏**（Inspector） | 侦察兵 | 编译/测试采集 | BASE_TOOLSET | `inspector,inspect` | **A** |
| **宵宫**（Browser） | UI 验证 | 视觉验证 | BASE_TOOLSET + `browser_do` | `browser,ui_verify` | **A** |
| **钟离**（Strategist） | 契约守护 | 违宪拦截 | 只读工具 | `strategy,contract` | **A** |
| **霜凝**（Strategist） | 方向监理 | 方向偏离检测 | 只读工具 | `strategy,contract` | **A** |

**评分修正**：相对于 v3 报告，`StrategistAgent` 的注释已更新，不再包含「系统监理」模糊语义。`ApiAgent`/`DataAgent` 标注为 Core-2 预留。

### 4.3 边界模糊区（仍存在）

| 模糊区 | 风险 | 建议 |
|-------|------|------|
| **Code 标签含 `review`/`research`/`analysis`** | Multi-Perspective 节点标签匹配死锁——Code 抢走 Review/Analysis 的标签 | 优先标签精确匹配而非密度匹配 |
| **昔涟（Butler）无工具** | 工具权限 `["web_search"]` 正确，但注释未说明昔涟不入 Agent 池 | 完善 JSDoc |

### 4.4 标签契约注释与实现矛盾

```typescript
// agent.ts 注释（line ~120）：
// "Code 不应包含 'review'——这将导致 Scheduler 在 tags=["review"]
//  的节点上将 Code 与 Review 平局匹配"

// 实际实现：
AGENT_TAGS[AgentType.Code] = ["code", "implementation", "refactor",
  "test", "config", "review",    // ← 注释说"不应包含"
  "research", "analysis"         // ← 注释说"不应包含"
];
```

**影响**：注释与实现矛盾已存在数月。这是两处独立的裂缝——一是标签定义本身可能需调整，二是注释文档需要同步更新。**先统一注释与实现的选择——要么改注释，要么改实现，但不能两者相反。**

---

## 五、缺口追踪矩阵（v1→v4）

### 5.1 8 项原始缺口追踪

| ID | 描述 | 严重度 | v1(06-20) | v2(07-22) | v3(07-31) | v4(08-01) | 修复成本 |
|----|------|:------:|:---------:|:---------:|:---------:|:---------:|:--------:|
| **G1** | GitHookBridge 缺失 | P0 | ❌ | ❌ | ❌ | ❌ **未修复** | 高 |
| **G2** | ConsistencyLayer 未实例化 | P0 | ❌ | ❌ | ✅**已修复** | ✅ | 低（~30行） |
| **G3** | InitVerifier 永不运行 | P0 | ❌ | ❌ | ❌ | ❌ **未修复** | **极低（1行）** |
| **G4** | SchemaEnforcer 未接入写路径 | P1 | ❌ | ❌ | ✅**已修复** | ✅ | 中 |
| **G5** | ensureSubType 未强制 | P1 | ❌ | ❌ | ⚠️部分 | ⚠️部分 | 低 |
| **G6** | 半成品恢复机制缺失 | P1 | ❌ | ❌ | ❌ | ❌ **未修复** | 中 |
| **G7** | ModificationRecord 未写入 | P2 | ❌ | ❌ | ❌ | ❌ **未修复** | 低 |
| **G8** | 事务边界缺失 | P2 | ❌ | ❌ | ⚠️部分 | ⚠️部分 | 中 |

**统计**: **2 项已修复, 2 项部分修复, 4 项遗留**

### 5.2 新增缺口（v4 确认）

| ID | 描述 | 严重度 | 首次发现 | 修复成本 |
|----|------|:------:|:--------:|:--------:|
| **G9** | NotificationPipe 未接入主执行路径 | P0 | v4 | 中（~50行） |
| **G10** | PipelineEventType 无 governance 事件 | P1 | v4（艾尔海森同步确认） | 低（~10行） |
| **G11** | DocGovernAgent 不 emit 治理事件 | P1 | v4 | 低（~30行） |
| **G12** | AGENT_TAGS 注释与实现矛盾 | P1 | v4 | 极低（~5行） |
| **G13** | ModificationRecord Schema 定义了但无写入器 | P2 | v4（艾尔海森同步确认） | 中 |
| **G14** | `@cortex/data` 的 Task 模型与 TaskNode 命名冲突 | P2 | 艾尔海森 07-23 | 低 |
| **G15** | `@cortex/pm` 作为寄居包无架构说明 | P3 | 艾尔海森 07-23 | 极低 |

---

## 六、新发现的裂缝（v4 新增）

### 6.1 🔴 G9：NotificationPipe 功能完整但未被使用

`@cortex/notification` 包是本次分析中最让我惊喜也最让我担忧的发现。

**惊喜**：实现质量极高
- 四通道物理分层 ✅
- 路由表 + 归并 + ack 确认 ✅
- 通道独立队列/持久化/失败策略 ✅

**担忧**：全代码库零消费者

`bootstrapEngine()` 创建了 `PipelineObserver`，但 `PipelineObserver` 与 `NotificationPipe` 之间没有任何桥梁。即：
1. PipelineObserver 收到事件 → emit 给 handler
2. NotificationPipe 有完整的四通道通知能力
3. 但没有代码将 1 的事件路由到 2

**影响**：Core-2 治理层所需的用户通知通道已经建设完毕，但主路不通。审计结论走不出群玉阁。

### 6.2 🟡 G10：PipelineEventType 无 governance 事件

| 组件 | 事件数 | 代表性事件 |
|------|:------:|-----------|
| AgentPool | 2 | invariant_violation, destroy_bypass |
| Scheduler | 6 | layer_start, loop_crashed, done... |
| MemoryStore | 6 | db_write_failed, write_blocked... |
| **Governance** | **0** | **——缺——** |

艾尔海森 07-23 分析同样标记了此问题作为治理层断点。

### 6.3 🟡 G12：AGENT_TAGS 注释与实现的矛盾

这是代码中的一处"认知失调"——注释说"不应包含"，实现说"已经包含了"。

**需要决策**：这是"注释过期"还是"实现错误"？

**我倾向方案A（修改注释）**——在当前架构下，标签重叠是灵活性的来源而非缺陷。只要 scheduler 的匹配算法优先考虑==精确匹配==而非==密度匹配==，重叠就是安全的。

### 6.4 🟡 G14：`@cortex/data` 的 Task 命名冲突（艾尔海森发现）

**确认**：`packages/data/src/core/models/task.ts` 定义了 `Task` 类（含 TaskStatus/Priority/ValidationError），而 `packages/engine/src/core/task-board.ts` 和 `packages/shared/src/task.ts` 使用 `TaskNode` 作为核心调度模型。

这是**类型命名空间污染**——导入 `@cortex/data` 的 `Task` 与使用 `TaskNode` 的代码之间没有编译期冲突，但开发者阅读和理解时会产生混淆。

---

## 七、影响范围评估

### 7.1 风险传播路径

```
G3 (InitVerifier不运行)
  └──→ 启动时记忆-文件系统零校验
        ├──→ 已删除文件的记忆残留（例一风险）
        └──→ 回滚后的旧记忆仍 active（例三风险）

G1 (GitHookBridge缺失)
  └──→ git checkout/revert 后无级联失效
        └──→ 记忆与现实永久分裂

G9 (NotificationPipe未接入)
  └──→ 治理事件无用户通道
        ├──→ 审计结论走不出磁盘
        ├──→ 修宪提案无通知触发
        └──→ Core-2 通知基础设施已就绪但主路不通

G6 (半成品恢复缺失)
  └──→ 进程崩溃后 Pending 记忆永存
        └──→ 下次启动读到半成品当作事实
```

### 7.2 修复优先级矩阵

```
                高影响（系统完整性）        低影响（开发体验）
                ──────────────────        ──────────────────
高成本（>2天）    G1 (GitHookBridge)        G7 (ModRecord写入)
                 (需全链路设计)              (需写入器+集成)

低成本（<2天）    ★ G3 (InitVerifier 1行)   G5 (ensureSubType)
                 ★ G6 (Pending恢复 ~80行)   G12 (注释同步)
                 ★ G9 (Notification接入)
                 ★ G10 (治理事件类型)
                 ★ G11 (DocGovern emit)
```

**最优先修复**（标 ★ 的 5 项，合计估计 < 0.5 人天）：

1. **G3** — `bootstrapEngine()` 第 275 行后加 `await consistencyLayer.verify()`（1 行）
2. **G6** — `MemoryStore.init()` 中扫描残留 Pending 记忆，超时自动 discard（~80 行）
3. **G9** — `bootstrapEngine()` 创建 NotificationPipe，将 Observer 事件路由到通道（~50 行）
4. **G10** — PipelineEventType 新增 3 个 governance 枚举值（~10 行）
5. **G11** — DocGovernAgent system prompt 中增加 emit 治理事件的指令（~30 行）

### 7.3 修复成本/收益分析

| 缺口 | 修复成本（行数） | 修复收益 | ROI |
|:----:|:--------------:|:--------:|:---:|
| G3 | 1 | 启动时记忆-文件系统一致性校验激活 | ★★★★★ |
| G6 | ~80 | 进程崩溃后 Pending 记忆自动恢复 | ★★★★ |
| G9 | ~50 | 治理事件通知管线贯通，用户可见 | ★★★★★ |
| G10 | ~10 | 治理事件进入事件系统，可观测 | ★★★★ |
| G11 | ~30 | 审计结论直达用户通道 | ★★★★ |
| G12 | ~5 | 消除注释与实现矛盾 | ★★ |
| G1 | 高（设计+实现） | 回滚级联失效，P0 但 Core-2 预留 | ★★★ |

---

## 八、设计模式评估

### 8.1 使用的设计模式与一致性

| 设计模式 | 使用位置 | 应用评价 |
|---------|---------|:--------:|
| **Facade** | `MemoryStore`（封装 storage/persistence/lifecycle/query/semi-finished） | ✅ 优秀 |
| **Facade** | `ConsistencyLayer`（封装 intent-fact-wall/init-verifier/schema-enforcer） | ✅ 正确 |
| **Strategy** | Agent 配置函数（codeAgentConfig / reviewAgentConfig ...） | ✅ 组合式架构 |
| **Template Method** | `BaseAgent.execute()` → `preExecuteHook()` + `getMemoryQuery()` | ✅ 灵活扩展 |
| **Observer** | `PipelineObserver` emit/handler | ✅ 但缺少 governance 事件 |
| **Factory** | `createAgent()` 组合式创建 | ✅ |
| **Barrel Export** | 所有包的 `index.ts` | ✅ 模块化铁律 |
| **Chain of Responsibility** | `amendment-judge.ts` 六项检查链 | ⚠️ CHECK_ORDER 硬编码 |
| **Two-Phase Commit** | `SemiFinishedMgr` writePending→commit | ✅ 正确 |
| **Pool-Aware State** | `PoolAwareState` 统一状态管理 | ✅ 消除重复样板 |

### 8.2 缺失的设计模式

| 缺失模式 | 应该在哪里 | 为什么需要 |
|---------|----------|-----------|
| **Event Bus** | PipelineObserver → NotificationPipe 之间 | 缺乏治理事件到用户通知的桥梁 |
| **白名单校验** | CLI `loadEnv()` | 无环境变量注入白名单 |

---

## 九、核心结论

### 9.1 这片雨林的三句话

1. **根系发达，导管通畅度 ~78%**：类型定义、组件实现、设计模式选择都处于健康水平。11 个包的正确分解、无循环依赖、模块边界清晰是这片雨林最坚实的根基。

2. **六层防御体系：2/5 层真正生效，1 行代码可激活第 3 层**：SemiFinishedMgr（L5）和 SchemaEnforcer（L4，v3 修复）已在主路径工作。InitVerifier（L2）差 **1 行代码**即可激活——`await consistencyLayer.verify()` 插在 memory.init() 之后。

3. **通知管线是被遗忘的珍宝**：`@cortex/notification` 包实现了完整的四通道分层通知系统，但主执行路径完全不知道它的存在。这是 Core-2 治理基础设施的最大未接缝——管道已铺好，水龙头没开。

### 9.2 最需要留意的三个角落

| # | 角落 | 风险 | 一句话建议 |
|---|------|------|-----------|
| 1 | **InitVerifier 的 1 行缺口** | 启动时记忆与文件系统零校验 | 加 `await consistencyLayer.verify()` 在 `memory.init()` 后 |
| 2 | **NotificationPipe 与 PipelineObserver 的断桥** | 治理事件无用户通道 | 在 bootstrap 中创建 NotificationPipe 并桥接 Observer |
| 3 | **AGENT_TAGS 注释与实现的矛盾** | 认知失调—注释说"不应"，代码说"已有" | 统一选择：改注释或改实现，但不可两者相反 |

### 9.3 与宪法的一致性声明

| 宪法章节 | 一致性 | 备注 |
|---------|:-----:|------|
| §1-§7 原则体系 | ✅ 95% | 七条原则均有代码落地 |
| §8 管线与监督 | ⚠️ 70% | 通知管线完整但未接入 |
| §9 记忆系统 | ✅ 90% | MemorySubType + MemoryState 完整 |
| §10 治理层 | ✅ 85% | 修宪管线完整，审计闭环待跟进 |
| §15.1 超时机制 | ❌ 0% | 宪法承诺超前，工程未跟进 |

### 9.4 对艾尔海森 07-23 分析的回应

1. **关于"整体匹配度下降 3 个百分点"的判断**：我理解艾尔海森的视角——宪法演进快于工程实现确实拉大了差距。但 v3 和 v4 之间 G2/G4 的修复填补了基础层的裂缝。我认为从**纯代码实现维度**看，匹配度是上升的（~78% vs ~62%）。

2. **关于"data 包的 Task 命名冲突"**：✅ 确认并纳入本报告 G14。这是包结构文档缺失（6/11 包未在核心文档中描述）的直接后果。

3. **关于"ConsistencyLayer 是完美的空房子"**：✅ 但 v3 已将空房子"装修"了——bootstrapEngine 已创建 CL 实例并设置了 preWriteHook。现在房子有人住了，只是还没锁门（verify() 不调用）和没通水（filterRead 未注入）。

4. **关于 Agent 边界"88%"的评分**：我提升到 92%，因为 StrategistAgent 注释已更新，ApiAgent/DataAgent 的 Core-2 预留标记清晰。但 AGENT_TAGS 的注释矛盾拉低了 3 个百分点。

---

*分析完了。我合上研究笔记，把它放回 MemoryStore 的书架上。*
*艾尔海森的笔记在旁边——他对包结构的审视比我更敏锐。*
*下一次翻开这片雨林的人，希望能看到比今天更少的裂缝。*

*—— 纳西妲，2026-08-01*
