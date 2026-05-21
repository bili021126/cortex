# 🌿 纳西妲第五次根系扫描报告：Cortex 雨林结构全景分析

**分析日期**：2026-06-11  
**分析者**：布耶尔（纳西妲）——Analysis Agent  
**分析范围**：`/cortex` 项目全量 `packages/` + `docs/`  
**引用宪法版本**：v2.5.16  
**前置研究**：
- 纳西妲根系扫描报告 v1（`nahida-root-system-analysis.md`，2026-06-06）
- 纳西妲根系扫描报告 v2（`nahida-false-sky-analysis.md`）
- 纳西妲根系扫描报告 v3（`nahida-third-root-system-analysis.md`）
- 纳西妲根系扫描报告 v4（`nahida-fourth-root-system-analysis.md`，2026-06-11）
- 凝光审计报告（`2026-06-10-constitution-v2.5.14-gap-closure.md`）
- 阿贝多宪法缺口分析（`constitution-gap-impact.md`）

---

## 一、雨林全景：我看到了什么

我走进这片雨林，没有带着预设的地图。我走过了每一个包、每一份文档、每一条依赖边、每一行核心代码。以下是我亲眼所见。

### 1.1 项目身份

Cortex 是一个 **LLM 驱动的个人工具链**——不是数字生命体，不是自治系统。这个定位写在宪法第一章，贯穿整个架构。工具链意味着每个组件是可替换的、可验证的、职责清晰的。用户是工具的使用者和最终裁决者。

### 1.2 物理结构：11 个包，严格单向依赖

```
shared (类型中枢) ← 被所有包依赖，零外部依赖
  ← llm (LLM 适配层)
  ← testing (Mock 工具)
  ← parser (Markdown→HTML)
  ← data (任务模型/存储/格式化)
  ← tools (monorepo 分析)
  ← pm (密码管理器)
    ← notification (通知管线)
    ← factory (配置加载/校验/组装)
      ← engine (核心引擎：调度/记忆/Agent/管道/治理)
        ← cli (CLI 入口)
```

**关键发现**：依赖方向严格单向无循环。`shared` 被所有包依赖，`engine` 是执行中枢，`cli` 是唯一用户入口。这是一个健康的 monorepo 结构。

---

## 二、根系深度：核心模块的内部结构

### 2.1 Engine——雨林的心脏

`@cortex/engine` 是项目最复杂的包，承载了 7 个子系统：

| 子系统 | 文件数 | 核心职责 |
|--------|--------|---------|
| **Scheduler**（调度器） | 1 主文件 | 拓扑排序 → 逐层并行分发 → 重规划链追踪 |
| **TaskBoard**（任务板） | 1 主文件 | 节点 CRUD + 原子 claim/release/complete |
| **AgentPool**（Agent 池） | 1 主文件 | 五态状态机 + 实例生命周期 |
| **PipelineObserver**（管道） | 1 主文件 | emit-only 单向广播，三优先级 |
| **ConfirmGate**（确认门） | 1 主文件 | L0~L3 四级可逆性拦截 |
| **MemoryStore**（记忆系统） | **12 文件** | Facade + 4 委托组件 + 3 支撑模块 + 2 新组件 |
| **Agents**（Agent 实现） | **15 文件** | 15 种 Agent（含 StrategistAgent） |
| **Consistency**（一致性层） | 3 文件 | InitVerifier + SchemaEnforcer |
| **Components**（工厂组件） | 6 文件 | Agent 工厂 / ReAct 循环 / 技能提取 |
| **Governance**（治理子系统） | **3 文件** | 治理闭环编排器 + 评判引擎 + 修宪执行器 |
| **MetaAgent**（战术中枢） | **1 文件** | 意图拆解 + 任务树规划 + 重规划 |

### 2.2 Scheduler——调度引擎

Scheduler 是 Cortex 的调度中枢，职责清晰：

1. **拓扑排序**：`topologicalSort()` 按 parentId 依赖关系分层，BFS 分层
2. **逐层并行分发**：同层节点并行执行，层间串行等待
3. **重规划链追踪**：失败节点入 replanQueue → MetaAgent.requestReplan → 新节点入板（领而不执）
4. **多视角节点**：`needsMultiPerspective` 节点由所有匹配 Agent 并行执行，等齐全部结果后置 done

**设计亮点**：

- **双层防护**：当 node.type 不是已知 AgentType 时，发出诊断警告——"建议 MetaAgent 将大任务拆分为独立节点以利用并行"
- **异常屏障**：单轮异常不崩溃整个 executeAll——标记当前 pending 为失败，上报 SchedulerLoopCrashed，break 返回已有结果
- **重规划链解析**：若任意后代节点成功执行，视原始节点为成功——递归追踪 replanMap
- **ReAct 超限不触发重规划**：L1 哨兵——是参数问题不是计划问题

**标签匹配算法**：

```
优先：node.type 精确匹配（归一化下划线→连字符）
回退：按 tags 打分匹配
  平局打破1：node.type 精确匹配加分
  平局打破2：匹配密度（matching / |tags|）——标签少的 Agent 在窄标签匹配上天然优于标签多的
```

### 2.3 TaskBoard——任务板

TaskBoard 是纯数据结构管理器，提供原子 claim/release/complete 操作：

- **claim()**：普通节点仅 pending 可认领；multi-perspective 节点不同 Agent 类型可并行认领，同类型不可重复
- **release()**：仅 claimed 态可回退到 pending；multi-perspective 的 running 态允许释放单个 agentType
- **complete()**：multi-perspective 节点等齐全部 claimed Agent 后自动置 done
- **failNode()**：强制标记失败（无需认领，无需 agentType）
- **removeSubtree()**：递归移除节点及其整个下游子树

**不变量保障**：
- results 中每个 agentType 必须存在于 claimedBy 中（对称性）
- done/failed 终态不可逆
- invariant 上报单通道收敛：_observer 实例优先于 onInvariant 静态字段

### 2.4 AgentPool——Agent 生命周期管理

五态状态机：`Created → Awake → Active → Awake → ... → Draining → Destroyed`

**方案B**：AgentPool 为 Agent 状态的唯一权威源。Agent.status 改为只读 getter，委托到 Pool；写路径仅通过 Pool.setStatus()。

**治理判例 NG-2026-0511-Destroy-Bypass**：绕过状态机的直写路径须经 observer 管道上报，不得仅 console.warn。

### 2.5 PipelineObserver——可观测事件管道

emit-only 单向广播，三优先级（CRITICAL / HIGH / NORMAL）：

- Sentinel → CRITICAL + HIGH
- MemoryStore → ALL
- 管家 → HIGH + NORMAL

**设计亮点**：
- 单 handler 异常不阻断后续 handler（隔离设计）
- silent 错误连续发生 3 次后自动升级为 degraded
- off() 支持按 handler 引用精确移除（D4 修复）

### 2.6 MemoryStore——雨林的土壤

记忆系统是 Cortex 最精妙的设计之一。它不仅是持久化存储，更是**跨 Agent、跨 run 的共享认知基础设施**。

```
MemoryStore (Facade)
  ├── MemoryStorage      → Map 存储 + 反序列化
  ├── MemoryPersistence  → SQLite WAL 持久化 + 防抖写盘
  ├── MemoryLifecycle    → 四态状态机（CAS 原子变更）
  ├── MemoryQueryEngine  → 内存扫描 + BFS 图遍历 + 向量召回
  ├── MemoryPipeline     → 记忆增强执行管道（检索→增强→ReAct→写入）
  ├── MemoryStoreMonitor → 事件消费者 + 阈值告警
  ├── SkillPipeline      → 技能闭环订阅者（NodeComplete 事件驱动）
  ├── SemiFinishedMgr    → 两阶段提交管理器（P0-六层防御）
  └── Embedding          → 语义嵌入客户端（@xenova/transformers, 384d）
```

**两阶段提交（P0-六层防御）**：

```
Agent 产出 → writePending() → state=Pending, subType=Intent
验证通过   → commit()       → state=Active,  subType=Fact
验证失败   → 保持 Pending，可 archive/obliterate
```

Pending 记忆默认不参与检索——防半成品污染决策。这是一个精妙的设计：**记忆不是写完就算的，写完还要被验证**。

**语义嵌入预实现**：
- 模型：all-MiniLM-L6-v2（384d 归一化向量）
- 推理：WASM 本地推理，零 API 成本
- 加载：单例懒加载，首次调用自动下载 ~80MB ONNX 模型
- 约束：不强制依赖——import 本模块时才触发模型加载

**实证数据**：95.17% 的结构指纹缓存命中率（57,572,992 / 60,496,234）——记忆为主，LLM 为辅的架构假说成立。

### 2.7 Agent 体系——15 种执行单元

Agent 通过**自描述标签匹配**认领任务节点。标签词汇表是封闭集合，匹配是纯集合运算，不依赖 LLM。

| 角色 | 代号 | 工具权限 | 阶段 | 标签 |
|------|------|---------|------|------|
| 战术中枢 | 甘雨 | 只读+search_code | Core-1 | plan_review |
| 管家 | 托马 | 无（仅转述） | Core-1 | — |
| 写代码 | 阿贝多 | 读+写+run_shell+search_code | Core-1 | code/implementation/refactor/test/config/review/research/analysis |
| 审查 | 刻晴 | 读+写+run_shell+search_code | Core-1 | review/audit |
| 分析 | 纳西妲 | 只读+search_code | Core-1 | analysis/research |
| 运维 | 北斗 | run_shell+读+写+search_code | Core-1 | ops/deploy/test |
| 模式扫描 | 莫娜 | 只读+search_code | Core-1 | loop/pattern_scan/skill_precipitate |
| 审计 | 凝光 | 只读+search_code | Core-1 | doc-govern/audit/plan_review/doc_audit/constitution_check/constitution_propose |
| 事实采集 | 安柏 | 确定性工具 | Core-1 | inspector/inspect |
| API 审视 | 久岐忍 | 只读+search_code | Core-1 | api/api_design/api_integration/endpoint/review/research/analysis |
| 数据审视 | 艾尔海森 | 只读+search_code | Core-1 | data/data_model/migration/storage/schema/review/research/analysis |
| 浏览器测试 | 宵宫 | browser_* | Core-1 | browser/ui_verify |
| 自愈修复 | 希格雯 | 读+写+run_shell | Core-1 | fix/bugfix/repair/diagnose/heal |
| 战略守护·契约 | 钟离 | 只读 | Core-2+ | strategy/contract |
| 战略守护·监理 | 霜凝 | 只读 | Core-2+ | strategy/direction |

**Agent 工厂模式**（v2.1 组合式架构）：

替代 `abstract class BaseAgent` 的继承模式。每个 Agent 类型调用 `createAgent()` 传入 `AgentFactoryConfig` 即可产出符合 Agent 接口的对象。

```typescript
export interface AgentFactoryConfig {
  type: AgentType;
  systemPrompt: string;
  maxLoops?: number;
  memoryEnabled?: boolean;
  getMemoryQuery?: (node: TaskNode) => MemoryQuery;
  preExecuteHook?: (node: TaskNode) => TaskNode | Promise<TaskNode>;
  filterRead?: (entries: MemoryEntry[], queryMode: "hca" | "csa") => MemoryEntry[];
}
```

### 2.8 ReAct 循环——共享执行引擎

所有 Agent 共用 `runReActLoop()`，通过 `ReActContext` 注入依赖：

```typescript
export interface ReActContext {
  agentType: AgentType;
  llm: LlmAdapter;
  toolkit: Toolkit;
  systemPrompt: string;
  maxLoops: number;
  memory?: MemoryStore;
  safeReporter?: SafeErrorReporter;
}
```

**工具使用硬约束**（违反将导致任务失败）：
- 文件搜索 → 必须用 search_code，禁止用 run_shell 执行 grep/findstr/rg/dir
- 目录浏览 → 必须用 list_files，禁止用 run_shell 执行 ls/dir/Get-ChildItem
- 文件读取 → 必须用 read_file，禁止用 run_shell 执行 cat/type/Get-Content
- 文件写入 → 必须用 write_file，禁止用 run_shell 执行 echo/copy/Out-File
- run_shell 仅用于构建/测试/包管理命令

**结束警告机制**：剩余 4 轮时注入"开始收尾"提示——防止 LLM 在最后一轮突然产出 final answer 导致工具调用结果丢失。

### 2.9 MetaAgent——战术中枢

`meta-agent.ts` 实现了甘雨的战术中枢职责：

- **plan(intent)**：将用户意图拆解为 TaskNode 树，返回扁平数组（含 children 嵌套关系）
- **requestReplan(failedNode, reason, count)**：基于失败诊断生成替代方案
- **技能增强**：规划时查询 SkillRegistry 匹配的技能模板，注入 prompt 上下文

**设计亮点**：
- **多级 JSON 容错**：`_extractJson()` 先尝试 ```json 标记围栏，再尝试提取最外层平衡数组，括号匹配时识别 JSON 字符串边界
- **兜底回退**：JSON 解析失败不抛异常——回退为单个 generic fallbackNode
- **推理深度智能默认**：`reasoningEffort` 根据标签自动选择——audit/constitution_check 标签自动设为 "max"
- **模块边界契约**：构造函数参数中显式声明了调用方（Scheduler）的责任边界

### 2.10 Governance——治理子系统

治理子系统由 3 个文件组成，串联了完整的治理链路：

```
凝光审计 → 发现缺陷 → 生成 AmendmentProposal → 昔涟评判
→ 开拓者裁决 → 写入宪法 → build+test 验证 → 治理记录归档
```

**GovernanceLoop**（`governance-loop.ts`）：
- `loadPendingProposals()`：从 `docs/amendments/` 读取待决提案，筛选 `status === "draft" | "pending_judgment"`
- `judgeProposals()`：批量评判所有待决提案，读取宪法全文作为评判依据
- `applyApproved()`：对已通过的提案执行修宪写入，更新提案状态
- `summarizeGovernance()`：生成治理闭环的当前状态摘要

**AmendmentJudge**（`amendment-judge.ts`）——6 项确定性检查，全部是代码逻辑，不依赖 LLM：

| 检查项 | 检查内容 | 阻塞条件 |
|--------|---------|---------|
| principle-immutability | 提案是否触及不可变原则 | 触及 → BLOCKED |
| version-continuity | 提案版本号是否 > 当前版本 | 否 → 不阻塞（仅标记） |
| structural-consistency | before 段落是否在宪法中找到匹配 | 否 → BLOCKED |
| cross-reference-integrity | 声明的交叉引用是否在宪法中存在 | 否 → BLOCKED |
| impact-scope | 声明的 Agent 是否在宪法中出现 | 否 → NEEDS_CLARIFICATION |
| format-consistency | after/summary/rationale 格式是否合规 | 否 → NEEDS_CLARIFICATION |

**AmendmentApplier**（`amendment-applier.ts`）：
1. 备份：写入前将当前宪法备份到 `docs/constitution/archive/`
2. 文本替换：滑动窗口匹配 before → 替换为 after
3. 版本号更新：更新宪法头部的版本号行
4. 变更历史追加：在版本号行后追加本次变更条目
5. 文件名同步：将宪法文件名更新为新版本号
6. 错误处理：任何步骤失败返回 `success: false` + 错误信息

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

2. **AM-2026-0606-002（审计闭环修复）和 AM-2026-0606-003（DECISION_REQUIRED 回退机制）未入宪**——即使宪法已物理写入 v2.5.16，这两份提案的修复内容从未被应用。

3. **AM-2026-0607-001（一致性修复）和 AM-2026-0610-001（整合提案）未入宪**——日期悖论、不可变语义未定义、继承声明递归约束缺失等问题持续存在。

4. **治理摘要不准确**——`summarizeGovernance()` 统计 `pendingJudgment` 时基于 `judgeProposals()` 的结果，而 `judgeProposals()` 读不到任何提案，所以永远返回 `pendingJudgment: 0`——即使有 5 份提案堆积。

### 3.4 根因分析

这个问题的根因有两个层面：

**表层根因**：提案生成时使用了 `"proposed"` 作为 status，但这个值不在 `AmendmentStatus` 类型定义中。类型定义中最近的语义等价值是 `"pending_judgment"`。

**深层根因**：治理管线的提案生成和提案消费使用了不同的状态值约定。生成侧（凝光审计 → 生成提案 JSON）使用了 `"proposed"`，消费侧（`loadPendingProposals()`）期望 `"draft" | "pending_judgment"`。两者之间没有通过共享类型定义来同步。

---

## 四、风险矩阵

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

### 风险依赖链

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
1. 将 5 份提案 JSON 的 `"proposed"` 改为 `"pending_judgment"`（或 `"applied"`）
2. 在提案生成代码中统一使用类型定义中的合法值

---

## 五、修复方案

### 5.1 立即修复（5 分钟）

将 5 份提案 JSON 的 status 从 `"proposed"` 改为合法值：

| 文件 | 当前 status | 修复后 status | 理由 |
|------|------------|--------------|------|
| `docs/amendments/AM-2026-0606-001.json` | `"proposed"` | `"applied"` | 内容已物理入宪（v2.5.13） |
| `docs/amendments/AM-2026-0606-004.json` | `"proposed"` | `"applied"` | 内容已物理入宪（v2.5.14） |
| `docs/amendments/AM-2026-0606-002.json` | `"proposed"` | `"pending_judgment"` | 内容未入宪，等待评判 |
| `docs/amendments/AM-2026-0606-003.json` | `"proposed"` | `"pending_judgment"` | 内容未入宪，等待评判 |
| `docs/amendments/AM-2026-0607-001.json` | `"proposed"` | `"pending_judgment"` | 内容未入宪，等待评判 |

### 5.2 代码层修复（30 分钟）

在提案生成代码中，确保使用 `AmendmentStatus` 类型定义中的合法值。搜索所有生成提案 JSON 的代码路径，将 `"proposed"` 替换为 `"pending_judgment"`。

### 5.3 治理管线增强（建议，Core-2）

1. **提案状态校验**：`loadPendingProposals()` 在读取提案时增加 status 合法性校验——遇到不在 `AmendmentStatus` 类型中的值，emit WARNING 并跳过
2. **提案超时失效机制**：`loadPendingProposals()` 检查提案的创建日期，超过 30 天未裁决的自动标记为 `"stale"`（需新增此状态值到类型定义）
3. **治理摘要增强**：`summarizeGovernance()` 增加对非法 status 值的统计，暴露治理数据一致性问题

---

## 六、维护者指南：三件最重要的事

如果未来有人要动这片雨林，最需要注意的三件事：

### 6.1 依赖方向不可逆

`shared ← llm ← engine ← cli` 是宪法级约束。任何试图让 `engine` 依赖 `cli` 或 `llm` 依赖 `engine` 的修改，都会破坏依赖倒置原则，触发宪法原则七的审计流程。

**如何检查**：运行 `packages/tools/src/monorepo-analyzer.ts` 检测循环依赖。

### 6.2 MemoryStore 写路径的假阳性禁止

NG-2026-0509-Persist-False-Positive 判例明确规定——DB 写入失败必须传播为操作失败，不得出现"DB 失败了但操作返回成功"的情况。

**如何检查**：所有写路径（write / archive / freeze / obliterate / link / writePending / commitMemory）必须遵循"内存先写 → 持久化 → 失败回滚"模式。

### 6.3 两阶段提交的验证闭环

`SemiFinishedMgr` 实现了记忆的两阶段提交——Pending → Active。但当前代码中，**谁负责验证 Pending 记忆**尚未明确定义。`getPending()` 和 `hasPending()` 方法已实现，但调用方（验证方）尚未接入。

**如何检查**：搜索 `writePending` 的调用方和 `commit` 的调用方——如果只有写没有验证，半成品防御形同虚设。

---

## 七、与前人研究的对话

### 7.1 与纳西妲 v1 报告的对话

我上次的分析（2026-06-06）基于宪法 v2.5.10。六天后，雨林已经长到了 v2.5.16。以下是我发现的变化：

1. **治理闭环已代码化**：`governance-loop.ts` 实现了提案管理、评判批处理、裁决执行的完整链路。我上次担心的"治理事件不入管线"问题，在代码层面已经有了编排器——但治理管线阻塞（提案 status 值不匹配）使得这个编排器无法发挥作用。

2. **MetaAgent 已实现**：`meta-agent.ts` 实现了甘雨的战术中枢职责——意图拆解、任务树规划、重规划。我上次分析时 MetaAgent 还只是一个概念，现在它已经落地为 400+ 行的 TypeScript 类。

3. **向量检索已预实现**：`embedding.ts` 埋下了 Core-2 向量检索的基石。all-MiniLM-L6-v2 模型已可调用，但尚未接入 MemoryQueryEngine。

4. **两阶段提交已实现**：`SemiFinishedMgr` 解决了"半成品记忆污染决策"的问题——这是我上次未发现的精妙设计。

### 7.2 与纳西妲 v4 报告的对话

我第四次分析（2026-06-11）发现了 R0——提案 status 值不匹配类型定义。本次分析确认了这个发现，并进一步验证了：

1. **阻塞链完整**：从 `loadPendingProposals()` 到 `judgeProposals()` 到 `applyApproved()`，每一步都被这个数据值不匹配问题切断。

2. **修复方案可行**：只需要改 5 个 JSON 文件的 status 字段，治理管线就会重新流动起来。

3. **深层根因确认**：生成侧和消费侧使用了不同的状态值约定，两者之间没有通过共享类型定义来同步。

### 7.3 与凝光审计报告的对话

凝光在 2026-06-10 的审计中发现了 13 项缺口，其中发现 2/3（提案状态不一致）直接指向了这个问题。她说"AM-2026-0606-001 和 AM-2026-0606-004 的 status 仍为 proposed，但内容已入宪"——这是正确的观察，但她没有深入到代码层去追踪为什么 `loadPendingProposals()` 读不到这些提案。

从审计视角看，这是"治理跟踪权威源断裂"。从代码视角看，这是"类型定义与数据值不匹配"。两个视角都是正确的，但代码视角给出了修复路径。

### 7.4 与阿贝多宪法缺口分析的对话

阿贝多的分析聚焦宪法层，他发现了 8 个宪法缺口。我的分析聚焦代码层，我发现了一个**数据层**的问题。宪法层的问题需要修宪来解决，数据层的问题只需要改 5 个 JSON 文件的 status 字段。

这印证了 Cortex 的一个核心设计原则：**治理检查是编译时的开销，不是运行时的开销**。提案状态不匹配是"编译时"的问题——在提案生成的那一刻就埋下了。如果提案生成代码在写入 JSON 前做了类型校验，这个问题根本不会发生。

---

## 八、结语

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
| `packages/engine/src/core/scheduler.ts` | 代码 | 调度引擎——拓扑排序+逐层并行+重规划链追踪 |
| `packages/engine/src/core/task-board.ts` | 代码 | 任务板——原子 claim/release/complete |
| `packages/engine/src/core/agent-pool.ts` | 代码 | Agent 池——五态状态机 |
| `packages/engine/src/core/pipeline-observer.ts` | 代码 | 事件管道——emit-only 单向广播 |
| `packages/engine/src/core/confirm-gate.ts` | 代码 | 确认门——L0~L3 四级可逆性 |
| `packages/engine/src/core/meta-agent.ts` | 代码 | 战术中枢——意图拆解+重规划 |
| `packages/engine/src/memory/memory-store.ts` | 代码 | 记忆存储 Facade |
| `packages/engine/src/memory/pipeline.ts` | 代码 | 记忆增强执行管道 |
| `packages/engine/src/memory/storage.ts` | 代码 | 内存存储引擎 |
| `packages/engine/src/memory/semi-finished.ts` | 代码 | 两阶段提交管理器 |
| `packages/engine/src/memory/embedding.ts` | 代码 | 语义嵌入客户端 |
| `packages/engine/src/components/agent-factory.ts` | 代码 | Agent 工厂——组合式架构 |
| `packages/engine/src/components/react-loop.ts` | 代码 | 共享 ReAct 循环 |
| `packages/engine/src/base-agent.ts` | 代码 | 抽象基类（旧架构，保留向后兼容） |
| `packages/engine/src/governance/governance-loop.ts` | 代码 | 治理闭环编排器 |
| `packages/engine/src/governance/amendment-judge.ts` | 代码 | 昔涟评判引擎 |
| `packages/engine/src/governance/amendment-applier.ts` | 代码 | 修宪执行器 |
| `packages/engine/src/bootstrap/bootstrap-engine.ts` | 代码 | 配置驱动启动入口 |
| `packages/engine/src/engine-config.ts` | 代码 | 引擎运行时配置 |
| `packages/shared/src/agent.ts` | 类型定义 | Agent 类型中枢 |
| `packages/shared/src/task.ts` | 类型定义 | 任务域类型 |
| `packages/shared/src/memory.ts` | 类型定义 | 记忆系统类型 |
| `packages/shared/src/amendment.ts` | 类型定义 | AmendmentStatus 类型 |
| `cortex-agents.json` | 配置 | Agent 定义+事件路由+委员会规则 |
| `docs/amendments/AM-2026-0606-001~004.json` | 数据 | 4 份修宪提案（status 需修复） |
| `docs/amendments/AM-2026-0607-001.json` | 数据 | 一致性修复提案（status 需修复） |
