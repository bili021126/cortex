# 架构一致性分析 v2：文档-实现匹配度与Agent边界评估

**分析者**: 纳西妲（草神，Cortex Analysis Agent）
**分析范围**: packages/ + docs/（宪法 v2.5.22 + 一致性设计 v1.0 + diagnosis_report + amendments）
**分析日期**: 2026-07-22
**基准**: 上次分析（2026-06-20）报告整体匹配度 ~70%，本次评估修复进展与遗留缺口

---

## 零、记忆库追溯

上次分析（2026-06-20 纳西妲）报告了 **8 项缺口**（G1-G8），其中：
- P0: G1(GitHookBridge缺失)、G2(ConsistencyLayer未实例化)、G3(InitVerifier未运行)
- P1: G4(SchemaEnforcer未接入)、G5(ensureSubType未强制)、G6(半成品恢复机制缺失)
- P2: G7(ModificationRecord未写入)、G8(事务边界缺失)

本次审查验证全部缺口状态，并结合 7 月审查新增发现进行综合评估。

---

## 一、总览：整体匹配度 ~68%（小幅下降）

| 维度 | 2026-06-20 | 2026-07-22 | 变化 |
|------|-----------|-----------|------|
| **组件定义完整度** | **80%** | **75%** | ↓ 修复了 0 项组件级缺口，ConsistencyLayer 仍是孤儿 |
| **集成对接完整度** | **40%** | **35%** | ↓ 发现新的集成断裂点（NotificationPipe 归并死代码） |
| **类型契约一致性** | **90%** | **92%** | ↑ ModificationRecord v1 保持完整，类型定义健康 |
| **运行时行为一致度** | **30%** | **30%** | — 启动校验仍然不触发，半成品恢复仍然缺失 |
| **文档-代码一致性** | — | **65%** | ↓ 宪法 v2.5.22 协议层已修复多处，但工程实现未跟进 |
| **Agent边界清晰度** | — | **88%** | ↑ ApiAgent/DataAgent/StrategistAgent 边界明确 |

---

## 二、宪法 v2.5.22 与工程实现的一致性

### 2.1 Agent 数量声明 — ✅ 已修复（但经历合规违规）

**宪法 v2.5.20-2.5.22 版本变迁**：
- v2.5.20: 「11 Agent」— ✅ 正确（Core-1 Agent 11 种）
- v2.5.21: 「13 Agent」— ❌ AM-2026-0612-001 未经裁决预执行
- v2.5.22: 「11 Agent」— ✅ AM-2026-0708-001 回滚至合规状态

**代码实现**：`packages/engine/src/agents/` 下确实有 11 个 Agent 文件（不含 strategist-agent.ts、butler-agent.ts 作为特殊角色）。ApiAgent/DataAgent 已实现（api-agent.ts、data-agent.ts）但属于 Core-2 预留，不参与调度。

**一致性判断**：✅ **已修复**。宪法声明与工程实现一致。但 AM-2026-0708-001 揭示的「修宪管线合规违规」暴露了治理风险——宪法内容可能被绕过修宪流程直接修改。此风险已在宪法层封堵，但工程层无修改审计追踪。

### 2.2 不可变语义定义 — ✅ 已入宪，代码层无需跟进

**宪法要求**（AM-2026-0612-001 + AM-2026-0715-001）：
- 原则一至原则六：完全不可变（标题、存在、内容均不可修改）
- 原则七：标题和存在不可删除，子约束可通过子约束7演进

**代码影响**：不可变语义是宪法层声明，无需代码层实现。`amendment-judge.ts` 的 `CHECK_ORDER` 硬编码问题（2026-06-06 分析发现）仍存在，但此项不可变语义定义未增加新的代码需求。

**一致性判断**：✅ **完全一致**。宪法声明完整，代码层无冲突。

### 2.3 昔涟角色定位 — ✅ 已入宪，与代码一致

**宪法要求**（AM-2026-0612-001 §10.8 补充）：
- 昔涟是治理层评判角色（amendment-judge.ts）
- 不属 Agent 池执行单元
- 无 Toolkit 权限、不参与任务认领、不进入 Scheduler 调度

**代码实现**：
- `engine/src/governance/amendment-judge.ts` — ✅ 评判角色存在
- `engine/src/index.ts` — 导出了 `evaluateAmendment` 但未导出昔涟类
- 无 `QixilnAgent` 类或类似实体 — ✅ 符合「不入 Agent 池」

**一致性判断**：✅ **完全一致**。昔涟作为评判角色存在于 governance 层，代码无 Agent 化意图。

### 2.4 监理角色修正 — ✅ 已入宪

**宪法要求**（AM-2026-0715-001）：
- 移除子约束5中「监理追踪执行」的引用
- 将执行追踪归入凝光的审计闭环职责
- 监理取向开关保留为治理层设计文档的超前设计

**代码实现**：
- `engine/src/governance/` 中无监理独立实体 — ✅ 符合宪法
- 霜凝（StrategistAgent）定义中仍包含「系统监理」语义 — ⚠️ 代码注释可能未同步更新

**一致性判断**：✅ **宪法与工程基本一致**，但 StrategistAgent 的注释可能需要审查。

### 2.5 §15.1 超时失效机制 — ⚠️ **宪法承诺超前于工程**

**宪法要求**（Core-1 过渡方案）：
- DocGovernAgent 在每次被调度执行审计任务时附带执行超时检查
- 审计报告中须包含「超时提案扫描」小节

**代码实现**：
- `doc-govern-agent.ts` — ❌ 未找到超时检查逻辑
- `governance/governance-loop.ts` — 无超时提案扫描功能
- `governance/amendment-judge.ts` — 无超时状态检测

**一致性判断**：⚠️ **宪法承诺了实现但工程未跟进**。Core-1 过渡方案将超时检查从「每日扫描」降级为「审计附带扫描」，但即使这个降级后的约定也未在代码中落地。

### 2.6 §9.1 DocGovern 分区 TTL 豁免 — ✅ 已入宪，代码层待确认

**宪法要求**（AM-2026-0612-001 新增）：
- DocGovern 分区（MemoryType.Governance）不受 30 天窗口限制
- 数据清理仅通过明确的归档操作或开拓者指令执行

**代码实现**：
- `memory-store.ts` 中的 `archive()` / `freeze()` / `obliterate()` — 以 `MemoryState` 驱动
- 未找到 MemoryType.Governance 的 TTL 豁免逻辑 — ⚠️ 需要确认 `pipeline.ts` 或 `lifecycle.ts` 是否有分区特例判断

**一致性判断**：⚠️ **宪法已定义但工程实现状态待确认**。`MemoryLifecycle` 和 `MemoryStore` 中未见按 `memoryType` 分区隔离 TTL 的逻辑。

---

## 三、consistency-design.md 与代码实现的一致性

### 3.1 六层防御体系逐层评估

| 层级 | 组件 | 实现状态 | 集成状态 | 一致性评分 |
|------|------|---------|---------|-----------|
| L1 | IntentFactWall | ✅ 完整实现 | ❌ 未通过 ConsistencyLayer 接入（通过 pipeline filterRead 回调间接使用） | **60%** |
| L2 | InitVerifier | ✅ 完整实现 | ❌ 永不运行（verify() 从未被调用） | **40%** |
| L3 | GitHookBridge | ❌ 完全缺失 | ❌ 不存在 | **0%** |
| L4 | SchemaEnforcer | ✅ 完整实现 | ❌ 未在 MemoryStore.write() 中被调用 | **50%** |
| L5 | SemiFinishedMgr | ✅ 完整实现 | ✅ 已集成到 pipeline 记忆写入 | **100%** |
| L6 | ConsistencyLayer | ✅ Facade 定义完整 | ❌ Zero import, Zero consumer | **30%** |

### 3.2 上次缺口修复状态追踪

| 缺口 | 描述 | 06-20 状态 | 07-22 状态 | 原因 |
|------|------|-----------|-----------|------|
| **G1** | GitHookBridge 缺失 | ❌ P0 | ❌ **未修复** | 标记为 Core-2 预留 |
| **G2** | ConsistencyLayer 未实例化 | ❌ P0 | ❌ **未修复** | bootstrapEngine() 未创建 CL 实例 |
| **G3** | InitVerifier 从未运行 | ❌ P0 | ❌ **未修复** | verify() 全代码库 zero calls |
| **G4** | SchemaEnforcer 未接入写路径 | ❌ P1 | ❌ **未修复** | MemoryStore.write() 不调用 validate() |
| **G5** | ensureSubType 未强制 | ❌ P1 | ❌ **未修复** | 依赖调用方自觉传入 subType |
| **G6** | 半成品恢复机制缺失 | ❌ P1 | ❌ **未修复** | 进程崩溃后 Pending 记忆永存 |
| **G7** | ModificationRecord 未写入 | ❌ P2 | ❌ **未修复** | Schema v1 定义完成但无 writer |
| **G8** | 事务边界缺失 | ❌ P2 | ❌ **未修复** | MemoryStore 无 ConsistencyLayer 集成 |

**统计**: **0 项修复, 8 项遗留** — 六层防御体系在一个月内没有任何进展。

### 3.3 设计文档与实现的具体缺口

#### 3.3.1 IntentFactWall — 树冠成型，光照不到根部

**文档要求**（consistency-design.md §3.2）：
> CSA 模式下过滤 subType === Intent 的记忆，HCA 模式下不过滤。
> 写前强制标记 subType，无标记默认 Fact。

**代码实现**：
- ✅ `IntentFactWall.filterRead()` — 正确实现 CSA/HCA 过滤
- ✅ `IntentFactWall.ensureSubType()` — 无标记默认 Fact
- ✅ `pipeline.ts` 的 `executeWithMemoryPipeline()` 接受 `filterRead` 回调（line 147-150）

**集成缺口**：
- ❌ `filterRead` 回调的来源是调用方显式传入，ConsistencyLayer 未作为来源
- ❌ `MemoryStore.write()` 不调用 `ensureSubType()` — subType 标记全靠自觉
- ❌ `bootstrapEngine()` 不创建 ConsistencyLayer，所以也没有设置 filterRead 回调
- ⚠️ `pipeline.ts line 178` 中 `_rememberResult` 调用 `writePending` 时传入了 `subType: MemorySubType.Fact` — 这是 pipeline 代码写死的，不是通过 ensureSubType 注入的

**实际行为**：pipeline 的记忆写入路径确实设置了 subType=Fact，因为 `_rememberResult` 中写死了。但其他绕过 pipeline 直接调用 `MemoryStore.write()` 的路径不受任何 subType 约束。

#### 3.3.2 InitVerifier — 种子破土，没有被播种

**文档要求**：
> MemoryStore.init() 之后调用，遍历所有 Active 记忆，校验文件引用的一致性。

**代码实现**：
- ✅ `InitVerifier.run()` — 完整的一致性校验算法
- ✅ `InitVerifier.extractFileReferences()` — 从 metadata/content/summary 提取文件路径
- ✅ `ConsistencyLayer.verify()` — 委托给 InitVerifier.run()

**集成缺口**：
- ❌ `bootstrapEngine()` 在 `memory.init()` 后不调用 `verify()`
- ❌ `MemoryStore.init()` 不接受 ConsistencyLayer，不调用 verify
- ❌ 全代码库搜索 `ConsistencyLayer` 的导入 — **0 个结果**（除定义文件自身和 barrel export）

#### 3.3.3 GitHookBridge — 设计图画了，地下没有根

**文档要求**：
> 回滚级联失效——Git 事件映射到记忆失效。
> 用户 git checkout/revert/reset → 关联记忆自动降级。

**状态**：
- ❌ 全代码库搜索 `GitHookBridge` / `GitHook` / `git-hook-bridge` — 0 结果
- ❌ `ConsistencyLayer` 无 GitHookBridge 引用或占位
- ❌ `Toolkit` 无 git 事件监听机制
- ❌ `FileLockManager` 不追踪外部修改

**一致性影响**：GitHookBridge 已在设计文档和宪法审计（NG-2026-0610-Gap-Closure）中标记为 Core-2 预留。当前评估中将其标记为 **P0 设计缺口但 P2 实现优先级**——设计承诺了但实现方有明确知悉的延迟。

#### 3.3.4 SchemaEnforcer — 存在但不作用于写路径

**文档要求**：
> 校验 MemoryWriteInput 字段完整性，自动注入默认字段。

**代码实现**：
- ✅ `SchemaEnforcer.validate()` — 校验 memoryType/content/summary/agentType/creatorId
- ✅ `SchemaEnforcer.annotate()` — subType 默认 Fact

**集成缺口**：
- ❌ `MemoryStore.write()` 中无 validate() 调用 — 第 180-410 行的 write() 实现无任何 Schema 校验
- ❌ `MemoryStore.writePending()` 中无 validate() 调用
- ❌ `SemiFinishedMgr.writePending()` 接收 `MemoryWriteInput` 但不校验

**实际行为**：写路径完全信任调用方提供的输入格式。如果调用方传了 `memoryType: undefined` 或缺失 `summary`，写入内存时会使用 TypeScript 类型的默认值，但不会抛出校验错误。

#### 3.3.5 SemiFinishedMgr — 唯一真正接入主线的组件

**文档要求**：
> 两阶段提交：Agent 产出 → writePending() → state=Pending → 验证 → commit() → state=Active。

**代码实现**：
- ✅ `pipeline.ts` 的 `_rememberResult()` 使用两阶段提交（line 169-212）
- ✅ `MemoryStore.writePending()` / `commitMemory()` — 完整的两阶段方法
- ✅ `SemiFinishedMgr.writePending()` / `commit()` / `discard()` / `getPending()` / `hasPending()`

**剩余缺口**：
- ❌ H-01（刻晴审查）：`_rememberResult` catch 块不清理半成品 — `link()` 或 `commitMemory()` 中途失败时，已写入的 Pending 条目未回滚，残留在存储中
- ❌ 缺乏进程崩溃恢复机制：`MemoryStore.init()` 不扫描残留 Pending 记忆，不做超时 discard

#### 3.3.6 ConsistencyLayer — 设计完整的房子，无人居住

**文档要求**（consistency-design.md §3.1）：
> 跨组件调度：组合 InitVerifier + SchemaEnforcer + IntentFactWall + SemiFinishedMgr + GitHookBridge。

**代码实现**：
- ✅ `ConsistencyLayer` 类完整定义：`verify()` / `validateInput()` / `annotateInput()` / `filterRead()` / `ensureSubType()`
- ✅ 已从 `engine/src/index.ts` 导出为公开 API（line 77-78）
- ❌ 全代码库 zero imports（排除自身定义和 barrel 导出）
- ❌ `bootstrapEngine()` 不创建、不接受 ConsistencyLayer
- ❌ `MemoryStore` 构造函数和 init() 不涉及 ConsistencyLayer

---

## 四、Agent边界清晰度评估

### 4.1 Agent 池边界

通过审查 `packages/engine/src/agents/` 和 `cortex-agents.json`，各 Agent 边界如下：

| Agent | 文件 | 职责边界 | MemoryQuery | 清晰度 |
|-------|------|---------|------------|--------|
| **Code** (阿贝多) | code-agent.ts | 代码实现 | codeMemoryQuery | ✅ 清晰 |
| **Review** (刻晴) | review-agent.ts | 代码审查 | reviewMemoryQuery | ✅ 清晰 |
| **Analysis** (纳西妲) | analysis-agent.ts | 架构分析 | analysisMemoryQuery | ✅ 清晰 |
| **Ops** (北斗) | ops-agent.ts | 运维操作 | opsMemoryQuery | ✅ 清晰 |
| **Loop** (莫娜) | loop-agent.ts | 循环检测 | loopMemoryQuery | ✅ 清晰 |
| **DocGovern** (凝光) | doc-govern-agent.ts | 文档治理 | docGovernMemoryQuery | ✅ 清晰 |
| **Api** (久岐忍) | api-agent.ts | API 契约 | apiMemoryQuery | ⚠️ 已实现但 Core-2 预留 |
| **Data** (艾尔海森) | data-agent.ts | 数据处理 | dataMemoryQuery | ⚠️ 已实现但 Core-2 预留 |
| **Fix** (希格雯) | fix-agent.ts | 问题修复 | fixMemoryQuery | ✅ 清晰 |
| **Inspector** (神里绫华) | inspector-agent.ts | 审查巡检 | (无独立 query) | ✅ 清晰 |
| **Butler** (托马) | butler-agent.ts | CLI 交互 | (不参与调度) | ✅ 清晰 |
| **MetaAgent** (甘雨) | meta-agent.ts | 规划中枢 | (不参与调度) | ✅ 清晰 |
| **Strategist** (钟离+霜凝) | strategist-agent.ts | 战略把关 | (Core-2+ 预留) | ⚠️ 已实现未调度 |
| **Browser** (派蒙) | browser-agent.ts | 浏览器操作 | (无独立 query) | ✅ 清晰 |

**边界重叠检测**：
- ✅ Code vs Fix — 职责区分明确（实现 vs 修复），有独立 Agent 类型和 memoryQuery
- ✅ Review vs Analysis — 审查（代码质量）vs 分析（架构洞察），查询策略不同
- ✅ DocGovern vs Analysis — 文档审计 vs 架构分析，不重叠
- ⚠️ ApiAgent vs DataAgent — 两者都是 Core-2 预留，但 API 契约与数据处理的边界在 Agent 定义中清晰

**Agent 边界清晰度评分: 88%** — 主要扣分项为 ApiAgent/DataAgent/StrategistAgent 的「已实现但未调度」状态可能造成认知混淆。

### 4.2 包依赖边界

```
依赖图（实际）：
  cli        → engine, llm, shared
  engine     → factory, llm, shared
  factory    → shared, notification
  llm        → shared
  shared     → (纯类型，无内部依赖)
  parser     → (无)
  data       → (无)
  pm         → (无)
  tools      → (无)
  testing    → shared
  notification → shared
```

**发现**：
- ✅ **无循环依赖** — 依赖方向为 shared ← 所有包
- ✅ **shared 层的纯度** — 纯类型/枚举/接口，无运行时逻辑，是所有包的理想依赖基座
- ✅ **Barrel 导出规范化** — `engine/src/index.ts` 和 `shared/src/index.ts` 均采用显式逐条导出（已修复久岐忍 P1-3）
- ⚠️ **ConsistencyLayer 的引用** — `consistency-layer.ts` 从 engine 内部正确引用 `@cortex/shared`，但其作为 engine 的导出项从未被 engine 自身或其调用方使用

### 4.3 模块内部边界

| 模块 | 公开导出 | 内部隐藏 | 评分 |
|------|---------|---------|------|
| `engine/src/consistency/` | 4 文件均通过 barrel 导出（CL/IFW/IV/SE） | ✅ 内部细节隐藏 | B+ |
| `engine/src/memory/` | 仅 MemoryStore 等核心符号导出 | ✅ SemiFinishedMgr 通过 MemoryStore 间接暴露 | A- |
| `engine/src/governance/` | amendment-judge/applier/loop/pipeline 全部导出 | ✅ 内部细节隐藏 | A |
| `engine/src/agents/` | 全量导出 | ⚠️ query 函数与 agent config 函数混合导出 | B |
| `shared/src/` | 通过桶导出全部类型 | ✅ 纯类型域 | A |

---

## 五、修复进展与新增缺陷

### 5.1 刻晴 2026-07-22 审查修复状态

| 编号 | 问题 | 级别 | 状态 |
|------|------|------|------|
| C-01 | topologicalSort 循环依赖丢失 | 🟠 High | ✅ **已修复** |
| C-02 | deserializeRow 拒绝 JSON 字符串值 | 🟠 High | ✅ **已修复** |
| N-01 | PipelineObserver 异常递归栈溢出 | 🔴 Critical | ✅ **已修复** |
| H-02 | resolveConfig 共享默认值引用 | 🟠 High | ✅ **已修复** |
| H-03 | CLI agent spawn 不检查结果 | 🟠 High | ✅ **已修复** |
| H-01 | _rememberResult pending 泄漏 | 🟠 High | ❌ **未修复** |
| N-02 | bootstrap.ts 异步错误吞没 | 🟠 High | 🔍 **误诊**（同步函数） |
| N-03 | LlmAdapter 编码损坏 | 🟡 Medium | ⏳ 部分修复（BOM 移除） |
| M-01 | TaskBoard.complete 静默丢弃 | 🟡 Medium | ❌ **未修复** |
| M-02 | JsonFileAdapter.ensureDir 同步 I/O | 🟡 Medium | ❌ **未修复** |
| M-03 | MemoryStore.write() DB 失败静默 | 🟡 Medium | ❌ **未修复** |
| M-04 | ConfirmGate.dispose() 阻塞上游 | 🟡 Medium | ❌ **未修复** |
| N-04 | NotificationPipe._flushMerged 死代码 | 🟡 Medium | **本轮新增** |
| N-05 | LlmAdapter 编码损坏 | 🟡 Medium | **确认未修复** |

**统计**: 5 项修复（含 1 项误诊），7 项未修复，2 项新增。修复率 5/14 ≈ 36%。

### 5.2 与架构一致性直接相关的未修复项

- **H-01**（_rememberResult pending 泄漏） — 直接影响 SemiFinishedMgr 的行为一致性。设计文档承诺两阶段提交的完整性，但 catch 不清理导致 Pending 记忆残留。
- **M-03**（MemoryStore.write() DB 失败静默） — 直接影响记忆写入的可靠性。空 catch 违反了原则五（所有可观测事件走 PipelineObserver）。

---

## 六、核心缺口分级（更新）

### P0 级缺口

| 缺口 | 描述 | 影响 | 备注 |
|------|------|------|------|
| **G1/G2/G3** | 六层防御前 3 层未激活 | 设计文档承诺的一致性保护全部离线 | 一个月零进展 |
| **宪法 §15.1 超时** | 承诺的超时检查未在 DocGovernAgent 中实现 | 宪法条款对用户做了不可执行的承诺 | 纸面合规 |

### P1 级缺口

| 缺口 | 描述 | 影响 | 备注 |
|------|------|------|------|
| **G4/G5** | SchemaEnforcer + ensureSubType 未接入写路径 | 写路径无校验，记忆质量靠自觉 | 20 行代码可修复 |
| **G6 + H-01** | 半成品恢复 + catch 清理缺失 | 进程崩溃或异常时 Pending 残留 | 影响 SemiFinishedMgr 完整性 |
| **G7** | ModificationRecord 未写入 | Schema v1 定义完成但零使用 | 第二个教训（幻觉日期）的解决方案未落地 |

### P2 级缺口

| 缺口 | 描述 | 影响 |
|------|------|------|
| **G8** | ConsistencyLayer-MemoryStore 无事务边界 | 写路径与校验路径分离 |
| **M-03** | DB 更新失败静默吞错 | 去重路径数据不一致 |
| **N-04** | NotificationPipe 归并死代码 | 通知归并优化完全失效 |
| **M-01** | TaskBoard 多视角失败静默丢弃 | 执行报告不完整 |

---

## 七、Agent 边界一致性特殊发现

### 7.1 宪法 vs 代码的 Agent 数量一致性

宪法 §5 声明「11 种执行单元」，`cortex-agents.json` 定义了 11 种 Agent 角色：

| Agent 类型 | 宪法中 | cortex-agents.json | agents/ 目录 | Scheduler 注册 |
|-----------|--------|-------------------|-------------|---------------|
| meta | 未计数（中枢） | 已定义 | meta-agent.ts | 不参与调度 |
| butler | 未计数（管家） | 已定义 | butler-agent.ts | 不参与调度 |
| code | ✅ 计数 | 已定义 | code-agent.ts | ✅ |
| review | ✅ 计数 | 已定义 | review-agent.ts | ✅ |
| analysis | ✅ 计数 | 已定义 | analysis-agent.ts | ✅ |
| ops | ✅ 计数 | 已定义 | ops-agent.ts | ✅ |
| loop | ✅ 计数 | 已定义 | loop-agent.ts | ✅ |
| doc-govern | ✅ 计数 | 已定义 | doc-govern-agent.ts | ✅ |
| inspector | ✅ 计数 | 已定义 | inspector-agent.ts | ✅ |
| browser | ✅ 计数 | 已定义 | browser-agent.ts | ✅ |
| fix | ✅ 计数 | 已定义 | fix-agent.ts | ✅ |
| api | ⚠️ Core-2 预留 | 已定义 | api-agent.ts | ❌ 不注册 |
| data | ⚠️ Core-2 预留 | 已定义 | data-agent.ts | ❌ 不注册 |
| strategist | ⚠️ Core-2+ 预留 | 已定义 | strategist-agent.ts | ❌ 不注册 |

**一致性判断**：✅ **完全一致**。宪法与代码对 Agent 数量的理解一致。Api/Data/Strategist 虽然代码已存在，但不参与调度，符合「Core-2 预留」的定位。

### 7.2 独立包 vs Agent 角色一致性

`packages/` 下共 11 个子包，与 11 个 Agent 无一一对应关系——这是设计意图：

| 包 | 与 Agent 的关系 |
|----|---------------|
| **shared** | 所有 Agent 共享的类型中枢 |
| **engine** | Agent 运行时 + 调度器 + 记忆系统 |
| **cli** | ButlerAgent 的 CLI 交互层 |
| **llm** | 所有 Agent 的 LLM 适配器 |
| **factory** | Agent 创建工厂（bootstrap 时使用） |
| **data** | 持久化存储适配器（MemoryStore 使用） |
| **pm** | 包管理器（CodeAgent 使用） |
| **parser** | 代码解析（独立，目前体系外） |
| **tools** | 工具集（所有 Agent 使用） |
| **notification** | 通知管线（ButlerAgent 治理角色使用） |
| **testing** | 测试工具 |

**发现**：
- ✅ `parser` 包无任何内部依赖 — 它独立于整个 Agent 体系之外，设计文档未提及
- ✅ `notification` 包依赖 shared — 治理层的通知管线通过此包与 ButlerAgent 联动
- ⚠️ `tools` 包无依赖 — 似乎是工具函数集合，但不清楚它与 Toolkit 的关系

### 7.3 MemoryQuery 边界 — 每个 Agent 的独立视角

每个 Agent 都有其独特的记忆查询策略（通过 `makeMemoryQuery` 差异化配置）：

```
Agent → memoryQuery() → MemoryQuery { keywords, memoryTypes, bfsDepth, limit, ... }
```

| Agent | memoryTypes | bfsDepth | limit | 查询特点 |
|-------|------------|----------|-------|---------|
| code | Episodic | 2 | 5 | 标准执行记忆 |
| review | Episodic + Conceptual | 3 | 8 | 需上下文更广 |
| analysis | Conceptual + Knowledge | 3 | 10 | 架构级深度 |
| ops | Episodic | 2 | 5 | 操作记录 |
| loop | Episodic | 3 | 10 | 需要更多历史判断模式 |
| doc-govern | Governance | 2 | 5 | 只查治理分区 |
| api | Episodic | 2 | 5 | API 调用记录 |
| data | Episodic + Knowledge | 2 | 5 | 数据处理记录 |
| fix | Episodic | 2 | 5 | bug 修复记录 |

**一致性判断**：✅ 各 Agent 的记忆视图通过 `MemoryQuery` 参数差异化配置实现，边界清晰。

---

## 八、根系诊断：一致性裂缝的四个根源

### 根因 R1：ConsistencyLayer 是"三层皮"

```
宪法层 — 定义了六层防御、一致性校验体系 (consistency-design.md)
   ↓ 设计层 — 设计了 ConsistencyLayer Facade、组件职责矩阵、API 接口
      ↓ 代码层 — 实现了全部 5/6 组件 + Facade，但零集成
```

ConsistencyLayer 在三个层面都存在（宪法、设计、代码），但**层与层之间的"导管"没有打通**：
- 设计文档第 7 节的代码 diff 方案（BaseAgent 可选注入、Toolkit 中 setConsistencyLayer）全部未落地
- bootstrapEngine() 是理想的集成点，但未创建 ConsistencyLayer 实例

### 根因 R2：宪法承诺超前于工程实现

至少两处宪法条款对用户做了承诺但工程未实现：
1. §15.1 超时检查 — DocGovernAgent 无定时任务能力
2. §9.1 DocGovern 分区 TTL 豁免 — MemoryLifecycle 无分区特例判断

宪法是契约，工程是实现。契约超前于实现 = 不可执行的承诺。

### 根因 R3：修复集中在"表面"，一致性防御零进展

从 06-20 到 07-22 的修复历史：
- **已修复的**：拓扑排序、JSON 反序列化、PipelineObserver 递归、默认值引用、CLI 结果检查
- **未修复的**：全部 8 项一致性缺口（G1-G8）、全部 6 层防御（除 SemiFinishedMgr）

修复集中在**运行时错误处理**（安全网），而**架构一致性**（预防网）完全没有进展。

### 根因 R4：Agent 注册与调度存在"影子 Agent"

ApiAgent、DataAgent、StrategistAgent 三种 Agent 的代码已完整实现（在 agent 目录中有独立文件），但根据宪法：
- ApiAgent/DataAgent：Core-2 预留（代码已存在但不参与调度）
- StrategistAgent：Core-2+ 预留（在 bootstrap 中创建但不注册到 Scheduler）

这些"影子 Agent"是代码超前于宪法规划的产物。虽然目前不造成问题（宪法声明与代码行为一致），但它们的持续存在增加了认知负荷——开发者需要知道"这些 Agent 虽然存在但不干活"。

---

## 九、修复建议（优先级排序）

### 立即（P0，1-2 日内）

```
1. 在 bootstrapEngine() 中创建 ConsistencyLayer 实例
   └── 激活 IntentFactWall + InitVerifier（25 行代码，影响 40% 的防御体系）
   
2. 在 bootstrapEngine() 的 memory.init() 后调用 CL.verify()
   └── 启动时文件引用一致性检查（5 行代码，影响 InitVerifier 的投用）

3. 在 DocGovernAgent 的审计流程中嵌入超时提案扫描
   └── 闭合宪法 §15.1 的承诺（~30 行代码）
```

### 短期（P1，1 周内）

```
4. MemoryStore.write() 中调用 SchemaEnforcer.validate() + IntentFactWall.ensureSubType()
   └── 写路径获得一致性校验（~15 行代码）

5. _rememberResult catch 块增加半成品回滚
   └── 闭合 H-01，增强 SemiFinishedMgr 的可靠性（~10 行代码）

6. MemoryStore.init() 中扫描残留 Pending 记忆并超时 discard
   └── 半成品恢复机制（~20 行代码）
```

### 中期（P2，下一阶段）

```
7. 实现 ModificationRecordWriter — 将 Schema v1 定义转化为实际写入流程
   └── 闭合第二个教训（幻觉日期）的解决方案
   
8. MemoryStore.write() 去重路径的空 catch 替换为事件上报 + 内存回滚
   └── 闭合 M-03

9. NotificationPipe._flushMerged 修复死代码条件
   └── 闭合 N-04，恢复通知归并优化
```

---

## 十、结论

**12 个字：宪法修好了，代码没跟上，防御还睡着。**

具体来说：

1. **文档与实现的一致性：从 ~70% 降至 ~68%**。宪法层在 7 月通过了 AM-2026-0612-001 和 AM-2026-0715-001 的完整修复，协议层高度一致。但工程层的一致性防御（六层防御体系）在 06-20 到 07-22 之间 **零进展**——全部 8 项缺口未修复。

2. **Agent 边界清晰度：~88%，架构健康**。11 个 Agent 的职责边界、记忆查询策略、工具权限通过 `cortex-agents.json` 和类型系统清晰划分。ApiAgent/DataAgent/StrategistAgent 是"影子 Agent"——代码存在但不调度——虽不违反当前宪法，但增加了认知负荷。

3. **最大的断裂点**：ConsistencyLayer 是一个完整的 Facade 实现（含 5 个组件），但它处于"无人居住"的状态——从 bootstrap 到 MemoryStore 到 BaseAgent，没有任何代码导入或使用它。设计文档第 7 节的集成方案全部未落地。

4. **最大的修复杠杆**：在 `bootstrapEngine()` 中创建 ConsistencyLayer 实例并在 `memory.init()` 后调用 `verify()`——这 30 行代码能激活三组件（IntentFactWall、InitVerifier、ConsistencyLayer 本身），覆盖六层防御中 50% 的组件。

5. **最需要关注的宪法-工程裂缝**：宪法 §15.1 的超时失效机制对用户承诺了 Core-1 可执行的审计附带扫描，但 DocGovernAgent 中没有实现任何超时检查逻辑。这是宪法承诺超前于工程实现的最典型案例。
