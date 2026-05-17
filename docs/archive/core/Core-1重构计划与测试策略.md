# Core-1 阶段——重构计划与测试策略

> 依据宪法 v2.0。从 Meso-Lite 原型代码向工具链架构重构。

---

## 一、重构范围

### 1.1 保留

| 组件 | 保留原因 | 处理 |
|------|---------|------|
| ConfirmGate | 核心逻辑不变 | 从 Engine 中拆出，升级（TrustModel 集成） |
| CoroutineRunner | ReAct 循环不变 | 从 PillarRunner 中提取，通用化给 Agent |
| 测试框架 | Mock+E2E 基础设施 | 保留，适配新接口 |
| `read_file/list_dir/search_code/write_file/run_shell` 工具 | 底层适配不变 | 保留 |

### 1.2 删除

| 组件 | 原因 |
|------|------|
| PillarId 19 枚举 → AgentType 6 枚举 | 柱→Agent |
| CodePillar/SummarizePillar/SafetyPillar | 被 Agent 配置替代 |
| ReadOnlyToolInvoker/SafetyToolInvoker | 权限下放到 Agent.allowedTools |
| InMemoryTransport + EventBus | PipelineObserver 替代 |
| CommitteeManager | 删除，会议是模式 |
| 交融支撑组件 (staining/lifecycle/projection/types) | 开会替代 |
| CortextEngine.handleExecute() switch-case | 拆分 |

### 1.3 新建

| 组件 | 说明 |
|------|------|
| AgentPool | Agent 实例管理（创建/回收/配额） |
| TaskBoard | 任务板 + claim 原子操作 |
| MetaAgent | 从 Engine 中独立 |
| CodeAgent/ReviewAgent/AnalysisAgent | Agent 类型（配置化，非独立类） |
| OpsAgent/LoopAgent/DocGovernAgent | Agent 类型 |
| PipelineObserver | 优先级回调注册表 |
| TrustModel | 信任模型 |
| FileLockManager | 文件级锁 |
| ToolRegistry | 工具目录 |
| Sentinel（骨架） | 4 检测模式框架，可后续填充 |

---

## 二、测试策略

### 2.1 原则

**少量多次，最简原则。**

- 每个新组件先写 1 个最简测试，通过后再补边界
- 不追求覆盖率，追求行为正确性
- Mock 测试优先于真实 LLM 测试
- 每次只集成 1 个新组件到管线

### 2.2 测试分轮

#### 第一轮：基础设施（Mock only，0 LLM 调用）

| 组件 | 最简测试 |
|------|---------|
| ToolRegistry | 注册工具→查询→正确返回 |
| TaskBoard | 创建节点→Agent claim→拒绝重复认领 |
| AgentPool | 创建 CodeAgent→分配→回收 |
| ConfirmGate | L1/L2/L3 分级拦截（mock 用户响应） |
| FileLockManager | 写锁排斥→读锁共存 |
| PipelineObserver | 注册 handler→emit→handler 被调用 |

#### 第二轮：单 Agent 执行（真实 LLM，1 Agent）

| 组件 | 最简测试 |
|------|---------|
| CodeAgent | 认领 "写 hello world 函数" 节点 → 产出代码 |
| ReviewAgent | 认领 "审查一段代码" 节点 → 产出审查意见 |
| MetaAgent | 收到 "实现登录" → 产出任务树 |

#### 第三轮：多 Agent 协作（真实 LLM，2-3 Agent）

| 场景 | 最简测试 |
|------|---------|
| 串行 | CodeAgent 产出 → ReviewAgent 审查 |
| 开会 | needsMultiPerspective 节点 → 2 Agent 并行认领 |
| 重规划 | CodeAgent 失败 → MetaAgent 重规划 |

#### 第四轮：完整管线（真实 LLM，全栈）

| 场景 | 最简测试 |
|------|---------|
| 端到端 | 用户意图 → 规划 → 执行 → 审查 → 交付 |
| 确认门 | L2 操作 → 确认弹窗 → 用户确认 → 通过 |
| 常设委员会 | DocGovernAgent 审计 → 产出报告 |

### 2.3 Core-1 纯 CLI 验证

宪法决策为 CLI + Electron 双形态并存，但 Core-1 的定位是**原型验证而非产品发布**。为防止"过早 UI 化"（和 v1.1 的"过早架构化"同源），Core-1 **冻结 Electron 一切开发**，全部测试在纯 CLI 环境下完成。

| 形态 | Core-1 | 原因 |
|------|--------|------|
| **CLI** | ✅ 所有四轮 | 最少变量——Engine 行为验证不需要 UI 噪声 |
| **Electron** | ❌ 冻结到 Core-2 | IPC 链路会制造"Engine 还是 Electron"的调试迷宫 |

**原则**：Core-1 的退出标准是 v2.0 核心链路在 CLI 下的行为正确性。PlatformBridge 只建 CLIAdapter 一个实现。ElectronAdapter 在 Core-2 拿着已验证的 Bridge 接口去"冲击"，撞出裂缝再修。

### 2.4 测试数量目标

| 轮次 | 最少测试数 | 平台 | 说明 |
|------|-----------|------|------|
| 第一轮 | 6 | CLI | 每个基础设施 1 个 |
| 第二轮 | 3 | CLI | 每个单 Agent 1 个 |
| 第三轮 | 3 | CLI | 每个协作场景 1 个 |
| 第四轮 | 3 | CLI | 每个全栈场景 1 个 |
| **总计** | **15** | CLI only | 最简路径，Core-2 追加 Electron |

## 三、平台抽象层设计要点

Engine 与 UI 之间通过 PlatformBridge 抽象：

```
Engine (平台无关)
    │
PlatformBridge
    └── CLIAdapter     → stdin/stdout + 确认门终端交互（Core-1 唯一实现）
    └── ElectronAdapter → IPC + Notification + 确认门系统弹窗（Core-2）
```

PlatformBridge 暴露（Core-1 仅实现 CLI 语义）：
- `confirm(request): Promise<ConfirmResponse>` —— CLI 下为 stdin 阻塞等待
- `notify(observation): void` —— CLI 下为 stdout 输出
- `getPlatformContext(): PlatformContext` —— CLI 下固定返回 `{ kind: CLI, foreground: true, idle: false }`

Bridge 接口在 Core-1 保持最简——只服务 CLI。Electron 会在 Core-2 去撞这个接口，撞出裂缝再修。好的抽象是生长出来的，不是设计出来的。

---

## 四、Core 阶段的 Meso 前车之鉴

| Meso 阶段错误 | Core 阶段对策 |
|-------------|-------------|
| 19柱分类在仅3个实现时固化 | Agent 类型从 6 开始，加一个需新权限组合 |
| 确认门过度工程化（54+68行 vs 0行重规划） | 每个组件先最简实现，token 成本跟踪后再优化 |
| 上帝类 Engine 771行 | 每轮拆分一个职责，不允许回退 |
| 44事件类型仅20在用 | PipelineObserver 从 4-5 个事件类型起步 |
| 0 生产订阅者假装有 pub-sub | PipelineObserver 必须每个 handler 有对应测试 |
| 测试覆盖151远超需求但核心行为未验证 | 15 个最简测试先通，再加边界 |

---

## 五、Core-1 当前实施进度（截至 2026-05-04）

### 5.1 包结构

Core-1 实施后，Meso-Lite 的 10 包 monorepo 精简为 **3 包**：

| 包 | 职责 | 状态 |
|----|------|------|
| `@cortex/shared` | 所有类型定义（接口/枚举/类型），不依赖任何包 | ✅ 完成 |
| `@cortex/engine` | 全部运行时实现：AgentRunner、Scheduler、MemoryStore、MetaAgent、TaskBoard、ConfirmGate、PipelineObserver、FileLockManager、AgentPool、ToolRegistry、LlmAdapter、Toolkit | ✅ 核心完成 |
| `@cortex/testing` | Mock 基础设施（MockLlmAdapter、MockToolkit、buildTestNode 等） | ✅ 完成 |

**依赖方向**（依赖倒置原则）：
```
shared（抽象层，零依赖）
  ↑
engine（实现层，依赖 shared）
  ↑
testing（测试支撑，依赖 shared）
```

### 5.1A 协议约束清单（Protocol Invariants）

以下约束定义组件间"应该怎么用"——不是类型系统能表达的，是运行时契约。

#### MemoryStore

| # | 约束 |
|---|------|
| M1 | `write()` 是唯一入口，新记忆 `state=Active` |
| M2 | **禁止直改 `state`**——`peek()` 返回冻结副本，唯一状态入口是 `cas()` |
| M3 | `read()` 默认返回 Active + 30天窗口内 |
| M4 | `read()` 中 `trackAccess=false` 为 HCA，不累加 accessCount，不刷新 lastAccessedAt |
| M5 | `read()` 中 `trackAccess=true` (CSA 默认) 累加 accessCount + 刷新 lastAccessedAt |
| M6 | `cas(expected, desired)` 原子：expected 匹配→新值，不匹配→false |
| M7 | 四态流转：Active→Archived，Active|Archived→Frozen，Active|Archived|Frozen→Obliterated。**Obliterated 不可逆，Frozen 不可回退** |
| M8 | `freeze()`/`obliterate()` 内部走 `cas()`，不做重复校验（单一出口原则） |
| M9 | `link()` 拒绝任一端为 Obliterated |

#### TaskBoard

| # | 约束 |
|---|------|
| T1 | `claim()` 原子：普通 `pending`→`claimed`，multi-perspective 同类型不重复 |
| T2 | `release()` 仅 `claimed`→`pending`，认领者本人。running/done/failed 拒绝 |
| T3 | `complete()` 仅 claimedBy 中的 Agent 可提交，结果不可逆（终态） |
| T4 | **`release()` 与 `complete()` 职责分离**：释放≠失败 |
| T5 | Scheduler spawn 失败→`release()`，非 `complete(false)` |

#### Agent 注入

| # | 约束 |
|---|------|
| C1 | ConfirmGate / FileLockManager 构造时注入 Toolkit，非 setter |
| C2 | Agent 不持 Gate/LockManager 引用，通过 Toolkit 间接使用 |
| C3 | Scheduler 不调 `agent.setGate/setLockManager`（方法已删除） |
| C4 | `IConfirmGate`/`IFileLockManager` 在 shared 定义最小接口 |

#### Agent 执行契约

| # | 约束 |
|---|------|
| A1 | Agent 接收 TaskNode→返回 NodeResult，不持 TaskBoard 引用 |
| A2 | Agent 不调 `TaskBoard.claim/complete/release`——Scheduler 负责 |
| A3 | `memory` 参数可选但存在时必用：`read()` 检索 → `write()` EPISODIC |
| A4 | 执行成功后写 EPISODIC + link：`write()` → `link(EPISODIC, ctx, PRODUCED_BY)` |

#### 依赖方向

| # | 约束 |
|---|------|
| D1 | shared 零依赖（不 import engine 任何内容） |
| D2 | engine 不 import testing（测试隔离） |
| D3 | `@cortex/shared` 类型不在 engine 中重复定义 |

### 5.2 已删除的空壳包

以下 4 个包在 Meso-Lite 为独立包，在 Core-1 中其功能已并入 `@cortex/engine`，原包目录已删除：

| 原包名 | 功能 | Core-1 去向 |
|--------|------|-----------|
| `@cortex/memory` | sql.js MemoryStore | → `engine/src/memory-store.ts`（内存级 Map 实现，议题四兼容） |
| `@cortex/meta-agent` | 关键词分类 + 模板任务树 | → `engine/src/meta-agent.ts` |
| `@cortex/scheduler` | 拓扑排序 + 节点调度 | → `engine/src/scheduler.ts` |
| `@cortex/doc-govern` | （仅 shell，无实现） | 删除 |

### 5.3 已建成组件

| 组件 | 文件 | 行数 | 测试 | 说明 |
|------|------|------|------|------|
| **MemoryStore** | `engine/src/memory-store.ts` | 279 | 24 | 议题四兼容：4 种记忆类型、4 种状态、7 种链接类型、30 天 TTL、关键词匹配、CAS 四态封闭、peek() 冻结只读 |
| **Scheduler** | `engine/src/scheduler.ts` | 443 | 9 | 拓扑排序（BFS 分层）、逐层并行调度、单/多视角路由、PipelineObserver 事件、spawn 失败走 release() |
| **AgentRunner** | `engine/src/agent-runner.ts` | ~240 | 2 | ReAct 循环 + MemoryStore 集成（executeWithMemory） |
| **TaskBoard** | `engine/src/task-board.ts` | ~163 | 1 | 任务板 + claim/release/complete 原子操作 + getAllNodes |
| **MetaAgent** | `engine/src/meta-agent.ts` | ~140 | 1 | LLM 驱动的任务规划 |
| **ConfirmGate** | `engine/src/confirm-gate.ts` | ~50 | 1 | L0/L1/L2/L3 可逆性分级拦截 |
| **PipelineObserver** | `engine/src/pipeline-observer.ts` | ~40 | 1 | 优先级回调注册表（CRITICAL/HIGH/NORMAL） |
| **FileLockManager** | `engine/src/file-lock-manager.ts` | ~50 | 1 | 文件级读/写锁 |
| **AgentPool** | `engine/src/agent-pool.ts` | ~45 | 1 | Agent 实例创建/回收/配额 |
| **ToolRegistry** | `engine/src/tool-registry.ts` | ~25 | 1 | 工具注册/查询 |
| **Toolkit** | `engine/src/toolkit.ts` | ~90 | - | 工具实现集合 |
| **LlmAdapter** | `engine/src/llm-adapter.ts` | ~100 | - | LLM 调用适配层 |

**总计**：~1500 行实现代码，**170+ 个测试全部通过**（已超过 Core-1 规划的 15 个最简测试目标）。

**E2E 压力测试场景（3 个新增）**：

| 暗雷 | 场景 | 文件 |
|------|------|------|
| R7 | 多视角 spawn 失败自愈——release() 释放失败 Agent 类型，其他继续执行 | task-board-stress.test.ts |
| R8 | claim-release 竞态压测——100 轮高频循环不产生僵尸节点 | task-board-stress.test.ts |
| R9 | MemoryStore CAS 并发防改写——peek() 深冻结、concurrent CAS 竞态验证 | task-board-stress.test.ts |

### 5.4 待建组件

| 组件 | 说明 | 优先级 |
|------|------|--------|
| TrustModel | 信任模型（按 Agent 类型+风险域聚合） | Core-1 后续 |
| Sentinel | 安全规则引擎 4 模式（骨架可先行） | Core-2 |
| SkillRegistry + SkillExecutor | 技能模板存储与执行 | Core-2 |
| PlatformBridge + CLIAdapter | Engine 与 UI 之间的平台抽象 | Core-1 后续 |
| ElectronAdapter | Electron IPC 适配 | Core-2 |

---

**文档状态**：Core-1 反思后更新。协议层落地完成（TaskBoard release 原语含 multi-perspective 死锁修复、MemoryStore CAS 封闭 + `_safeDbRun` 安全写 + 写路径 DB 失败回滚、SafeErrorReporter 统一错误上报、AgentPool 单一权威源 + VALID_TRANSITIONS 表驱动）。170+ 测试全部通过（含 R7-R9 三个新 E2E 场景），P0 全部闭合，自审视 7 Agent 并行验证通过。
