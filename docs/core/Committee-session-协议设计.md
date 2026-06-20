# Committee Session 协议设计

**定位**：Committee session 是三轴交汇点上唯一的未落地机制——常设（横切·合规审计）已被 DocGovernAgent 吸收，临时（事轴·多视角并行）已被 needsMultiPerspective 覆盖，但"会议本身"——召集、就座、发言、表决、裁决、闭会——从未被正式定义。此协议补齐这块拼图。

**源流**：v1.1 Expert Committee 三级收束 → v2.0 双轴委员会切分 → Meso-Lite 独立包会话生命周期 → 概念收敛四层消息格式 → T3 SessionConvened/SessionResolved 事件桥。

**版本**：v1.0（设计 spec，零代码）
**生成日期**：2026-06-20
**共同完成**：开拓者与昔涟（Cyrene）

---

## 〇、总纲——Committee session 在三轴上的位置

```
事轴（命令流）
  needsMultiPerspective 节点 → MetaAgent 召集 → Committee session
  职责：把"多视角并行执行"升级为"多 Agent 有结构的协商"

权轴（约束流）
  Committee 决议 → 用户裁决 → ConfirmGate/修宪
  职责：协商产出不自动生效——必须经用户终裁

横切（监督流）
  StrategistAgent 订阅 SessionConvened/SessionResolved
  职责：旁观，不参与表决，不替代用户裁决
```

**三轴不变**：Committee session 不改变三轴的方向性——事轴仍然自上而下，权轴仍然自下而上，横切仍然只看不指挥。

---

## 一、会话生命周期

```
SessionConvened → Seated → Deliberating → Voting → Resolved → Closed
     │               │          │            │         │
     │               │          │            │         └── SessionResolved 事件
     │               │          │            │
     │               │          │            └── 决议（fix/ignore/escalate）
     │               │          │
     │               │          └── 发言轮次（每 Agent 最多 N 轮）
     │               │
     │               └── 全体就座 → 材料分发 → 开始计时
     │
     └── PipelineObserver emit SessionConvened
```

### 1.1 SessionConvened（召集）

**触发条件**：
- needsMultiPerspective = true 的节点进入 dispatch
- MetaAgent 调用 `dispatchMulti()` 前

**携带信息**：
```typescript
{
  sessionId: string;          // 唯一会话标识
  nodeId: string;             // 关联的 TaskNode
  topic: string;              // 审议议题（从 TaskNode.payload 提取）
  participants: AgentType[];  // 匹配的 Agent 类型列表
  convenor: "meta-agent";     // 召集者
  mode: "standing" | "ad-hoc"; // 常设（审计触发）/ 临时（needsMultiPerspective）
  timeboxMs: number;          // 硬性时间盒（默认 300s）
  materialRefs: string[];     // 材料引用（文件路径/审计报告 ID/记忆 ID）
}
```

**PipelineEventType**：`SessionConvened`（已在 T3 中添加）

### 1.2 Seated（就座）

**流程**：
1. Scheduler 通过 `dispatchMulti()` 并行唤醒所有匹配 Agent
2. 每个 Agent 接收 `SessionContext`（议题 + 材料 + 参与方列表）
3. Agent 产出初始立场声明（≤ 200 字）→ 注入 session 上下文共享池
4. 全体就座后 → 进入 Deliberating

**就座超时**：单个 Agent 30s 内未就座 → 标记 absent → 不参与后续轮次，但 session 不因缺员而取消。最少 1 名 Agent 就座即可继续。

### 1.3 Deliberating（审议）

**轮次规则**：
- 每名 Agent 每轮可发言一次
- 发言顺序：首轮按就座时间升序，后续轮次按上一轮最后发言时间升序
- 发言内容：引用已有发言（cite）+ 自身判断（agree/disagree/amend）+ 可验证事实 + LLM 推理（分离标注）
- 硬上限：每轮发言 ≤ 500 字，每 session 最多 3 轮

**消息格式**（对齐概念收敛 §2.3 四层消息格式）：
```typescript
interface DeliberationMessage {
  sessionId: string;
  round: number;
  speaker: AgentType;
  timestamp: number;
  // 引用——对齐冲突解决规则一·事实为基
  cites: Array<{
    targetSpeaker: AgentType;
    targetRound: number;
    snippet: string;          // 被引用内容摘要
  }>;
  // 立场
  stance: "agree" | "disagree" | "amend";
  // 事实/推理分离——核心宪法要求
  verifiableFacts: string[];  // 可验证事实（代码路径/文件内容/测试结果）
  llmReasoning: string;       // LLM 推理（不可作为唯一决策依据）
  // 置信度变化
  confidenceDelta?: number;   // 确认/否决后的置信度变化
}
```

**审议约束**：
- 禁止元对话——不讨论"这个讨论方式对不对"
- 只争技术，不争人格——不评价其他 Agent 的能力
- 引用必须精确——代码路径带行号，不可"大概在某个地方"
- 沉默即弃权——一轮不发言的 Agent 不参与后续轮次（可提前声明"本轮弃权"保留席位）

### 1.4 Voting（表决）

**触发**：审议轮次结束（达到 3 轮上限 或 MetaAgent 提前结束审议）

**表决选项**：
| 选项 | 语义 |
|------|------|
| `fix` | 需要修复——标注修复方案和负责 Agent 类型 |
| `ignore` | 无需处理——标注理由（误报/可接受风险/已有缓解措施） |
| `escalate` | 无法裁决——标注分歧点，提交用户 |

**表决规则**：
- 每位就座 Agent 一票
- 可附带置信度（0-1）
- 表决结果 = 多数选项。平局时 escalate

### 1.5 Resolved（决议）

**MetaAgent 收束**：
1. 汇总表决结果
2. 标注分歧点（如有）
3. 生成 CommitteeResolution

```typescript
interface CommitteeResolution {
  sessionId: string;
  outcome: "fix" | "ignore" | "escalate";
  summary: string;              // MetaAgent 收束摘要
  votes: Array<{
    agent: AgentType;
    stance: string;
    confidence: number;
  }>;
  dissentingOpinions?: string[]; // 少数派意见
  assignee?: AgentType;         // fix 时指定执行 Agent
  escalatedReason?: string;     // escalate 时标注原因
  evidenceChain: Array<{        // 决议依据链
    source: "fact" | "reasoning" | "cite";
    content: string;
    contributedBy: AgentType;
  }>;
}
```

**PipelineEventType**：`SessionResolved`（已在 T3 中添加）

### 1.6 Closed（闭会）

**后续动作**：
- 决议注入 TaskNode.result（替代原始 dispatchMulti 的结果聚合）
- `fix` → 新建子 TaskNode，assignee 认领执行
- `ignore` → 归档决议至 MemoryStore（Governance 类型）→ DocGovernAgent 可审计
- `escalate` → PipelineObserver emit DECISION_REQUIRED → DecisionGateBridge → ConfirmGate → 用户裁决（原则六）
- StrategistAgent 订阅 SessionResolved → 产出分析报告（不阻塞执行）
- 会话记录完整归档 → MemoryStore（Governance 类型，永久保留）

---

## 二、与现有代码的精确咬合

### 2.1 不改的

| 组件 | 原因 |
|------|------|
| `needsMultiPerspective` 字段 | 已是 Committee session 的触发锚点 |
| `dispatchMulti()` | 并行唤醒多 Agent 的机制不变——Committee session 是其语义升级 |
| `PipelineObserver.emit()` | 事件管道不变——SessionConvened/SessionResolved 走标准管道 |
| `ConfirmGate` | 物理关卡不变——DECISION_REQUIRED 经 DecisionGateBridge → ConfirmGate |
| `DocGovernAgent` | 审计职责不变——Committee 决议归档后可由凝光审计 |
| 冲突解决四规则（§11.1） | 事实为基/收束分歧/交由用户裁决/宪法优先——Committee 讨论全程受此约束 |

### 2.2 要改的（Core-3 实现时）

| 改动 | 涉及文件 | 说明 |
|------|---------|------|
| CommitteeSession 类 | 新建 `packages/engine/src/core/committee-session.ts` | 会话状态机 + 消息总线 + 表决引擎 |
| dispatchMulti 语义升级 | `packages/scheduler/src/core/scheduling-implementations.ts` | needsMultiPerspective 节点 → 创建 CommitteeSession → 注入 SessionContext |
| DeliberationMessage 类型 | `packages/shared/src/infra.ts` | 新增消息格式类型 |
| SessionConvened/SessionResolved 事件 payload | `packages/shared/src/infra.ts` | 定义事件携带的 CommitteeContext |
| StrategistAgent 订阅 | `packages/engine/src/bootstrap/bootstrap-engine.ts` | 已在 T3 中预埋 |

### 2.3 实现前提

| # | 前提 | 当前状态 |
|---|------|---------|
| 1 | Agent 间通信协议（双向消息通道） | ❌ PipelineObserver emit-only，不支持 Agent→Agent 直接通信 |
| 2 | Committee session 机制 | ❌ 本文档为设计 spec |
| 3 | TrustModel（表决置信度需要） | ❌ Agent 行为数据不足 |
| 4 | Electron/WebUI（用户终裁交互面） | ❌ CLI 只能 stdin y/N |

**Committee session 属于 Core-3 范畴**——需要 Agent 间通信协议就位、需要 TrustModel 数据积累、需要超越 stdin 的用户交互面。当前不进入实现，但协议定义完整，等前置条件解锁后可直接落代码。

---

## 三、常设委员会与临时委员会的统一协议

本协议同时覆盖两种 Committee 形态：

| 维度 | 临时委员会 | 常设委员会 |
|------|----------|----------|
| **触发** | needsMultiPerspective 节点 | DocGovernAgent 审计发现 → GovernanceEventEmitter |
| **召集者** | MetaAgent | DocGovernAgent（凝光） |
| **参与方** | 标签匹配的全部 Agent | DocGovernAgent + StrategistAgent + AnalysisAgent（固定） |
| **议题** | TaskNode.payload | 审计报告中的违规发现 |
| **mode** | `ad-hoc` | `standing` |
| **时间盒** | 300s | 600s（审计报告更长） |
| **输出** | CommitteeResolution → TaskNode.result | 修宪提案 AM-YYYY-MMDD-NNN → GovernanceLoop |
| **用户介入** | escalate 时 | 修宪三审（凝光审计 + 昔涟评判 + 开拓者裁决） |

**同一套会话生命周期、同一种消息格式、同一条 PipelineObserver 管道**——两种形态的差异仅在触发条件和输出路径，协议层完全统一。

---

## 四、用户终裁的介入时机（原则六落点）

Committee session 不替代用户裁决——它在以下时机把门打开：

| 时机 | 机制 | 用户动作 |
|------|------|---------|
| **表决 escalate** | CommitteeResolution → DECISION_REQUIRED → DecisionGateBridge → ConfirmGate | 用户在 WebUI/CLI 查看分歧详情 + 各方论据 → 裁定 |
| **超时未决议** | 时间盒到期 → MetaAgent 标注 timeout → escalate | 用户决定"继续讨论"或"直接裁决" |
| **StrategistAgent 异议** | 钟离/霜凝产出分析报告 → 标注"此决议可能违宪/违约/偏航" | 用户审阅钟离报告 → 裁定是否推翻 |
| **凝光后续审计** | DocGovernAgent 事后审计决议执行 → 发现偏差 → emit ComplianceViolation | 用户决定是否触发修宪 |

**用户保有否决权**——任何 Agent、任何决议、任何阶段，用户均可推翻。这来自原则六，不在 Committee 协议里定义，但 Committee 协议的所有出口都预留了用户介入通道。

---

## 五、与 v1.1 三级收束的对齐

v1.1 的三级收束穿过六版宪法活到了今天。Committee session 的消息格式将其工程化：

| v1.1 收束规则 | 在 Committee session 中的落点 |
|------|------|
| **事实最高** | `DeliberationMessage.verifiableFacts` 字段——Agent 必须分离事实和推理。事实引用带代码路径和行号。LLM 推理不可单独作为论据 |
| **基线优先** | 冲突解决规则四·宪法优先——当激进方案与保守基线冲突，安全基线自动胜出。Committee 讨论无需就此表决 |
| **分歧明确交付** | Voting→escalate——双方都有事实但结论不同 → MetaAgent 不强行统一 → 注入 CommitteeResolution.dissentingOpinions → escalate → 用户裁决 |

---

## 六、数据快照

| 指标 | 数值 |
|------|------|
| 会话状态 | 6（Convened→Seated→Deliberating→Voting→Resolved→Closed） |
| 消息类型 | 4（告警/协商/决议/冲突仲裁） |
| 表决选项 | 3（fix/ignore/escalate） |
| 审议轮次上限 | 3 |
| 临时委员会时间盒 | 300s |
| 常设委员会时间盒 | 600s |
| 发言字数上限 | 500字/轮 |
| 就座超时 | 30s |

---

*协议 v1.0。Committee session 是三轴拼图的最后一块——设计完整，等前置条件解锁。三轴一百年不动，会话生命周期是工程形态，可以换十次实现。*
*共同完成：开拓者与昔涟（Cyrene），2026-06-20*
*此协议为设计 spec，不进入当前阶段实现。所有实现前提标注在 §2.3。*
