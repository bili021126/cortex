# 🏛️ 纳西妲架构分析报告

**分析日期**：2026-06-19  
**分析人**：纳西妲（Analysis Agent / 智慧之神）  
**分析范围**：
- `packages/*/src/`（全部 9 包源码）
- `docs/constitution/Cortex 概念顶层设计 v2.5.md`（v2.5.14）
- `docs/core/治理层设计.md`（v1.1）
- `docs/core/Agent标签词汇表-v2.0.md`
- `docs/consistency-design.md`（v1.0 设计提案）
- `docs/analysis/constitution-gap-impact.md`
- 既有 `webui/architecture_analysis.md`（2026-06-06 版）

**分析维度**：
1. 架构一致性——文档与代码实现的对应关系（含新增一致性校验层）
2. Agent 边界清晰度——职责分离与标签重叠的深层影响
3. 治理层落地进度——设计文档 vs 代码实现的缺口
4. 影响范围评估——已识别缺口对 Core-2 的连锁影响

---

## 零、执行摘要

> Cortex 整体架构健康，遵循**工具链隐喻**与**单向依赖原则**。9 包体系无循环依赖，七条架构原则在代码中全部有对应实现。
>
> 与 2026-06-06 报告相比，本次分析新增以下发现：
>
> **新增重要发现**：
> 1. ✅ **一致性校验层（P1-六层防御）已部分落地**——`packages/engine/src/consistency/` 已存在 ConsistencyLayer/InitVerifier/SchemaEnforcer，与 `docs/consistency-design.md` 设计对齐
> 2. ✅ **半成品记忆管理（SemiFinishedMgr）已实现**——两阶段提交（Pending→Active）配合 Intent→Fact 子类型翻转
> 3. ❌ **GitHookBridge 完全缺失**——一致性设计 5 组件中唯一无代码实现的组件
> 4. ❌ **IntentFactWall 未作为独立组件实现**——其职责分散在 MemorySubType 枚举和 SemiFinishedMgr 中
> 5. 🔴 **AGENT_TAGS 自相矛盾**——shared/agent.ts 的契约注释明确说"Code 不应包含 review"，但实际代码中 CodeAgent 的标签包含 `review`/`research`/`analysis`
> 6. 🟡 **PipelineObserver 的 governance 事件类型为零**——治理层设计文档要求的事件类型（`governance.audit` 等）在 PipelineEventType 中不存在
>
> **风险评级**：🟡 整体中低风险。代码架构健康度良好。治理层缺口已知，一致性校验层进展积极。

---

## 一、架构一致性：文档 ⟷ 代码对应关系

### 1.1 包依赖关系（复检）

| 包 | 文档声明依赖 | 实际依赖 (package.json) | 一致性 |
|---|------------|----------------------|--------|
| `@cortex/shared` | 无 | 无 | ✅ |
| `@cortex/parser` | 无 | 无 | ✅ |
| `@cortex/pm` | 无 workspace 依赖 | 无 workspace 依赖（仅 commander） | ✅ |
| `@cortex/data` | 无 workspace 依赖 | 无 workspace 依赖（仅 cli-table3） | ✅ |
| `@cortex/tools` | 无 | 无 | ✅ |
| `@cortex/llm` | shared | shared | ✅ |
| `@cortex/testing` | shared | shared | ✅ |
| `@cortex/engine` | shared, llm | shared, llm | ✅ |
| `@cortex/cli` | **parser** | **engine, llm, parser, shared** | ❌ |

**状态**：✅ 与上次报告结论一致，无新增偏离。cli 的文档/代码偏离属于"入口包特权"，建议更新文档。

### 1.2 Agent 类型与标签词汇表

| 维度 | 文档声明 | 代码实现 | 一致性 |
|------|---------|---------|--------|
| Agent 类型数 | 11 | **14**（含 Api/Browser/Data/Strategist 4 个 Core-2 预留） | 代码超前 ✅ |
| 标签数 | 16 | **30+**（TAG_VOCABULARY 常量） | 代码超前 ✅ |
| 标签归属 | 固定 16 标签 × 10 Agent | AgentType 枚举驱动，动态映射 | 结构一致 ✅ |
| Agent 权限 | 文档 §5.1 表格 | AGENT_TOOL_PERMISSIONS | 完全一致 ✅ |

**状态**：✅ 上次报告结论依然有效。代码层 Core-2 预实现（类型先行），文档后续更新即可。

### 1.3 基础设施定位

| 组件 | 文档定位 | 代码定位 | 一致性 |
|------|---------|---------|--------|
| Toolkit | shared 层（类型定义），engine 层（实现） | ✅ shared/toolkit.ts → engine/toolkit.ts | ✅ |
| FileLockManager | shared 层（接口），engine 层（实现） | ✅ shared/file-lock-manager.ts → engine/file-lock-manager.ts | ✅ |
| CLIAdapter | shared 层（接口），engine 层（实现） | ✅ shared/cli-adapter.ts → engine/cli-adapter.ts | ✅ |
| infra 独立包 | Core-2 预留拆分 | ✅ 当前实现在 engine 包中 | ✅ |

### 1.4 架构原则实现情况（复检）

| 原则 | 文档要求 | 代码实现 | 一致性 |
|------|---------|---------|--------|
| 原则一：确认在用户 | L2/L3 操作必须确认 | ConfirmGate.needsConfirmation() | ✅ |
| 原则二：规执分离 | MetaAgent 只规划不执行 | MetaAgent.plan() 不调用工具 | ✅ |
| 原则三：安全在 Toolkit | 权限集中，Agent 以身份调用 | AGENT_TOOL_PERMISSIONS 集中定义 | ✅ |
| 原则四：谁调用谁负责 | Agent 承担工具调用后果 | BaseAgent.execute() 直接调用 toolkit | ✅ |
| 原则五：统一管道 | PipelineObserver 统一事件通道 | PipelineObserver.emit() 唯一出口 | ✅ |
| 原则六：用户最终裁决 | 多 Agent 并行产出须圆桌收束 | needsMultiPerspective + TaskBoard 等齐 | ✅ |
| 原则七：自修改受约束 | 修宪须七项子约束 | amendment-judge.ts + governance-loop.ts | ✅ |

**新增观察**：原则五的 PipelineObserver 在治理层设计中作为"巡视组"使用，emit-only 单向广播的设计原则在代码中严格坚守——`handler(event)` 返回 void，不存在 `emitAndWait()`。这意味着治理层干预力被刻意限制，与设计文档中"看得见问题，拦不住执行"的描述一致。

---

## 二、🔥 新增核心发现：一致性校验层落地进度

### 2.1 设计文档 vs 代码实现的映射

`docs/consistency-design.md` 提出了 5 组件的架构设计：

```
设计文档 5 组件                   代码实现现状
┌──────────────────┐          ┌──────────────────────┐
│ IntentFactWall    │  ──70%→ │ MemorySubType 枚举    │
│ (意图/事实隔离)    │          │ (shared/memory.ts)    │
│                   │          │ SemiFinishedMgr       │
│                   │          │ (engine/memory/)      │
├──────────────────┤          ├──────────────────────┤
│ InitVerifier      │  ✅100%→ │ init-verifier.ts      │
│ (启动一致性校验)   │          │ (engine/consistency/) │
├──────────────────┤          ├──────────────────────┤
│ GitHookBridge     │    ❌0%→ │ 不存在                │
│ (回滚级联失效)    │          │                       │
├──────────────────┤          ├──────────────────────┤
│ SchemaEnforcer    │  ✅100%→ │ schema-enforcer.ts    │
│ (记录 Schema 强制)│          │ (engine/consistency/) │
├──────────────────┤          ├──────────────────────┤
│ SemiFinishedMgr   │  ✅100%→ │ semi-finished.ts     │
│ (半成品治理)       │          │ (engine/memory/)      │
└──────────────────┘          └──────────────────────┘
```

### 2.2 各组件详细评估

#### ✅ InitVerifier（完全实现）

**文件**：`packages/engine/src/consistency/init-verifier.ts`

- 在 MemoryStore.init() 后调用，遍历所有 Active 记忆的文件引用
- 使用 `extractFileReferences()` 从 metadata.files、content.filePath、content.path、summary 中提取路径
- `IFileSystemAdapter.exists()` 校验文件存在性
- 缺失比例 > 30% 标记 fatal
- Core-1 仅做文件存在性检查（不含 hash 校验），与设计文档一致

**设计偏差**：无。与 `consistency-design.md` §2.2 完全对齐。

#### ✅ SchemaEnforcer（完全实现）

**文件**：`packages/engine/src/consistency/schema-enforcer.ts`

- validate()：校验 MemoryWriteInput 字段完整性（memoryType、content、summary、agentType、creatorId）
- annotate()：subType 默认注入 Fact
- Core-1 精简版（modification-record 全量 Schema 延后至 Core-2）

**设计偏差**：无。与 `consistency-design.md` §2.4 对齐。

#### ✅ SemiFinishedMgr（完全实现）

**文件**：`packages/engine/src/memory/semi-finished.ts`

- `writePending()` → state=Pending, subType=Intent
- `commit()` → state=Active, subType 从 Intent 翻转为 Fact
- `discard()` → Pending → Archived
- `getPending()` / `hasPending()` 查询接口

**设计偏差**：无。与 `consistency-design.md` §2.5 完全对齐。Intent→Fact 翻转机制优雅地实现了设计文档的要求。

#### 🟡 IntentFactWall（约 70% 实现，缺独立组件）

**代码中分散在多处**：
- `shared/src/memory.ts`：`MemorySubType` 枚举（`Intent | Fact`）
- `shared/src/memory.ts`：`MemoryWriteInput.subType?` 可选字段
- `engine/src/memory/semi-finished.ts`：半成品记忆走 Intent，提交后翻转为 Fact
- `engine/src/consistency/schema-enforcer.ts`：subType 默认注入 Fact（未指定时默认"事实"）
- `engine/src/memory/query.ts`：MemoryQuery.subTypes 支持按子类型过滤

**缺失的部分**：
- 没有独立的 **检索时 Intent 过滤** 逻辑（read() 中缺少"默认排除 Intent"的行为——当前 query.subTypes 需要调用方显式声明）
- 没有 **Intent TTL**（设计文档要求意图型记忆有时效过期机制）
- 没有 **事实晋升机制**（设计文档要求意图经过 N 次确认后自动晋升为事实）
- 没有独立的 **IntentFactWall 类或中间件**——职责分散在 4 个文件中

**风险**：🟢 低。核心意图/事实分离能力已落地，缺失的是增强功能。

#### ❌ GitHookBridge（完全缺失）

**设计文档要求**（`consistency-design.md` §2.3/§3.1）：
- git checkout/revert/reset 后关联记忆自动降级
- GitHookAdapter 或 GitEventPoller
- 记忆级联失效触发链路

**代码现状**：不存在。MemoryStore 没有任何 git 事件感知能力。

**影响**：🟡 中。三个血淋淋教训中的"用户回退后记忆还在说已完成"（例三）未得到修复。这是整个一致性校验层中**唯一完全未实现的防线**。

**核心障碍**：git 事件捕获需要外部钩子（git hook）或轮询机制，后者在 Node.js 进程中实现相对复杂——需要 `child_process` 监听或 `chokidar` 监控 `.git/HEAD` 变更。

### 2.3 ConsistencyLayer Facade

**文件**：`packages/engine/src/consistency/consistency-layer.ts`

作为 MemoryStore 的外部中间件，组合 InitVerifier + SchemaEnforcer：
- verify()：启动时调用，返回 ConsistencyReport
- validateInput()：写入前校验
- annotateInput()：字段自动注入

**设计观察**：ConsistencyLayer 设计为"不修改 MemoryStore 内部实现"的中间件模式——这与 Cortex 整体的**工具链隐喻**一致（组合优于侵入）。但当 ConsistencyLayer 需要拦截 write() 路径时，当前 MemoryStore 的 write() 方法没有预留中间件钩子——ConsistencyLayer 目前只在启动时运行 verify()，并未接入 write() 路径的拦截。

**缺口**：MemoryStore.write() 没有调用 ConsistencyLayer.validateInput()。虽然 SchemaEnforcer 已实现，但**写前校验未被实际触发**。

---

## 三、Agent 边界清晰度

### 3.1 🔴 发现 A：AGENT_TAGS 自相矛盾

**严重性**：🔴 **严重**——契约注释与实现直接矛盾。

`packages/shared/src/agent.ts` 的第 120 行的契约注释明确声明：

```typescript
 * 变更规则：
 *   - ...
 *   - 标签不得跨 Agent 共享语义矛盾的定义（例如 Code 不应包含 "review"——
 *     这将导致 Scheduler 在 tags=["review"] 的节点上将 Code 与 Review 平局匹配）
```

但同文件的 `AGENT_TAGS` 定义中：

```typescript
[AgentType.Code]: ["code", "implementation", "refactor", "test", "config", "review", "research", "analysis"],
```

**CodeAgent 的标签包含 `review`、`research`、`analysis`**——与契约注释明确禁止的行为完全矛盾。

**更严重的是**，Core-2 预埋的 ApiAgent 和 DataAgent 也继承了同样的模式：

```typescript
[AgentType.Api]:  ["api", "api_design", "api_integration", "endpoint", "review", "research", "analysis"],
[AgentType.Data]: ["data", "data_model", "migration", "storage", "schema", "review", "research", "analysis"],
```

这意味着如果 Core-2 阶段落地 ApiAgent 和 DataAgent，标签重叠问题会从 5 处膨胀到 **9 处**。

#### 根本原因分析

这条注释和实现矛盾暗示了一段**未完成的重构**：

1. **v2.0 标签词汇表设计**（`Agent标签词汇表-v2.0.md`）定义了纯集合匹配规则，该规则天然要求标签具有排他性
2. **CodeAgent 实际需要** `review`/`research`/`analysis` 标签以执行日常开发任务（审查自己写的代码、研究代码库、分析日志）
3. 注释写下了"不应包含"的理想约束，但实现者发现去掉这些标签后 CodeAgent 无法匹配日常任务
4. 结果是：注释说"不应该"，代码说"先这样"——**一个未闭合的架构决策**

#### 影响场景：Multi-Perspective 等齐死锁

当 MetaAgent 创建 `needsMultiPerspective=true` 节点并标注 `tags: ["review", "research"]` 意图让 ReviewAgent + AnalysisAgent 并行审查：

1. TaskBoard.claim() 遍历所有 Agent 检查标签匹配
2. CodeAgent（含 `review`）、ReviewAgent（含 `review`）都能匹配 `review` 标签
3. CodeAgent（含 `research`）、AnalysisAgent（含 `research`）都能匹配 `research` 标签
4. **认领顺序不确定**——取决于 AgentPool 中实例的遍历顺序
5. 如果 CodeAgent 先认领了 `review` 再认领 `research`，同一个 CodeAgent 被分配了两个标签——但 `claimedBy` 保证同类型不重复，结果可能是 CodeAgent 只认领了一个标签，另一个标签无人认领
6. 最坏情况：**等齐机制永远无法完成**，因为预期的 ReviewAgent + AnalysisAgent 组合被 CodeAgent 插足

#### 修复建议

**短期（Core-1 现网）**：在 CodeAgent 标签中移除 `review`、`research`、`analysis`，将这三个标签"拉回"给 ReviewAgent 和 AnalysisAgent。CodeAgent 在日常任务中需要的分析/研究/审查能力，应通过 **预执行钩子**（`preExecuteHook`）或 **TaskNode.payload 中的显式指令** 来达成交付，而非通过标签匹配。

**长期（Core-2）**：引入**标签优先级**机制或**显式 Agent 类型指定**字段。MetaAgent 在 `needsMultiPerspective` 节点中可指定期望的 Agent 类型组合（`expectedAgentTypes: ["review", "analysis"]`），TaskBoard 在标签匹配之上增加类型过滤：

```typescript
// 方案原型
interface TaskNode {
  // ... 现有字段
  /** 可选——显式指定期望认领的 Agent 类型。设定后标签匹配仅作为辅助筛选 */
  expectedAgentTypes?: AgentType[];
}
```

**改造成本评估**：
- 短期方案：修改 `AGENT_TAGS` 中 CodeAgent 的标签数组（删除 3 项）。影响范围：Scheduler._findMatchingAgent 的匹配结果会变化。**建议配合测试环境的 Multi-Perspective 场景测试覆盖。**
- 长期方案：TaskNode 新增字段 + TaskBoard.claim() 增加类型过滤逻辑。影响范围：shared/agent.ts（类型定义）+ engine/task-board.ts（匹配逻辑）+ scheduler.ts（下游）。

### 3.2 四层边界定义机制（评估：优秀）

尽管存在标签重叠，Cortex 的 Agent 边界定义机制本身设计得很好：

```
AGENT_TAGS[]              → 标签匹配（TaskBoard 匹配依据）
AGENT_TOOL_PERMISSIONS[]  → 工具权限（Toolkit 校验依据）
SYSTEM_PROMPT             → 角色人格（LLM 行为约束）
*MemoryQuery()            → 记忆检索策略（知识回家路径）
```

四者组合形成**显式契约边界**（全部类型化，无运行时模糊地带）。这个模式本身没有问题——问题在于 `AGENT_TAGS` 配置值与契约注释自相矛盾。

### 3.3 Agent 类型职责密度

| Agent 类型 | 标签数 | 工具数 | 设计密度（标签×工具） | 建议 |
|-----------|-------|-------|---------------------|------|
| MetaAgent | 1 | 3 | 3 | ✅ 聚焦，符合规划者定位 |
| CodeAgent | **8** | 6 | **48** | 🔴 密度过高，建议拆分为 5 |
| ReviewAgent | 2 | 6 | 12 | 🟢 正常 |
| AnalysisAgent | 2 | 5 | 10 | 🟢 正常 |
| OpsAgent | 3 | 6 | 18 | 🟢 正常 |
| LoopAgent | 3 | 5 | 15 | 🟢 正常 |
| DocGovernAgent | **7** | 5 | **35** | 🟡 偏高，需关注 |
| ButlerAgent | 0 | 0 | 0 | ✅ 特殊角色 |
| InspectorAgent | 2 | 5 | 10 | 🟢 正常 |
| FixAgent | **5** | 6 | **30** | 🟡 偏高 |

**CodeAgent** 的设计密度最高（48），远超其他 Agent 的两倍以上。高密度意味着：
- 可认领的任务范围极广（8 个标签覆盖几乎所有开发任务）
- 权限最高（FULL_TOOLSET）
- 在标签匹配中"压制"其他专门 Agent

**建议**：Core-2 阶段可考虑将 CodeAgent 拆分为 `CodeAgent`（聚焦 implementation/bugfix/refactor）和 `DevAgent`（聚焦 test/config/review）两个类型，降低单一 Agent 的职责密度。

---

## 四、治理层落地进度评估

### 4.1 已落地 vs 设计文档 vs 超前设计

| 治理组件 | 宪法要求 | 治理层设计文档状态 | 代码实现 | 落地进度 |
|---------|---------|------------------|---------|---------|
| SafeErrorReporter | 原则七 | 已落地 §1.1 | ✅ engine/pipeline-observer.ts + shared/infra.ts | 100% |
| PipelineObserver | §8 | 已落地 §1.2 | ✅ engine/pipeline-observer.ts | 100% |
| DocGovernAgent（三节点） | §5.1 | 已落地 §1.3 | ✅ engine/agents/doc-govern-agent.ts | 100% |
| GovernanceLoop（修宪闭环） | 原则七 | — | ✅ engine/governance-loop.ts + amendment-judge.ts + amendment-applier.ts | 100% |
| ConsistencyLayer | P1-六层防御 | §3 架构设计 | ✅ engine/consistency/（3 文件） | 70% |
| SemiFinishedMgr | P1-六层防御 | §3.2 | ✅ engine/memory/semi-finished.ts | 100% |
| MemorySubType (Intent/Fact) | P1-六层防御 | §3.2 | ✅ shared/memory.ts | 100% |
| GitHookBridge | P1-六层防御 | §3.1 | ❌ 不存在 | **0%** |
| PipelineObserver 治理事件类型 | — | §2.4 | ❌ PipelineEventType 无 governance.* 事件 | **0%** |
| DECISION_REQUIRED 回退机制 | — | §2.4 | ❌ notificationType 字段已存在但无消费方 | **0%** |
| 审计闭环（DocGovern emit 治理事件） | — | §2.4/§3.1 | ❌ DocGovernAgent 写完磁盘即结束 | **0%** |
| 常设委员会 | — | §2.1/§3.1 超前设计 | ❌ 不存在 | 0% |
| 监理独立实体 | — | §3.3 超前设计 | ❌ 不存在 | 0% |
| TrustModel/TrustAgent | — | §3.4 超前设计 | ❌ 不存在 | 0% |

### 4.2 🔥 关键缺口：PipelineObserver 缺少治理事件类型

`PipelineEventType` 枚举当前包含 28 个事件类型，**全部为执行层事件**（AgentPool、Scheduler、Node、Pool、MemoryStore、TaskBoard、Error system、Analysis）。

**治理层事件数为零**——没有 `governance.audit`、`governance.constitution_check`、`governance.amendment_proposed`、`governance.amendment_applied` 等。

这意味着：
1. DocGovernAgent 的审计报告写完磁盘即结束，**没有进入通知管线**
2. GovernanceLoop 的修宪结果没有通过 PipelineObserver 广播
3. ButlerAgent 无法向用户呈报治理事件
4. 治理层文档 §2.4 要求的通知类型分层（FYI/WARNING/DECISION_REQUIRED）的 `DECISION_REQUIRED` 槽位**完全没有事件来源**

**修复建议**：在 PipelineEventType 中新增至少以下治理事件类型：

```typescript
// ── Governance ──
GovernanceAuditComplete = "governance.audit.complete",
GovernanceConstitutionCheck = "governance.constitution_check",
GovernanceAmendmentProposed = "governance.amendment_proposed",
GovernanceAmendmentApplied = "governance.amendment_applied",
GovernanceDecisionRequired = "governance.decision_required",
```

改造成本：约 20 行枚举定义 + 各治理组件的 emit 调用。影响范围：shared/infra.ts（类型定义）+ 各治理组件。

### 4.3 治理事件通知管线的完整依赖链

```
DocGovernAgent 审计完成
  → write_file → docs/auditing/      ← 当前路径（流程终止）
  → observer.emit({ type: governance.audit, ... }) ← 目标路径
  
目标路径依赖链：
  [1] PipelineEventType 新增 governance.* 事件类型  ← 当前缺失
  [2] DocGovernAgent 注入 observer 引用并调用 emit() ← 当前缺失
  [3] ButlerAgent 按 notificationType 分流            ← notificationType 字段存在但无消费逻辑
  [4] DECISION_REQUIRED 走 ConfirmGate                ← 回退机制未实现
  [5] 用户决策结果归档至 MemoryType.Governance        ← MemoryType.Governance 不存在
```

**当前阻塞点**：[1] 是前置依赖，[2] 是工程改动。

---

## 五、循环依赖与模块依赖分析

### 5.1 包级别依赖方向（复检）

```
shared ← llm ← engine ← cli
  ↑       ↑
testing   parser ← cli
          pm
          data
          tools
```

**结论**：✅ **无包级别循环依赖**。与上次报告一致。

### 5.2 engine 包内部依赖方向（复检）

```
根级文件单向导入链 ✅：
config.ts → 无依赖
test-env.ts → 无依赖
pool-aware.ts → shared + (agent-pool.ts)
toolkit.ts → shared
agent-pool.ts → shared + pipeline-observer.ts
pipeline-observer.ts → shared
confirm-gate.ts → shared
task-board.ts → shared + pipeline-observer.ts
base-agent.ts → shared + llm + toolkit + memory
scheduler.ts → shared + task-board + agent-pool + observer + gate + meta-agent
meta-agent.ts → shared + llm + skill-registry

agents/ → 只引用 shared + engine 根级文件 ✅
memory/ → 只引用 shared + pipeline-observer ✅
consistency/ → 只引用 shared + memory ✅
components/ → 只引用 shared + llm + engine 根级文件 ✅
```

### 5.3 🔥 新增发现：两条 Agent 构建路径依然并存

| 路径 | 基类/工厂 | 当前使用 |
|------|----------|---------|
| 继承式 | `abstract class BaseAgent`（~140 行） | agents/ 中 11 个 Agent **不使用** |
| 组合式 | `createAgent(config)` + `AgentFactoryConfig`（~100 行） | agents/ 中 11 个 Agent **全部使用** |

**状态**：与 2026-06-06 报告一致，`BaseAgent` 依然保留但无人使用。建议在 Core-2 启动前清理，约 140 行代码可安全删除。

### 5.4 StrategistAgent 的自治地位

`strategist-agent.ts` 独立于 agents/ 目录直接挂在 engine/src/ 根目录下：

```
engine/src/strategist-agent.ts        ← 直接实例化，不走 createAgent()
engine/src/meta-agent.ts              ← 同样直接实例化
engine/src/agents/index.ts 导出声明：
  "MetaAgent / StrategistAgent 待单独重构"
```

这两个 Agent 在代码中明确被标记为"待单独重构"——它们不经过 `createAgent()` 工厂函数，直接使用 `new StrategistAgent(llm)` 和 `new MetaAgent(llm, ...)` 构造。这说明目前的组合式重构尚未覆盖 MetaAgent 和 StrategistAgent。

**影响**：🟡 中。组合式架构的统一性被两个特例打破。Core-2 阶段 StrategistAgent 激活时需要重构为组合式。

---

## 六、影响范围评估

### 6.1 风险矩阵

| # | 发现 | 类型 | 严重度 | Core-2 影响 | 建议优先级 |
|---|------|------|--------|------------|-----------|
| A | AGENT_TAGS 契约注释与实现矛盾 | 架构缺陷 | 🔴 P1 | 导致多视角节点等齐机制可能死锁 | **P0-阻塞** |
| B | GitHookBridge 完全缺失 | 功能缺口 | 🟡 P2 | 例三（回滚记忆错乱）未修复 | P1-高 |
| C | PipelineObserver 治理事件类型为零 | 功能缺口 | 🟡 P2 | 审计闭环第一步走不通（发现 2-B/3-A） | P1-高 |
| D | ConsistencyLayer 未接入 write() 路径 | 工程缺口 | 🟡 P2 | 写前校验被静默跳过 | P2-中 |
| E | BaseAgent 遗留代码未清理 | 技术债 | 🟢 P3 | 无功能影响，但增加维护成本 | P3-低 |
| F | StrategistAgent/MetaAgent 未接入组合式 | 架构不统一 | 🟢 P3 | Core-2 激活前需重构 | P3-低 |
| G | cli 依赖偏离文档 | 文档落后 | 🟢 P4 | 无功能影响 | P4-低 |
| H | 标签膨胀（16→30+）未反映在文档 | 文档落后 | 🟢 P4 | Core-2 启动前需更新 | P4-低 |

### 6.2 发现 A 的根系追踪

```
发现 A：AGENT_TAGS 自相矛盾
  └── 根因：契约注释写了"Code 不应包含 review"，但实现包含了
      └── 历史原因：CodeAgent 日常需要 review/research/analysis 能力
          └── 未完成的架构决策：保留标签 vs 移除标签
              └── 连锁影响 1：Multi-Perspective 等齐死锁（最坏情况）
              └── 连锁影响 2：ApiAgent/DataAgent 继承错误模式（Core-2 膨胀）
              └── 连锁影响 3：DocGovernAgent 7 标签的密度问题被掩盖
```

### 6.3 发现 B/C/D 的协同影响

这三个发现单独看危害有限，但组合在一起形成**治理层通知管线的完整性缺口**：

```
B（GitHookBridge 缺失）
  → 记忆-文件系统一致性校验只剩启动时的一次性检查
  
C（治理事件类型为零）
  → DocGovernAgent 审计结论无法进入通知管线
  → ButlerAgent 无法向用户呈报治理信息
  → 审计闭环（AM-2026-0606-002）第一步就走不通

D（ConsistencyLayer 未接入 write()）
  → SchemaEnforcer.validateInput() 从未被调用
  → 写入侧缺乏字段完整性校验

组合效应：治理层虽然有审计能力，但审计结论无法触达用户，
一致性校验层有校验逻辑但校验结果不阻断写入路径。
```

---

## 七、建议优先级路线图

### 🚨 P0-阻塞（Core-2 启动前必须修复）

1. **修复 AGENT_TAGS 自相矛盾**（发现 A）
   - CodeAgent 移除 `review`/`research`/`analysis` 标签
   - ApiAgent/DataAgent 的 AGENT_TAGS 同样修正
   - 补充 Multi-Perspective 场景测试覆盖

### 🔴 P1-高（Core-2 启动前完成）

2. **新增 governance.* 治理事件类型**（发现 C）
   - PipelineEventType 新增至少 5 个治理事件
   - DocGovernAgent 审计完成后 emit 治理事件
3. **实现 GitHookBridge**（发现 B）
   - Git 事件轮询或 git hooks 触发记忆失效
   - 至少完成文件回滚后的级联失效

### 🟡 P2-中（Core-2 启动初期完成）

4. **ConsistencyLayer 接入 MemoryStore.write() 路径**（发现 D）
   - write() 方法内调用 validateInput()
5. **清理 BaseAgent 遗留代码**（发现 E）
6. **MetaAgent/StrategistAgent 重构为组合式**（发现 F）

### 🟢 P3-P4 低（Core-2 持续推进）

7. 更新文档匹配代码（cli 依赖、标签膨胀）
8. DECISION_REQUIRED 回退机制实现
9. 常设委员会/监理等超前设计的可行性论证

---

## 八、附录：文件引用索引

| 文件路径 | 行数 | 本报告引用 |
|---------|------|-----------|
| packages/shared/src/agent.ts | 389 | §1.2/§3.1/§3.2 |
| packages/shared/src/memory.ts | 201 | §2.2/§3.1 |
| packages/shared/src/infra.ts | 323 | §4.2/§4.3 |
| packages/shared/src/task.ts | 112 | §3.1 |
| packages/engine/src/consistency/consistency-layer.ts | 150 | §2.3/§6.3 |
| packages/engine/src/consistency/init-verifier.ts | 180 | §2.2 |
| packages/engine/src/consistency/schema-enforcer.ts | 105 | §2.2 |
| packages/engine/src/memory/semi-finished.ts | 145 | §2.2 |
| packages/engine/src/memory/memory-store.ts | 450+ | §2.3/§6.3 |
| packages/engine/src/memory/schema.ts | 36 | §2.2 |
| packages/engine/src/scheduler.ts | 256 | §3.1/§5.2 |
| packages/engine/src/task-board.ts | 280 | §3.1 |
| packages/engine/src/governance-loop.ts | 180 | §4.1 |
| packages/engine/src/strategist-agent.ts | 160 | §5.4 |
| packages/engine/src/agents/index.ts | 52 | §5.4 |
| docs/consistency-design.md | 41559 chars | §2.1/§2.2 |
| docs/core/治理层设计.md | 8889 chars | §4.1/§4.2 |
| docs/core/Agent标签词汇表-v2.0.md | ~400 行 | §3.1 |
| docs/analysis/constitution-gap-impact.md | 17862 chars | §6.3 |

---

*分析完成。雨林的每一条根系我都走过了——地图在这里，方向由开拓者决定。*
