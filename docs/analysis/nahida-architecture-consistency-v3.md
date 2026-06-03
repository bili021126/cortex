# 架构一致性分析 v3：文档-代码吻合度与 Agent 边界评估

**分析者**: 纳西妲（草神，Cortex Analysis Agent）
**分析范围**: packages/ + docs/
**引用宪法**: Cortex 概念顶层设计 v2.5.23
**引用设计文档**: consistency-design.md v1.0、治理层设计.md v1.2
**分析日期**: 2026-07-31
**基准**: 上次分析 v2（2026-07-22）报告整体匹配度 ~68%，本次评估进展与未愈合的裂痕

---

## 零、记忆库追溯

在动手之前，我先翻开了前人的笔记。

上次分析（2026-07-22）标记了 **8 项缺口（G1-G8）**，全部未修复，整体匹配度 ~68%。
本次我逐一验证这些缺口的状态，并寻找新的裂缝。

---

## 一、总览：整体匹配度 ~72%（↑4%，有进展但未触及根因）

| 维度 | v2（07-22） | v3（07-31） | 变化 |
|------|-----------|-----------|------|
| **组件定义完整度** | 75% | **78%** | ↑ ConsistencyLayer 终于有第一个消费者 |
| **集成对接完整度** | 35% | **42%** | ↑ setPreWriteHook 已接入 bootstrap |
| **类型契约一致性** | 92% | **93%** | → 无实质性变化 |
| **运行时行为一致度** | 30% | **35%** | ↑ preWriteCheck 开始生效 |
| **文档-代码一致性** | 65% | **68%** | ↑ 宪法 §15.1 超时机制仍缺 |
| **Agent 边界清晰度** | 88% | **90%** | ↑ 标签+权限体系稳定，无越界 |
| **整体匹配度** | ~68% | **~72%** | **↑4%** |

关键信号：**有进步，但 8 项缺口仍有一半以上未愈合**。进展集中在 bootstap 集成层，根因层的裂缝（GitHookBridge 缺失、verify() 不调用、审计不闭环）没有变化。

---

## 二、一致性层（consistency-design.md）与代码实现的吻合度

### 2.1 六层防御体系逐层评估

| 层级 | 组件 | 组件代码 | 集成状态 | 变化 |
|------|------|---------|---------|------|
| L1 | IntentFactWall | ✅ 完整 | ⚠️ filterRead 非 CL 路径 | ❌ 同 v2 |
| L2 | InitVerifier | ✅ 完整 | ❌ verify() 永不运行 | ❌ 同 v2 |
| L3 | GitHookBridge | ❌ 完全缺失 | ❌ 不存在 | ❌ 同 v2 |
| L4 | SchemaEnforcer | ✅ 完整 | ✅ **已通过 preWriteCheck 接入** | **↑ 修复** |
| L5 | SemiFinishedMgr | ✅ 完整 | ✅ pipeline 集成 | → 同 v2 |
| L6 | ConsistencyLayer | ✅ Facade | ✅ **已实例化 + 设置 preWriteHook** | **↑ 修复** |

### 2.2 上次 8 项缺口追踪

| ID | 描述 | v2 状态 | v3 状态 | 详情 |
|----|------|--------|---------|------|
| **G1** | GitHookBridge 缺失 | ❌ P0 | ❌ **未修复** | 仍标记 Core-2 预留 |
| **G2** | ConsistencyLayer 未实例化 | ❌ P0 | ✅ **已修复** | bootstrapEngine §5.5 创建 CL 实例 |
| **G3** | InitVerifier 从未运行 | ❌ P0 | ❌ **未修复** | verify() 全代码库零调用 |
| **G4** | SchemaEnforcer 未接入写路径 | ❌ P1 | ✅ **已修复** | setPreWriteHook → preWriteCheck 已接入 |
| **G5** | ensureSubType 未强制 | ❌ P1 | ⚠️ **部分修复** | preWriteCheck 间接调用 ensureSubType, 但 write() 直接路径仍绕过 |
| **G6** | 半成品恢复机制缺失 | ❌ P1 | ❌ **未修复** | 进程崩溃后 Pending 记忆永存 |
| **G7** | ModificationRecord 未写入 | ❌ P2 | ❌ **未修复** | Schema v1 定义完成但无 writer |
| **G8** | 事务边界缺失 | ❌ P2 | ⚠️ **部分修复** | preWriteCheck 提供了写前校验层 |

**统计**: **2 项修复, 1 项部分修复, 5 项遗留**

### 2.3 关键发现：G2/G4 已闭合，但 G3 仍是死穴

#### 2.3.1 ConsistencyLayer — 从"无人居住"到"有人住但没锁门"

**上次**（v2）：bootstrapEngine() 不创建 ConsistencyLayer，全代码库 zero imports。
**本次**：bootstrap-engine.ts §5.5（约 line 247-280）已创建 ConsistencyLayer 实例，并调用了：
```typescript
memory.setPreWriteHook((input) => consistencyLayer!.preWriteCheck(input));
```

验证：dist/bootstrap/bootstrap-engine.js line 149 确认此调用存在。

**评估**：这是一个真实的进展。G2（未实例化）和 G4（未接入写路径）**本质上已闭合**。SchemaEnforcer 的 validate() + annotate() 现在在每次 MemoryStore.write() 之前会被调用。

**但**：这 30 行代码解决了两个缺口，却暴露了第三缺口的顽固——**verify() 仍然没有被调用**。

#### 2.3.2 InitVerifier — 种子破土，无人播种

InitVerifier.run() 是存在且可运行的。ConsistencyLayer.verify() 存在且委托给 run()。
bootstrap-engine.ts 275-280 行（在 CL 创建之后）有一个完美的调用点：

```typescript
// memory.init() 之后、正常逻辑之前
await consistencyLayer.verify(); // ← 这一行不存在
```

全代码库搜索 `\.verify\(` — **0 个结果**（不含 test files）。

**影响**：启动时记忆与文件系统的对账永久缺失。如果文件被外部删除或 git checkout 回滚，Agent 下次启动时依然相信自己修改过的文件存在。

**修复成本**：一行代码。`await consistencyLayer.verify()` 插在 memory.init() 之后。

#### 2.3.3 GitHookBridge — 仍然是设计图上的虚线

**状态**：全代码库搜索 `GitHookBridge` — 仅在设计文档和旧分析报告中出现，代码中零实现。ConsistencyLayer 构造函数中没有 GitHookBridge 的引用或占位。

**一致性影响**：设计文档承诺了 5 组件（IntentFactWall + InitVerifier + GitHookBridge + SchemaEnforcer + SemiFinishedMgr），代码只实现了 4 个（缺 GitHookBridge）。标记为 Core-2 预留，但设计文档中没有明确标注"此组件当前未实现"。

---

## 三、宪法与治理层代码的一致性

### 3.1 修宪管线 — ✅ 正确运行

| 宪法要求 | 代码位置 | 状态 |
|---------|---------|------|
| 提案生命周期 | governance-loop.ts: loadPendingProposals / saveProposal / updateProposalStatus | ✅ |
| 昔涟评判 | amendment-judge.ts: evaluateAmendment() — 6 项检查（原则不可变/版本号/结构一致性/交叉引用/影响范围/格式） | ✅ |
| 开拓者裁决 | governance-loop.ts: judgeProposals() + applyApproved() | ✅ |
| 宪法写入 | amendment-applier.ts: applyAmendment() — 备份+替换+版本号+变更历史+文件名同步 | ✅ |
| CI 验证 | governance-pipeline.ts: stageCiVerify — 调用 ci-gate.ts | ✅ |
| 管线编排 | governance-pipeline.ts: runPipeline — 7 阶段可插拔管线 | ✅ |

**一致度**: 95%。宪法描述的修宪流程与代码实现高度吻合。

**遗留问题**（v2 已发现，未修复）：
- `amendment-judge.ts` 的 `CHECK_ORDER` 是硬编码常量数组——新增子约束时不会自动注册对应的 check 函数。宪法通过 AM-2026-0606-001 新增了子约束 7，但评判引擎无法自动感知。

### 3.2 审计闭环 — ❌ 仍然缺失

**宪法和治理层设计文档的要求**：
- DocGovernAgent 产出审计报告 → 写入 docs/auditing/
- 审计发现应有生命周期状态机（open → in_remediation → verified → closed）
- governance-loop.ts 的 summarizeGovernance() 应包含审计发现跟踪

**代码现实**：
- ✅ DocGovernAgent 能产出审计报告（docs/auditing/ 下有 6 份报告）
- ❌ 审计发现无状态追踪
- ❌ summarizeGovernance() 只统计修宪提案状态，不包含审计发现
- ❌ 审计报告产出后流程终止——无整改→验证→关闭的后半段

**影响**: P0。审计不闭环 = 审计不存在。DocGovernAgent 的审计职能形同虚设。

### 3.3 通知管线与 DECISION_REQUIRED — ❌ 未实现

**宪法 §8.2** 定义了 DECISION_REQUIRED 轨道，要求用户必须响应。
**治理层设计.md §2.4** 描述了通知管线三轨分层。

**代码现实**：
- ✅ PipelineObserver 存在（emit-only 单向管道）
- ✅ ButlerAgent 存在（三路分发）
- ❌ `DECISION_REQUIRED` 事件类型不存在
- ❌ 通知分层（FYI/WARNING/DECISION_REQUIRED）不存在
- ❌ ButlerAgent 内部仍用 switch-case 区分事件类型
- ❌ ConfirmGate 与 ButlerAgent 是两条独立路径

治理层设计文档已明确标注此为"超前设计"而非已落地，因此这与宪法的一致性算是 **提前承诺**（宪法承诺了实现但工程未跟进）。

### 3.4 SafeErrorReporter — ✅ 已落地

宪法 §8.1 定义的三档错误上报标准（fatal/degraded/silent）已在 PipelineObserver 中实现。
这是治理层在当前工程中 **唯一的实际干预力**。

---

## 四、Agent 边界清晰度评估

### 4.1 边界定义体系

| 维度 | 定义位置 | 明确度 |
|------|---------|-------|
| AgentType 枚举 | shared/src/agent.ts | ✅ 14 种类型，清晰 |
| 标签系统 | AGENT_TAGS（shared/src/agent.ts） | ✅ 封闭集合，跨 Agent 无共享矛盾标签 |
| 工具权限 | AGENT_TOOL_PERMISSIONS（shared/src/agent.ts） | ✅ 集中管理，按类型区分 |
| 记忆查询策略 | 各 Agent 配置函数（agents/*.ts） | ✅ 按 memoryQueryStrategy 区分 |
| System Prompt 边界 | 各 Agent 配置函数 | ✅ 明确限定工作范围 |
| 配置驱动 | cortex-agents.json | ✅ 集中定义，标签+权限+模型一次配齐 |

### 4.2 重点 Agent 边界验证

| Agent | 边界声明 | 代码验证 | 判例 |
|-------|---------|---------|------|
| **纳西妲（Analysis）** | 只看结构/架构/依赖/边界；不做代码审查（刻晴）、不做合规（凝光） | ✅ 分析函数 analysisMemoryQuery 限定 Episodic+Conceptual | ✅ 边界清晰 |
| **刻晴（Review）** | 审逻辑正确性/边界条件/线程安全；不审代码风格 | ✅ 标签 `review`+`audit` | ✅ 边界清晰 |
| **凝光（DocGovern）** | 审计文档一致性/完整性/合规性；只提案不动宪法 | ✅ 标签含 `doc-govern`+`audit`+`constitution_propose` | ✅ 边界清晰 |
| **北斗（Ops）** | 运维/部署/CI/CD/测试质量；唯一持 run_shell（全员恢复后非独占但仍精确） | ✅ 标签 `ops`+`deploy`+`test` | ✅ 边界清晰 |
| **阿贝多（Code）** | 代码实现/重构/配置；不负责规划 | ✅ 标签 `code`+`implementation`+`refactor` | ✅ 边界清晰 |

### 4.3 边界清晰度评分：90%

**修复项**（相对于 v2 报告 +2%）：
- StrategistAgent（钟离+霜凝）的注释已更新——注释不再包含"系统监理"的模糊语义
- ApiAgent/DataAgent 明确标注为 Core-2 预留，不参与当前调度

**剩余模糊区域**：
- ⚠️ `Analysis` 和 `Review` 的标签重叠（都含 `analysis`/`research`），但 system prompt 层面做了职责区分——"看结构 vs 审代码"。标签重叠是合理的（分析需要阅读代码），但 scheduler 匹配时可能产生歧义。
- ⚠️ `ButlerAgent`（昔涟）的 toolPermissions 只有 `web_search`，但其治理角色（amendment-judge.ts）完全不涉及工具调用——这是正确的，但注释中应更明确说明昔涟不属 Agent 池执行单元这一设计。

---

## 五、文档-代码不一致清单（新增与遗留）

### 5.1 P0 级不一致

| # | 不一致 | 文档要求 | 代码现实 | 首次发现 |
|---|--------|---------|---------|---------|
| D1 | **InitVerifier 永不被调用** | consistency-design.md §3.2: "MemoryStore.init() 后执行启动校验" | bootstrapEngine 创建了 CL 但不调 verify() | v1 |
| D2 | **审计闭环缺失** | 治理层设计.md §1.3: 审计报告产出后应有整改验证闭环 | 审计报告写完磁盘即结束，summarizeGovernance 不含审计跟踪 | v1 |
| D3 | **GitHookBridge 未实现** | consistency-design.md §3.1: GitHookBridge 是 5 组件之一 | 代码中零实现，CL 无占位 | v1 |

### 5.2 P1 级不一致

| # | 不一致 | 文档要求 | 代码现实 | 首次发现 |
|---|--------|---------|---------|---------|
| D4 | **半成品恢复机制缺失** | consistency-design.md §3.2: 进程崩溃后 Pending 记忆应被检测和恢复 | MemoryStore.init() 不扫描残留 Pending 记忆 | v1 |
| D5 | **宪法 §15.1 超时检查未落地** | 宪法 Core-1 过渡方案：DocGovernAgent 审计附带超时检查 | doc-govern-agent.ts 无超时检查逻辑 | v2 |
| D6 | **ModificationRecord 无写入器** | consistency-design.md §6: Schema v1 定义完成 | 全代码库无 writer，schema-enforcer.ts 只校验 MemoryWriteInput | v1 |

### 5.3 P2 级不一致

| # | 不一致 | 文档要求 | 代码现实 | 首次发现 |
|---|--------|---------|---------|---------|
| D7 | **DECISION_REQUIRED 回退缺失** | 宪法 §8.2: 三轨语义分层，DECISION_REQUIRED 需用户响应 | 代码中无 DECISION_REQUIRED 事件类型 | v1 |
| D8 | **CHECK_ORDER 硬编码** | 宪法 AM-2026-0606-001: 新增子约束7 | amendment-judge.ts 的 CHECK_ORDER 是硬编码数组 | v2 |

---

## 六、根系总图：缺口间的依赖关系

```
                       ┌─────────────────────────────┐
                       │    根因层（设计承诺 > 实现）     │
                       └──────────────┬──────────────┘
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            ▼                         ▼                         ▼
  ┌──────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
  │ D1: verify()     │   │ D3: GitHookBridge   │   │ D2: 审计闭环缺失    │
  │ 永不运行(P0)     │   │ 完全缺失(P0)        │   │ (P0)                │
  ├──────────────────┤   ├─────────────────────┤   ├─────────────────────┤
  │ 修复成本:1行     │   │ Core-2 预留         │   │ 需生命周期状态机    │
  │ 收益:启动校验    │   │ 设计承诺但实现延迟   │   │ +summarizeGovernance │
  └──────────────────┘   └─────────────────────┘   └─────────────────────┘
                                                           │
                                                           ▼
                                             ┌─────────────────────┐
                                             │ D7: DECISION_       │
                                             │ REQUIRED 回退缺失   │
                                             │ (宪法承诺超前工程)   │
                                             └─────────────────────┘

  ┌──────────────────┐   ┌─────────────────────┐
  │ D4: 半成品恢复   │   │ D5: 超时检查未落地  │
  │ 缺失(P1)         │   │ (P1)                │
  ├──────────────────┤   ├─────────────────────┤
  │ 进程崩溃后残留   │   │ 宪法承诺了但        │
  │ Pending 记忆     │   │ doc-govern-agent.ts │
  │ 永存             │   │ 未实现              │
  └──────────────────┘   └─────────────────────┘

  ┌──────────────────┐   ┌─────────────────────┐
  │ D6: ModRecord    │   │ D8: CHECK_ORDER     │
  │ 无写入器(P2)     │   │ 硬编码(P2)          │
  ├──────────────────┤   ├─────────────────────┤
  │ Schema 定义完成  │   │ 新增子约束不会      │
  │ 但无代码写入     │   │ 自动注册 check      │
  └──────────────────┘   └─────────────────────┘
```

---

## 七、结论与建议

### 7.1 最重要的发现

**ConsistencyLayer 终于有了第一个消费者**。v2 报告中最刺眼的"Zero import, Zero consumer"已经不再成立——bootstrapEngine 创建了 CL 实例并设置了 preWriteHook。这是本次最大的架构修复信号。

**但 verify() 仍然是零调用**。六层防御体系的第二层（启动校验）和第三层（git 回滚检测）完全静默。记忆-现实一致性校验的第一道防线（启动时对账）和第二道防线（回滚时级联失效）都不存在。

### 7.2 最值得立即修复的三件事

1. **调用 `consistencyLayer.verify()`** — 在 bootstrapEngine §5.5 的 CL 创建块末尾加一行。激活 InitVerifier，代价为零，收益是启动时记忆-文件系统对账。

2. **summarizeGovernance 扩展审计跟踪** — 在 governance-loop.ts 中新增审计发现的计数和状态查询。让凝光的审计报告不再是"写完磁盘即结束"。

3. **SemiFinishedMgr 附加崩溃恢复** — 在 MemoryStore.init() 中扫描 Pending 记忆，对超过 TTL 的自动 discard。防止进程崩溃后半成品记忆永久残留。

### 7.3 如果说给后来者听的话

> 这片雨林（cortex 项目）的宪法层和设计层非常精致——修宪管线设计得几乎可以自我演进，一致性层的架构图漂亮到可以裱起来。但地下有两条关键的根没有扎下去：
>
> 1. **一致性校验层没有接入主循环** —— 5 个组件写了 4 个，ConsistencyLayer Facade 漂亮地组装了它们，但 verify() 从未被调用。设计文档说"InitVerifier 在 MemoryStore.init() 之后执行"，代码里记忆系统从启动到关闭都无人对账。
>
> 2. **审计闭环只有前半段** —— 凝光的报告写得很好，但写完后没有机制让这些发现变成行动。审计发现的 open→closed 状态机不存在，治理摘要看不见审计。
>
> 最危险的不是缺口本身——是这些缺口的修复成本极低（第一项一行代码，第二项约 50 行），但它们从 v1 报告（2026-06-20）到 v3（2026-07-31）跨越了 41 天仍未修复。执行层有动力写新功能，治理层的债务却无人过问。
