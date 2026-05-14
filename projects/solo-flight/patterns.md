# 🏛️ Cortex 可复用模式手册

> 水镜映照：以下模式均源自 `/cortex/packages/` 实际执行过的代码波纹。
> 每个模式至少出现两次才被收录，三次以上视为成熟模式。
> —— 莫娜·梅姬斯图斯，星天水占术士

---

## 目录

1. [🧩 多重人格架构（Multi-Agent Architecture）](#1-多重人格架构)
2. [🔄 ReAct 循环（ReAct Loop）](#2-react-循环)
3. [🎯 拓扑调度分层（Topological Scheduling）](#3-拓扑调度分层)
4. [📋 标签路由（Tag-Based Routing）](#4-标签路由)
5. [⚙️ 状态机归一化（PoolAwareState）](#5-状态机归一化)
6. [🔭 管道观察者（PipelineObserver）](#6-管道观察者)
7. [🧠 三级漏斗记忆检索（Multi-Channel Memory）](#7-三级漏斗记忆检索)
8. [🎨 平台适配器（PlatformBridge）](#8-平台适配器)
9. [🗄️ SkillRegistry — 技能注册表](#9-技能注册表)
10. [🧪 JSON 提取器（Skill Extractor）](#10-json-提取器)
11. [🔐 确认门（ConfirmGate）](#11-确认门)
12. [📦 门面模式 — MemoryStore](#12-门面模式-memorystore)
13. [🪢 动态投影（Derived MemoryQuery）](#13-动态投影)

---

## 1. 🧩 多重人格架构

**触发标签**: `agent`, `architecture`, `multi-agent`

**触发条件**: 需要将不同领域的复杂任务分派给专门的 LLM 角色执行，每个角色拥有独立的系统提示词、工具权限和行为约束。

**出现次数**: 12 次（每个 Agent 一个实现）

### 步骤序列

1. **定义 AgentType 枚举** — 在 `shared/src/agent.ts` 中列出所有 Agent 类型（`AgentType.Code | Review | Analysis | Ops | Loop | DocGovern | Inspector | Fix | Browser | Api | Data | Strategist ...`）
2. **分配标签词汇表** — 定义 `TAG_VOCABULARY` 封闭集合和 `AGENT_TAGS` 映射表，每个 Agent 声明自己可认领的标签集
3. **分配工具权限** — 在 `AGENT_TOOL_PERMISSIONS` 中声明每种 Agent 的可使用工具列表：
   - 规划者（Meta/Strategist）：只读工具（`read_file`, `search_code`, `list_files`）
   - 执行者（Code/Review/Fix）：完整工具集（含 `run_shell`）
   - 侦察者（Inspector/Analysis/Loop/DocGovern）：基础工具集（不含 `run_shell`）
4. **编写系统提示词** — 每个 Agent 撰写独立的人格/角色提示词，包含角色身份、行为守则、🏠 回家指令
5. **实现 BaseAgent 抽象基类** — 封装生命周期管理（`wakeup → Active → Awake → Draining → Destroyed`）、记忆流水线（`executeWithMemoryPipeline`）和 ReAct 调度
6. **注册到 AgentFactory** — 在 `agent-factory.ts` 中为每种 Agent 类型注册工厂配置，Scheduler 按类型查表创建实例

### 预期产出

一套彼此隔离、各司其职的 Agent 角色体系。新 Agent = 枚举 + 标签 + 权限 + 提示词，四步完成。

---

## 2. 🔄 ReAct 循环

**触发标签**: `react`, `loop`, `agent-execution`, `tool-calling`

**触发条件**: Agent 需要与 LLM 多轮对话，在每一轮中决策调用哪个工具、解析工具结果、直到产出最终答案。

**出现次数**: 10+ 次（BaseAgent.execute → executeWithMemoryPipeline → runReActLoop，所有执行型 Agent 共用）

### 步骤序列

1. **准备上下文** — 组装 `ReActContext` 对象（`agentType`, `llm`, `toolkit`, `systemPrompt`, `maxLoops`, `memory`, `safeReporter`）
2. **构建消息队列** — `[{ role: "system", content: systemPrompt }, { role: "system", content: TOOL_DISCIPLINE }, { role: "user", content: task }]`
3. **生成 ToolDefs** — 从 `toolkit.listDefinitions(agentType)` 获取 function calling schema
4. **进入循环**（上限 `maxLoops` 次）：
   - 临近上限（`maxLoops - 4`）时推送收尾提示
   - 调用 `llm.chat(model, messages, toolDefs, reasoningEffort)`
   - toolCalls 为空 → 提取 content 为最终输出，跳出
   - toolCalls 非空 → 逐条执行工具调用，结果追加到 messages
   - 捕获异常 → 返回带 partial output 的 NodeResult
5. **返回结果** — 超限未产出 → `success: false, error: "Exceeded max loops without final answer"`

### 关键参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `maxLoops` | 64 | 通用 Agent 默认上限 |
| `maxLoops` | 24 | InspectorAgent 专用（降低幻觉风险） |
| `reasoningEffort` | "high" | 大多数任务；"max" 用于审计/宪法检查 |

---

## 3. 🎯 拓扑调度分层

**触发标签**: `scheduler`, `topological-sort`, `task-dispatch`, `parallel`

**触发条件**: 任务树中存在父子依赖关系，需要保证父节点完成后才调度子节点；兄弟节点可并行执行。

**出现次数**: 3+ 次（Scheduler.executeAll → topologicalSort → 逐层 dispatch）

### 步骤序列

1. **构建依赖图** — 遍历 `TaskNode[]`，无 `parentId` 为根节点（第 0 层），有 parentId 加入父节点 children 列表
2. **BFS 分层** — 从根节点开始广度优先遍历：`layers.push(current) → next = children of current → current = next`
3. **逐层并行执行** — 每层内节点通过 `Promise.all(layerPromises)` 并行 dispatch
4. **动态消费** — 主循环不断检查 `getPendingNodes()`，直到无 pending 且无 replan 积压
5. **重规划注入** — MetaAgent 新节点通过旁路入板（领而不执），由下轮循环统一调度

### 预期产出

`ExecutionReport { totalNodes, completed, failed, results[], durationMs }`

---

## 4. 📋 标签路由

**触发标签**: `tag-routing`, `agent-matching`, `dispatch`

**触发条件**: 需要根据任务节点的标签列表，自动匹配最合适的 Agent 类型来执行。

**出现次数**: 4 次（Scheduler._findMatchingAgent + _findAllMatchingAgents + TaskBoard.findPending + TaskBoard.claim）

### 步骤序列

1. **定义映射** — `AGENT_TAGS: Record<AgentType, Tag[]>` 声明每个 Agent 可认领的标签集合
2. **单一匹配（单视角）** — `_findMatchingAgent(node)`:
   - 优先：`node.type` 若为已知 `AgentType` 且已注册 → 直接匹配
   - 回退：对所有注册 Agent 按标签命中数打分
   - 平局打破 1: `node.type === agentType` 加分
   - 平局打破 2: 匹配密度 `score / |tags|` 高的胜出（专精者优先于通才）
3. **批量匹配（多视角）** — `_findAllMatchingAgents(node)` 收集所有有标签交集的 Agent
4. **认领** — `TaskBoard.claim(nodeId, agentType)` 校验标签匹配 + 状态

### 约束

| 约束 | 说明 |
|------|------|
| 标签不得跨类型语义矛盾 | 如 Code 不应包含 "review"，否则导致平局匹配 |
| 标签窄 = 匹配优势 | 标签少的 Agent 在窄标签匹配上天然优于标签多的 |
| 新增 AgentType 必须同步 | 枚举 + TAG_VOCABULARY + AGENT_TAGS + AGENT_TOOL_PERMISSIONS 四表联动 |

---

## 5. ⚙️ 状态机归一化（PoolAwareState）

**触发标签**: `state-machine`, `lifecycle`, `pool`, `status`

**触发条件**: 多个 Agent 类中存在相同的状态管理代码（复制粘贴），需要统一的状态流转校验逻辑。

**出现次数**: 3 次（BaseAgent / ButlerAgent / StrategistAgent → 合并为 PoolAwareState）

### 步骤序列

1. **定义合法流转表** — `VALID_TRANSITIONS: Record<AgentStatus, Set<AgentStatus>>`:
   - `Created → { Awake, Destroyed }`
   - `Awake → { Active, Draining }`
   - `Active → { Awake, Draining }`
   - `Draining → { Destroyed }`
   - `Destroyed → {}`
2. **实现 PoolAwareState 共享组件** — `status` getter + `transition(status)` API：
   - 有 Pool 绑定 → 委托给 `AgentPool.setStatus()`（单权威源）
   - 无 Pool 绑定 → 本地校验，拒绝非法流转
3. **延迟求值标签提供者** — 构造函数接受 `() => string` 解决 abstract property 初始化顺序问题
4. **SafeErrorReporter 集成** — 非法流转自动上报（`severity: "fatal"`），不静默吞错
5. **治理判例归档** — 绕过状态机的直写（如崩溃后强制回收）须经 observer 管道上报

---

## 6. 🔭 管道观察者（PipelineObserver）

**触发标签**: `observer`, `event-bus`, `observability`, `pipeline`

**触发条件**: 需要在系统关键节点（调度、节点生命周期、记忆操作）发射可观测事件，支持多优先级、多订阅者、异常隔离。

**出现次数**: 5+ 次（Scheduler 发射事件 / MemoryStore 错误上报 / AgentPool 违规报告 / TaskBoard invariant 报告）

### 步骤序列

1. **定义事件类型枚举** — `PipelineEventType` 封闭集合，镜像代码库中所有 emit 点
2. **定义 Payload 映射** — `EventPayloadMap` 按事件类型锁定额外字段，编译期约束
3. **注册回调** — `observer.on(priority, handler)`，按 `PipelinePriority` 分级注册，同优先级按注册顺序执行
4. **发射事件** — `observer.emit(event)`：
   - 自动生成 `requestId` 幂等键
   - 只调用与事件优先级匹配的 handler
   - **单 handler 异常不阻断后续**（隔离设计）
5. **SafeErrorReporter 集成** — `silent` 级错误连续发生 3 次自动升级为 `degraded`，非 silent 错误立即重置计数器

### 订阅约定

| 订阅者 | 注册优先级 |
|--------|-----------|
| Sentinel | CRITICAL + HIGH |
| MemoryStore | ALL (CRITICAL + HIGH + NORMAL) |
| 管家 | HIGH + NORMAL |

---

## 7. 🧠 三级漏斗记忆检索

**触发标签**: `memory`, `retrieval`, `fts5`, `vector`, `bfs`, `fusion`

**触发条件**: Agent 在开始任务前需要从 MemoryStore 中检索相关历史记忆，需要多通道混合检索以提高召回质量。

**出现次数**: 3+ 次（MemoryStore.read 管道，每 Agent 每次执行触发）

### 步骤序列

1. **阶段 0 — 探索契约检查** — 每 N=50 轮读取触发一次权重探索：
   - 保存当前通道权重快照
   - 从最高权重通道转移 20% 到最低权重通道
   - 观察 10 轮后回滚（或与手动调整合并）
   - 退火：间隔倍增，上限 1600 轮
2. **阶段 1 — 获取候选集** — 从 SQLite 或内存扫描获取候选记忆条目
3. **阶段 2 — 三级漏斗并行** — 按 `funnelOrder` 顺序执行：
   - **FTS5 通道**：关键词匹配率计算（0.0~1.0）
   - **Vector 通道**：余弦相似度召回（仅当提供 queryEmbedding 时）
   - **BFS 通道**：以候选集为种子沿关联边展开（深度可配）
4. **阶段 3 — 通道加权融合** — memory_id 去重，冷启动降级以 0.5 折扣计入
5. **阶段 4-5 — 时间衰减** — weight 衰减因子 = `max(0.1, 1 - ageDays/30)`
6. **阶段 6-7 — FSA 因果归因** — 检索到的记忆标记 `_retrievedAt` / `_retrievalChannel`

| 通道 | 默认权重 | 说明 |
|------|---------|------|
| `fts5` | 1/3 | 关键词精确匹配 |
| `vector` | 1/3 | 语义向量相似度 |
| `bfs` | 1/3 | 图关联遍历展开 |

---

## 8. 🎨 平台适配器（PlatformBridge）

**触发标签**: `platform`, `adapter`, `cli`, `electron`, `bridge`

**触发条件**: 系统需要支持多种运行平台（CLI终端 / Electron GUI），不同平台下用户交互方式不同（stdin vs 弹窗）。

**出现次数**: 2 次（CLIAdapter 实现 + ElectronAdapter 预埋）

### 步骤序列

1. **定义 PlatformBridge 接口** — `confirm()`, `notify()`, `getPlatformContext()`
2. **定义 PlatformKind 枚举** — `CLI | Electron`
3. **CLIAdapter 实现** — 基于 `node:readline`：
   - `confirm()`：通过 `rl.question(prompt)` 阻塞等待用户 `y/N` 输入
   - `notify()`：写入 `process.stdout`
   - 惰性初始化 readline 接口，避免重复监听 stdin
4. **注入到 ConfirmGate** — `confirmGate.setBridge(bridge)` 启用真实用户交互
5. **无 bridge 降级** — 测试模式下挂起等待外部 `resolve()` 调用，支持超时

---

## 9. 🗄️ 技能注册表（SkillRegistry）

**触发标签**: `skill-registry`, `template`, `skills`, `registry`

**触发条件**: LoopAgent 从已完成任务中提炼了可复用的工作流模板，需要结构化存储、按标签查询、支持持久化。

**出现次数**: 3+ 次（SkillRegistry 类 + MetaAgent 查询 + Scheduler 注册）

### 步骤序列

1. **定义 SkillTemplate 接口** — id, agentType, name, triggerTags, trigger, steps, expectedOutput, outputFile?, status, adoptionCount, rejectionCount, discoveredBy, createdAt
2. **三重索引** — 注册时构建：`_byTag`（标签索引）、`_byAgent`（类型索引）、`_byId`（主键索引）
3. **查询规则** — `queryByTags(queryTags)`：`template.triggerTags ∩ queryTags ≠ ∅`，仅返回 `active | trial`
4. **状态升级流程** — `draft → trial`（需人工审核）`→ active`（被采纳并成功执行）`→ deprecated`（连续拒绝 ≥3 次）
5. **持久化** — `saveJson(filePath)` / `loadJson(filePath)`，JSON 序列化

---

## 10. 🧪 JSON 提取器（Skill Extractor）

**触发标签**: `json-extraction`, `llm-output`, `parsing`, `normalization`

**触发条件**: 需要从 LLM 自由文本输出中可靠地提取结构化 JSON（含围栏、容错、字段校验）。

**出现次数**: 3 次（skill-extractor.ts + MetaAgent._extractJson + MetaAgent._tryParseItems）

### 步骤序列

1. **提取 JSON 子串** — 多级回退策略：
   - 优先匹配 ` ```json ... ``` ` 围栏（非贪婪）
   - 回退：找到第一个 `{` 或 `[` → 平衡括号匹配提取
   - **字符串边界感知**：跳过 JSON 字符串内的 `[ ] { }` 字符
2. **解析 JSON** — 三级容错：
   - 直接 `JSON.parse`
   - 去除尾部多余逗号后重试（`/,\s*([}\]])/g → $1`）
   - 截取首 `[` 到末 `]` 后重试
3. **规范化验证** — 对每个条目执行：
   - `id` 缺失 → 自动生成 `skill-${Date.now()}-${random}`
   - `name` 缺失 → 跳过（必需字段）
   - `agentType` → 支持短名别名（如 `cod→Code`, `rev→Review`）
   - `triggerTags` → 过滤不在词汇表中的标签
   - `steps` → 非数组时尝试 `split(/[,，]/)` 容错
   - `status` → 永远不允许 LLM 自声明 `active`，强制降级为 `trial`
4. **诊断收集** — 所有跳过/降级/修正记录写入 `diagnostics[]`，不阻塞提取

---

## 11. 🔐 确认门（ConfirmGate）

**触发标签**: `confirmation`, `guard`, `reversibility`, `safety`

**触发条件**: 工具调用根据可逆性等级需要用户确认（L2=不可逆写入 / L3=不可恢复），需要统一的确认机制。

**出现次数**: 2+ 次（Toolkit.execute + ConfirmGate 类）

### 步骤序列

1. **定义可逆性等级** — `ReversibilityLevel` 枚举：
   - L0 — 纯读取，永不确认
   - L1 — 可逆写入，信任够则放行
   - L2 — 不可逆写入，永远确认
   - L3 — 不可恢复，永远确认
2. **工具元数据标注** — `read_file: L0, write_file: L2, run_shell: L3, delete_file: L3`
3. **执行前拦截** — `gate.needsConfirmation(level)` → `gate.request()` → `gate.waitFor(reqId, timeout)`
4. **PlatformBridge 集成** — 有 bridge 走真实用户交互，无 bridge 挂起
5. **测试模式 bypass** — `gate.bypassAll()`（生产环境调用抛错）

---

## 12. 📦 门面模式 — MemoryStore

**触发标签**: `facade`, `memory`, `storage`, `persistence`

**触发条件**: 记忆系统包含多个子系统（内存存储、SQLite 持久化、状态机生命周期、查询引擎），需要对外提供统一的简洁 API。

**出现次数**: 1 次（MemoryStore 类），内部委托 4 子组件

### 步骤序列

1. **核心子系统拆分**：
   - `MemoryStorage` — Map 内存存储 + 反序列化 + peek 冻结副本
   - `MemoryPersistence` — SQLite WAL 模式持久化，write-through + 防抖 flush
   - `MemoryLifecycle` — 四态状态机（CAS / archive / freeze / obliterate）
   - `MemoryQueryEngine` — 内存扫描 + BFS 图遍历 + 向量召回
2. **Facade 暴露统一 API** — `write()`, `read()`, `link()`, `cas/archive/freeze/obliterate`
3. **异常语义契约** — DB 失败回滚内存（假阳性禁止），SQL 退化至内存扫描
4. **惰性持久化** — 不调 `init(dbPath)` 则纯内存运行

---

## 13. 🪢 动态投影（Derived MemoryQuery）

**触发标签**: `projection`, `memory-query`, `dynamic`, `derivation`

**触发条件**: 不同 Agent 在不同任务阶段需要不同的记忆检索策略（广度 vs 深度、不同记忆类型、不同关联边类型）。不能硬编码查询参数，需要在每次检索时动态推导。

**出现次数**: 4+ 次（deriveMemoryQuery 函数 + MemoryStore.forAgent + pipeline.ts 调用）

### 步骤序列

1. **定义常量映射表**（编译时确定，运行时投影）：
   - `AGENT_QUERY_MODE: AgentType → "hca" | "csa"` — 注意力模式
   - `AGENT_MEMORY_TYPES: AgentType → MemoryType[]` — 记忆类型
   - `AGENT_LINK_TYPES: AgentType → LinkType[]` — 关联边白名单
   - `PHASE_BFS_DEPTH: taskPhase → number` — BFS 遍历深度
   - `AGENT_LIMIT: AgentType → number` — 返回数量
   - `AGENT_STATES: AgentType → MemoryState[]` — 记忆状态过滤
2. **主推导函数** `deriveMemoryQuery(agentType, taskPhase?, context?)`：
   - queryMode: AgentType 默认 → taskPhase 覆盖
   - bfsDepth: taskPhase 决定（planning=1, execution=2, review=3）
   - limit: AgentType 定制 > queryMode 默认
   - keywords: 从 context 提取（CJK 2-gram + 拉丁词 >3字符）
3. **调用方式** — `memory.forAgent({ agentType, taskPhase, context }) → deriveMemoryQuery → memory.read(query)`

### 查询模式

| 模式 | 名称 | 适用场景 | BFS深度 | limit | 访问追踪 |
|------|------|---------|---------|-------|---------|
| `hca` | 广度浅读 | MetaAgent 规划 / Inspector 侦察 | 1 | 10 | ❌ |
| `csa` | 深度窄读 | 执行型 Agent 代码/审查/修复 | 2 | 3~10 | ✅ |

Agent 无需理解记忆检索的 8+ 个参数——投影规则自动算出该查什么、查多少、怎么查。

---

## 📌 模式索引速查

| # | 模式 | 核心文件 | 复用方式 |
|---|------|---------|---------|
| 1 | 多重人格架构 | `shared/src/agent.ts`, `engine/src/base-agent.ts` | 添加 Agent 类型 |
| 2 | ReAct 循环 | `engine/src/components/react-loop.ts` | 直接调用 `runReActLoop()` |
| 3 | 拓扑调度 | `engine/src/scheduler.ts` → `topologicalSort()` | 任务编排 |
| 4 | 标签路由 | `engine/src/scheduler.ts` → `_findMatchingAgent()` | 自动匹配 |
| 5 | 状态机归一化 | `engine/src/pool-aware.ts` → `PoolAwareState` | 共享组件 |
| 6 | 管道观察者 | `engine/src/pipeline-observer.ts` | 事件订阅 |
| 7 | 三级漏斗记忆 | `engine/src/memory-store.ts` → `read()` | 记忆检索 |
| 8 | 平台适配器 | `shared/src/cli-adapter.ts` | 实现接口 |
| 9 | 技能注册表 | `shared/src/skill-registry.ts` | 注册/查询 |
| 10 | JSON 提取器 | `engine/src/components/skill-extractor.ts` | 提取函数 |
| 11 | 确认门 | `engine/src/confirm-gate.ts` | 工具执行拦截 |
| 12 | 门面模式 | `engine/src/memory-store.ts` | 统一 API |
| 13 | 动态投影 | `engine/src/memory/projection-rules.ts` | 配置表驱动 |
