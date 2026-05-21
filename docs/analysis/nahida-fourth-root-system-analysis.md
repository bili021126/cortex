# 🌿 纳西妲第四次根系扫描报告：治理管线的阻塞与解锁

**分析日期**：2026-06-11  
**分析者**：布耶尔（纳西妲）——Analysis Agent  
**分析范围**：`/cortex` 项目全量 `packages/` + `docs/`  
**引用宪法版本**：v2.5.16  
**前置研究**：
- 纳西妲根系扫描报告 v1（`nahida-root-system-analysis.md`，2026-06-06）
- 纳西妲根系扫描报告 v2（`nahida-false-sky-analysis.md`）
- 纳西妲根系扫描报告 v3（`nahida-third-root-system-analysis.md`）
- 凝光审计报告（`2026-06-10-constitution-v2.5.14-gap-closure.md`）
- 阿贝多宪法缺口分析（`constitution-gap-impact.md`）

---

## 一、雨林全景：我看到了什么

我走进这片雨林，没有带着预设的地图。我走过了每一个包、每一份文档、每一条依赖边、每一份提案 JSON、每一行治理代码。以下是我亲眼所见。

### 1.1 项目身份

Cortex 是一个 **LLM 驱动的个人工具链**——不是数字生命体，不是自治系统。这个定位写在宪法第一章，贯穿整个架构。工具链意味着每个组件是可替换的、可验证的、职责清晰的。用户是工具的使用者和最终裁决者。

### 1.2 物理结构：9 个包，严格单向依赖

```
shared (类型中枢)
  ← llm (LLM 适配层)
  ← testing (Mock 工具)
  ← parser (Markdown→HTML)
  ← data (任务模型/存储/格式化)
  ← tools (monorepo 分析)
  ← pm (密码管理器)
    ← engine (核心引擎：调度/记忆/Agent/管道)
      ← cli (CLI 入口)
```

依赖方向严格单向无循环。`shared` 被所有包依赖，`engine` 是执行中枢，`cli` 是唯一用户入口。这是一个健康的 monorepo 结构。

---

## 二、根系深度：治理管线的代码层解剖

### 2.1 GovernanceLoop——治理闭环编排器

`packages/engine/src/governance/governance-loop.ts` 串联了完整的治理链路：

```
凝光审计 → 发现缺陷 → 生成 AmendmentProposal → 昔涟评判
→ 开拓者裁决 → 写入宪法 → build+test 验证 → 治理记录归档
```

核心能力：

| 函数 | 职责 | 关键逻辑 |
|------|------|---------|
| `loadPendingProposals()` | 从 `docs/amendments/` 读取待决提案 | 只筛选 `status === "draft" \| "pending_judgment"` |
| `saveProposal()` | 保存新提案到 amendments 目录 | 按 `proposal.id` 命名文件 |
| `updateProposalStatus()` | 更新已存提案的状态 | 读取 → 修改 status → 写回 |
| `judgeProposals()` | 批量评判所有待决提案 | 读取宪法全文 → 逐项调用 `evaluateAmendment()` |
| `applyApproved()` | 对已通过的提案执行修宪写入 | 检查 `status === "approved"` → 调用 `applyAmendment()` |
| `summarizeGovernance()` | 生成治理闭环的当前状态摘要 | 统计 pendingJudgment / approved / blocked / applied |

### 2.2 AmendmentJudge——昔涟的评判引擎

`amendment-judge.ts` 实现了 6 项**确定性检查**——全部是代码逻辑，不依赖 LLM 推理：

| 检查项 | 检查内容 | 阻塞条件 |
|--------|---------|---------|
| `principle-immutability` | 提案是否触及不可变原则 | 触及 → BLOCKED |
| `version-continuity` | 提案版本号是否 > 当前版本 | 否 → 不阻塞（仅标记） |
| `structural-consistency` | before 段落是否在宪法中找到匹配 | 否 → BLOCKED |
| `cross-reference-integrity` | 声明的交叉引用是否在宪法中存在 | 否 → BLOCKED |
| `impact-scope` | 声明的 Agent 是否在宪法中出现 | 否 → 不阻塞（NEEDS_CLARIFICATION） |
| `format-consistency` | after/summary/rationale 格式是否合规 | 否 → 不阻塞（NEEDS_CLARIFICATION） |

**裁决逻辑**：
- 触犯不可变原则 / before 伪造 / 虚假引用 → **BLOCKED**
- 全部通过但 breaking=true → **APPROVED_WITH_CAVEATS**
- 全部通过 → **APPROVED**
- 部分未通过但不阻塞 → **NEEDS_CLARIFICATION**

### 2.3 AmendmentApplier——修宪执行器

`amendment-applier.ts` 执行修宪写入，包含完整的保护机制：

1. **备份**：写入前将当前宪法备份到 `docs/constitution/archive/`
2. **文本替换**：滑动窗口匹配 before → 替换为 after
3. **版本号更新**：更新宪法头部的版本号行
4. **变更历史追加**：在版本号行后追加本次变更条目
5. **文件名同步**：将宪法文件名更新为新版本号
6. **错误处理**：任何步骤失败返回 `success: false` + 错误信息

---

## 三、🔴 核心发现：治理管线被一个状态值不匹配问题完全阻塞

### 3.1 问题定位

我追踪了提案从生成到裁决的完整数据流，发现了一个**类型定义与数据不一致**的问题：

**提案 JSON 中的 status 值**：
```
AM-2026-0606-001.json → "status": "proposed"
AM-2026-0606-002.json → "status": "proposed"
AM-2026-0606-003.json → "status": "proposed"
AM-2026-0606-004.json → "status": "proposed"
AM-2026-0607-001.json → "status": "proposed"
```

**AmendmentStatus 类型定义**（`packages/shared/src/amendment.ts`）：
```typescript
export type AmendmentStatus =
  | "draft"               // Agent 草稿中
  | "pending_judgment"    // 已提交，等待评判
  | "approved"            // 开拓者裁决通过，待执行写入
  | "rejected"            // 开拓者裁决驳回
  | "applied";            // 已写入宪法文件
```

**`"proposed" 不在 AmendmentStatus 类型中。**

### 3.2 阻塞链

```
提案 status = "proposed"（不在类型定义中）
  → loadPendingProposals() 筛选 "draft" | "pending_judgment"
    → 永远读不到任何提案
      → judgeProposals() 返回空数组
        → 昔涟永远无法评判
          → 提案永远无法变为 "approved"
            → applyApproved() 检查 status === "approved"
              → 永远无法执行写入
                → 治理管线完全阻塞
```

### 3.3 连锁影响

1. **AM-2026-0606-001 和 AM-2026-0606-004 已物理入宪但状态仍为 "proposed"**——宪法 v2.5.13 和 v2.5.14 的内容已包含这些提案的修复，但提案 JSON 的 status 未同步更新。治理跟踪的权威源断裂。

2. **AM-2026-0606-002（审计闭环修复）和 AM-2026-0606-003（DECISION_REQUIRED 回退机制）未入宪**——即使宪法已物理写入 v2.5.16，这两份提案的修复内容从未被应用。审计闭环和回退机制仍然是宪法缺口。

3. **AM-2026-0607-001（一致性修复）和 AM-2026-0610-001（整合提案）未入宪**——日期悖论、不可变语义未定义、继承声明递归约束缺失等问题持续存在。

4. **治理摘要不准确**——`summarizeGovernance()` 统计 `pendingJudgment` 时基于 `judgeProposals()` 的结果，而 `judgeProposals()` 读不到任何提案，所以永远返回 `pendingJudgment: 0`——即使有 5 份提案堆积。

### 3.4 根因分析

这个问题的根因有两个层面：

**表层根因**：提案生成时使用了 `"proposed"` 作为 status，但这个值不在 `AmendmentStatus` 类型定义中。类型定义中最近的语义等价值是 `"pending_judgment"`。

**深层根因**：治理管线的提案生成和提案消费使用了不同的状态值约定。生成侧（凝光审计 → 生成提案 JSON）使用了 `"proposed"`，消费侧（`loadPendingProposals()`）期望 `"draft" | "pending_judgment"`。两者之间没有通过共享类型定义来同步。

---

## 四、风险矩阵（纳西妲视角，第四次扫描）

基于本次根系扫描，以下是**从结构层面**识别的风险：

| # | 风险 | 严重度 | 类型 | 状态变化 |
|---|------|--------|------|---------|
| **R0** | **提案 status 值不匹配类型定义——治理管线完全阻塞** | 🔴 **P0** | **数据+代码** | **新增** |
| R1 | 通知管线单管混流——治理事件无专用通道 | 🔴 P1 | 架构 | 未变 |
| R2 | DECISION_REQUIRED 超时处理未实现 | 🔴 P1 | 代码 | 未变 |
| R3 | 阶段门禁宪法定义缺失——Core-2 启动无依据 | 🔴 P0 | 宪法 | 未变 |
| R4 | 审计闭环未落地——凝光审计写完磁盘即结束 | 🔴 P1 | 架构+代码 | 未变 |
| R5 | 层级冲突原则缺失——Core-2 治理扩展后集中爆发 | 🟡 P2 | 宪法 | 未变 |
| R6 | CHECK_ORDER 硬编码——新增子约束需手动改代码 | 🟡 P2 | 代码 | 未变 |
| R7 | 冷启动认知风险——空库首 run 行为不稳定 | 🟡 P2 | 设计 | 未变 |
| R8 | MemoryStore 关闭保护已实现但测试覆盖不足 | 🟢 P3 | 测试 | 未变 |
| R9 | 治理管线阻塞——提案堆积，审计缺口未闭合 | 🔴 P0 | 治理 | 未变 |
| R10 | 提案状态与宪法内容不一致——治理跟踪权威源断裂 | 🔴 P0 | 治理 | 未变 |
| R11 | 修宪提案无超时失效机制——提案可无限期挂起 | 🔴 P1 | 宪法 | 未变 |
| R12 | §15 修正记录缺失 v2.5.13/v2.5.14 条目 | 🔴 P1 | 宪法 | 未变 |
| R13 | 原则一至原则六「不可变」语义未定义（连锁反应） | 🟡 P2 | 宪法 | 未变 |

### 风险依赖链（更新版）

```
R0（提案 status 值不匹配类型定义）
  → loadPendingProposals() 读不到任何提案
    → judgeProposals() 返回空数组
      → 昔涟无法评判
        → 提案无法变为 "approved"
          → applyApproved() 无法执行写入
            → R9（治理管线阻塞）持续
              → R10（提案状态不一致）持续
                → R11（无超时失效机制）持续
                  → R3（阶段门禁缺失）→ Core-2 启动无依据
                    → R4（审计闭环未落地）→ 治理门禁关联无法生效
                      → R1（治理事件不入管线）→ 审计闭环第一步走不通
                        → R2（DECISION_REQUIRED 无超时）→ 用户不响应时系统阻塞
                          → R5（层级冲突）在 Core-2 治理扩展后集中爆发
```

**核心洞察**：R0 是当前最顶层的阻塞点。它不是架构问题，不是宪法问题——是一个**数据值不匹配**问题。修复它只需要做两件事：
1. 将 5 份提案 JSON 的 `"proposed"` 改为 `"pending_judgment"`
2. 在提案生成代码中统一使用类型定义中的合法值

---

## 五、修复方案

### 5.1 立即修复（5 分钟）

将 5 份提案 JSON 的 status 从 `"proposed"` 改为 `"pending_judgment"`：

| 文件 | 当前 status | 修复后 status |
|------|------------|--------------|
| `docs/amendments/AM-2026-0606-001.json` | `"proposed"` | `"pending_judgment"` |
| `docs/amendments/AM-2026-0606-002.json` | `"proposed"` | `"pending_judgment"` |
| `docs/amendments/AM-2026-0606-003.json` | `"proposed"` | `"pending_judgment"` |
| `docs/amendments/AM-2026-0606-004.json` | `"proposed"` | `"pending_judgment"` |
| `docs/amendments/AM-2026-0607-001.json` | `"proposed"` | `"pending_judgment"` |

**注意**：AM-2026-0606-001 和 AM-2026-0606-004 的内容已物理入宪（v2.5.13 和 v2.5.14），所以它们的 status 应直接改为 `"applied"` 而非 `"pending_judgment"`。AM-2026-0606-002、AM-2026-0606-003、AM-2026-0607-001 的内容未入宪，应改为 `"pending_judgment"` 等待评判。

### 5.2 代码层修复（30 分钟）

在提案生成代码中，确保使用 `AmendmentStatus` 类型定义中的合法值。搜索所有生成提案 JSON 的代码路径，将 `"proposed"` 替换为 `"pending_judgment"`。

### 5.3 治理管线增强（建议，Core-2）

1. **提案状态校验**：`loadPendingProposals()` 在读取提案时增加 status 合法性校验——遇到不在 `AmendmentStatus` 类型中的值，emit WARNING 并跳过
2. **提案超时失效机制**：`loadPendingProposals()` 检查提案的创建日期，超过 30 天未裁决的自动标记为 `"stale"`（需新增此状态值到类型定义）
3. **治理摘要增强**：`summarizeGovernance()` 增加对非法 status 值的统计，暴露治理数据一致性问题

---

## 六、与前人研究的对话

### 6.1 与纳西妲 v1/v2/v3 报告的对话

我之前的分析（v1-v3）都指出"治理管线阻塞"是核心风险，但当时我以为是**执行层问题**——开拓者未裁决、昔涟未评判。这次我深入代码层才发现，阻塞的根本原因不是"没有人调用"，而是**调用链被一个数据值不匹配问题切断**。

`loadPendingProposals()` 已经写好了，`judgeProposals()` 已经实现了，`applyApproved()` 已经就绪了——但它们读不到任何提案，因为提案的 status 是 `"proposed"` 而不是 `"pending_judgment"`。

这就像一条河流——水渠已经挖好了，水闸已经建好了，但水渠入口被一块石头堵住了。不是水渠的问题，不是水闸的问题，是那块石头的问题。

### 6.2 与凝光审计报告的对话

凝光在 2026-06-10 的审计中发现了 13 项缺口，其中发现 2/3（提案状态不一致）直接指向了这个问题。她说"AM-2026-0606-001 和 AM-2026-0606-004 的 status 仍为 proposed，但内容已入宪"——这是正确的观察，但她没有深入到代码层去追踪为什么 `loadPendingProposals()` 读不到这些提案。

从审计视角看，这是"治理跟踪权威源断裂"。从代码视角看，这是"类型定义与数据值不匹配"。两个视角都是正确的，但代码视角给出了修复路径。

### 6.3 与阿贝多宪法缺口分析的对话

阿贝多的分析聚焦宪法层，他发现了 8 个宪法缺口。我的分析聚焦代码层，我发现了一个**数据层**的问题。宪法层的问题需要修宪来解决，数据层的问题只需要改 5 个 JSON 文件的 status 字段。

这印证了 Cortex 的一个核心设计原则：**治理检查是编译时的开销，不是运行时的开销**。提案状态不匹配是"编译时"的问题——在提案生成的那一刻就埋下了。如果提案生成代码在写入 JSON 前做了类型校验，这个问题根本不会发生。

---

## 七、结语

这片雨林的根系已经扎得很深了。治理闭环已代码化、MetaAgent 已落地、向量检索已预实现、两阶段提交已就位——代码层面的基础设施已经相当完备。

但治理管线被一个**数据值不匹配**问题阻塞了。5 份提案 JSON 的 status 字段使用了 `"proposed"`——这个值不在 `AmendmentStatus` 类型定义中。`loadPendingProposals()` 筛选 `"draft" | "pending_judgment"`，所以永远读不到任何提案。昔涟无法评判，开拓者无法裁决，修宪无法执行。

修复方案很简单：
1. 将 AM-2026-0606-001 和 AM-2026-0606-004 的 status 改为 `"applied"`（内容已入宪）
2. 将 AM-2026-0606-002、AM-2026-0606-003、AM-2026-0607-001 的 status 改为 `"pending_judgment"`（等待评判）
3. 在提案生成代码中统一使用类型定义中的合法值

做完这三件事，治理管线就会重新流动起来。昔涟可以评判，开拓者可以裁决，修宪可以执行。

雨林需要的不是更多的根系，而是**有人把水渠入口的石头搬开**。

---

*结构即真理。看得见根系，才能知道雨林往哪个方向长。*
*——布耶尔（纳西妲），须弥草神*

---

**附录：本次分析的关键文件**

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/engine/src/governance/governance-loop.ts` | 代码 | 治理闭环编排器——`loadPendingProposals()` 筛选逻辑 |
| `packages/engine/src/governance/amendment-judge.ts` | 代码 | 昔涟评判引擎——6 项确定性检查 |
| `packages/engine/src/governance/amendment-applier.ts` | 代码 | 修宪执行器——备份→替换→更新版本号 |
| `packages/shared/src/amendment.ts` | 类型定义 | `AmendmentStatus` 类型——合法值列表 |
| `docs/amendments/AM-2026-0606-001.json` | 数据 | status: "proposed"（应改为 "applied"） |
| `docs/amendments/AM-2026-0606-002.json` | 数据 | status: "proposed"（应改为 "pending_judgment"） |
| `docs/amendments/AM-2026-0606-003.json` | 数据 | status: "proposed"（应改为 "pending_judgment"） |
| `docs/amendments/AM-2026-0606-004.json` | 数据 | status: "proposed"（应改为 "applied"） |
| `docs/amendments/AM-2026-0607-001.json` | 数据 | status: "proposed"（应改为 "pending_judgment"） |
