# Cortex 概念顶层设计 v2.3

**版本**：v2.3
**状态**：已归档。v2.4 替代。原为 Core-1 实施中，Meso 反思阶段产出，Core 阶段准入依据
**性质**：LLM 驱动的个人工具链——工程化宪法
**前置**：v1.1（大脑隐喻，已废弃）→ v2.0（工具链隐喻）→ v2.1（Core-1 物理落地）→ v2.2（Core-1 反思：Agent 扩展+权限集中+状态机）→ v2.3（Core-1 反思：记忆四态 CAS + HCA/CSA 注意力区分）

---

## 一、Cortex 是什么

Cortex 是一个 LLM 驱动的个人工具链。它以 MetaAgent 为规划中枢，以 6 种 Agent 为执行单元，以确认门和安全规则引擎为护栏，以管家为个人助手——构成一个围绕用户项目工作的完整工具集。

核心隐喻从 v1.1（大脑/神经系统）变更为**工具链**。工具链意味着：
- 每个组件是可替换的、可验证的、职责清晰的工具
- 不存在"数字生命体"的不可知性——每个行为可审计
- 用户是工具的使用者和最终裁决者，不是"生命体"的管理者

---

## 二、六条不可变原则

| 原则 | 内容 | 不可变性 |
|------|------|---------|
| **原则一** | 确认这个动作永远在用户手里。任何 L2/L3 不可逆操作必须经用户确认 | 不可变 |
| **原则二** | 规划与执行分离。MetaAgent 只规划不执行，Agent 只执行不规划 | 不可变 |
| **原则三** | 安全边界在 Toolkit 调用层。Toolkit 按 Agent 类型集中校验权限，Agent 以身份调用，不持有权限定义 | 不可变 |
| **原则四** | 谁调用谁负责。Agent 对其工具调用的后果承担全部责任 | 不可变 |
| **原则五** | 所有可观测事件走 PipelineObserver 统一管道 | 不可变 |
| **原则六** | 用户是最终裁决者。多 Agent 并行产出由用户收束，Agent 之间不协商统一 | 不可变 |

---

## 三、系统架构

```
Cortex
│
├── Engine (容器)
│   ├── MetaAgent (规划中枢)
│   ├── Agent池 (6 Agent)
│   ├── TaskBoard (任务板，并发控制)
│   ├── ConfirmGate (确认门)
│   ├── PipelineObserver (可观测管道)
│   ├── MemoryStore (运行时记忆，30天窗口)
│   ├── Scheduler (Agent 调度，拓扑排序 → 逐层并行)
│   └── TrustModel (信任模型)
│
├── 基础设施 (独立于 Engine)
│   ├── ToolRegistry (工具目录)
│   ├── SkillRegistry (技能模板存储)
│   ├── SkillExecutor (技能模板执行)
│   ├── Sentinel (安全规则引擎，4模式)
│   └── FileLockManager (文件级锁)
│
├── 管家 (独立进程，常驻)
│   ├── 消息源插件 (邮箱/RSS/GitHub/自定义)
│   ├── 周期性汇总简报
│   └── ConfirmGate 用户交互通道
│
└── 治理层 (工具链自律框架)
    ├── 宪法 (本文档)
    ├── DocGovernAgent (自动审计引擎)
    ├── 阶段门禁检查表
    ├── DocGovern 分区 (永久审计记录)
    ├── 常设委员会 (多人并行治理)
    └── 临时委员会 (节点多视角并行审查)
```

> **物理包结构说明（Core-1）**：上述概念架构在代码层面对应 3 个包——`@cortex/shared`（全部类型定义）、`@cortex/engine`（上述 Engine 容器的全部实现 + Scheduler/MemoryStore）、`@cortex/testing`（Mock 基础设施）。依赖方向为 shared ← engine ← testing，严格遵循依赖倒置原则。Meso-Lite 中曾独立存在的 `@cortex/memory`、`@cortex/meta-agent`、`@cortex/scheduler`、`@cortex/doc-govern` 四个包已删除，其功能已并入 engine。

---

## 四、MetaAgent——规划中枢

MetaAgent 是系统中唯一的规划者。其职责：

1. **规划**：接收用户意图 → 拆解为任务树节点 → 发布到 TaskBoard
2. **标注**：为每个节点打 `type` + `tags` 标签，Agent 据此自描述匹配
3. **仲裁**：Agent 执行失败 → requestReplan(nodeId, reason) → 修改受影响节点
4. **聚合**：多 Agent 并行产出 → 聚合为统一视图 → 交管家呈现
5. **重规划**：最多 3 轮，超限交用户裁决

MetaAgent **不做**：不调用工具执行任何操作，不替用户做最终决策，不自行修改 Agent 的产出。

---

## 五、Agent 池——12 种执行单元

Agent 的定义：**扫描 TaskBoard → 自描述匹配节点标签 → 认领 → 执行 → 产出 NodeResult**。

Agent 池按复杂度伸缩：简单项目仅注册 CodeAgent 即为单 Agent 全栈模式；复杂项目全量注册即为多 Agent 专业化分工。

### 5.1 Agent 类型

| Agent | 允许工具 | 认领标签 | 模式 | 落地阶段 |
|-------|---------|---------|------|---------|
| **MetaAgent** | 只读+search_code | 中枢，不认领任务节点 | 常驻 | Core-1 |
| **CodeAgent** | 读+写+run_shell+search_code | 见 `Agent标签词汇表-v2.0.md` | 按需唤醒 | Core-1 |
| **ReviewAgent** | 只读+search_code | 见 `Agent标签词汇表-v2.0.md` | 按需唤醒 | Core-1 |
| **AnalysisAgent** | 只读+search_code+run_shell | 见 `Agent标签词汇表-v2.0.md` | 按需唤醒 | Core-1 |
| **OpsAgent** | run_shell+读+写+search_code | 见 `Agent标签词汇表-v2.0.md` | 按需唤醒 | Core-1 |
| **LoopAgent** | 只读+search_code | 见 `Agent标签词汇表-v2.0.md` | 按需唤醒 | Core-1 |
| **DocGovernAgent** | 只读+search_code | 见 `Agent标签词汇表-v2.0.md` | 按需唤醒 | Core-1 |
| **ButlerAgent** | 无（仅转述，不调工具） | 不认领节点 | 常驻 | Core-1 |
| **InspectorAgent** | tsc+madgre+AST+grep（确定性工具，非 LLM 推理） | inspector_* | 按需唤醒 | Core-1 |
| **ApiAgent** | api_* | api_test/integration_test | 按需唤醒 | Core-2 |
| **BrowserAgent** | browser_*+read_file+search_code | browser_test/ui_test | 按需唤醒 | Core-2 |
| **DataAgent** | db_* | data_check/db_verify | 按需唤醒 | Core-2 |

Agent 类型按权限边界划分——每增加一种 Agent 类型，必须对应新的权限组合。权限表集中在 Toolkit 层（`AGENT_TOOL_PERMISSIONS`），Agent 以类型身份调用，不自行定义工具白名单。

标签词汇表为封闭集合，匹配规则见 `Agent标签词汇表-v2.0.md`。

### 5.2 Agent 状态机

```
Created → Awake → Active → Awake → ... → Draining → Destroyed
  │        │        │                   │
  │        │        │                   └─ shutdown() 开始
  │        │        └─ execute() 执行中
  │        └─ wakeup() 完成，等待任务
  └─ 构造完毕，未唤醒
```

| 状态 | 含义 | 可接收 execute？ |
|------|------|----------------|
| Created | 实例存在，未建立 LLM 连接 | 否 |
| Awake | 已唤醒，Toolkit 注入完毕，等待任务 | 是 |
| Active | 正在执行 | 否（已在执行中） |
| Draining | 正在关闭，完成当前事务后退出 | 否（拒绝新请求） |
| Destroyed | 已销毁 | 否 |

**唤醒策略**：
- 常驻（始终 Awake）：ButlerAgent、MetaAgent
- 按需唤醒（有匹配标签时 wakeup，干完 shutdown 回 Created）：CodeAgent、ReviewAgent、AnalysisAgent、OpsAgent、LoopAgent、DocGovernAgent、InspectorAgent、ApiAgent、BrowserAgent、DataAgent
- AgentPool.spawn() 创建 Created 实例 → Scheduler 发现标签匹配 → 调用 wakeup() → 执行 → 调用 shutdown() 回到 Created
- Scheduler 调用 execute 前检查 `status === Awake`，否则跳过该 Agent

### 5.3 自描述匹配

Agent 自描述为固定标签集。MetaAgent 规划节点时打标签。匹配规则：`node.tags ∩ agent.tags ≠ ∅` → 匹配。无 Agent 匹配 → MetaAgent 告警，重新打标签或拆节点。

### 5.4 并发控制

- TaskBoard.claim() 原子操作：已认领节点拒绝再次认领
- FileLockManager：写锁排斥所有读写锁，读锁可共存
- L2/L3 确认等待期间**不持文件锁**
- Scheduler：每种 Agent 类型保留至少 1 个实例配额，防饥饿

---

## 六、ButlerAgent（管家）——唯一用户交互出口

ButlerAgent 是 Agent 池的正式成员，类型为 `AgentType.Butler`。常驻 Awake，不认领任务节点，不调用工具。

### 6.1 五大法定职责

| # | 职责 | 说明 |
|----|------|------|
| ① | 唯一交互出口 | 所有 Agent 输出、ConfirmGate 请求、MetaAgent 结果、PipelineObserver 通知 → ButlerAgent 格式化 → 呈现用户。用户输入 → ButlerAgent 接收 → 路由 |
| ② | 决策中转 | InspectorAgent 事实报告 → ButlerAgent 解释为可理解选项 → 用户选择 → 归档 DocGovernAgent 作为约束依据 |
| ③ | 闲时采集 | 管线空闲时自然对话。聊到项目 → 用户自然说出决策原因 → 归档。聊到技术 → Agent 互相争论 → 用户旁听学习 |
| ④ | 事件通知 | Agent 状态变更 → 状态灯刷新。管线事件 → 必要时打断（失败/确认需求）或静默通知 |
| ⑤ | 入口适配 | 无项目：全屏对话入口。有项目：自动切换为 IDE 三栏布局（文件树+编辑器+对话面板） |

### 6.2 非其职责

ButlerAgent 不创造、不审查、不部署、不审计。它只转述、解释、采集、通知。

### 6.3 消息源插件

管家支持插件化个人域消息源：邮箱（标题优先+本地摘要，正文需用户许可才送 LLM）、RSS、GitHub通知等。个人数据存入管家专用存储区，不入 MemoryStore。

### 6.4 崩溃降级

管家崩溃 → Engine 继续运行 → 用户通知降级为 stdout 原始输出 → 管家恢复后批量补推。

---

## 七、确认门与安全

### 7.1 可逆性等级

| 等级 | 定义 | 确认要求 |
|------|------|---------|
| L0 | 纯读取 | 永不确认 |
| L1 | 可逆写入 | TrustLevel ≥ L3 放行，否则确认 |
| L2 | 不可逆写入 | 永远确认 |
| L3 | 不可恢复 | 永远确认 |

L1→L2 升级：单次 >3文件或 >100行 或命中风险文件名（secret/token/password/key/.env 等）。

### 7.2 ConfirmGate

Agent 调用工具 → ConfirmGate 拦截 → 查 TrustModel → 判定 → 如需确认则经管家弹窗 → 用户响应。

L2/L3 超时 = 阻塞等待（不替用户决策），L1 超时 = 默认拒绝。

### 7.3 TrustModel

按 (Agent类型, 风险域) 二维聚合接受率。冷启动从 L1 起。

疲劳确认防护：延迟 <500ms 或 30秒内连点 ≥5次 → 排除，不计入信任。50次交互无该类型操作 → trustLevel × 0.95 衰减。模型版本变更 → 信任重置。

### 7.4 Sentinel——安全规则引擎

4 种检测模式：

| # | 模式 | 触发 |
|---|------|------|
| 1 | 不可逆操作未确认 | ConfirmGate L2/L3 无 confirmedByUser |
| 2 | 窗口内异常事件 | PipelineObserver `*_FAILED` 高频 |
| 3 | 信任分数骤降 | TrustModel 接受率突降 |
| 4 | 确认门冲击 | L2/L3 操作频率异常 |

告警 → PipelineObserver 高优 → 持久化日志 + 管家通知用户。

---

## 八、PipelineObserver——可观测管道

所有可观测事件走统一管道。

```
PipelineObserver {
  on(event, handler, priority)

  优先级:
    CRITICAL → 同步执行，立即持久化
    HIGH     → 异步优先队列, 批量 1s
    NORMAL   → 异步普通队列, 批量 5s

  数据结构:
    Observation { source, type, payload, timestamp, priority }

  订阅者:
    Sentinel   → CRITICAL + HIGH
    MemoryStore → ALL (持久化)
    管家        → HIGH + NORMAL (推送/聚合)
}
```

---

## 九、记忆系统

### 9.1 四态生命周期

每条记忆处于以下四态之一，单向流转，不可回退：

```
Active → Archived → Frozen → Obliterated
  │                    │         │
  └────────────────────┘         │
  │                              │
  └──────────────────────────────┘
```

| 状态 | 含义 | 可检索 | 可关联 | 去向 |
|------|------|--------|--------|------|
| Active | 热记忆，30 天窗口内有效 | ✅ | ✅ | → Archived / Frozen / Obliterated |
| Archived | 已归档，移出热窗口 | ✅（states 显式指定） | ✅ | → Frozen / Obliterated |
| Frozen | 冻结，不再参与检索和规划 | 仅显式指定 states=[Frozen] | ❌ 新关联 | → Obliterated |
| Obliterated | 湮灭，不可逆终点 | 仅显式指定 states=[Obliterated] | ❌ 新关联 | 无 |

流转规则：
- Active → Archived：`archive(id)` — CAS 保护，仅 Active 态可归档
- Active|Archived → Frozen：`freeze(id)` — CAS 保护
- 任何非 Obliterated 态 → Obliterated：`obliterate(id)` — 不可逆，CAS 保护
- Obliterated → 任何态：永不允许
- Frozen → Active/Archived：不允许
- Archived → Active：不允许

### 9.2 CAS 原子状态变更

所有四态流转通过 `cas(id, expected, newState)` 执行原子比较并交换。expected 与当前态不一致 → 拒绝。`_isValidTransition` 在 CAS 内部校验流转合法性。

单线程 JS 事件循环保证了同步 `get()` → `set()` 之间无竞态窗口，不需要锁。

### 9.3 MemoryStore

运行时记忆，30 天热数据窗口。存储：TaskBoard、NodeResult、会话数据、TrustModel 分数、PipelineObserver Observation。

超出 30 天 → 归档到 DocGovern 分区（永久保存）。淘汰优先级：中间态 > 最终结果 > 审计记录（审计记录永不淘汰）。

### 9.4 HCA/CSA 注意力区分

记忆检索区分两种注意力模式，通过 `read()` 的 `trackAccess` 参数控制：

| 模式 | 调用方 | 行为 | `trackAccess` |
|------|--------|------|---------------|
| **HCA**（高层次注意力） | MetaAgent 规划扫描 | 检索但不累加 accessCount，不刷新 lastAccessedAt | `false` |
| **CSA**（上下文选择注意力） | Agent 执行检索 | 检索并累加 accessCount，刷新 lastAccessedAt | 默认 `true` |

设计依据：MetaAgent 规划时广度扫 50 条记忆，不等于 50 条都被用过。热度应反映 Agent 执行时的真实引用，而非规划路过。跳过 HCA 的访问统计累加，避免假热度污染执行 Agent 的检索排序。

### 9.5 DocGovern 分区

持久化治理记录。DocGovernAgent 写入。存储：审计报告、规划审查记录、阶段门禁结论、宪法一致性检查记录。

### 9.6 管家存储

独立于 MemoryStore 和 DocGovern。存储：个人消息源数据、偏好配置、冷启动观察期数据。

---

## 十、治理层

治理层是工具链的自律框架——不是另起一套政府，而是工具链上的审计、审查和裁决机制。

### 10.1 DocGovernAgent——自动审计引擎

在 TaskBoard 上认领 `plan_review`（规划审查）、`doc_audit`（文档审计）、`constitution_check`（宪法检查）节点。

- `plan_review`：最高优先级——看到必须立即认领。审查 MetaAgent 规划的自洽性、粒度、needsMultiPerspective 标注正确性
- `doc_audit`：阶段门禁时，扫描全量文档，对照检查表逐条打钩
- `constitution_check`：宪法一致性验证

产出审计报告 → 写入 DocGovern 分区 → 管家摘呈用户。

### 10.2 常设委员会——多人并行治理

常设委员会 = 多 Agent 并行审视项目整体自洽性。DocGovernAgent 牵头，成员按需动态出入。

**大事开小会，小事开大会**：
- 大事（宪法违宪、阶段跃迁、严重信任骤降）→ 小会：你 + DocGovernAgent + MetaAgent
- 小事（格式不一致、常规审计）→ 大会：DocGovernAgent + ReviewAgent + AnalysisAgent 并行审，你可以不看

### 10.3 临时委员会——节点多视角并行审查

needsMultiPerspective=true 节点 → 责任链上多 Agent 并行认领 → 各产各的 → 用户收束裁决。Agent 之间不协商统一。

交融机制 = 临时委员会。不再需要 staining/lifecycle/projection。

---

## 十一、任务流转

```
用户意图
  → MetaAgent 规划 → 打标签 → 发布到 TaskBoard
  → DocGovernAgent 审查规划 (如果是 plan_review 节点)
  → MetaAgent 修正（如需要）
  → Agent 扫描 TaskBoard → 自描述匹配 → claim 认领
  → Think→Act→Observe 循环
     → 工具调用 → ConfirmGate 拦截 → (如需确认) 管家弹窗 → 用户响应
     → FileLockManager 排队
  → 产出 NodeResult → MemoryStore
  → (如失败) MetaAgent.requestReplan → 重规划 → 重新发布
  → 管家汇总呈现
```

---

## 十二、技能记忆

LoopAgent 扫描已完成节点 → 发现可重复模式 → 生成 SkillTemplate → 写入 SkillRegistry。

MetaAgent 规划时检查 SkillRegistry：匹配当前节点的技能模板 → 标注 skillId。Agent 认领时可选择用 SkillExecutor（替代完整 ReAct 循环，省 token）。

试用期：自动沉淀技能默认试用，连续采纳 5 次自动应用，连续拒绝 3 次终止。

---

## 十三、阶段模型

| 阶段 | 核心交付 |
|------|---------|
| **Nano+** | LLM→工具→确认门 单链路验证 |
| **Meso-Lite** | 3 柱协作 + Scheduler + 记忆检索 |
| **Meso 反思** | 全量审查 + 架构反思 + 宪法 v2.0 |
| **Core-1** | Engine 重构 + 6 Agent + MemoryStore + Scheduler + PipelineObserver（实施中，58 测试通过） |
| **Core-2** | Sentinel + TrustModel + SkillRegistry + 向量检索 |
| **Core-3** | 自迭代 + 跨会话连续性 + 冷启动退出 |
| **Full** | Electron 桌面 + Worker Threads + 完整功能 |

---

## 十四、宪法修正记录

| 版本 | 主要变更 |
|------|---------|
| v1.0 → v1.1 | 国家/政府分层，八裂缝归入政府层 |
| v1.1 → v2.0 | **全面重写**：大脑隐喻→工具链，19柱→6Agent，事件总线→PipelineObserver，三省六部→治理层，交融→开会，8修宪条款消解为1 |
| v2.0 → v2.1 | Core-1 实施：包结构从 10 包精简为 3 包（shared/engine/testing），Scheduler 从基础设施移入 Engine，4 空壳包删除 |
| v2.1 → v2.2 | Core-1 反思：Agent 池从 6 种扩展至 12 种（Core-1 落地 8 种）；原则三修正为 Toolkit 集中管控权限；管家从独立进程改为 ButlerAgent 纳入 Agent 池；新增 Agent 状态机五态模型；新增 InspectorAgent 定义 |
| v2.2 → v2.3 | Core-1 反思：记忆系统新增四态生命周期（Active/Archived/Frozen/Obliterated）与 CAS 原子状态机；新增 HCA/CSA 注意力区分（`trackAccess` 参数），MetaAgent 规划扫描不污染执行 Agent 热度统计 |

---

**文档状态**：v2.3。替代 v1.1 作为 Core 阶段准入依据。v1.1 归档保留，标注"已废弃"。
