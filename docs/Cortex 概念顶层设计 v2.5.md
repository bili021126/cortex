# Cortex 概念顶层设计 v2.5

**版本**：v2.5
**状态**：Core-1 自审视终局修宪——软约束权限例外 + DeepSeek 4.1 多模态预留 + 三轮圆桌审阅入宪
**性质**：LLM 驱动的个人工具链——工程化宪法
**前置**：v1.1（大脑隐喻，已废弃）→ v2.0（工具链隐喻）→ v2.1（Core-1 物理落地）→ v2.2（Core-1 反思：Agent 扩展+权限集中+状态机）→ v2.3（Core-1 反思：记忆四态 CAS + HCA/CSA 注意力区分）→ v2.4（Core-1 终局反思：工程全量对账——SafeErrorReporter / AgentPool 权威源 / MemoryStore 安全写 / 编译时治理 / 阶段模型同步）→ v2.5（Core-1 自审视终局：软约束权限例外入宪 / DeepSeek 4.1 多模态预留 / 三轮圆桌审阅 / 自审视委员会主体地位确认）

---

## 一、Cortex 是什么

Cortex 是一个 LLM 驱动的个人工具链。它以 MetaAgent 为规划中枢，以 10 种 Agent 为执行单元，以确认门和安全规则引擎为护栏，以管家为个人助手。

核心隐喻从 v1.1（大脑/神经系统）变更为**工具链**。工具链意味着：
- 每个组件是可替换的、可验证的、职责清晰的工具
- 不存在"数字生命体"的不可知性——每个行为可审计
- 用户是工具的使用者和最终裁决者

---

## 二、六条不可变原则

| 原则 | 内容 | 不可变性 |
|------|------|---------|
| **原则一** | 确认这个动作永远在用户手里。任何 L2/L3 不可逆操作必须经用户确认 | 不可变 |
| **原则二** | 规划与执行分离。MetaAgent 只规划不执行，Agent 只执行不规划 | 不可变 |
| **原则三** | 安全边界在 Toolkit 调用层。Toolkit 按 Agent 类型集中校验权限，Agent 以身份调用，不持有权限定义 | 不可变 |
| **原则四** | 谁调用谁负责。Agent 对其工具调用的后果承担全部责任 | 不可变 |
| **原则五** | 所有可观测事件走 PipelineObserver 统一管道。SafeErrorReporter 作为上层协议定义 fatal / degraded / silent 三档错误上报标准，杜绝静默吞错 | 不可变 |
| **原则六** | 用户是最终裁决者。多 Agent 并行产出由用户收束，Agent 之间不协商统一 | 不可变 |

---

## 三、系统架构

```
Cortex
│
├── Engine (容器)
│   ├── MetaAgent (规划中枢)
│   ├── Agent池 (10 Agent)
│   ├── TaskBoard (任务板，并发控制)
│   ├── ConfirmGate (确认门)
│   ├── PipelineObserver (可观测管道 + SafeErrorReporter)
│   ├── MemoryStore (运行时记忆，30天窗口 + 安全写 + 生命周期状态机)
│   └── Scheduler (Agent 调度，拓扑排序 → 逐层并行)
│
├── 基础设施 (独立于 Engine)
│   ├── Toolkit (工具目录与权限校验)
│   ├── FileLockManager (文件级锁)
│   ├── Core-2 预留：TrustModel (信任模型)
│   ├── Core-2 预留：Sentinel (安全规则引擎)
│   └── Core-2 预留：SkillRegistry + SkillExecutor (技能模板)
│
├── 管家 (独立进程，常驻)
│   ├── Core-2 预留：消息源插件
│   ├── Core-2 预留：周期性汇总简报
│   └── ConfirmGate 用户交互通道
│
└── 治理层 (高于工具链的自律框架)
    ├── 宪法 (本文档——国家结构)
    ├── 治理层设计 (配套政府设计文档)
    ├── DocGovernAgent (自动审计引擎)
    ├── 阶段门禁检查表
    └── DocGovern 分区 (永久审计记录)
```

> **治理层定位**：治理层不参与工具链执行循环。它高于工具链，负责审计、审查和裁决。宪法定义国家结构（大脑），治理层设计定义政府运行方式。委员会体系、纪检委监督链、监理封驳权等政府机制见配套文档 [`治理层设计`](./core/治理层设计.md)。

> **物理包结构（Core-1 终局）**：3 个包——`@cortex/shared`（全部类型定义 + SafeErrorReporter 协议）、`@cortex/engine`（Engine 全部实现，含 Scheduler / MemoryStore / AgentPool）、`@cortex/testing`（Mock 基础设施）。依赖方向 shared ← engine ← testing，严格依赖倒置。Meso-Lite 中曾独立存在的 `@cortex/memory`、`@cortex/meta-agent`、`@cortex/scheduler`、`@cortex/doc-govern` 四个包已删除，功能并入 engine。

---

## 四、MetaAgent——规划中枢

唯一规划者。职责：

1. **规划**：用户意图 → 拆解为任务树节点 → 发布到 TaskBoard
2. **标注**：为每个节点打 `type` + `tags` 标签，Agent 据此自描述匹配
3. **仲裁**：Agent 执行失败 → requestReplan(nodeId, reason) → 修改受影响节点
4. **聚合**：多 Agent 并行产出 → 聚合为统一视图 → 交管家呈现
5. **重规划**：最多 3 轮，超限交用户裁决

MetaAgent **不做**：不调用工具执行任何操作，不替用户做最终决策，不自行修改 Agent 产出。

---

## 五、Agent 池——10 种执行单元

Agent 定义：**扫描 TaskBoard → 自描述匹配节点标签 → 认领 → 执行 → 产出 NodeResult**。

Agent 池按复杂度伸缩：简单项目仅注册 CodeAgent 即为单 Agent 全栈模式；复杂项目全量注册即为多 Agent 专业化分工。

### 5.1 Agent 类型

| Agent | 允许工具 | 认领标签 | 模式 | 落地阶段 |
|-------|---------|---------|------|---------|
| **MetaAgent** | 只读+search_code | 中枢，不认领任务节点 | 常驻 | Core-1 |
| **ButlerAgent** | 无（仅转述，不调工具） | 不认领节点 | 常驻 | Core-1 |
| **CodeAgent** | 读+写+run_shell+search_code | 见标签词汇表 | 按需唤醒 | Core-1 |
| **ReviewAgent** | 只读+search_code | 见标签词汇表 | 按需唤醒 | Core-1 |
| **AnalysisAgent** | 只读+search_code+run_shell | 见标签词汇表 | 按需唤醒 | Core-1 |
| **OpsAgent** | run_shell+读+写+search_code | 见标签词汇表 | 按需唤醒 | Core-1 |
| **LoopAgent** | 只读+search_code | 见标签词汇表 | 按需唤醒 | Core-1 |
| **DocGovernAgent** | 只读+search_code | 见标签词汇表 | 按需唤醒 | Core-1 |
| **InspectorAgent** | tsc+madge+AST+grep（确定性工具，非 LLM 推理） | inspector_* | 按需唤醒 | Core-1 |
| **BrowserAgent** | browser_*+read_file+search_code | browser_test/ui_test | 按需唤醒 | Core-1 |

> **Core-2 预留**：ApiAgent（api_*）、DataAgent（db_*）。类型已定义，Core-1 未注册，纳入 Core-2。

Agent 类型按权限边界划分。权限表集中在 Toolkit 层（`AGENT_TOOL_PERMISSIONS`），Agent 以类型身份调用，不自行定义工具白名单。

标签词汇表为封闭集合，匹配规则见 `Agent标签词汇表-v2.0.md`。

### 5.1.1 自审视模式权限例外

**原则**：自审视是元系统对自身的审查。当 Cortex 审视自身代码时，常规权限边界与审查需求存在天然矛盾——ReviewAgent 没有 `write_file` 就无法产出审查报告，InspectorAgent 没有 `run_shell` 就无法搜索全量目录树。

**条款**：

| 项目 | 常规模式 | 自审视模式（`--soft`） |
|------|---------|----------------------|
| Agent 工具权限 | 宪法 §5.1 表所示 | 临时提升至 `FULL_TOOLSET` |
| 写入路径 | 全局受限 | 硬约束于 `test-output/self-examination-soft/` |
| 源码修改 | 不允许 | 不允许（只读） |
| run_shell | 部分 Agent 无 | 全开放（构建/测试/诊断必需） |
| 生效范围 | — | 仅自审视脚本运行期间，不写入 Agent 配置文件 |

**归因**：凝光（DocGovernAgent）在自审视审计中发现了 5 项文档-代码权限偏差（D-01~D-05，见凝光治理审计报告 §3.1.3）。经归因分析确认：这不是宪法与实现不一致的 bug，而是元系统自审视的天然需求——审视工具和限制工具是同一把扳手，镜子照镜子时镜子不能先把自己涂黑。

**保障**：自审视结束即恢复常规模式权限。此例外不构成先例——常规运行时 Agent 权限仍严格遵循 §5.1 权限表。

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

**AgentPool 单一权威源**：Agent.status 读写必须委托 AgentPool。Agent 不自行修改 status。AgentPool 持有 `VALID_TRANSITIONS` 表驱动校验合法流转边。非法流转触发 `observer.emit('scheduler.invariant_violation', CRITICAL)`，由 SafeErrorReporter 上报。

**唤醒策略**：
- 常驻（始终 Awake）：ButlerAgent、MetaAgent
- 按需唤醒（有匹配标签时 wakeup，干完 shutdown 回 Created）：CodeAgent、ReviewAgent、AnalysisAgent、OpsAgent、LoopAgent、DocGovernAgent、InspectorAgent、BrowserAgent
- AgentPool.spawn() 创建 Created 实例 → Scheduler 发现标签匹配 → wakeup() → execute() → shutdown() 回到 Created

### 5.3 自描述匹配

Agent 自描述为固定标签集。匹配规则：`node.tags ∩ agent.tags ≠ ∅` → 匹配。无 Agent 匹配 → MetaAgent 告警，重新打标签或拆节点。

### 5.4 并发控制

- TaskBoard.claim() 原子操作：已认领节点拒绝再次认领
- FileLockManager：写锁排斥所有读写锁，读锁可共存
- L2/L3 确认等待期间**不持文件锁**
- Scheduler：每种 Agent 类型保留至少 1 个实例配额，防饥饿

---

## 六、ButlerAgent（管家）——唯一用户交互出口

Agent 池正式成员，`AgentType.Butler`。常驻 Awake，不认领任务节点，不调用工具。

### 6.1 五大法定职责

| # | 职责 | 说明 |
|----|------|------|
| ① | 唯一交互出口 | 所有 Agent 输出、ConfirmGate 请求、MetaAgent 结果、PipelineObserver 通知 → ButlerAgent 格式化 → 呈现用户。用户输入 → ButlerAgent 接收 → 路由 |
| ② | 决策中转 | InspectorAgent 事实报告 → ButlerAgent 解释为可理解选项 → 用户选择 → 归档 DocGovernAgent |
| ③ | 闲时采集 | 管线空闲时自然对话。聊到项目 → 决策原因归档。聊到技术 → Agent 互相争论 → 用户旁听学习 |
| ④ | 事件通知 | Agent 状态变更 → 状态灯刷新。管线事件 → 必要时打断（失败/确认需求）或静默通知 |
| ⑤ | 入口适配 | 无项目：全屏对话入口。有项目：IDE 三栏布局（文件树+编辑器+对话面板） |

### 6.2 非其职责

不创造、不审查、不部署、不审计。只转述、解释、采集、通知。

### 6.3 消息源插件（Core-2 预留）

管家支持插件化个人域消息源（邮箱/RSS/GitHub通知等），个人数据存入管家专用存储区，不入 MemoryStore。**Core-1 未实现**，纳入 Core-2。

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

L1→L2 升级：单次 >3文件 或 >100行 或命中风险文件名（secret/token/password/key/.env 等）。

### 7.2 ConfirmGate

Agent 调用工具 → ConfirmGate 拦截 → 查 TrustModel → 判定 → 如需确认则经管家弹窗 → 用户响应。

L2/L3 超时 = 阻塞等待（不替用户决策），L1 超时 = 默认拒绝。

### 7.3 TrustModel（Core-2 预留）

按 (Agent类型, 风险域) 二维聚合接受率。冷启动从 L1 起。疲劳确认防护、信任衰减、模型变更重置——**Core-1 未实现**，纳入 Core-2。

### 7.4 Sentinel（Core-2 预留）

安全规则引擎，4 种检测模式（不可逆未确认 / 异常事件高频 / 信任骤降 / 确认门冲击）。**Core-1 未实现**，纳入 Core-2。

---

## 八、PipelineObserver——可观测管道

所有可观测事件走统一管道。

```
PipelineObserver {
  on(event, handler, priority)
  emit(event, payload, priority?)

  优先级:
    CRITICAL → 同步执行，立即持久化
    HIGH     → 异步优先队列, 批量 1s
    NORMAL   → 异步普通队列, 批量 5s

  数据结构:
    Observation { source, type, payload, timestamp, priority }
}
```

### 8.1 SafeErrorReporter——统一错误上报协议

建于 PipelineObserver 之上。三档严重性，杜绝静默吞错：

| 严重性 | 含义 | Pipeline 优先级 | 典型场景 |
|--------|------|----------------|---------|
| **fatal** | 操作失败，无法继续 | CRITICAL，立即 emit | DB 写入失败、状态机非法流转 |
| **degraded** | 操作部分成功，降级运行 | HIGH | SQL 回退到内存扫描、文件锁排队超时 |
| **silent** | 静默异常，自动追踪 | NORMAL（计数累加） | catch 块中无 emit 的吞错 |

**静默计数器自动升级**：同一 `(source, event)` 在一次执行中静默累计 ≥ 3 次 → 自动升级为 `degraded` 并 emit。防止隐蔽故障长期积累。

注入方式：`BaseAgent.setSafeReporter()` 和 `LlmAdapter.setSafeReporter()` 在 bootstrap 上层统一注入，所有 Agent 和 LLM 适配器共享同一安全上报通道。

---

## 九、记忆系统

### 9.1 四态生命周期

单向流转，不可回退：

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
| Frozen | 冻结，不再参与检索和规划 | 仅显式指定 | ❌ 新关联 | → Obliterated |
| Obliterated | 湮灭，不可逆终点 | 仅显式指定 | ❌ 新关联 | 无 |

流转规则：
- Active → Archived：`archive(id)` — CAS 保护
- Active|Archived → Frozen：`freeze(id)` — CAS 保护
- 任何非 Obliterated 态 → Obliterated：`obliterate(id)` — 不可逆，CAS 保护
- Obliterated → 任何态：永不允许
- Frozen / Archived → Active：不允许

### 9.2 CAS 原子状态变更

所有四态流转通过 `cas(id, expected, newState)` 原子比较并交换。单线程 JS 事件循环保证同步 `get()` → `set()` 之间无竞态窗口。

### 9.3 MemoryStore 安全写架构

#### 生命周期状态机

MemoryStore 自身处于以下三态之一：

```
active → closing → closed
```

- **active**：正常服务。所有读写路径开放。
- **closing**：正在关闭。拒绝新写入，等待进行中的写操作完成。
- **closed**：已关闭。所有路径拒绝。`_saveDb` 静默跳过（已无 DB 连接）。

#### `_safeDbRun` —— 统一安全写入口

所有 DB 写入必须经过 `_safeDbRun(sql, params, opName)`：

1. 检查 `_lifecycle`：非 active 状态 → 跳过写入
2. 指数退避重试：最大 3 次，间隔 100ms / 200ms / 400ms
3. 失败处理：emit CRITICAL → rethrow → 调用侧回滚内存状态

不使用 `observer.emit` 直调——统一走 SafeErrorReporter。

#### 写路径 DB 失败回滚

MemoryStore 的 7 条写路径（write / archive / freeze / obliterate / link / unlink / 批量操作）遵循统一模式：

1. **内存先写**：先更新内存 Map（乐观写入）
2. **持久化**：通过 `_safeDbRun` 写入 SQLite
3. **失败回滚**：`_safeDbRun` 抛异常 → 调用侧 catch → 内存状态回滚到写入前

此模式保证：DB 故障时，内存状态始终正确——不产生脏数据。

#### NG-2026-0509-Persist-False-Positive 判例

持久化操作不允许假阳性。若 DB 写入失败，操作必须传播为失败——不得出现"DB 失败了但操作返回成功"的情况。这是首条跨模块工程判例，所有持久化操作必须遵守。

### 9.4 HCA/CSA 注意力区分

| 模式 | 调用方 | 行为 | `trackAccess` |
|------|--------|------|---------------|
| **HCA**（高层次注意力） | MetaAgent 规划扫描 | 检索但不累加 accessCount，不刷新 lastAccessedAt | `false` |
| **CSA**（上下文选择注意力） | Agent 执行检索 | 检索并累加 accessCount，刷新 lastAccessedAt | 默认 `true` |

MetaAgent 规划时广度扫 50 条记忆，不等于 50 条都被用过。热度应反映 Agent 执行时的真实引用。

### 9.5 DocGovern 分区

持久化治理记录。DocGovernAgent 写入。存储：审计报告、规划审查记录、阶段门禁结论、宪法一致性检查记录。

### 9.6 管家存储

独立于 MemoryStore 和 DocGovern。存储：个人消息源数据、偏好配置、冷启动观察期数据。

---

## 十、治理层

治理层是工具链的自律框架——不参与执行循环，高于工具链，负责审计、审查和裁决。

治理层的完整设计见配套政府设计文档：[`治理层设计`](./core/治理层设计.md)。本文档（宪法）定义国家结构（大脑），治理层设计定义政府运行方式。二者分属国家/政府两个层级——同一国家结构可承载不同政府形式，政府可演进，宪法不必改。

宪法仅在此章定义治理层与工具链的两个接口：
- **DocGovernAgent**：作为审计引擎的宪法地位，详见 5.1 Agent 类型表（Core-1 落地，三大审计节点：plan_review / doc_audit / constitution_check）
- **DocGovern 分区**：持久化治理记录的存储边界，详见 9.5

委员会体系（常设委员会=治理审计、临时委员会=执行裁决）、纪检委监督链、监理封驳权、四层逐级上报、MetaAgent 权力边界——均属于政府设计，定义在治理层设计文档中，不纳入宪法。

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

## 十二、技能记忆（Core-2 预留）

LoopAgent 扫描已完成节点 → 发现可重复模式 → 生成 SkillTemplate → 写入 SkillRegistry。

MetaAgent 规划时检查 SkillRegistry：匹配当前节点的技能模板 → 标注 skillId。

试用期：自动沉淀技能默认试用，连续采纳 5 次自动应用，连续拒绝 3 次终止。**Core-1 未实现**，SkillRegistry/SkillExecutor 纳入 Core-2。

---

## 十三、阶段模型

| 阶段 | 核心交付 |
|------|---------|
| **Nano+** | LLM→工具→确认门 单链路验证 |
| **Meso-Lite** | 3 柱协作 + Scheduler + 记忆检索 |
| **Meso 反思** | 全量审查 + 架构反思 + 宪法 v2.0 |
| **Core-1** | Engine 重构 + 10 Agent + MemoryStore + Scheduler + PipelineObserver + SafeErrorReporter（170+ 测试全通过，自审视 7 Agent 并行验证通过，P0 全部闭合） |
| **Core-2** | Sentinel + TrustModel + SkillRegistry + ApiAgent/DataAgent + 向量检索 |

> **DeepSeek 4.1 多模态预留**：DeepSeek 4.1 预计 2026-06 发布，将支持多模态能力（图像/音频/视频理解）。Core-2 阶段需为此预埋伏笔：
> - BrowserAgent 将获得截图→视觉理解闭环（当前仅 DOM 操作）
> - InspectorAgent 可分析设计稿/架构图直译（当前仅文本 AST/grep）
> - 宪法 §八 PipelineObserver 事件 schema 需预留 `Observation.payloadType: "text" | "image" | "audio"` 字段
> - Agent 工具调用协议需支持 `image` 类型的工具输入参数
> - 多模态能力的具体落地范围与优先级，在 Core-2 启动前由自审视委员会三轮圆桌讨论收束
| **Core-3** | 自迭代 + 跨会话连续性 + 冷启动退出 |
| **Full** | Electron 桌面 + Worker Threads + 完整功能 |

---

## 十四、附则：编译时治理

以下 ESLint 规则作为宪法工程化强制手段，违者编译不通过：

| 规则 | 级别 | 宪法依据 | 说明 |
|------|------|---------|------|
| `no-console` | warn | 原则五（可观测事件走 PipelineObserver） | console.log/warn/error 绕过统一管道，不允许 |
| `no-empty` | error | 原则四（谁调用谁负责） | 空 catch 块静默吞错，违宪 |

ESLint 是 TypeScript 运行时能在编译期做到的强制力上限——不能阻止 `import fs from 'fs'`，但能在 CI 中拦截可检测的违宪模式。

---

## 十五、宪法修正记录

| 版本 | 主要变更 |
|------|---------|
| v1.0 → v1.1 | 国家/政府分层，八裂缝归入政府层 |
| v1.1 → v2.0 | **全面重写**：大脑隐喻→工具链，19柱→6Agent，事件总线→PipelineObserver，三省六部→治理层，交融→开会，8修宪条款消解为1 |
| v2.0 → v2.1 | Core-1 实施：包结构从 10 包精简为 3 包（shared/engine/testing），Scheduler 从基础设施移入 Engine，4 空壳包删除 |
| v2.1 → v2.2 | Core-1 反思：Agent 池从 6 种扩展至 12 种（Core-1 落地 8 种）；原则三修正为 Toolkit 集中管控权限；管家从独立进程改为 ButlerAgent 纳入 Agent 池；新增 Agent 状态机五态模型 |
| v2.2 → v2.3 | Core-1 反思：记忆系统新增四态生命周期（Active/Archived/Frozen/Obliterated）与 CAS 原子状态机；新增 HCA/CSA 注意力区分 |
| v2.3 → v2.4 | **Core-1 终局反思——工程全量对账**：原则五补充 SafeErrorReporter 三档错误上报协议（fatal/degraded/silent + 静默计数器 N=3 自动升级）；AgentPool 作为 status 单一权威源 + VALID_TRANSITIONS 表驱动；MemoryStore 新增生命周期状态机（active/closing/closed）+ `_safeDbRun` 统一安全写入口 + 7 写路径 DB 失败内存回滚 + NG-2026-0509-Persist-False-Positive 判例；系统架构图全量同步（ToolRegistry→Toolkit，Agent 数 6→10，TrustModel/Sentinel/SkillRegistry 标注 Core-2）；新增编译时治理（ESLint no-console/no-empty）；阶段模型测试数 58→170+；BrowserAgent 确认 Core-1 落地；治理层拆分——委员会体系/纪检委监督链/监理封驳权移入独立 [`治理层设计`](./core/治理层设计.md)，宪法第十章改为指针 |
| v2.4 → v2.5 | **Core-1 自审视终局修宪**：§5.1.1 新增自审视模式权限例外条款——自审视模式下 Agent 工具权限临时提升至 FULL_TOOLSET，写入硬约束于 test-output/self-examination-soft/，归因于元系统自审视的天然矛盾（凝光审计 D-01~D-05）；§十三 DeepSeek 4.1 多模态预留（2026-06 发布，多模态能力预理 PipelineObserver schema / 工具协议 / BrowserAgent 视觉闭环）；三轮圆桌代码审阅作为自审视标准流程入宪——每轮每人 5-7 次发言、必须收束结论、全部 10 位 Agent 作为圆桌主体参与、甘雨从 MetaAgent 秘书转为圆桌参与者；宪法版本号 v2.4→v2.5 |

---

**文档状态**：v2.5。替代 v2.4 作为 Core 阶段准入依据。v2.4 已归档保留。
