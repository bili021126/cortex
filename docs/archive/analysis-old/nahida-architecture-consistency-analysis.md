# 架构一致性分析：设计与实现的匹配度

**分析者**: 纳西妲（草神，Cortex Analysis Agent）
**分析范围**: packages/ + docs/
**分析日期**: 2026-06-20
**核心问题**: `docs/consistency-design.md`（记忆-现实一致性校验层 v1.0）与代码实现的匹配程度

---

## 一、总览：整体匹配度 ~70%

| 维度 | 匹配度 | 关键发现 |
|------|--------|---------|
| 组件定义 | **80%** | 5/6 组件已实现，1 个完全缺失 |
| 集成对接 | **40%** | 组件存在但未接入主线流程 |
| 类型契约 | **90%** | 共享类型定义与设计高度一致 |
| 运行时行为 | **30%** | 启动校验不触发，半成品流程不完整 |

---

## 二、逐组件分析

### 2.1 IntentFactWall — ✅ 实现完整，但未接入

**文档描述**（consistency-design.md §3.2）：
> CSA 模式下过滤 subType === Intent 的记忆，HCA 模式下不过滤。
> 写前强制标记 subType，无标记默认 Fact。

**代码实现**：`packages/engine/src/consistency/intent-fact-wall.ts`
- ✅ `filterRead()` — CSA 模式过滤 Intent，HCA 模式全通过
- ✅ `ensureSubType()` — 无标记时默认 Fact
- ✅ `stats()` — 过滤统计

**集成缺口**：
- ❌ `MemoryStore.write()` 未调用 `ensureSubType()` — 执行流程中 subType 标记是调用方自觉传入的，不是系统强制
- ❌ `BaseAgent` 中有 `_filterRead` 回调钩子（line 46-47），但注入依赖调用方显式传入，ConsistencyLayer 未参与
- ⚠️ `pipeline.ts` 的 `executeWithMemoryPipeline()` 接受 `filterRead` 参数并调用（line 147-150），这是正确的集成点，但 ConsistencyLayer 未作为这个回调的来源

### 2.2 InitVerifier — ✅ 实现完整，但永不运行

**文档描述**（consistency-design.md §3.2）：
> MemoryStore.init() 之后调用，遍历所有 Active 记忆，校验文件引用的一致性。

**代码实现**：`packages/engine/src/consistency/init-verifier.ts`
- ✅ `extractFileReferences()` — 从 metadata.files、content.filePath/path、summary 文件名提取
- ✅ `run()` — 文件存在性校验 + 缺失比例计算 + fatal 标记

**集成缺口**：
- ❌ `MemoryStore.init()` 内部没有调用 InitVerifier
- ❌ `bootstrapEngine()` 没有实例化 ConsistencyLayer，没有调用 `verify()`
- ❌ `ConsistencyLayer.verify()` 方法存在但从未被调用——全代码库搜索无调用方
- ❌ 设计文档明确要求 "init() 时运行 InitVerifier"，代码中 InitVerifier 只是一个孤立的类

### 2.3 SchemaEnforcer — ✅ 实现完整，但仅用于输入校验

**文档描述**（consistency-design.md §3.2）：
> 校验 MemoryWriteInput 字段完整性，自动注入默认字段。modification-record 全量 Schema 延后至 Core-2。

**代码实现**：`packages/engine/src/consistency/schema-enforcer.ts`
- ✅ `validate()` — 校验 memoryType/content/summary/agentType/creatorId
- ✅ `annotate()` — subType 默认 Fact

**ModificationRecord Schema**：`packages/shared/src/modification-record.ts`
- ✅ `ModificationRecordV1` — 完整 schema v1 定义
- ✅ `FactAnchor` — 文件 hash、commit hash、时间戳来源分类
- ✅ `ModificationSession` — 会话级追踪
- ✅ `ModificationType` 枚举 — 封闭集合
- ✅ `ReversibilityClass` 枚举

**集成缺口**：
- ❌ `SchemaEnforcer.validate()` 未在 `MemoryStore.write()` 中被调用
- ❌ `SchemaEnforcer` 与 `ModificationRecord` 之间无联动——schema 校验器不知道 modification-record 的存在
- ⚠️ ModificationRecord 的 v1 定义比设计文档中描述的 v2 更早，缺少 `modificationRecord.json` 文件的实际写入/读取流程

### 2.4 SemiFinishedMgr — ✅ 实现完整，且已集成

**文档描述**（consistency-design.md §3.2）：
> 两阶段提交：Agent 产出 → writePending() → state=Pending → 验证 → commit() → state=Active。
> Pending 记忆默认不参与检索。

**代码实现**：`packages/engine/src/memory/semi-finished.ts`
- ✅ `writePending()` — 写入 Pending 状态 + Intent subType
- ✅ `commit()` — Pending → Active + Intent → Fact 翻转
- ✅ `discard()` — Pending → Archived
- ✅ `getPending()` / `hasPending()` — 查询接口
- ✅ commit 失败回滚逻辑（@fix EH-2）

**MemoryStore 集成**：
- ✅ `writePending()` 方法（line 459-502）
- ✅ `commitMemory()` 方法（line 510-526）
- ✅ `getPending()` / `hasPending()` 委托方法
- ✅ `pipeline.ts` 中 `_rememberResult()` 使用两阶段提交（line 169-212）

**缺口**：
- ⚠️ `_rememberResult` 的 catch 块（line 214-224）写入了半成品但验证失败时只上报不触发验证流程——没有"验证 Agent"来执行 commit/discard
- ❌ 没有针对进程崩溃的恢复机制——设计文档要求 SemiFinishedMgr 在启动时检测残留 Pending 记忆，但 InitVerifier 和 bootstrap 都不处理这个

### 2.5 GitHookBridge — ❌ 完全缺失（P0 级缺口）

**文档描述**（consistency-design.md §3.2）：
> 回滚级联失效——Git 事件映射到记忆失效。
> 用户 git checkout/revert/reset → 关联记忆自动降级。

**代码状态**：
- ❌ 全代码库搜索 `GitHookBridge`、`GitHook`、`git-hook-bridge` — 0 个结果
- ❌ 没有任何 git 事件监听机制
- ❌ 没有任何记忆失效级联逻辑
- ❌ `FileLockManager` 不追踪外部修改（设计文档明确指出此缺口）
- ❌ `ConsistencyLayer` 中没有 GitHookBridge 的引用或占位

**严重性**：P0 — 这是设计文档中三个血淋淋教训（例三）的直接解决方案。用户 git checkout 回滚后，记忆与现实的分裂无法修复。

### 2.6 ConsistencyLayer Facade — ✅ 定义完整，但未被使用

**文档描述**（consistency-design.md §3.1）：
> 跨组件调度：组合 InitVerifier + SchemaEnforcer + IntentFactWall + SemiFinishedMgr + GitHookBridge。

**代码实现**：`packages/engine/src/consistency/consistency-layer.ts`
- ✅ `verify()` → InitVerifier
- ✅ `validateInput()` / `annotateInput()` → SchemaEnforcer
- ✅ `filterRead()` → IntentFactWall
- ✅ `ensureSubType()` → IntentFactWall

**集成缺口**：
- ✅ **ConsistencyLayer 已被导出**为公开 API（`engine/src/index.ts` line 77）
- ❌ 但 **没有任何代码导入并使用 ConsistencyLayer** — 全代码库 zero imports
- ❌ `bootstrapEngine()` 不接受 ConsistencyLayer 实例，不实例化它
- ❌ `MemoryStore` 构造函数不接受 ConsistencyLayer
- ❌ 设计文档第 7 节的代码 diff 方案（BaseAgent 可选注入、Toolkit 中 setConsistencyLayer）全部未落地

---

## 三、类型契约一致性

### 3.1 MemorySubType 枚举 — ✅ 高度一致

| 设计文档要求 | 代码实现 | 状态 |
|-------------|---------|------|
| Intent/Fact 子类型区分 | `shared/src/memory.ts` 定义了 `enum MemorySubType { Intent, Fact }` | ✅ |
| MemoryWriteInput.subType 可选字段 | `subType?: MemorySubType` | ✅ |
| MemoryEntry.subType 可选字段 | `subType?: MemorySubType` | ✅ |
| MemoryQuery.subTypes 过滤 | `subTypes?: MemorySubType[]` | ✅ |

### 3.2 MemoryState 枚举 — ✅ 完整

设计文档要求四态 + 半成品 Pending：
- ✅ `Active`, `Pending`, `Archived`, `Frozen`, `Obliterated`

### 3.3 ModificationRecord Schema — ✅ v1 完整，v2 未跟进

设计文档要求的事实锚点全部在 v1 中存在：
- ✅ `fileHashBefore` / `fileHashAfter`
- ✅ `commitHash`
- ✅ `gitDiffSummary`
- ✅ `timestampSource` 枚举（含 `filesystem_mtime` / `git_commit_time` / `system_clock` / `llm_inferred`）

---

## 四、依赖结构分析

### 4.1 包依赖图（实际 vs 文档隐含）

```
文档隐含的理想依赖：
  cli → engine → consistency-layer → memory-store
                                    → shared

实际代码依赖：
  cli        → engine, llm, parser, shared
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
- ✅ 依赖方向是健康的：shared ← 所有包，无循环依赖
- ❌ `engine` 不依赖 `factory` 以外的包，但 `consistency-layer.ts` 引用了 `@cortex/shared` — 这是正确的，但 ConsistencyLayer 不在 engine 的核心依赖路径上
- ⚠️ `parser` 无任何内部依赖——它似乎独立于整个体系之外，设计文档未提及

### 4.2 模块边界清晰度

| 模块 | 导出边界 | 内部隐藏 | 评分 |
|------|---------|---------|------|
| `engine/src/consistency/` | 4 个文件均通过 barrel 导出 | ✅ 内部细节隐藏 | B+ |
| `engine/src/memory/` | 仅 MemoryStore 等 4 个符号导出 | ✅ SemiFinishedMgr 未直接导出 | A- |
| `shared/src/` | 所有类型通过桶导出 | ✅ 纯类型/枚举 | A |

---

## 五、缺口分级与修复建议

### P0 级缺口（必须修复）

| # | 缺口 | 影响 | 修复路径 |
|---|------|------|---------|
| G1 | **GitHookBridge 缺失** | 用户 git checkout/revert 后记忆与现实永久分裂 | 新增 `consistency/git-hook-bridge.ts`，监听 git 事件，级联失效关联记忆 |
| G2 | **ConsistencyLayer 未被实例化** | 5 个组件全部离线，六层防御形同虚设 | `bootstrapEngine()` 创建 ConsistencyLayer，注入 MemoryStore 和 BaseAgent |
| G3 | **InitVerifier 从未运行** | 启动时记忆-文件系统一致性零检查 | `MemoryStore.init()` 后调用 `ConsistencyLayer.verify()` |

### P1 级缺口（应该修复）

| # | 缺口 | 影响 | 修复路径 |
|---|------|------|---------|
| G4 | **SchemaEnforcer 未接入写路径** | `memoryType`/`summary`/`creatorId` 无强制性校验 | `MemoryStore.write()` 内部调用 `SchemaEnforcer.validate()` |
| G5 | **ensureSubType 未强制** | subType 依赖调用方自觉传入 | `MemoryStore.write()` 和 `writePending()` 内部调用 `ensureSubType()` |
| G6 | **半成品恢复机制缺失** | 进程崩溃后 Pending 记忆永存 | `InitVerifier.run()` 增加 Pending 记忆检测 + 超时自动 discard |

### P2 级缺口（值得改进）

| # | 缺口 | 影响 | 修复路径 |
|---|------|------|---------|
| G7 | **ModificationRecord 未写入** | Schema v1 定义完成但无实际写入文件流程 | 新增 `ModificationRecordWriter` 配合 ConsistencyLayer 记录文件操作 |
| G8 | **ConsistencyLayer 与 MemoryStore 无事务边界** | 记忆写入与一致性校验不原子 | 在 MemoryStore 中集成 ConsistencyLayer，写路径校验一体化 |

---

## 六、核心结论

这片雨林有美丽的树冠（设计文档），有发达的根系（类型定义、组件实现），但**主干的导管没有打通**。

具体来说，`consistency-design.md` 描述的六层防御体系：
- **第一层**（IntentFactWall）：树冠已成型，但阳光照不到根部——代码有实现，有导出，有回调钩子，但 ConsistencyLayer 不在执行路径上
- **第二层**（InitVerifier）：种子已破土，但没有被播种——完整的类定义和算法，但 `run()` 从未被调用
- **第三层**（GitHookBridge）：设计图上画了，但地下根本没有这根根系——完全未实现
- **第四层**（SchemaEnforcer）：可以作为独立工具存在，但未接入写路径
- **第五层**（SemiFinishedMgr）：这是唯一一个真正接入主线的组件——`writePending`+`commitMemory` 已集成到 pipeline 的记忆写入流程
- **第六层**（ConsistencyLayer Orchestrator）：Facade 定义完成，export 了，但 zero consumer——像一个被精心打造却无人居住的房子

**修复优先级矩阵**：

```
                高影响              低影响
高成本      G1 (GitHookBridge)    G7 (ModRecord写入)
低成本      G2 (实例化CL)         G4 (Schema接入写路径)
            G3 (InitVerifier)     G5 (ensureSubType强制)
            G6 (半成品恢复)
```

最经济且影响最大的修复是 **G2 + G3**：在 `bootstrapEngine()` 中创建 ConsistencyLayer 实例，在 `MemoryStore.init()` 后调用 `verify()`。这能在 20 行代码内激活三个已完成的组件（IntentFactWall、InitVerifier、SchemaEnforcer）。
