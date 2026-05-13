# Cortex 代码模式与架构技巧报告

> 水镜观测时间：2026-05-12
> 观测者：莫娜·梅姬斯图斯，星天水占术士
> 范围：packages/engine + packages/shared + packages/llm
> 状态：已完成一次全库扫描，Pattern 已落笔

---

## 目录

1. [模式一：类型中枢 (Type Hub)](#模式一类型中枢-type-hub)
2. [模式二：组合工厂 vs 继承基类 (Composition Factory)](#模式二组合工厂-vs-继承基类-composition-factory)
3. [模式三：状态所有权归一 (Pool-Aware State)](#模式三状态所有权归一-pool-aware-state)
4. [模式四：记忆管道三步曲 (Memory Pipeline)](#模式四记忆管道三步曲-memory-pipeline)
5. [模式五：模板方法 + 记忆检索策略 (Template Method)](#模式五模板方法--记忆检索策略-template-method)
6. [模式六：技能提取-注册闭环 (Skill Extract-Register)](#模式六技能提取-注册闭环-skill-extract-register)
7. [模式七：类型化事件管道 (Typed Event Bus)](#模式七类型化事件管道-typed-event-bus)
8. [模式八：契约化模块边界 (Contract Boundary)](#模式八契约化模块边界-contract-boundary)
9. [模式九：Facade 委派分解 (Facade Delegation)](#模式九facade-委派分解-facade-delegation)
10. [模式十：拓扑调度 + 动态消费 (Topo Scheduler)](#模式十拓扑调度--动态消费-topo-scheduler)
11. [模式十一：多视角并行聚合 (Multi-Perspective Dispatch)](#模式十一多视角并行聚合-multi-perspective-dispatch)
12. [模式十二：重规划链递归解析 (Replan Chain)](#模式十二重规划链递归解析-replan-chain)
13. [模式十三：错误静默升级与双通道上报 (Silent Upgrade)](#模式十三错误静默升级与双通道上报-silent-upgrade)
14. [模式十四：L0-L3 可逆性等级保护 (Reversibility Gate)](#模式十四l0-l3-可逆性等级保护-reversibility-gate)
15. [模式十五：Agent 人格化提示词 (Character Prompt)](#模式十五agent-人格化提示词-character-prompt)

---

## 模式一：类型中枢 (Type Hub)

**文件**：`packages/shared/src/agent.ts`（单文件 360+ 行）

**现象**：18/22 的文件 import 自 `@cortex/shared` 的 `agent.ts`。枚举、常量、接口全数收束于此。

**模式描述**：

```
┌─ 类型中枢 ──────────────────────────────┐
│  AgentType 枚举（~14 种）                │
│  AgentStatus 枚举（5 态状态机）          │
│  TAG_VOCABULARY 封闭集合（~50 标签）     │
│  AGENT_TAGS 标签归属表                   │
│  AGENT_TOOL_PERMISSIONS 工具权限表        │
│  SkillTemplate 接口                      │
│  MemoryAware / Executable 协议接口        │
│  AgentConstructor 类型                   │
└──────────────────────────────────────────┘
```

**架构技巧**：
- 用枚举替代 string literal union，纯编译期约束，零运行时开销
- `TAG_VOCABULARY as const` + `type Tag = (typeof TAG_VOCABULARY)[number]` 枚举转类型的惯用法
- `AGENT_TAGS: Record<AgentType, readonly Tag[]>` 双向索引表设计
- 注释中显式声明依赖数和"为什么不拆分"的理由（高依赖数是类型中枢的正常特征）

**适用场景**：任何有 N 个模块共享同一套类型定义的工程。不要拆分——除非类型数量 > 30 需要按领域拆。

---

## 模式二：组合工厂 vs 继承基类 (Composition Factory)

**文件**：`packages/engine/src/components/agent-factory.ts`

**现象**：每个 Agent 都同时保有 `class XxxAgent extends BaseAgent` 和 `export function xxxAgentConfig(): AgentFactoryConfig` 两套路径。推荐路径是工厂函数 `createAgent(config)`。

**模式描述**：

```
// 继承路径（向后兼容）
class XxxAgent extends BaseAgent { ... }

// 组合路径（推荐）
export function xxxAgentConfig(): AgentFactoryConfig {
  return {
    type: AT.Xxx,
    systemPrompt: "...",
    memoryEnabled: true,
    getMemoryQuery: xxxMemoryQuery,
  };
}
// 在 bootstrap 中：const agent = createAgent(config, llm, toolkit, memory);
```

**架构技巧**：
- `AgentFactoryConfig` 是纯数据，不依赖 `this` 隐式耦合
- 每个字段显式声明，无隐含行为
- `preExecuteHook` 作为扩展点注入——InspectorAgent 的 tsc 编译事实采集就是通过这个钩子注入的
- 工厂内部闭包持有状态（`state`, `safeReporter`），零类继承开销

**适用场景**：当 Agent 数量膨胀到 10+，且每个 Agent 的行为差异可以用数据配置而非多态覆写表达时，从继承迁移到组合。

---

## 模式三：状态所有权归一 (Pool-Aware State)

**文件**：`packages/engine/src/pool-aware.ts`

**现象**：治理判例 `NG-2026-0511-CopyPaste-StateMachine` 发现 BaseAgent / ButlerAgent / StrategistAgent 重复了相同的 15+ 行状态管理代码。提取为 `PoolAwareState` 共享组件。

**模式描述**：

```
PoolAwareState
  ├── status getter      → Pool 有则委托，否则降级到 _localStatus
  ├── transition()       → 有 Pool 走 Pool.setStatus()，否则本地校验
  ├── setPool()          → 绑定 AgentPool 引用
  └── setSafeReporter()  → 错误上报

状态流转表（5 态）：
  Created → Awake → Active → Awake → ... → Draining → Destroyed
```

**架构技巧**：
- `() => this.type` 延迟求值模式——解决 abstract property 在基类构造器中未就绪的问题
- 流转合法性校验引用 `AgentPool.VALID_TRANSITIONS` 权威源，消除双轨校验
- 无 Pool 降级路径仍校验流转合法性，拒绝非法流转
- 违反流转通过 `SafeErrorReporter` 上报，不静默吞错

---

## 模式四：记忆管道三步曲 (Memory Pipeline)

**文件**：`packages/engine/src/memory/pipeline.ts`

**现象**：所有 Agent 执行都经过 `executeWithMemoryPipeline(ctx, node, model, memoryQuery, safeReporter)`。

**模式描述**：

```
步骤1：记忆检索 + 上下文增强
  memory.read(query) → 将历史记忆注入 payload 前方
  │
步骤2：ReAct 执行
  runReActLoop(ctx, enrichedNode, model) → NodeResult
  │
步骤3：记忆写入（成功/失败都写）
  _rememberResult(memory, agentType, node, result)
    ├── 主记忆：Episodic，weight=5(成功)/3(失败)
    ├── 上下文记忆：Episodic，weight=1
    └── 关联链接：ProducedBy → 上下文记忆
        修复节点额外链接父节点记忆
```

**架构技巧**：
- 三步管道设计——检索失败不阻塞执行（降级为无记忆执行）
- 失败记忆写入权重低于成功但**仍然写入**——失败经验价值最高
- 时间衰减机制：`weight * max(0.1, 1 - ageDays/30)`——30 天降至 10% 地板
- HCA vs CSA 双模式读取：HCA（广度浅读，不追踪访问）用于 MetaAgent 规划扫描，CSA（深度窄读，追踪访问）用于 Agent 执行

---

## 模式五：模板方法 + 记忆检索策略 (Template Method)

**文件**：`packages/engine/src/base-agent.ts` + 各 Agent 实现

**现象**：每个 Agent 覆写 `getMemoryQuery(node: TaskNode): MemoryQuery` 定义"回家路径"。

**模式描述**：

```typescript
// BaseAgent 定义模板
protected getMemoryQuery(node: TaskNode): MemoryQuery {
  // 默认 CJK bigram 分词
  // 子类覆写差异化搜索偏好
}

// CodeAgent：优先 ProducedBy + RefactoredFrom（工地日记）
export function codeMemoryQuery(node): MemoryQuery {
  return makeMemoryQuery(node, {
    memoryTypes: [MemoryType.Episodic, MemoryType.Conceptual],
    linkTypes: [LinkType.ProducedBy, LinkType.RefactoredFrom],
    bfsDepth: 2, limit: 3,
  });
}

// ReviewAgent：优先 CitedInCommittee（审查档案）
export function reviewMemoryQuery(node): MemoryQuery {
  return makeMemoryQuery(node, {
    linkTypes: [LinkType.CitedInCommittee, LinkType.RefactoredFrom],
    bfsDepth: 2, limit: 5,
  });
}

// DocGovernAgent：含 Archived 态（审计追溯）
export function docGovernMemoryQuery(node): MemoryQuery {
  return makeMemoryQuery(node, {
    states: [MemoryState.Active, MemoryState.Archived],
    bfsDepth: 3, limit: 8,
  });
}

// LoopAgent：广度最深（BFS 3，limit 10）
export function loopMemoryQuery(node): MemoryQuery {
  return makeMemoryQuery(node, {
    memoryTypes: [MemoryType.Episodic, MemoryType.Conceptual, MemoryType.Knowledge],
    bfsDepth: 3, limit: 10,
  });
}
```

**架构技巧**：
- `makeMemoryQuery()` 统一工厂函数——11 个 Agent 的检索策略全部收敛于此
- 关键词提取统一：CJK 2-gram + 拉丁长度 > 3 词 + 粗粒度去重
- 每个 Agent 只需声明差异化参数（memoryTypes / linkTypes / bfsDepth / limit）
- `preExecuteHook` 是第二模板方法入口——InspectorAgent 用它在执行前自动采集 tsc 编译结果

---

## 模式六：技能提取-注册闭环 (Skill Extract-Register)

**文件**：`packages/engine/src/components/skill-extractor.ts` + `packages/shared/src/skill-registry.ts`

**现象**：LoopAgent 完成后，Scheduler 自动提取输出中的 `SkillTemplate` JSON，注册到 `SkillRegistry`。MetaAgent 下次规划时查询匹配的技能。

**模式描述**：

```
LoopAgent.execute()
  → 输出含 SkillTemplate JSON
  → scheduler._dispatchSingle() 检测 agentType === Loop
  → _extractAndRegisterSkills(nodeId, output)
    → extractSkillsFromOutput(output)
      → 1. 提取 JSON（```json 围栏 / 平衡括号回退）
      → 2. 解析 JSON（支持单对象/数组）
      → 3. 规范化（字段完整性验证 + 安全默认值填充）
      → 4. status 降级：LLM 输出的 "active" → 强制 "trial"
    → skillRegistry.register(skill)
  → MetaAgent.plan() 时查询 matched skills 注入 prompt
```

**架构技巧**：
- 双层 JSON 解析容错：先 ```json 围栏，再平衡括号提取
- 状态安全约束：LLM 输出不能直接声明为 `active`，强制降至 `trial` 需人工审核
- 标签白名单：不在 `TAG_VOCABULARY` 中的标签自动过滤
- 提取失败不阻塞调度——通过 observer 上报诊断信息
- SkillRegistry 支持 `toJSON()` / `fromJSON()` 持久化，可与 MemoryStore 互通

---

## 模式七：类型化事件管道 (Typed Event Bus)

**文件**：`packages/engine/src/pipeline-observer.ts` + `packages/shared/src/infra.ts`

**现象**：所有可观测事件走 `PipelineObserver`，事件类型用枚举封闭，payload 按类型锁定额外字段。

**模式描述**：

```typescript
// 事件类型枚举——封闭集合，编译期约束
enum PipelineEventType { ... }  // 30+ 事件类型

// Payload 按事件类型锁定
type EventPayloadMap = {
  [PipelineEventType.NodeFailed]: { nodeId: string; error: string; agentType?: AgentType };
  [PipelineEventType.SchedulerDone]: { total: number; completed: number; failed: number; ... };
}

// 三级优先级
enum PipelinePriority { CRITICAL = 0, HIGH = 1, NORMAL = 2 }
```

**架构技巧**：
- 枚举替代裸 string——编译期约束事件名拼写，消除魔法字符串
- `requestId` 幂等键：每次 emit 自动生成，下游可区分"未上报"与"上报失败"
- 多级观察者订阅约定：Sentinel → CRITICAL+HIGH, MemoryStore → ALL, 管家 → HIGH+NORMAL
- 单 handler 异常不阻断后续 handler（隔离设计）
- `notificationType?: "FYI" | "WARNING" | "DECISION_REQUIRED"` 三级通知语义

---

## 模式八：契约化模块边界 (Contract Boundary)

**现象**：每个关键模块顶部都有 `@contract` 文档注释，明确声明前置条件、后置条件、异常语义、数据流。

**模式描述**（以 MemoryStore 为例）：

```
@contract 模块边界契约（久岐忍 P1-5）

@depends  memory/persistence.ts（SQLite 持久化，WAL 模式，write-through）
@depends  memory/storage.ts（Map 内存存储 + 反序列化）
@depends  memory/lifecycle.ts（四态状态机 CAS）
@depends  memory/query.ts（内存扫描 + BFS 图遍历 + 向量召回）

@dataflow write(input) → MemoryStorage.insert → MemoryPersistence.run (write-through)
           → scheduleFlush (防抖) → flush (WAL checkpoint)

异常语义：
  - write()：DB 失败回滚内存 delete(id)，抛出异常（非静默吞错）
  - read()：SQL 查询失败自动退化至内存扫描
  - cas()：持久化失败回滚 state
  - link()：DB 失败回滚内存 pop()
  - close()：仅 active 态执行，先 flush 再关闭
```

**架构技巧**：
- `@contract` + `@depends` + `@dataflow` 三段式文档结构
- 异常语义用自然语言逐条列举，不依赖类型系统
- 治理判例引用（如 `NG-2026-0509-Persist-False-Positive`）可追溯
- 非静默吞错原则：持久化失败必须传播为操作失败

---

## 模式九：Facade 委派分解 (Facade Delegation)

**文件**：`packages/engine/src/memory-store.ts`

**现象**：MemoryStore 是一个 Facade，将 4 个子系统的复杂度隐藏在统一的 API 之后。

**模式描述**：

```
MemoryStore (Facade)
  ├── write() / read() / link() / cas() / archive() / freeze() / obliterate()
  ├── init() / close() / flush()
  │
  ├── MemoryStorage     — Map 内存存储 + 反序列化
  ├── MemoryPersistence — SQLite WAL 持久化（write-through）
  ├── MemoryLifecycle   — 四态状态机 CAS + archive/freeze/obliterate
  └── MemoryQueryEngine — 内存扫描 + BFS 图遍历 + 向量召回
```

**架构技巧**：
- 每个委派组件的构造器参数只有 `observer?`——纯函数式，无副作用引用
- 持久化启用通过 `init(dbPath)` 选择性开启，不调 init() 则纯内存运行（测试兼容）
- 每个委派组件可独立测试，不依赖 MemoryStore 整体
- `_statePersistFn()` 工厂方法生成持久化回调——供 MemoryLifecycle 在状态变更时调用

---

## 模式十：拓扑调度 + 动态消费 (Topo Scheduler)

**文件**：`packages/engine/src/scheduler.ts`

**现象**：Scheduler 使用拓扑排序分层 + 动态消费循环调度任务树。

**模式描述**：

```
executeAll()
  while (true) {
    pendingNodes = board.getPendingNodes()
    if (pendingNodes.length === 0) {
      等待后台 replan 完成 → 检查新节点 → 无则 break
    }
    layers = topologicalSort(pendingNodes)
    for each layer {
      并行 dispatch 该层全部节点
    }
    fire replan 后台批次（不 await，下轮取结果）
  }
  → 收尾：重规划链解析 → ExecutionReport
```

**架构技巧**：
- 拓扑排序分层：BFS 按 parentId 依赖关系分层，每层无依赖并行执行
- 动态消费模式：只要有 pending/claimed 节点就继续调度
- 重规划队列后台发射：`replanFlight` 异步批次，不阻塞主循环
- 异常屏障：单轮异常不崩溃——标记当前 pending 为失败，保留已有结果
- `_isReplanChainSuccessful()` 递归追踪——后代节点成功则视原始节点成功

---

## 模式十一：多视角并行聚合 (Multi-Perspective Dispatch)

**文件**：`packages/engine/src/scheduler.ts` 中 `_dispatchMulti()`

**现象**：`needsMultiPerspective=true` 的节点被所有匹配 Agent 并行认领执行。

**模式描述**：

```
needsMultiPerspective: true
  → 找出所有标签匹配且有 runner 的 Agent 类型
  → 每个 Agent 独立 claim + spawn + execute + complete
  → 等齐：claimedBy 中全部 Agent 类型都有 results → 置 done
  → 聚合：每 Agent 输出以 [agentType] 前缀拼接
  → allSuccess: 全部成功才算成功
```

**架构技巧**：
- 等齐策略：用 `claimedBy Set` vs `results Map` 比较——只有实际认领的 Agent 才参与
- `release` 多视角语义：running 态允许释放单个 agentType（spawn 失败残留在 claimedBy 中不会死锁）
- invariant 校验：claimedBy 中每个条目最终要么在 results 中，要么已被 release
- spawn 失败时的 release 保证——防节点卡在 claimed 态

---

## 模式十二：重规划链递归解析 (Replan Chain)

**文件**：`packages/engine/src/scheduler.ts`

**现象**：失败节点 → MetaAgent 生成新节点 → 新节点再加入调度闭环，形成重规划链。

**模式描述**：

```
节点执行失败
  → 检查非 ReAct 超时（L1 哨兵：超限不触发重规划）
  → 入 replanQueue
  → 后台批次调用 MetaAgent.requestReplan()
  → 新节点入板（领而不执，不入 dispatch）
  → 旧节点回收（local: 只换当前节点 / subtree: 整个下游）
  → 下轮 executeAll 调度新节点
  → 终态时 _isReplanChainSuccessful() 递归解析
    → 任何后代节点成功 → 原始节点视为成功
```

**架构技巧**：
- 领而不执（Claim-Without-Dispatch）：新节点仅入板，由下一轮循环统一调度
- `replanMap` 追踪 `originalId → newIds`，支持多轮递归
- visited Set 防自环（ID 碰撞导致无限递归）
- 全局兜底 `MAX_TOTAL_REPLANS=3` 防无限重规划
- error 哨兵：内容含 "Exceeded max loops" 不触发重规划（参数问题不是计划问题）

---

## 模式十三：错误静默升级与双通道上报 (Silent Upgrade)

**文件**：`packages/engine/src/pipeline-observer.ts`

**现象**：`SafeErrorReporter` 支持三级严重级别（fatal / degraded / silent），silent 级别连续发生 3 次后自动升级为 degraded。

**模式描述**：

```
SafeErrorContext { source, error, severity, hint }

silent 级别：
  → 计数器 +1
  → 连续 N=3 次 → 升级 degraded → 发射 ErrorSilentUpgraded 事件
  → 非 silent 错误 → 重置计数器

双通道模式：
  通道1：PipelineObserver.emit() — 正式事件管道
  通道2：PipelineObserver.onInvariant() — 静态回调
```

**架构技巧**：
- 治理判例 `NG-2026-0509-Persist-False-Positive`：假阳性禁止原则
- silent 升级机制防止"有意忽略"退化为"习惯性忽略"
- dual-channel 设计：observer 管道 + static onInvariant 回调
- `createSafeReporter()` 工厂方法将 PipelineObserver 自身作为 SafeErrorReporter 的宿主

---

## 模式十四：L0-L3 可逆性等级保护 (Reversibility Gate)

**文件**：`packages/engine/src/toolkit.ts` + `packages/shared/src/agent.ts`

**现象**：每个工具标注可逆性等级（L0 只读 / L1 可逆 / L2 不可逆 / L3 危险），通过 ConfirmGate 拦截高风险操作。

**模式描述**：

```
工具权限表（AGENT_TOOL_PERMISSIONS）：
  Meta:       [read_file, search_code, list_files]    — 只读
  Code:       FULL_TOOLSET                              — 完整权限（含 run_shell）
  Analysis:   BASE_TOOLSET                              — 不含 run_shell
  Browser:    [...BASE_TOOLSET, "browser_do"]           — 含浏览器操作
  Butler:     []                                        — 无权限

可逆性等级：
  L0: read_file, search_code, list_files
  L2: write_file
  L3: run_shell, delete_file

ConfirmGate 拦截：L2/L3 → 用户确认后才执行（5 分钟超时）
```

**架构技巧**：
- 权限表与工具元数据分离：`AGENT_TOOL_PERMISSIONS` 管"谁能用"，`TOOL_META` 管"工具是什么"
- 目录级沙箱兜底：`_resolvePath()` 约束在 `workspaceRoot` 下
- FileLockManager 防护：write_file 和 delete_file 共享写锁互斥
- `run_shell` 仅 Code / Review / Fix / Ops 持有

---

## 模式十五：Agent 人格化提示词 (Character Prompt)

**文件**：每个 Agent 的 `SYSTEM_PROMPT` 常量

**现象**：每个 Agent 的系统提示词都采用统一的人物扮演风格。

**模式描述**：

```
"🎭 你是「角色名」—— 头衔，Cortex 的 Xxx Agent。"
+ [背景故事 2-3 段]
+ "说话像……：'例1'、'例2'"
+ "──── 工作守则（3-6 条）────"
+ [具体工作约束]
```

**架构技巧**：
- 角色化降低提示词冷感：每个 Agent 有名字、有性格、有说话方式
- 守则中包含 🏠 `回家（MemoryStore）` 提示——每个 Agent 都记得执行前/后检索记忆
- 守则第三条通常是工具使用边界（"你的原料库是 packages/ 和 docs/"）
- 提示词中硬编码页面元素 ID（`#expression`, `#calculateBtn`, `#result`）——消除 LLM 猜测空间

---

## 附录：跨模式关联图

```
类型中枢 (Type Hub)
  ├── 提供 AgentType / SkillTemplate 给
  │    ├── 组合工厂 (Composition Factory)
  │    ├── 状态所有权归一 (Pool-Aware State)
  │    └── 契约化模块边界 (Contract Boundary)
  │
  ├── 提供 TAG_VOCABULARY / AGENT_TAGS 给
  │    ├── 拓扑调度 (Topo Scheduler) — 标签匹配
  │    ├── 技能提取-注册 (Skill Extract) — 标签白名单
  │    └── 多视角并行 (Multi-Perspective) — Agent 类型枚举
  │
  └── 提供 AGENT_TOOL_PERMISSIONS 给
       └── L0-L3 可逆性保护 (Reversibility Gate)

记忆管道 (Memory Pipeline)
  ├── 使用模板方法 (Template Method) — getMemoryQuery 策略注入
  ├── 委派给 Facade (Facade Delegation) — MemoryStore
  └── 产出记忆供
       └── 技能提取-注册 (Skill Extract) — LoopAgent 读取历史模式

类型化事件管道 (Typed Event Bus)
  ├── 被 拓扑调度 用于节点生命周期通知
  ├── 被 错误静默升级 用于双通道上报
  └── 被 契约化模块边界 用于异常语义声明

拓扑调度 (Topo Scheduler)
  ├── 驱动 组合工厂 产出的 Agent 实例
  ├── 与 重规划链 形成调度闭环
  └── 触发 技能提取-注册 的自动沉淀
```

---

*水镜合拢。以上模式已观测到至少 3 次独立出现，符合"三次提笔"原则。*
*下一个出发的人可据此少走弯路。*
