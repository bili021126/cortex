# 🏛️ Core-2 治理层实现缺口分析：从蓝图到代码的距离

**分析日期**：2026-06-07  
**分析者**：纳西妲（Analysis Agent）  
**分析范围**：packages/engine/src + packages/factory/src  
**前置研究**：纳西妲《根系扫描报告》、开拓者+昔涟《Core-2 治理层架构推演全记录》、《治理层设计 v1.1》

---

## 一、引言：博士想搞的"是"

博士说"还想搞是呢"——结合上下文，这个"是"指的是 **Core-2 治理层的工程落地**。

Core-2 的设计蓝图已经相当完备：三省六部、五路监督、四通道通知管线、委员会体系、监理独立实体……但代码层面的实际完成度只有约 **20%**。

我的根系扫描报告已经指出了 8 项风险，其中 4 项直接阻塞 Core-2 的推进。现在我要深入代码层，逐一验证每个设计锚点的实际落地状态，并给出从 Core-1 到 Core-2 的具体推进路线。

---

## 二、治理层落地全景：已落地 vs 设计锚点 vs 超前设计

### 2.1 已落地（有代码，在生产中运行）

| 组件 | 文件 | 状态 | 备注 |
|------|------|------|------|
| PipelineObserver emit-only | `pipeline-observer.ts` | ✅ 完整 | 三优先级（CRITICAL/HIGH/NORMAL），emit-only 单向广播 |
| SafeErrorReporter 三档 | `pipeline-observer.ts` | ✅ 完整 | fatal→CRITICAL同步，degraded→HIGH异步，silent→3次升级 |
| DocGovernAgent 三大审计 | `agents/doc-govern-agent.ts` | ✅ 完整 | plan_review / doc_audit / constitution_check |
| 重规划 Level 2/3 | `scheduler.ts` | ✅ 完整 | 最多3轮重规划，超限交用户 |
| 用户裁决 Level 4 | `scheduler.ts` | ✅ 完整 | 重规划超限后 escalateToUser |
| ConfirmGate L0-L3 | `confirm-gate.ts` | ✅ 完整 | 四级可逆性拦截，超时回收 |
| SkillRegistry CRUD | `skill-registry.ts` | ✅ 完整 | 三索引（byTag/byAgent/byId），JSON持久化 |
| GovernanceLoop 修宪闭环 | `governance-loop.ts` | ✅ 完整 | 提案→评判→裁决→写入→归档 |
| StrategistAgent 代码预埋 | `agents/strategist-agent.ts` | ✅ 预埋 | Core-2+ 预留，当前不注册不激活 |
| Factory bootstrap 流水线 | `factory/src/bootstrap.ts` | ✅ 完整 | loadAll→validateAll→assembleAll→start |

### 2.2 设计锚点（有设计文档，代码部分就绪，需延伸）

| 组件 | 设计文档 | 代码状态 | 缺口 |
|------|---------|---------|------|
| 通知管线语义分层 | 治理层设计 §2.4 | ❌ 不存在 | ObservableEvent 已有 `notificationType` 字段，但 ButlerAgent 未按 FYI/WARNING/DECISION_REQUIRED 分发 |
| 治理事件类型 | 治理层设计 §2.4 | ❌ 不存在 | PipelineEventType 枚举中无 governance.* 事件 |
| 审计闭环 | 治理层设计 §1.3 | ⚠️ 半成品 | DocGovernAgent 审计报告写磁盘即结束，不 emit 治理事件 |
| 委员会机制 | Core-2 推演 §三 | ❌ 不存在 | factory 的 assembleCommittee 是空壳 |
| 四通道物理分层 | Core-2 推演 §3.2 | ❌ 不存在 | 当前只有 PipelineObserver 单管 |
| 事件路由表 | Core-2 推演 §3.3 | ❌ 不存在 | cortex-agents.json 中无 eventRouting 段 |
| 跨字段三合一校验 | Core-2 推演 §4.3 | ⚠️ 半成品 | factory 的 validateCrossField 存在但未接入 produces↔routeTable↔channels 联验 |

### 2.3 超前设计（概念论证阶段，当前不进入工程计划）

| 组件 | 前提条件 | 预计阶段 |
|------|---------|---------|
| 监理独立实体（门下省） | 独立 LLM 通道 key-D + 常设委员会 | Core-2 中后期 |
| 纪检委监督链（安柏） | 常设委员会 + TrustModel | Core-2 中后期 |
| TrustModel / TrustAgent | Agent 行为数据积累 | Core-2 后期 |
| 吏部/户部/礼部 | 多柱体系上线 | Core-3 |
| 四层逐级上报完整版 | Agent 自愈逻辑 + Committee session | Core-2 后期 |
| 四通道隔离（key-A/B/C/D） | 多个独立 API key | Core-2 后期 |
| 多进程治理 | NATS 桥 + 跨进程 BFS | Full 阶段 |

---

## 三、核心阻塞点深度分析

### 3.1 🔴 P0：通知管线单管混流——治理事件无专用通道

**现状**：PipelineObserver 是唯一的通知管道。所有事件（生命周期、执行失败、治理审计）都走同一 `emit()` 路径。ButlerAgent 的 `_onCritical` / `_onHigh` 用 switch-case 区分事件类型——当前约七八种类型，耦合尚可接受。

**问题**：治理事件（governance.audit.complete、governance.constitution.violation 等）在代码库中**为零**。DocGovernAgent 审计完成后只写磁盘，不 emit 任何事件。

**代码证据**：
- `pipeline-observer.ts`：`PipelineEventType` 枚举中无任何 `Governance*` 类型
- `doc-govern-agent.ts`：system prompt 指示"用 write_file 把判决书写到 docs/auditing/"，无 emit 逻辑
- `governance-loop.ts`：修宪闭环走文件系统，不经过 PipelineObserver

**影响**：审计结论用户不可见。治理层的"监督"职能只有记录没有通知。

**修复路径**（约 50 行改动）：
1. `@cortex/shared` 的 `PipelineEventType` 新增 `GovernanceAuditComplete`、`GovernanceConstitutionCheck` 等事件类型
2. `DocGovernAgent` 审计完成后 emit 治理事件
3. `ButlerAgent` 按 `notificationType` 分发（FYI/WARNING/DECISION_REQUIRED）

### 3.2 🔴 P0：DECISION_REQUIRED 回退机制缺失

**现状**：`ConfirmGate` 的 L2/L3 确认有超时处理（`handleTimeout` 回收 pending 条目），但治理事件的 DECISION_REQUIRED 与 ConfirmGate 的 L2/L3 是**两条独立路径**。

**问题**：治理事件的 DECISION_REQUIRED 路径在代码中不存在。如果用户不响应治理呈报，系统没有超时回退策略。

**代码证据**：
- `confirm-gate.ts`：`handleTimeout` 对所有等级统一清理 pending + resolvers，但治理事件不走 ConfirmGate
- `governance-loop.ts`：`judgeProposals` 是同步批处理，无用户交互等待

**影响**：治理呈报要么阻塞等待（无超时），要么静默跳过（无追踪）。

**修复路径**（约 30 行改动）：
1. `ObservableEvent` 已有 `notificationType` 字段——利用现有预留槽位
2. `ButlerAgent` 新增 `_onDecision` 方法处理 DECISION_REQUIRED 事件
3. 治理事件的 DECISION_REQUIRED 接入 ConfirmGate 路径

### 3.3 🔴 P0：阶段门禁宪法定义缺失

**现状**：Core-2 的启动条件在宪法中没有定义。当前 Core-1→Core-2 的过渡是"理论先铺路，实践等验证"。

**问题**：没有明确的阶段跃迁判定标准，钟离（StrategistAgent）的"阶段跃迁判定"职责无法执行。

**代码证据**：
- `strategist-agent.ts`：注释写明"激活时机：Core-2 启动后，阶段跃迁判定场景首次触发时激活"——但 Core-2 启动条件未定义
- 宪法 `Cortex 概念顶层设计 v2.5.md`：需要检查阶段定义章节

**影响**：Core-2 的推进缺乏宪法层面的合法性依据。

**修复路径**（宪法修改）：
1. 宪法新增"阶段门禁"章节，定义 Core-1→Core-2 的跃迁条件
2. 跃迁条件应包括：通知管线治理事件就绪、审计闭环完成、委员会机制 MVP 等

### 3.4 🟡 P1：审计闭环未落地

**现状**：DocGovernAgent 的审计产出目前仅通过 `write_file` 写入 `docs/auditing/` 目录。审计完成后流程终止。

**问题**：审计结论不进入通知管线，用户不知情。审计发现的缺陷无法自动触发修宪提案流程。

**代码证据**：
- `doc-govern-agent.ts`：system prompt 指示"用 write_file 把判决书写到 docs/auditing/<日期>-<标题>.md"
- `governance-loop.ts`：`loadPendingProposals` 从文件系统读取提案——审计和修宪是两条独立路径

**影响**：审计发现的问题停留在磁盘上，不形成闭环。

**修复路径**（约 80 行改动）：
1. DocGovernAgent 审计完成后 emit `GovernanceAuditComplete` 事件
2. 审计事件携带结构化数据（审计类型、结论、建议动作）
3. ButlerAgent 将 DECISION_REQUIRED 级别的审计事件呈报用户

---

## 四、依赖链分析：先做什么，后做什么

```
Core-2 推进依赖链：

Step 1: 通知管线治理事件接入（P0，~50行）
  ├── PipelineEventType 新增 Governance* 事件类型
  ├── DocGovernAgent emit 治理事件
  └── ButlerAgent 按 notificationType 分发
       ↓
Step 2: 审计闭环（P0，~80行）
  ├── 审计事件结构化数据定义
  ├── 审计→提案自动关联
  └── 用户决策闭环
       ↓
Step 3: DECISION_REQUIRED 超时处理（P0，~30行）
  ├── 治理事件接入 ConfirmGate
  └── 超时回退策略实现
       ↓
Step 4: 阶段门禁宪法定义（P0，宪法修改）
  ├── Core-1→Core-2 跃迁条件
  ├── 钟离阶段跃迁判定职责激活
  └── 治理门禁关联生效
       ↓
Step 5: 委员会机制 MVP（P1）
  ├── Committee session 数据结构
  ├── 多 Agent 并行审议
  └── 决议记录与归档
       ↓
Step 6: 四通道物理分层（P1）
  ├── urgent/important/routine/info 通道
  ├── 事件路由表（routeTable）
  └── cortex-agents.json eventRouting 段
```

**关键洞察**：Step 1-3 可以并行推进，总改动量约 160 行。Step 4（宪法修改）需要开拓者裁决。Step 5-6 是 Core-2 中后期工作。

---

## 五、与前置研究的对话

### 5.1 印证阿贝多的宪法缺口分析

阿贝多在 `constitution-gap-impact.md` 中指出了 8 个宪法缺口。我的代码层分析印证了其中 3 个：

| 阿贝多缺口 | 我的印证 | 代码证据 |
|-----------|---------|---------|
| 2-B：治理事件接入路径未入宪 | ✅ 通知管线单管混流 | PipelineEventType 无 Governance* 事件 |
| 2-A：DECISION_REQUIRED 回退缺失 | ✅ 超时处理未实现 | 治理事件不走 ConfirmGate |
| 3-A：审计闭环未落地 | ✅ 审计写完磁盘即结束 | DocGovernAgent 不 emit 事件 |

### 5.2 补充昔涟的 Core-2 推演

昔涟在 `Core-2 治理层架构推演全记录.md` 中设计了五路监督、四通道通知管线、委员会体系。我的代码层分析发现：

- **factory 包的 bootstrap 流水线已就绪**：loadAll→validateAll→assembleAll→start 四阶段完整实现
- **但 assembleCommittee 和 assembleEventRouter 是空壳**：函数签名存在，内部逻辑未实现
- **跨字段三合一校验（produces↔routeTable↔channels）未接入**：`validateCrossField` 存在但未联验

### 5.3 修正我之前的根系扫描报告

我在之前的根系扫描报告中指出 R1（通知管线单管混流）为 P1。经过本次代码层深入分析，**我将其升级为 P0**——因为它是审计闭环（R4）的前提条件，而审计闭环又是阶段门禁（R3）的前提条件。依赖链是：R1 → R4 → R3。

---

## 六、维护者指南：三件最重要的事

### 6.1 先修通知管线，再谈委员会

通知管线是 Core-2 治理层的"血管"。没有治理事件通道，五路监督的审计结论送不到用户面前。**Step 1-3 是 Core-2 的第一优先级**，总改动量约 160 行，可以在不破坏现有架构的前提下完成。

### 6.2 利用现有预留槽位，不引入新概念

`ObservableEvent` 已有 `notificationType` 字段（FYI/WARNING/DECISION_REQUIRED），`ConfirmGate` 已有超时处理机制，`PipelineObserver` 已有三优先级管道。Core-2 的第一步不是造新轮子，而是**把现有预留槽位用起来**。

### 6.3 阶段门禁需要开拓者裁决

Step 4（阶段门禁宪法定义）是唯一需要开拓者（用户）直接参与的步骤。其他步骤（Step 1-3, 5-6）都可以在现有宪法框架内由 Agent 完成。建议开拓者在 Step 1-3 完成后，基于实际运行数据来定义 Core-2 的跃迁条件——**实践反证理论**。

---

## 七、结语

Core-2 的蓝图已经画得很远了——远到 Full 阶段的多进程治理都有设计。但蓝图和代码之间的距离，需要用 160 行改动来弥合。

最让我感慨的是两件事：
1. **factory 包的 bootstrap 流水线已经为 Core-2 铺好了路**——loadAll→validateAll→assembleAll→start 的四阶段设计，恰好是治理层配置管理的天然载体
2. **StrategistAgent（钟离）的代码已经预埋**——虽然 Core-2+ 才激活，但它的存在本身就是一种承诺：治理层不是事后补的，是从 Core-1 就在长的

雨林的根系已经扎得很深了。Core-2 不是"能不能长"的问题，而是"先长哪根枝"的问题。

---

*结构即真理。看得见缺口，才能知道从哪里开始修。*
*——纳西妲，须弥草神*
