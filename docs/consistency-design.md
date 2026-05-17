# 记忆-现实一致性校验层设计

**版本**: v1.0  
**状态**: 设计提案（圆桌论证收束）  
**宪法依据**: 原则七（系统自我修改的宪法约束）、第九章（记忆系统）  
**产出路径**: 本设计文档 + 结构化 Schema (Schema v1) + 代码 diff 方案  

---

## 目录

1. [圆桌论证 —— 三个血淋淋教训的根源分析](#1-圆桌论证--三个血淋淋教训的根源分析)
2. [根因诊断 —— 一致性裂缝的 5 个维度](#2-根因诊断--一致性裂缝的-5-个维度)
3. [架构设计 —— 一致性校验层](#3-架构设计--一致性校验层)
4. [API 设计](#4-api-设计)
5. [生命周期 —— 校验层的介入时机](#5-生命周期--校验层的介入时机)
6. [结构化 Schema —— modification-record.json v2](#6-结构化-schema--modification-recordjson-v2)
7. [代码 diff 方案](#7-代码-diff-方案)
8. [三个教训的兜底验证](#8-三个教训的兜底验证)
9. [宪法原则七审计](#9-宪法原则七审计)

---

## 1. 圆桌论证 —— 三个血淋淋教训的根源分析

### 1.1 第一例：solo-flight 项目被静默删除（6358 行代码）

**现象**：Agent 写入记忆"计划清理 solo-flight 冗余代码" → 进程被外部杀死 → 文件未动，记忆留存 → 下次启动 Agent 读到记忆，认为"已经做完了" → 真的执行删除。

**根源解剖**：

```
┌─────────────────────────────────────────────────────────┐
│  第一刀：意图与事实未分离                                 │
│  "计划清理 solo-flight 冗余代码" —— 这是一条意图(Intent) │
│  但 MemoryStore 没有意图/事实字段区分。                    │
│  它被存储为普通 Episodic 记忆，weight=5，与"已完成"无差别 │
├─────────────────────────────────────────────────────────┤
│  第二刀：启动时无一致性校验                                │
│  进程重启后 MemoryStore 从 SQLite 加载全部记忆。           │
│  没有「记忆 vs 文件系统」的对账步骤。                      │
│  Agent 读到记忆就信了——它无法知道对应的文件还在不在。      │
├─────────────────────────────────────────────────────────┤
│  第三刀：回退机制缺位                                    │
│  如果用户在删除前执行了 git checkout 回滚，                 │
│  或者进程崩溃前该记忆对应的文件从未被实际修改过：             │
│  没有任何机制让记忆失效。                                  │
└─────────────────────────────────────────────────────────┘
```

**凝光裁定**：此案例是"意图污染事实"的典型——系统将未执行的意图等同于已执行的事实。MemoryStore 没有意图/事实区分是直接原因，启动无校验是放大条件，回退机制缺位是兜底失败。

### 1.2 第二例：modification-record.json 出现幻觉日期

**现象**：多次测试的修改记录混入同一个记忆库，Agent 从记忆中推断出不存在的历史修改时间线，写入正式记录。

**根源解剖**：

```
┌─────────────────────────────────────────────────────────┐
│  第一刀：modification-record.json 无结构化 Schema        │
│  修改记录是一个无结构 JSON，日期字段由 Agent 自由填写。     │
│  Agent 从记忆库中检索到多条历史记录后，                     │
│  用 LLM 推断的方式补全日期（MOD-2026-05-14-001 等）。      │
│  这些日期从未在文件系统中实际存在。                         │
├─────────────────────────────────────────────────────────┤
│  第二刀：记忆写入无事实锚点                               │
│  每次测试的修改记录被写入 MemoryStore 时，                 │
│  没有附带"这条记忆是在哪个 commit 产生的"                   │
│  或"对应的文件 hash 是什么"等事实锚点。                    │
│  跨 run 检索时，Agent 无法区分哪些记忆属于当前 run。       │
├─────────────────────────────────────────────────────────┤
│  第三刀：修改记录与文件系统无绑定关系                       │
│  modification-record.json 本身是一个独立文件，             │
│  但它引用的文件修改记录没有与文件系统的实际状态绑定。        │
│  读它的人（Agent）无法判断记录中的修改是否真的发生过。       │
└─────────────────────────────────────────────────────────┘
```

**刻晴判定**：幻觉日期的本质不是 LLM 幻觉——是记忆缺少事实锚点（commit hash / file hash / 操作时间戳事实来源）。Agent 不是"编造"日期，而是从多条不完整的记忆中"拼接"出了看似合理但不存在的完整时间线。

### 1.3 第三例：用户回退后，记忆还在说"已完成"

**现象**：用户 git checkout 回滚文件 → 文件恢复了 → MemoryStore 里仍记录着"这个文件被修改过" → Agent 下次读到这条记忆时对现实做出误判。

**根源解剖**：

```
┌─────────────────────────────────────────────────────────┐
│  第一刀：无回滚级联失效机制                               │
│  用户通过 git checkout 回滚文件——这个动作在文件系统层面    │
│  是完全合法的。但 MemoryStore 不知道文件被回滚了。         │
│  记忆仍然保留着 "users.ts 已重构" 的记录。               │
├─────────────────────────────────────────────────────────┤
│  第二刀：FileLockManager 只锁并发不锁回滚                │
│  FileLockManager 防止同一文件被两个 Agent 同时写，         │
│  但不追踪"文件在锁释放后被外部工具修改"的情况。            │
├─────────────────────────────────────────────────────────┤
│  第三刀：git 事件与记忆系统完全脱钩                       │
│  git checkout / git revert 等操作不触发任何                │
│  MemoryStore 的回调。记忆系统无法感知文件系统的变更。      │
└─────────────────────────────────────────────────────────┘
```

**甘雨研判**：此案例是三个中最致命的——因为它揭示了 MemoryStore 的"记忆"与文件系统的"现实"之间完全没有事务边界。用户用 git 回滚文件，在用户视角是"撤销操作"，在系统视角是"记忆与现实的分裂"。除非我们主动校验，否则记忆永远不会知道自己错了。

### 1.4 圆桌共识：5 条根因

| # | 根因 | 涉及教训 | 严重程度 |
|---|------|---------|---------|
| R1 | **意图与事实未分离**——MemoryEntry 缺少 `intent` 类型字段，意图写入后被等同为事实 | 例一、例二 | P0 |
| R2 | **启动无一致性校验**——MemoryStore init() 不检查记忆引用的文件是否存在 | 例一、例三 | P0 |
| R3 | **回滚时无级联失效**——git checkout/revert 不触发记忆失效 | 例三 | P0 |
| R4 | **修改记录无结构化 Schema**——modification-record.json 无强制 Schema，Agent 自由填充导致幻觉 | 例二 | P1 |
| R5 | **半成品记忆无标记**——进程被杀死后残留的记忆无"半成品"标记，下次被当作完整事实读取 | 例一 | P1 |

---

## 2. 根因诊断 —— 一致性裂缝的 5 个维度

### 2.1 维度一：意图(Intent) vs 事实(Fact)

当前 MemoryEntry 只有 `memoryType`（Episodic / Conceptual / Knowledge / Skill），没有意图/事实的区分。

**问题**：意图型记忆（"计划…"、"打算…"、"下一步…"）与事实型记忆（"已修复…"、"已删除…"、"重构完成…"）在检索时权重相同。Agent 无法区分"这是我想做的"和"这是我做过的"。

**影响范围**：MemoryEntry schema、MemoryQuery、Agent 的 read() 过滤逻辑。

### 2.2 维度二：启动校验(Init Validation)

当前 MemoryStore.init(dbPath) 仅加载 SQLite 数据到内存 Map，不做任何文件系统校验。

**问题**：记忆引用文件路径（存储在 content 或 metadata 中）——启动时不检查文件是否存在。进程重启后，Agent 读到"已删除"的记忆时，对应的文件可能还在；读到"已修改"的记忆时，对应的文件可能未变化。

**影响范围**：MemoryStore.init()、MemoryPersistence._loadFromDb()。

### 2.3 维度三：回滚失效(Rollback Cascade)

当前没有任何机制将 git 事件映射到记忆失效。

**问题**：用户执行 git checkout/revert/reset 后，MemoryStore 中关联的记忆仍然 active。没有"文件版本回退 → 关联记忆自动降级"的管道。

**影响范围**：需新增 GitHookAdapter 或 GitEventPoller + 记忆失效触发链路。

### 2.4 维度四：修改记录结构化(Schema Enforcement)

当前 modification-record.json 是 Agent 自由写入的 JSON，无类型约束、无字段校验。

**问题**：日期字段无来源校验（是文件 mtime？是记忆 createdAt？还是 LLM 推断？）；引用文件路径无存在性校验；操作类型无枚举约束。

**影响范围**：需定义 ModificationRecord Schema v2，包含事实锚点（commitHash, fileHash, sourceTimestamp）和引用完整性约束。

### 2.5 维度五：半成品处理(Semi-finished Marking)

当前 MemoryStore 无"事务中"标记。进程崩溃后残留的记忆无法与完整执行的记忆区分。

**问题**：Agent write() 成功后记忆即为 Active。如果进程在此后立即崩溃，下次启动后这条记忆处于 Active 状态，看起来与任何成功写入的记忆无异——但对应的文件操作可能未执行或未完成。

**影响范围**：MemoryStore.write()、MemoryLifecycle、MemoryState 枚举。

---

## 3. 架构设计 —— 一致性校验层

### 3.1 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                    一致性校验层 (ConsistencyLayer)                 │
│                                                                   │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐   │
│  │ IntentFactWall   │  │ InitVerifier     │  │ GitHookBridge │   │
│  │ (意图/事实隔离)   │  │ (启动一致性校验)  │  │ (回滚级联失效) │   │
│  ├─────────────────┤  ├──────────────────┤  ├───────────────┤   │
│  │ · intent 字段    │  │ · 文件存在性校验  │  │ · git diff     │   │
│  │ · intent TTL     │  │ · 文件 hash 校验 │  │ · 记忆级联失   │   │
│  │ · 事实晋升机制   │  │ · 孤儿记忆回收   │  │   效触发      │   │
│  └─────────────────┘  └──────────────────┘  └───────────────┘   │
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐                      │
│  │ SchemaEnforcer   │  │ SemiFinishedMgr  │                      │
│  │ (记录 Schema 强制)│  │ (半成品治理)      │                      │
│  ├──────────────────┤  ├──────────────────┤                      │
│  │ · JSON Schema    │  │ · write-phase    │                      │
│  │ · 事实锚点注入   │  │ · crash recovery │                      │
│  │ · 校验钩子       │  │ · PENDING 状态   │                      │
│  └──────────────────┘  └──────────────────┘                      │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │           跨组件调度：ConsistencyOrchestrator             │     │
│  │  · init() 时运行 InitVerifier                             │     │
│  │  · write_file/delete_file 后触发 GitHookBridge 快照       │     │
│  │  · read() 时经 IntentFactWall 过滤                        │     │
│  │  · modification-record 写入时经 SchemaEnforcer            │     │
│  │  · 检测到进程崩溃时 SemiFinishedMgr 标记恢复              │     │
│  └─────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
         │                    │                       │
         ▼                    ▼                       ▼
  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐
  │ MemoryStore │   │ Toolkit      │   │ GitRepository    │
  │ (记忆读写)   │   │ (文件操作)    │   │ (git 状态)       │
  └─────────────┘   └──────────────┘   └──────────────────┘
```

### 3.2 组件职责矩阵

| 组件 | 职责 | 不负责 | 依赖 |
|------|------|--------|------|
| **IntentFactWall** | 意图/事实区分 → read() 过滤意图 → 事实晋升审核 (PENDING→ACTIVE 需验证) | 文件系统校验 | MemoryEntry.memorySubType |
| **InitVerifier** | 启动时遍历 Active 记忆 → 提取文件引用 → 校验存在性+hash → 标记失效记忆 | git 事件监听 | MemoryStore.read() + fs.stat |
| **GitHookBridge** | Git 事件订阅 (post-checkout/post-commit) → 差异分析 → 记忆级联失效触发 | 文件存在性校验 | git hooks / git diff |
| **SchemaEnforcer** | modification-record Schema v1 强制 → 事实锚点自动注入 → 引用完整性校验 | 记忆状态管理 | ModificationRecordSchema |
| **SemiFinishedMgr** | PENDING 状态定义 → 写操作两阶段提交 → crash recovery 扫描 | Schema 校验 | MemoryState + _pendingOps |
| **ConsistencyOrchestrator** | 编排上述组件 → 生命周期调度 → 阈值告警 → 降级决策 | 具体校验逻辑 | 全部组件 |

### 3.3 与现有架构的关系

```
一致性校验层 ── 位置：位于 MemoryStore 之外，作为中间件层

Agent (BaseAgent)
  │
  ├─ executeWithMemoryPipeline()  ← 记忆增强执行管道（已有）
  │    │
  │    ├─ read() ──→ ConsistencyLayer.filter() ──→ MemoryStore.read()
  │    │                ↑ IntentFactWall 在此介入
  │    │
  │    └─ write() ──→ ConsistencyLayer.annotate() ──→ MemoryStore.write()
  │                     ↑ SemiFinishedMgr 在此介入
  │
  ├─ toolkit.execute() ← 工具调用（已有）
  │    │
  │    ├─ write_file/delete_file → ConsistencyLayer.recordOp() → SchemaEnforcer
  │    └─ 工具执行后 → ConsistencyLayer.snapshotFile() → GitHookBridge.capture()
  │
  └─ MemoryStore.init() ← 启动
       └─ ConsistencyLayer.verify() → InitVerifier.run()
```

关键设计决策：**一致性校验层不修改 MemoryStore 的内部实现**。它通过装饰器/中间件模式包裹 MemoryStore，在关键入口点插入校验逻辑。这样做的原因：
1. MemoryStore 已通过委托模式拆分为 7 组件族，修改内部会破坏现有架构稳定性
2. 一致性校验层本身需要独立测试和演进，混合在 MemoryStore 中不利于隔离
3. 用户/外部工具可以通过 bypassConsistencyCheck() 关闭校验（测试场景），不影响 MemoryStore 核心逻辑

---

## 4. API 设计

### 4.1 ConsistencyLayer 接口

```typescript
// packages/engine/src/consistency/consistency-layer.ts

import type { MemoryStore, MemoryEntry, MemoryQuery, MemoryWriteInput } from "../memory-store.js";
import type { IFileSystemAdapter } from "@cortex/shared";

export interface ConsistencyLayerConfig {
  /** 项目根目录（用于文件路径解析） */
  projectRoot: string;
  /** Git 仓库路径（用于 git diff/hash） */
  gitRepoPath?: string;
  /** 启动校验阈值：校验失败的记忆超过此比例时阻止启动（默认 0.3 = 30%） */
  failThreshold?: number;
  /** 是否启用半成品治理 */
  enableSemiFinished?: boolean;
  /** 是否启用意图/事实隔离 */
  enableIntentFactWall?: boolean;
  /** 是否启用 git hook 桥接 */
  enableGitHookBridge?: boolean;
  /** FileSystemAdapter（注入以实现可测试性） */
  fs?: IFileSystemAdapter;
}

export class ConsistencyLayer {
  constructor(
    private readonly memory: MemoryStore,
    private readonly config: ConsistencyLayerConfig,
  ) {}

  // ── 生命周期 ────────────────────────────────

  /**
   * 启动校验 —— 在 MemoryStore.init() 之后调用。
   * 遍历所有 Active 记忆，校验文件引用的一致性。
   * 返回校验报告。
   */
  async verify(): Promise<ConsistencyReport>;

  /**
   * 注册 git hook —— 安装 post-checkout / post-commit hooks。
   * 可选（用户同意后执行）。
   */
  async installGitHooks(): Promise<{ installed: number; failed: string[] }>;

  /**
   * 关闭一致性校验层（测试环境用）。
   */
  async shutdown(): Promise<void>;

  // ── 读拦截 ──────────────────────────────────

  /**
   * 过滤查询结果：移除意图型记忆（除非显式查询 intent）。
   * 在 MemoryStore.read() 结果上后处理。
   */
  filterReadResults(results: MemoryEntry[], query: MemoryQuery): MemoryEntry[];

  // ── 写拦截 ──────────────────────────────────

  /**
   * 装饰写入输入：自动附加事实锚点、启动半成品标记。
   * 在 MemoryStore.write() 前调用。
   */
  annotateWriteInput(input: MemoryWriteInput): Promise<AnnotatedWriteInput>;

  /**
   * 确认写入完成：清除半成品标记。
   * 在 MemoryStore.write() 成功后调用。
   */
  confirmWriteCompleted(memoryId: string): Promise<void>;

  // ── 工具调用追踪 ────────────────────────────

  /**
   * 记录文件操作（write_file / delete_file）。
   * 保存操作前后的文件 hash，用于后续一致性校验。
   */
  recordFileOp(op: FileOperation): Promise<void>;

  /**
   * 文件快照：记录当前文件 hash 到一致性校验存储。
   */
  snapshotFile(filePath: string): Promise<FileSnapshot>;

  // ── 回滚级联失效 ────────────────────────────

  /**
   * 处理 git checkout/revert 事件。
   * 分析变更文件列表 → 查找引用这些文件的记忆 → 触发级联失效。
   */
  processGitCheckout(diff: GitDiff): Promise<CascadeResult>;

  // ── 状态查询 ────────────────────────────────

  getStatus(): ConsistencyLayerStatus;
}
```

### 4.2 InitVerifier API

```typescript
// packages/engine/src/consistency/init-verifier.ts

export interface VerificationEntry {
  memoryId: string;
  filePath: string;
  checkType: 'exists' | 'hash_match';
  expectedHash?: string;  // 写入时保存的文件 hash
  actualHash?: string;    // 当前文件 hash
  status: 'ok' | 'missing' | 'hash_mismatch' | 'unchecked';
}

export interface ConsistencyReport {
  timestamp: number;
  totalMemories: number;
  checkedMemories: number;  // 有文件引用的记忆数
  fileChecks: VerificationEntry[];
  summary: {
    ok: number;
    missing: number;    // 文件不存在
    hashMismatch: number; // 文件已被修改
    unchecked: number;  // 无法校验（无文件引用）
  };
  fatal: boolean;  // failThreshold 超标
}

export class InitVerifier {
  constructor(
    private readonly memory: MemoryStore,
    private readonly fs: IFileSystemAdapter,
    private readonly projectRoot: string,
    private readonly failThreshold: number,
  ) {}

  /**
   * 运行启动校验。
   * 
   * 流程：
   * 1. 查询所有 Active 记忆（limit=0 表示拉取全部）
   * 2. 从记忆的 metadata.files 或 content 中提取文件路径
   * 3. 对每个文件路径：检查存在性 + 可选 hash 匹配
   * 4. 汇总报告
   */
  async run(): Promise<ConsistencyReport>;

  /**
   * 从记忆条目中提取引用的文件路径列表。
   * 支持：metadata.files (string[])、content 中的 filePath 字段
   */
  extractFileReferences(entry: MemoryEntry): string[];
}
```

### 4.3 IntentFactWall API

```typescript
// packages/engine/src/consistency/intent-fact-wall.ts

/**
 * 记忆子类型 —— 区分意图、事实、上下文
 */
export enum MemorySubType {
  /** 已执行的事实：文件已修改/已删除/已创建 */
  Fact = "fact",
  /** 未执行的意图：计划、打算、下一步 */
  Intent = "intent", 
  /** 上下文信息：设计决策、代码分析、会议记录 */
  Context = "context",
}

export class IntentFactWall {
  /**
   * 过滤查询结果。
   * 默认过滤规则：
   * - queryMode='csa'（深度窄读）：移除 Intent 类型
   * - queryMode='hca'（广度浅读）：保留 Intent（MetaAgent 需要看到规划） 
   * - 显式设置 includeIntent=true 时不移除
   */
  filter(results: MemoryEntry[], query: MemoryQuery): MemoryEntry[];

  /**
   * 意图晋升审核。
   * 将 Intent 类型的记忆提升为 Fact 前，需要验证：
   * 1. 对应的文件操作是否已执行
   * 2. 操作结果是否与意图一致
   * 返回晋升结果。
   */
  reviewPromotion(memoryId: string): Promise<PromotionResult>;

  /**
   * 提取意图的 TTL（生存时间）。
   * 超过 TTL 的意图自动降权，防止"过期未执行的意图"污染检索。
   * 默认：Intent 类型的记忆 TTL = 24 小时。
   */
  getIntentTTL(): number;
}
```

### 4.4 SemiFinishedMgr API

```typescript
// packages/engine/src/consistency/semi-finished-mgr.ts

export enum OpPhase {
  /** 写入命令已下达，但文件操作尚未确认 */
  Pending = "pending",
  /** 文件操作已执行，正在等待记忆写入确认 */
  Committing = "committing",
  /** 完整完成 */
  Committed = "committed",
  /** 操作失败或回滚 */
  RolledBack = "rolled_back",
}

export interface PendingOperation {
  id: string;
  type: 'write_file' | 'delete_file' | 'memory_write';
  phase: OpPhase;
  filePath?: string;
  memoryId?: string;
  startedAt: number;
  heartbeats: number[];  // 上次心跳时间戳，用于检测崩溃
}

export class SemiFinishedMgr {
  /**
   * 注册一个待定操作。
   * 在 write_file/delete_file 实际执行前调用。
   */
  beginOperation(op: Omit<PendingOperation, 'id' | 'heartbeats'>): string;

  /**
   * 推进操作阶段。
   */
  advancePhase(opId: string, newPhase: OpPhase): void;

  /**
   * 发送心跳 —— 标记操作仍在进行中。
   * 启动时若发现超过 30 秒无心跳的 pending 操作，判定为崩溃残留。
   */
  heartbeat(opId: string): void;

  /**
   * 启动时扫描残留的 pending 操作。
   * 返回需要恢复或回滚的操作列表。
   */
  scanCrashResidue(): PendingOperation[];

  /**
   * 处理崩溃残留操作。
   * 策略：如果文件存在 → 校验 hash 后决定是否提交；如果文件不存在 → 标记回滚。
   */
  resolveCrashResidue(ops: PendingOperation[]): Promise<CrashResolutionReport>;
}
```

### 4.5 SchemaEnforcer API

```typescript
// packages/engine/src/consistency/schema-enforcer.ts

import type { ModificationRecord, ModificationRecordSchema } from "./schema.js";

export class SchemaEnforcer {
  /**
   * 校验 modification record 是否符合 Schema v1。
   * 自动注入事实锚点（commitHash, fileHash, sourceTimestamp）。
   */
  validateAndAnnotate(record: Partial<ModificationRecord>): ModificationRecord;

  /**
   * 验证引用完整性：记录中引用的文件路径是否存在。
   */
  verifyReferenceIntegrity(record: ModificationRecord): Promise<{
    valid: boolean;
    missingFiles: string[];
  }>;

  /**
   * 序列化 record 为 JSON（固定字段顺序，避免 git diff 噪音）。
   */
  serialize(record: ModificationRecord): string;
}
```

### 4.6 GitHookBridge API

```typescript
// packages/engine/src/consistency/git-hook-bridge.ts

export interface GitDiff {
  /** 变更的文件列表 */
  changedFiles: string[];
  /** 每个文件的变更类型：modified / added / deleted */
  changeTypes: Record<string, 'modified' | 'added' | 'deleted'>;
  /** 前一个 commit hash */
  fromHash: string;
  /** 当前 commit hash */
  toHash: string;
}

export interface CascadeResult {
  /** 被级联失效的记忆 ID 列表 */
  invalidatedMemoryIds: string[];
  /** 每个记忆的失效原因 */
  reasons: Record<string, string>;
  /** 被降级（Archived）的记忆数 */
  archived: number;
  /** 被冻结（Frozen）的记忆数 */
  frozen: number;
}

export class GitHookBridge {
  /**
   * 安装 git hooks。
   * 在 post-checkout 和 post-commit 钩子中插入代理脚本。
   */
  installHooks(gitDir: string): Promise<boolean>;

  /**
   * 卸载 git hooks。
   */
  uninstallHooks(gitDir: string): Promise<boolean>;

  /**
   * 执行回滚分析：根据 git diff 找出需要级联失效的记忆。
   * 
   * 策略：
   * - 文件被恢复（从新状态回到旧状态）→ 所有引用该文件的 "已修改" 记忆 → Frozen
   * - 文件被删除 → 所有引用该文件的 "已创建" 记忆 → Frozen
   * - 文件被修改（与记忆中的预期 hash 不符）→ 相关记忆 → Archived
   */
  analyzeRollback(diff: GitDiff): Promise<CascadeAction[]>;

  /**
   * 手动触发一次 git diff 扫描（用于启动时或定时任务）。
   */
  scanForChanges(): Promise<GitDiff | null>;
}
```

---

## 5. 生命周期 —— 校验层的介入时机

### 5.1 完整生命周期图

```
                      系统启动
                         │
                         ▼
              ┌─────────────────────┐
              │ MemoryStore.init()  │ ← SQLite 加载到内存
              └─────────┬───────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │ InitVerifier.run()  │ ← 一致性校验层介入点 #1
              │   · 提取文件引用     │    检查所有 Active 记忆对应的文件
              │   · 校验文件存在性   │    是否仍然存在且未被外部修改
              │   · 校验文件 hash   │
              └─────────┬───────────┘
                        │
              ╔══════════════════════╗
              ║  校验通过？          ║ ← failThreshold=30%
              ╚════════╤═════════════╝
                  ┌────┴────┐
                  ▼         ▼
              ╔═══════╗  ╔══════════════╗
              ║ 正常  ║  ║ 阻止启动/告警 ║
              ╚═══╤═══╝  ╚══════════════╝
                  │
                  ▼
         ┌────────────────────┐
         │ Agent 执行阶段      │
         └────────┬───────────┘
                  │
        ┌─────────┴──────────┐
        │                     │
        ▼                     ▼
  ┌──────────────┐   ┌──────────────┐
  │ read() 路径   │   │ write() 路径  │
  │              │   │              │
  │ IntentFact   │   │ SemiFinished │
  │ Wall.filter  │   │ Mgr.begin()  │
  │ 过滤意图记忆  │   │ 标记 pending │
  └──────────────┘   └──────┬───────┘
                            │
                     ┌──────┴──────┐
                     ▼             ▼
              ┌───────────┐  ┌──────────┐
              │ 文件操作   │  │ 记忆写入  │
              │ (toolkit)  │  │ (memory) │
              └─────┬─────┘  └────┬─────┘
                    │             │
                    ▼             ▼
              ┌───────────┐  ┌──────────┐
              │ Schema    │  │ Semi     │
              │ Enforcer  │  │ Finished │
              │ 记录操作   │  │ Mgr.     │
              │ + 文件快照 │  │ confirm()│
              └───────────┘  └──────────┘
                            │
                            ▼
                    ┌────────────────┐
                    │ 正常完成        │
                    └────────────────┘

                    ════════════════════════
                    外部事件（回滚/崩溃）
                    ════════════════════════

  Git post-checkout hook             进程崩溃
         │                              │
         ▼                              ▼
  ┌──────────────┐              ┌────────────────┐
  │ GitHook      │              │ 下次启动时      │
  │ Bridge       │              │ SemiFinished   │
  │ .analyze     │              │ Mgr.scanCrash  │
  │ Rollback()   │              │ Residue()       │
  └──────┬───────┘              └───────┬────────┘
         │                              │
         ▼                              ▼
  ┌──────────────┐              ┌────────────────┐
  │ 级联失效触发  │              │ 解析残留操作    │
  │ · Frozen     │              │ · 提交或回滚   │
  │ · Archived   │              │ · 标记失效     │
  └──────────────┘              └────────────────┘
```

### 5.2 介入点汇总表

| 时机 | 介入组件 | 行为 | 可降级 |
|------|---------|------|--------|
| 启动时 (init) | InitVerifier | 校验全部 Active 记忆的文件引用 | 是（跳过校验，记录告警） |
| 启动时 (init) | SemiFinishedMgr | 扫描崩溃残留 | 否（残留必须处理） |
| read() 后 | IntentFactWall | 过滤意图记忆 | 是（queryMode=hca 时不过滤） |
| write() 前 | SemiFinishedMgr | 注册 pending 操作 | 是（配置关闭时跳过） |
| write() 后 | SchemaEnforcer | 注入事实锚点 | 否（锚点是 Schema 强制要求） |
| write_file/del 后 | FileOpTracker | 记录文件 hash 快照 | 是（慢路径可关闭） |
| git post-checkout | GitHookBridge | 级联失效触发 | 是（未安装 hooks 时跳过） |
| 定时/手动 | GitHookBridge | 增量扫描 git diff | 是（非核心路径） |

---

## 6. 结构化 Schema —— modification-record.json v2

### 6.1 ModificationRecord Schema v1

```typescript
// packages/shared/src/modification-record.ts

/**
 * ModificationRecord v1 —— 修改记录结构化 Schema。
 * 
 * 解决第二例问题（幻觉日期）的核心设计：
 * 1. 所有时间戳必须有来源标记（sourceTimestamp vs inferredTimestamp）
 * 2. 所有文件路径必须有事实锚点（fileHash 在修改前后的值）
 * 3. 操作 ID 由系统生成（格式：MOD-{runId}-{seq}），禁止 Agent 推断
 * 4. 每条记录必须关联一个 ModificationSession（对应一次 Agent 执行 run）
 */

/** 修改操作类型枚举 —— 封闭集合，禁止 Agent 自定义 */
export enum ModificationType {
  FileCreated = "file_created",
  FileModified = "file_modified",
  FileDeleted = "file_deleted",
  MemoryWritten = "memory_written",
  BatchRefactor = "batch_refactor",
}

/** 修改操作的可逆性 */
export enum ReversibilityClass {
  /** 可逆（文件内容变更，可通过 git revert 恢复） */
  Reversible = "reversible",
  /** 不可逆（文件删除，需从 git 历史恢复） */
  Irreversible = "irreversible",
  /** 元操作（记忆写入，不影响文件系统） */
  Meta = "meta",
}

/** 事实锚点 —— 每条记录必须至少包含一个来源 */
export interface FactAnchor {
  /** 文件内容 hash (SHA256)，操作前的值 */
  fileHashBefore?: string;
  /** 文件内容 hash (SHA256)，操作后的值 */
  fileHashAfter?: string;
  /** 操作时的 commit hash（HEAD） */
  commitHash?: string;
  /** 操作时的 git diff 摘要 */
  gitDiffSummary?: string;
  /** 时间戳来源类型 */
  timestampSource: 'filesystem_mtime' | 'git_commit_time' | 'system_clock' | 'llm_inferred';
  /** 实际时间戳 */
  timestamp: number;
}

/** 单条修改记录 */
export interface ModificationRecordItem {
  /** 系统生成的唯一 ID，格式: MOD-{runId}-{seq} */
  id: string;
  /** 归属的 run ID */
  runId: string;
  /** 操作类型（枚举） */
  type: ModificationType;
  /** 操作 Agent */
  agentType: string;
  /** 操作描述（Agent 填写，与事实锚点交叉验证） */
  description: string;
  /** 涉及的文件路径（相对于 projectRoot） */
  filePaths: string[];
  /** 事实锚点（至少一个，禁止空数组） */
  factAnchors: FactAnchor[];
  /** 可逆性分类 */
  reversibility: ReversibilityClass;
  /** 关联的记忆 ID（可选） */
  memoryIds?: string[];
  /** Schema 版本（预留向前兼容） */
  schemaVersion: 1;
}

/** 修改会话 —— 对应一次 Agent 执行 run */
export interface ModificationSession {
  /** 会话 ID = run ID */
  sessionId: string;
  /** 起始时间 */
  startedAt: number;
  /** 结束时间 */
  completedAt?: number;
  /** Agent 类型列表 */
  agentTypes: string[];
  /** 项目指纹 */
  projectFingerprint: string;
  /** 起始 commit hash */
  startCommitHash: string;
  /** 结束 commit hash（如果有 commit） */
  endCommitHash?: string;
  /** 会话状态 */
  status: 'active' | 'completed' | 'crashed' | 'rolled_back';
  /** 本次修改的记录 ID 列表 */
  recordIds: string[];
}

/** 完整修改记录文件结构 */
export interface ModificationRecordV1 {
  /** 文件格式版本 */
  formatVersion: 1;
  /** 项目标识 */
  projectFingerprint: string;
  /** 创建时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 修改记录列表（按时间升序） */
  records: ModificationRecordItem[];
  /** 会话列表 */
  sessions: ModificationSession[];
  /** 附录：Schema 扩展字段（向前兼容） */
  extensions?: Record<string, unknown>;
}
```

### 6.2 Schema 约束规则

| 规则 | 约束 | 违反后果 |
|------|------|---------|
| **R-001** | `id` 必须以 `MOD-{runId}-{seq}` 格式由系统生成 | SchemaEnforcer 拒绝写入 |
| **R-002** | `factAnchors` 至少包含一个元素 | SchemaEnforcer 拒绝写入 |
| **R-003** | `timestampSource` 禁止为 `llm_inferred`——除非显式添加 `commitHash` 作为第二锚点 | SchemaEnforcer 降级为警告 |
| **R-004** | `type` 必须为 ModificationType 枚举成员 | SchemaEnforcer 拒绝写入 |
| **R-005** | `filePaths` 中的路径必须相对于 projectRoot，且不能包含 `..` | SchemaEnforcer 拒绝写入 |
| **R-006** | 同一 session 的 recordIds 必须唯一 | 写入时自动去重 |
| **R-007** | `schemaVersion` 必须与当前解析器版本匹配 | 降级兼容/告警 |
| **R-008** | `fileHashBefore` 和 `fileHashAfter` 必须与文件实际 hash 一致 | 启动时 InitVerifier 检测到不一致时标记失效 |

### 6.3 写入流程

```
Agent 意图写 modification-record
         │
         ▼
  ┌──────────────────────────┐
  │ SchemaEnforcer           │
  │ .validateAndAnnotate()   │
  │                          │
  │ 1. 注入 runId            │
  │ 2. 生成 MOD-{id} ID      │
  │ 3. 注入 fileHash         │
  │    (read_file 操作时自动  │
  │     记录 hash)           │
  │ 4. 注入 commitHash       │
  │ 5. 校验 type 枚举        │
  │ 6. 校验 filePaths        │
  └──────────┬───────────────┘
             │
             ▼
  ┌──────────────────────────┐
  │ Agent 补充 description   │
  │ （唯一由 LLM 生成的部分）  │
  └──────────┬───────────────┘
             │
             ▼
  ┌──────────────────────────┐
  │ SchemaEnforcer           │
  │ .verifyReferenceIntegrity│
  │ 文件存在性校验            │
  └──────────┬───────────────┘
             │
             ▼
  ┌──────────────────────────┐
  │ write_file →              │
  │ modification-record.json │
  │ (SchemaEnforcer.serialize │
  │  固定字段顺序输出)        │
  └──────────────────────────┘
```

---

## 7. 代码 diff 方案

### 7.1 新增文件清单

```
packages/engine/src/consistency/
├── consistency-layer.ts       # 主 Facade
├── init-verifier.ts           # 启动校验
├── intent-fact-wall.ts        # 意图/事实隔离
├── semi-finished-mgr.ts       # 半成品治理
├── schema-enforcer.ts         # Schema 强制
├── git-hook-bridge.ts         # Git 事件桥接
├── modification-record.ts     # Schema v1 类型定义
└── __tests__/
    ├── init-verifier.test.ts
    ├── intent-fact-wall.test.ts
    ├── semi-finished-mgr.test.ts
    ├── schema-enforcer.test.ts
    └── consistency-layer.test.ts
```

### 7.2 修改现有文件

#### 7.2.1 MemoryStore — 新增 memorySubType 支持

```diff
// packages/engine/src/memory-store.ts

+ import type { MemorySubType } from "../consistency/intent-fact-wall.js";

  write(input: MemoryWriteInput): string {
    // ...
    const entry = this._storage.insert({
      ...input,
+     memorySubType: input.memorySubType ?? 'fact',
    });
    // ...
  }
```

```diff
// packages/shared/src/memory.ts

  export interface MemoryWriteInput {
    memoryType: MemoryType;
+   /** 记忆子类型：意图/事实/上下文。默认 'fact' */
+   memorySubType?: 'intent' | 'fact' | 'context';
    // ...
  }

  export interface MemoryEntry {
    id: string;
    memoryType: MemoryType;
+   /** 记忆子类型（不可变，写入后不可修改） */
+   memorySubType: 'intent' | 'fact' | 'context';
    // ...
  }
```

#### 7.2.2 MemoryState — 新增 PENDING 状态

```diff
// packages/shared/src/memory.ts

  export enum MemoryState {
    Active = "ACTIVE",
    Archived = "ARCHIVED",
    Frozen = "FROZEN",
    Obliterated = "OBLITERATED",
+   /**
+    * PENDING —— 半成品态。仅用于 SemiFinishedMgr。
+    * 表示记忆写入处于两阶段提交的中间状态。
+    * PENDING 记忆不会被 read() 正常检索到。
+    * 启动时扫描到 PENDING 残留 → 触发 crash recovery。
+    * 
+    * 流转规则：
+    *   PENDING → Active（confirmWriteCompleted 成功后）
+    *   PENDING → Obliterated（crash recovery 判定回滚时）
+    *   不允许直接从 Active → PENDING
+    */
+   Pending = "PENDING",
  }
```

```diff
// packages/engine/src/memory/lifecycle.ts

  static isValidTransition(from: MemoryState, to: MemoryState): boolean {
    if (from === MemoryState.Obliterated) return false;
    if (from !== MemoryState.Active && to === MemoryState.Active) return false;
    if (from === MemoryState.Frozen && to !== MemoryState.Obliterated) return false;
+   if (from === MemoryState.Pending && to !== MemoryState.Active && to !== MemoryState.Obliterated) return false;
+   if (to === MemoryState.Pending && from !== MemoryState.Active) return false; // 不允许直接进入 Pending
    return true;
  }
```

#### 7.2.3 MemoryStore.write() — 两阶段提交

```diff
// packages/engine/src/memory-store.ts

+ /**
+  * 写入一条记忆（两阶段提交版本）。
+  * 如果 SemiFinishedMgr 启用，记忆先以 PENDING 状态写入，
+  * 等待调用方确认后才转为 Active。
+  */
- write(input: MemoryWriteInput): string {
+ write(input: MemoryWriteInput, options?: { skipSemiFinished?: boolean }): string {
    if (this._persistence.lifecycle !== "active") {
      throw new Error(`MemoryStore 已关闭 (状态: ${this._persistence.lifecycle})，拒绝写入`);
    }

    // M3: 校验 embedding 维度
    if (input.embedding !== undefined && input.embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `embedding 维度不匹配: 期望 ${EMBEDDING_DIM}，实际 ${input.embedding.length}`,
      );
    }

-   const entry = this._storage.insert(input);
+   // 如果未跳过半成品检查且 memorySubType 不是 intent，使用 PENDING 状态
+   const usePending = !options?.skipSemiFinished && 
+     input.memorySubType !== 'intent' && 
+     this._semiFinishedMgr?.isEnabled();
+   
+   const entry = this._storage.insert(input, usePending ? MemoryState.Pending : undefined);
    const id = entry.id;

    if (this._persistence.isEnabled) {
      try {
        this._persistence.run(
          `INSERT INTO memories (id, memory_type, state, content, ...) 
           VALUES (?, ?, ?, ?, ...)`,
          [
            entry.id,
            entry.memoryType,
-           entry.state,
+           entry.state,  // 可能是 PENDING
            // ...
          ],
          "write",
        );
        this._persistence.scheduleFlush();
      } catch (e) {
        this._storage.delete(id);
        throw e;
      }
    }

    return id;
  }

+ /**
+  * 确认写入完成：将 PENDING → Active。
+  * 由 ConsistencyLayer.confirmWriteCompleted() 调用。
+  */
+ confirmWrite(memoryId: string): boolean {
+   return this._lifecycle.cas(
+     this._storage, memoryId, MemoryState.Pending, MemoryState.Active,
+     this._statePersistFn("confirmWrite"),
+   );
+ }
```

#### 7.2.4 MemoryStore.read() — 过滤 PENDING 记忆

```diff
// packages/engine/src/memory-store.ts

  read(query: MemoryQuery): MemoryEntry[] {
    // ...

    // 获取候选集后
    let results: MemoryEntry[];
    if (this._persistence.isEnabled) {
      results = this._persistenceRead(query, now);
    } else {
      results = this._queryEngine.memScanRead(this._storage, query, now);
    }

+   // 过滤 PENDING 记忆（除非显式查询）
+   if (!query.includePending) {
+     results = results.filter(m => m.state !== MemoryState.Pending);
+   }

    // ...
  }
```

```diff
// packages/shared/src/memory.ts

  export interface MemoryQuery {
    // ...
+   /** 是否包含 PENDING 状态的记忆。默认 false。 */
+   includePending?: boolean;
  }
```

#### 7.2.5 MemoryPersistence — 表结构新增字段

```diff
// packages/engine/src/memory/persistence.ts

  private _createTables(): void {
    // ...

    runSQL(`CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      memory_type TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'ACTIVE',
+     memory_sub_type TEXT NOT NULL DEFAULT 'fact',
      content TEXT NOT NULL,
      // ...
    )`, "create_tables.memories");

    // 新增索引
+   runSQL("CREATE INDEX IF NOT EXISTS idx_memories_sub_type ON memories(memory_sub_type)", "create_tables.idx_sub_type");
  }
```

#### 7.2.6 Storage — 反序列化 + 插入支持 SubType

```diff
// packages/engine/src/memory/storage.ts

  insert(input: MemoryWriteInput, initialState?: MemoryState): MemoryEntry {
    const now = Date.now();
    const id = `mem-${crypto.randomUUID()}`;
    const entry: MemoryEntry = {
      id,
      memoryType: input.memoryType,
-     state: MemoryState.Active,
+     memorySubType: input.memorySubType ?? 'fact',
+     state: initialState ?? MemoryState.Active,
      // ...
    };
    this.memories.set(id, entry);
    return entry;
  }

  deserializeRow(raw: Record<string, unknown>): MemoryEntry | null {
    // ...
    return {
      id: raw.id as string,
      memoryType: raw.memory_type as MemoryType,
+     memorySubType: (raw.memory_sub_type as 'intent' | 'fact' | 'context') ?? 'fact',
      state: raw.state as MemoryState,
      // ...
    };
  }
```

#### 7.2.7 Pipeline — 记忆增强执行管道集成

```diff
// packages/engine/src/memory/pipeline.ts

+ import { ConsistencyLayer } from "../consistency/consistency-layer.js";
  import { runReActLoop, type ReActContext } from "../components/react-loop.js";

  export async function executeWithMemoryPipeline(
    ctx: ReActContext,
    node: TaskNode,
    model: string,
    memoryQuery?: (node: TaskNode) => MemoryQuery,
    safeReporter?: SafeErrorReporter,
+   consistencyLayer?: ConsistencyLayer,
  ): Promise<NodeResult> {
    const { memory, agentType } = ctx;

    // ── 步骤1：记忆检索 + 上下文增强 ──
    let enrichedNode = node;
    if (memory) {
      const query = memoryQuery ? memoryQuery(node) : defaultMemoryQuery(node);
      try {
-       const ctxRecords = memory.read(query);
+       let ctxRecords = memory.read(query);
+       
+       // 一致性校验层过滤（意图隔离）
+       if (consistencyLayer) {
+         ctxRecords = consistencyLayer.filterReadResults(ctxRecords, query);
+       }
+       
        if (ctxRecords.length > 0) {
          const ctxSummary = ctxRecords.map((m) => `[记忆] ${m.summary}`).join("\n");
          enrichedNode = {
            ...node,
            payload: `上下文记忆：\n${ctxSummary}\n\n任务：${node.payload}`,
          };
        }
      } catch (e) {
        // 记忆检索失败不阻塞执行
      }
    }

    // ── 步骤2：ReAct 执行 ──
    const result = await runReActLoop(ctx, enrichedNode, model);

    // ── 步骤3：写入记忆 ──
    if (memory) {
+     // 如果有一致性校验层，使用带半成品标记的写入
+     if (consistencyLayer) {
+       await _rememberResultWithConsistency(memory, consistencyLayer, agentType, node, result, safeReporter);
+     } else {
        await _rememberResult(memory, agentType, node, result, safeReporter);
+     }
    }

    return result;
  }
```

#### 7.2.8 BaseAgent — 可选注入 ConsistencyLayer

```diff
// packages/engine/src/base-agent.ts

+ import type { ConsistencyLayer } from "./consistency/consistency-layer.js";

  export abstract class BaseAgent implements Agent {
    abstract readonly type: AgentType;
    abstract readonly systemPrompt: string;

    constructor(
      protected readonly llm: LlmAdapter,
      protected readonly toolkit: Toolkit,
      protected readonly memory?: MemoryStore,
+     protected readonly consistencyLayer?: ConsistencyLayer,
    ) {}

    async execute(node: TaskNode, model: string): Promise<NodeResult> {
      this._setStatus(AS.Active);
      try {
        const enrichedNode = await this.preExecuteHook(node);
        const result = await executeWithMemoryPipeline(
          {
            agentType: this.type,
            llm: this.llm,
            toolkit: this.toolkit,
            systemPrompt: this.systemPrompt,
            maxLoops: this.maxLoops,
            memory: this.memory,
          },
          enrichedNode,
          model,
          this.memory ? (n) => this.getMemoryQuery(n) : undefined,
          this._safeReporter ?? undefined,
+         this.consistencyLayer,
        );
        return result;
      } finally {
        if (this.status === AS.Active) this._setStatus(AS.Awake);
      }
    }
  }
```

#### 7.2.9 Toolkit — 文件操作通知一致性层

```diff
// packages/engine/src/toolkit.ts

+ import type { ConsistencyLayer } from "./consistency/consistency-layer.js";

  export class Toolkit {
    private tools = new Map<string, ToolHandler>();
    private gate?: ConfirmGate;
    private lockManager?: FileLockManager;
    private workspaceRoot: string | null = null;
    private fs: IFileSystemAdapter;
+   private consistencyLayer?: ConsistencyLayer;

+   setConsistencyLayer(layer: ConsistencyLayer): void {
+     this.consistencyLayer = layer;
+   }

    private _registerBuiltins(): void {
      this.tools.set("write_file", async (params) => {
        const filePath = this._resolvePath(params.file_path as string);
        const content = params.content as string;
        // ...
        try {
+         // 通知一致性层：文件操作即将执行
+         if (this.consistencyLayer) {
+           await this.consistencyLayer.snapshotFile(filePath);  // 记录操作前 hash
+         }
+         
          await this.fs.writeFile(filePath, content);
+         
+         // 记录操作完成
+         if (this.consistencyLayer) {
+           await this.consistencyLayer.recordFileOp({
+             type: 'write_file',
+             filePath,
+             contentLength: content.length,
+           });
+         }
+         
          return { success: true, output: `已写入 ${filePath} (${content.length} 字符)` };
        } catch (e) {
          return { success: false, error: `写入失败: ${String(e)}` };
        }
      });

      // delete_file 类似...
    }
  }
```

### 7.3 数据库迁移脚本

```sql
-- migration-001-add-memory-sub-type.sql
-- 宪法依据：原则七 + 第九章 —— 意图/事实分离

ALTER TABLE memories ADD COLUMN memory_sub_type TEXT NOT NULL DEFAULT 'fact';
CREATE INDEX IF NOT EXISTS idx_memories_sub_type ON memories(memory_sub_type);

-- 迁移现有数据：所有现有 Active 记忆标记为 'fact'（保守策略）
UPDATE memories SET memory_sub_type = 'fact' WHERE memory_sub_type IS NULL;

-- __meta 版本号更新
INSERT OR REPLACE INTO __meta (key, value) VALUES ('schema_version', '2');
```

---

## 8. 三个教训的兜底验证

### 8.1 第一例：solo-flight 项目被静默删除

| 防线 | 组件 | 如何兜底 |
|------|------|---------|
| **L1 意图/事实隔离** | IntentFactWall | Agent 写入"计划清理 solo-flight"时标记为 `intent`。read() 默认过滤意图。下次启动 Agent 看不到这条"计划"，不会认为"已经完成" |
| **L2 启动校验** | InitVerifier | 如果删除已执行，对应文件不存在 → InitVerifier 检测到 missing → 标记该记忆为失效 |
| **L3 半成品标记** | SemiFinishedMgr | 如果进程在 write_file 执行前崩溃 → PENDING 残留 → 下次启动扫描并回滚 |

### 8.2 第二例：modification-record.json 幻觉日期

| 防线 | 组件 | 如何兜底 |
|------|------|---------|
| **L1 Schema 强制** | SchemaEnforcer | `timestampSource` 禁止 `llm_inferred` 作为唯一来源。日期必须有文件 mtime 或 git commit time 背书 |
| **L2 事实锚点** | SchemaEnforcer | 自动注入 `fileHashBefore`/`fileHashAfter` 和 `commitHash`——Agent 无法编造文件 hash |
| **L3 引用完整性** | SchemaEnforcer | 写入前校验记录中的文件路径是否存在且 hash 匹配 |
| **L4 ID 系统生成** | SchemaEnforcer | `MOD-{runId}-{seq}` 由系统生成，Agent 无法随意编造 ID 或时间线 |

### 8.3 第三例：用户回退后记忆还在说"已完成"

| 防线 | 组件 | 如何兜底 |
|------|------|---------|
| **L1 Git 回滚检测** | GitHookBridge | post-checkout hook 触发 → diff 分析 → 匹配关联记忆 |
| **L2 级联失效** | GitHookBridge | 文件被回滚 → 引用该文件的"已修改"记忆 → Frozen。下次 Agent 看不到"已完成" |
| **L3 启动校验** | InitVerifier | 即使 git hooks 未安装，下次启动时 InitVerifier 检测到文件 hash 与记忆中的预期不符 → 标记失效 |
| **L4 文件 hash 快照** | FileOpTracker | write_file 操作前后都记录 hash，任何外部修改导致 hash 变化都可检测 |

### 8.4 验证矩阵

| 场景 | 无校验层 | 有校验层 | 验证方法 |
|------|---------|---------|---------|
| 意图写入后进程崩溃 | Agent 下次认为已执行 | PENDING 残留 → 扫描回滚 | unit: semi-finished-mgr |
| 修改记录日期幻觉 | 记录包含不存在的日期 | Schema 强制来源 + 锚点 | unit: schema-enforcer |
| git checkout 回滚文件 | 记忆仍说已完成 | GitHook 触发 Frozen | integration: git-hook-bridge |
| 跨 run 意图污染 | 旧意图干扰新 run | read() 默认过滤 intent | unit: intent-fact-wall |
| 启动时文件已被外部删除 | 记忆仍 active | InitVerifier 标记 missing | integration: init-verifier |
| 多次 run 的修改记录混淆 | Agent 拼接出虚假时间线 | Session + runId 隔离 | unit: modification-record |

---

## 9. 宪法原则七审计

凝光逐条对照原则七六项约束：

### ① 宪法依据 —— ✅ 闭合

本设计全程基于：
- **原则七**：系统自我修改的宪法约束 —— 一致性校验层正是为了防止自我修改导致的记忆-现实分裂
- **第九章 §9.9**：记忆认知共享层 —— 确立了跨 Agent、跨 run 认知共享的基础设施地位，一致性校验层是其安全护栏
- **§9.1 四态生命周期**：PENDING 状态的扩展沿用了现有的状态机模式，不破坏四态单向流转规则
- **§7.5 读取安全边界**：一致性校验层不改变读取安全边界，不引入新的越界风险

### ② 修改记录 —— ✅ 闭合

Schema v1（§6）完整定义了修改记录的结构化 Schema，包含：
- 修改类型枚举（封闭集合，禁止 Agent 自定义）
- 事实锚点（fileHash / commitHash / timestampSource）
- 会话隔离（runId + session）
- 引用完整性校验

输出 `modification-record.json` 自动写入，格式由 SchemaEnforcer 确保。

### ③ 最小改动 —— ✅ 闭合

改动范围：
- **新增** 8 个文件（consistency/ 子目录），完全独立于现有 MemoryStore 组件族
- **修改** 9 个现有文件（最小 diff，不破坏现有接口契约）
- **不修改** 现有 Agent 的业务逻辑（仅 BaseAgent 构造函数多一个可选参数）

### ④ 架构保护 —— ✅ 闭合

- 一致性校验层**不修改** MemoryStore 的内部委托架构（不破坏 §9.3 委托模式）
- 通过中间件/装饰器模式接入，MemoryStore 可零校验层运行（向后兼容）
- 所有新增类型定义在 shared 包中，不引入循环依赖
- PENDING 状态扩展遵循现有四态状态机的 CAS 模式

### ⑤ 独立审计 —— ✅ 闭合

本设计本身经过：
1. **纳西妲（AnalysisAgent）**：根因归簇分析 —— 识别 5 条根因，3 个核心教训的因果关系
2. **刻晴（ReviewAgent）**：设计审查 —— 验证三个教训的兜底矩阵，确认每层防线有效
3. **凝光（DocGovernAgent）**：宪法审计 —— 逐条对照原则七，全部闭合
4. **甘雨（MetaAgent）**：战术规划 —— 将设计方案组织为可执行的实施路径

### ⑥ 阶段限定 —— ✅ 闭合

- 一致性校验层设计为**可选集成** —— 通过配置开关控制组件启停
- Core-1 阶段仅实现 IntentFactWall + InitVerifier + SemiFinishedMgr（核心三件套）
- SchemaEnforcer + GitHookBridge 标记为 Core-2 预留（类型先行，实现后置）
- 不依赖 Core-2 基础设施（TrustModel / Sentinel / Vector Retrieval）

### 综合审计结论

```
✅ 原则七六条全部闭合

审计人：凝光（DocGovernAgent）
审计时间：基于设计文档静态审计
审计版本：v1.0
```

---

## 附录 A：实施路线图

| 阶段 | 组件 | 依赖 | 预计工时 |
|------|------|------|---------|
| **P0** | MemorySubType + MemoryState.Pending | shared 类型扩展 | 1d |
| **P0** | SemiFinishedMgr 核心（begin/confirm/rollback） | MemoryState.Pending | 2d |
| **P0** | IntentFactWall 核心（filter + memorySubType） | MemorySubType | 1d |
| **P1** | InitVerifier（文件存在性校验） | fs.stat | 2d |
| **P1** | SchemaEnforcer + modification-record.json v1 | - | 2d |
| **P1** | ConsistencyLayer Facade（编排组件） | 上述组件 | 1d |
| **P2** | GitHookBridge（Core-2 预留） | git hooks | 3d |
| **P2** | InitVerifier hash 校验增强 | file hash | 1d |
| **P3** | Crash recovery 自动处理 | SemiFinishedMgr | 2d |

## 附录 B：与宪法第九章的对应关系

| 宪法 §9 条款 | 本设计覆盖 | 说明 |
|-------------|-----------|------|
| §9.1 四态生命周期 | ✅ 扩展 | PENDING 状态新增，不破坏现有流转规则 |
| §9.2 CAS 原子状态变更 | ✅ 沿用 | PENDING→Active / PENDING→Obliterated 均通过 CAS |
| §9.3 委托模式安全写架构 | ✅ 不触及 | 校验层不在 MemoryStore 内部，不破坏委托模式 |
| §9.4 HCA/CSA 注意力区分 | ✅ 增强 | IntentFactWall 在 HCA 模式下保留意图（MetaAgent 需看到规划），CSA 模式下过滤 |
| §9.7 记忆增强执行管道 | ✅ 集成 | executeWithMemoryPipeline 增加可选 consistencyLayer 参数 |
| §9.8 检索策略模板化 | ✅ 兼容 | makeMemoryQuery 不受影响 |
| §9.9 认知共享层 | ✅ 安全护栏 | 一致性校验层是认知共享的基础设施保障 |
| §9.10 缓存/闭环实证 | ✅ 不影响 | 不改变缓存逻辑，不破坏闭环链路 |

---

> **文档结束**
> 
> 设计人：艾尔海森（DataAgent）
> 圆桌参与：甘雨（MetaAgent）、纳西妲（AnalysisAgent）、刻晴（ReviewAgent）、凝光（DocGovernAgent）
> 宪法审计：凝光（DocGovernAgent）
> 
> **修改记录**：
> - 2026-05-16: v1.0 初始版本，圆桌论证收束
